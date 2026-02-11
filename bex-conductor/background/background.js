// BEX Conductor - Background Script
// Manages ticket storage, cookie setting, and header injection

let ticketsByDomain = {};

// Load saved tickets on startup
browser.storage.local.get('ticketsByDomain').then(result => {
  if (result.ticketsByDomain) {
    ticketsByDomain = result.ticketsByDomain;
  }
});

function saveTickets() {
  browser.storage.local.set({ ticketsByDomain });
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
      console.warn('[BEX Conductor] Failed to set cookie:', cookie.name, e);
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
      console.warn('[BEX Conductor] Failed to remove cookie:', cookie.name, e);
    }
  }
}

// Header injection via blocking webRequest
browser.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
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
      if (!ticket.domain) {
        sendResponse({ success: false, error: 'Invalid ticket: missing domain' });
        return;
      }
      ticketsByDomain[ticket.domain] = ticket;
      saveTickets();
      setCookies(ticket).then(() => {
        sendResponse({ success: true, domain: ticket.domain });
      });
      return true; // async response
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
        sendResponse({ success: true });
      });
      return true; // async response
    }
    sendResponse({ success: false, error: 'No ticket for domain' });
  }

  if (msg.type === 'GET_TICKET_FOR_DOMAIN') {
    const ticket = getDomainTicket(msg.hostname);
    sendResponse({ ticket: ticket || null });
  }
});
