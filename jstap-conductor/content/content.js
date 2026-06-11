// JS-Tap Conductor - Content Script
// Injects localStorage, sessionStorage, and spoofs navigator properties
// Works in both direct and proxy mode — session tickets provide auth context

(function() {
  const hostname = location.hostname;
  if (!hostname) return;

  browser.runtime.sendMessage({ type: 'GET_TICKET_FOR_DOMAIN', hostname: hostname }).then(response => {
    if (!response || !response.ticket) return;

    const ticket = response.ticket;

    // Inject localStorage
    if (ticket.localStorage && ticket.localStorage.length > 0) {
      for (const entry of ticket.localStorage) {
        try {
          localStorage.setItem(entry.key, entry.value);
        } catch (e) {
          console.warn('[JS-Tap Conductor] Failed to set localStorage:', entry.key, e);
        }
      }
    }

    // Inject sessionStorage
    if (ticket.sessionStorage && ticket.sessionStorage.length > 0) {
      for (const entry of ticket.sessionStorage) {
        try {
          sessionStorage.setItem(entry.key, entry.value);
        } catch (e) {
          console.warn('[JS-Tap Conductor] Failed to set sessionStorage:', entry.key, e);
        }
      }
    }

    // Spoof navigator properties via MAIN world script injection
    if (ticket.userAgent) {
      const escapedUA = ticket.userAgent.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      const escapedAppVersion = escapedUA.replace(/^Mozilla\//, '');

      let platformValue = 'Win32';
      const plat = (ticket.platform || '').toLowerCase();
      if (plat.includes('linux')) platformValue = 'Linux x86_64';
      else if (plat.includes('mac')) platformValue = 'MacIntel';
      else if (plat.includes('win')) platformValue = 'Win32';
      else if (plat.includes('android')) platformValue = 'Linux armv8l';
      else if (plat.includes('ios') || plat.includes('iphone')) platformValue = 'iPhone';

      const script = document.createElement('script');
      script.textContent = `
        (function() {
          try {
            Object.defineProperty(navigator, 'userAgent', {
              get: function() { return '${escapedUA}'; },
              configurable: true
            });
            Object.defineProperty(navigator, 'appVersion', {
              get: function() { return '${escapedAppVersion}'; },
              configurable: true
            });
            Object.defineProperty(navigator, 'platform', {
              get: function() { return '${platformValue}'; },
              configurable: true
            });
          } catch(e) {}
        })();
      `;
      document.documentElement.prepend(script);
      script.remove();
    }
  }).catch(() => {
    // Extension context may be invalid, silently ignore
  });
})();
