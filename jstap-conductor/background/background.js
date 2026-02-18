// JS-Tap Conductor - Background Script
// Manages ticket storage, cookie setting, header injection, proxy mode, and ticket history

let ticketsByDomain = {};

// Proxy mode state
let proxyEnabled = false;
let proxyAddress = '127.0.0.1';
let proxyPort = 8445;
let proxyAuthHeader = '';  // Pre-computed "Basic ..." (kept for storage compat)
let proxyUsername = 'proxy';
let proxyPassword = '';

// Ticket history (last 10 tickets, newest first)
let ticketHistory = [];
const MAX_HISTORY = 10;

// Load saved state on startup
browser.storage.local.get(['ticketsByDomain', 'proxyEnabled', 'proxyAddress', 'proxyPort', 'proxyAuthHeader', 'proxyUsername', 'proxyPassword', 'ticketHistory']).then(result => {
  if (result.ticketsByDomain) {
    ticketsByDomain = result.ticketsByDomain;
  }
  if (result.proxyAddress) proxyAddress = result.proxyAddress;
  if (result.proxyPort) proxyPort = result.proxyPort;
  if (result.proxyAuthHeader) proxyAuthHeader = result.proxyAuthHeader;
  if (result.proxyUsername) proxyUsername = result.proxyUsername;
  if (result.proxyPassword) proxyPassword = result.proxyPassword;
  if (result.ticketHistory) ticketHistory = result.ticketHistory;
  if (result.proxyEnabled) {
    proxyEnabled = true;
    enableProxyHandler();
  }
});

function saveTickets() {
  browser.storage.local.set({ ticketsByDomain });
}

function saveProxySettings() {
  browser.storage.local.set({ proxyEnabled, proxyAddress, proxyPort, proxyAuthHeader, proxyUsername, proxyPassword });
}

function saveHistory() {
  browser.storage.local.set({ ticketHistory });
}

// Normalize domain for matching (strip leading dot)
function normalizeDomain(domain) {
  return domain.replace(/^\./, '');
}

// Check if a URL's hostname matches a ticketed domain
function getDomainTicket(hostname) {
  for (const domain of Object.keys(ticketsByDomain)) {
    const norm = normalizeDomain(domain);
    if (hostname === norm || hostname.endsWith('.' + norm)) {
      return ticketsByDomain[domain];
    }
  }
  return null;
}

// Set all cookies from a ticket
async function setCookies(ticket) {
  for (const cookie of ticket.cookies) {
    const protocol = cookie.secure ? 'https' : 'http';
    const cookieDomain = cookie.domain || ticket.domain;
    const host = normalizeDomain(cookieDomain);
    const url = protocol + '://' + host + (cookie.path || '/');

    const cookieDetails = {
      url: url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path || '/',
      secure: !!cookie.secure,
      httpOnly: !!cookie.httpOnly
    };

    // Set domain only if it starts with a dot (subdomain-scoped)
    if (cookie.domain && cookie.domain.startsWith('.')) {
      cookieDetails.domain = cookie.domain;
    }

    // Map sameSite values
    const sameSite = (cookie.sameSite || '').toLowerCase();
    if (sameSite === 'strict') {
      cookieDetails.sameSite = 'strict';
    } else if (sameSite === 'lax') {
      cookieDetails.sameSite = 'lax';
    } else {
      cookieDetails.sameSite = 'no_restriction';
    }

    if (cookie.expirationDate) {
      cookieDetails.expirationDate = cookie.expirationDate;
    }

    try {
      await browser.cookies.set(cookieDetails);
    } catch (e) {
      console.warn('[JS-Tap Conductor] Failed to set cookie:', cookie.name, e);
    }
  }
}

// Clear cookies for a domain
async function clearCookies(domain) {
  const ticket = ticketsByDomain[domain];
  if (!ticket) return;

  for (const cookie of ticket.cookies) {
    const protocol = cookie.secure ? 'https' : 'http';
    const cookieDomain = cookie.domain || domain;
    const host = normalizeDomain(cookieDomain);
    const url = protocol + '://' + host + (cookie.path || '/');
    try {
      await browser.cookies.remove({ url, name: cookie.name });
    } catch (e) {
      console.warn('[JS-Tap Conductor] Failed to remove cookie:', cookie.name, e);
    }
  }
}


// ---------------------------------------------------------------------------
// Ticket history management
// ---------------------------------------------------------------------------

function addToHistory(ticket, active) {
  const type = ticket.type || 'clone';
  // Key for dedup: domain for clone tickets, 'proxy:'+domains for proxy tickets
  const key = type === 'proxy'
    ? 'proxy:' + (ticket.domains || []).sort().join(',')
    : 'clone:' + ticket.domain;

  // Remove existing entry with same key
  ticketHistory = ticketHistory.filter(h => h.key !== key);

  // Build display label
  const label = type === 'proxy'
    ? (ticket.beaconNickname || (ticket.domains || []).join(', ') || 'proxy')
    : ticket.domain;

  ticketHistory.unshift({
    key: key,
    label: label,
    type: type,
    generated: ticket.generated || new Date().toISOString(),
    ticket: ticket,
    active: active,
  });

  // Trim to max
  if (ticketHistory.length > MAX_HISTORY) {
    ticketHistory = ticketHistory.slice(0, MAX_HISTORY);
  }

  saveHistory();
}

function setHistoryActive(key, active) {
  const entry = ticketHistory.find(h => h.key === key);
  if (entry) {
    entry.active = active;
    saveHistory();
  }
}


// ---------------------------------------------------------------------------
// Proxy mode — route traffic through JS-Tap MITM proxy
// ---------------------------------------------------------------------------

function proxyRequestHandler(requestInfo) {
  // Route traffic through the JS-Tap MITM proxy, EXCEPT requests to
  // the proxy host itself (JS-Tap server, admin UI, WebSocket, etc.)
  // to avoid circular routing.
  try {
    const url = new URL(requestInfo.url);
    const host = url.hostname;

    // Don't proxy requests to the JS-Tap server / proxy host
    if (host === proxyAddress ||
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1') {
      console.log('[JS-Tap Conductor] DIRECT (local):', requestInfo.url);
      return { type: 'direct' };
    }

    console.log('[JS-Tap Conductor] PROXY:', requestInfo.url, '->', proxyAddress + ':' + proxyPort);
  } catch (e) {
    console.log('[JS-Tap Conductor] DIRECT (parse error):', requestInfo.url);
    return { type: 'direct' };
  }

  // Auth is handled by onAuthRequired listener, not inline config
  return { type: 'http', host: proxyAddress, port: proxyPort };
}

function enableProxyHandler() {
  browser.proxy.onRequest.addListener(proxyRequestHandler, { urls: ['<all_urls>'] });
  console.log('[JS-Tap Conductor] Proxy mode enabled:', proxyAddress + ':' + proxyPort, proxyPassword ? '(authenticated)' : '(no auth)');
}

function disableProxyHandler() {
  browser.proxy.onRequest.removeListener(proxyRequestHandler);
  console.log('[JS-Tap Conductor] Proxy mode disabled');
}

// Auto-supply proxy credentials when the proxy responds with 407
browser.webRequest.onAuthRequired.addListener(
  function(details) {
    if (details.isProxy && proxyEnabled && proxyPassword) {
      return {
        authCredentials: {
          username: proxyUsername,
          password: proxyPassword
        }
      };
    }
  },
  { urls: ['<all_urls>'] },
  ['blocking']
);


// ---------------------------------------------------------------------------
// Activate / deactivate tickets
// ---------------------------------------------------------------------------

async function activateCloneTicket(ticket) {
  ticketsByDomain[ticket.domain] = ticket;
  saveTickets();
  if (!proxyEnabled) {
    await setCookies(ticket);
  }
}

async function deactivateCloneTicket(domain) {
  if (ticketsByDomain[domain]) {
    await clearCookies(domain);
    delete ticketsByDomain[domain];
    saveTickets();
  }
}

function activateProxyTicket(ticket) {
  // Deactivate any currently active proxy ticket first
  deactivateProxyTicket();

  proxyAddress = ticket.proxy.host;
  proxyPort = ticket.proxy.port;
  proxyUsername = ticket.proxy.username || 'proxy';
  proxyPassword = ticket.proxy.password || '';
  proxyAuthHeader = 'Basic ' + btoa(proxyUsername + ':' + proxyPassword);
  proxyEnabled = true;

  enableProxyHandler();
  saveProxySettings();
}

function deactivateProxyTicket() {
  if (proxyEnabled) {
    proxyEnabled = false;
    disableProxyHandler();
    saveProxySettings();
  }
  // Mark all proxy history entries as inactive
  ticketHistory.forEach(h => {
    if (h.type === 'proxy') h.active = false;
  });
  saveHistory();
}


// ---------------------------------------------------------------------------
// Header injection via blocking webRequest
// In proxy mode, skip local injection — the beacon handles credentials.
// We still inject User-Agent locally since the proxy doesn't modify that
// on the wire between operator browser and JS-Tap (only the beacon's
// outgoing fetch does, but the target site sees the beacon's fetch headers).
// Actually, in proxy mode the beacon handles UA too, so skip everything.
// ---------------------------------------------------------------------------

browser.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    // Skip header injection entirely when in proxy mode —
    // the beacon injects credentials at the endpoint
    if (proxyEnabled) return {};

    const url = new URL(details.url);
    const ticket = getDomainTicket(url.hostname);
    if (!ticket) return {};

    const headers = details.requestHeaders;

    // Inject captured headers (Authorization, API keys, etc.)
    for (const h of ticket.headers) {
      const idx = headers.findIndex(rh => rh.name.toLowerCase() === h.name.toLowerCase());
      if (idx !== -1) {
        headers[idx].value = h.value;
      } else {
        headers.push({ name: h.name, value: h.value });
      }
    }

    // Replace User-Agent
    if (ticket.userAgent) {
      const uaIdx = headers.findIndex(h => h.name.toLowerCase() === 'user-agent');
      if (uaIdx !== -1) {
        headers[uaIdx].value = ticket.userAgent;
      }
    }

    return { requestHeaders: headers };
  },
  { urls: ['<all_urls>'] },
  ['blocking', 'requestHeaders']
);

// Message handling from popup and content scripts
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'IMPORT_TICKET') {
    try {
      let ticketJson;
      try {
        ticketJson = atob(msg.data);
      } catch (e) {
        // Not base64, try raw JSON
        ticketJson = msg.data;
      }
      const ticket = JSON.parse(ticketJson);
      const ticketType = ticket.type || 'clone';

      if (ticketType === 'proxy') {
        // Proxy ticket — auto-configure proxy
        if (!ticket.proxy || !ticket.proxy.host || !ticket.proxy.port) {
          sendResponse({ success: false, error: 'Invalid proxy ticket: missing proxy config' });
          return;
        }
        activateProxyTicket(ticket);
        addToHistory(ticket, true);
        sendResponse({
          success: true,
          ticketType: 'proxy',
          domain: (ticket.domains || []).join(', ') || 'proxy',
          port: ticket.proxy.port,
        });
      } else {
        // Clone ticket — existing behavior
        if (!ticket.domain) {
          sendResponse({ success: false, error: 'Invalid ticket: missing domain' });
          return;
        }
        activateCloneTicket(ticket).then(() => {
          addToHistory(ticket, true);
          sendResponse({ success: true, ticketType: 'clone', domain: ticket.domain });
        });
        return true; // async response
      }
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }

  if (msg.type === 'GET_TICKETS') {
    const summary = {};
    for (const [domain, ticket] of Object.entries(ticketsByDomain)) {
      summary[domain] = {
        domain: ticket.domain,
        cookieCount: ticket.cookies.length,
        headerCount: ticket.headers.length,
        localStorageCount: ticket.localStorage.length,
        sessionStorageCount: ticket.sessionStorage.length,
        urls: ticket.urls || [],
        userAgent: ticket.userAgent || '',
        browser: ticket.browser || '',
        platform: ticket.platform || ''
      };
    }
    sendResponse({ tickets: summary });
  }

  if (msg.type === 'CLEAR_TICKET') {
    const domain = msg.domain;
    if (ticketsByDomain[domain]) {
      clearCookies(domain).then(() => {
        delete ticketsByDomain[domain];
        saveTickets();
        // Mark corresponding history entry as inactive
        const key = 'clone:' + domain;
        setHistoryActive(key, false);
        sendResponse({ success: true });
      });
      return true; // async response
    }
    sendResponse({ success: false, error: 'No ticket for domain' });
  }

  if (msg.type === 'GET_TICKET_FOR_DOMAIN') {
    const ticket = getDomainTicket(msg.hostname);
    sendResponse({ ticket: ticket || null, proxyEnabled: proxyEnabled });
  }

  // Proxy mode controls (legacy — kept for backward compat)
  if (msg.type === 'SET_PROXY') {
    proxyAddress = msg.address || '127.0.0.1';
    proxyPort = msg.port || 8445;

    if (msg.enabled && !proxyEnabled) {
      proxyEnabled = true;
      enableProxyHandler();
    } else if (!msg.enabled && proxyEnabled) {
      proxyEnabled = false;
      disableProxyHandler();
    }

    saveProxySettings();
    sendResponse({ success: true, proxyEnabled, proxyAddress, proxyPort });
  }

  if (msg.type === 'GET_PROXY_STATUS') {
    sendResponse({ proxyEnabled, proxyAddress, proxyPort });
  }

  // Ticket history
  if (msg.type === 'GET_TICKET_HISTORY') {
    sendResponse({ history: ticketHistory, proxyEnabled });
  }

  if (msg.type === 'ACTIVATE_TICKET') {
    const entry = ticketHistory.find(h => h.key === msg.key);
    if (!entry) {
      sendResponse({ success: false, error: 'Ticket not found in history' });
      return;
    }

    if (entry.type === 'proxy') {
      activateProxyTicket(entry.ticket);
      entry.active = true;
      saveHistory();
      sendResponse({ success: true, ticketType: 'proxy' });
    } else {
      activateCloneTicket(entry.ticket).then(() => {
        entry.active = true;
        saveHistory();
        sendResponse({ success: true, ticketType: 'clone' });
      });
      return true; // async
    }
  }

  if (msg.type === 'DEACTIVATE_TICKET') {
    const entry = ticketHistory.find(h => h.key === msg.key);
    if (!entry) {
      sendResponse({ success: false, error: 'Ticket not found in history' });
      return;
    }

    if (entry.type === 'proxy') {
      deactivateProxyTicket();
      sendResponse({ success: true, ticketType: 'proxy' });
    } else {
      deactivateCloneTicket(entry.ticket.domain).then(() => {
        entry.active = false;
        saveHistory();
        sendResponse({ success: true, ticketType: 'clone' });
      });
      return true; // async
    }
  }

  if (msg.type === 'DELETE_TICKET_HISTORY') {
    const entry = ticketHistory.find(h => h.key === msg.key);
    if (entry) {
      // Deactivate first if active
      if (entry.active) {
        if (entry.type === 'proxy') {
          deactivateProxyTicket();
        } else {
          deactivateCloneTicket(entry.ticket.domain).then(() => {
            ticketHistory = ticketHistory.filter(h => h.key !== msg.key);
            saveHistory();
            sendResponse({ success: true });
          });
          return true; // async
        }
      }
      ticketHistory = ticketHistory.filter(h => h.key !== msg.key);
      saveHistory();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Ticket not found' });
    }
  }
});
