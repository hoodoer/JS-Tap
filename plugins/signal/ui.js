// Signal Interceptor — ui.js
// Dashboard UI for browsing Signal conversations, messages, and sending messages.

var conversations = [];
var contacts = [];
var currentMessages = [];
var currentConversationId = null;
var currentConversationName = '';
var allErrors = [];
var convFilter = '';
var searchResults = null;
var searchQuery = '';
var _refreshTimer = null;
var _pollTimer = null;
var _searchPollTimer = null;
var selectedInjectUser = null;
var _injectPollTimer = null;
var _activeDownloads = {};
var injectedMessageCount = 0;
var _clearInjectedPollTimer = null;
var _sendPollTimer = null;
var dbConnected = false;

function esc(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
}

function humanFileSize(bytes) {
    if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function fileIcon(mimetype) {
    if (!mimetype) return '\u{1F4CE}';
    if (mimetype.indexOf('image/') === 0) return '\u{1F5BC}';
    if (mimetype.indexOf('video/') === 0) return '\u{1F3AC}';
    if (mimetype.indexOf('audio/') === 0) return '\u{1F3B5}';
    if (mimetype.indexOf('pdf') !== -1) return '\u{1F4C4}';
    return '\u{1F4CE}';
}

function contactInitialAvatar(name, id) {
    var initial = (name && name.length > 0) ? name.charAt(0).toUpperCase() : '?';
    var colors = ['#4a7c59','#7c4a6b','#4a5e7c','#7c6b4a','#5a4a7c','#7c4a4a','#4a7c7c','#6b7c4a'];
    var hash = 0;
    var str = id || name || '';
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    var color = colors[Math.abs(hash) % colors.length];
    return '<div style="width:24px;height:24px;border-radius:3px;background:' + color +
        ';display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:bold;margin-right:8px;flex-shrink:0">' +
        initial + '</div>';
}

// ===== Send command to plugin via server =====

function sendCommand(command) {
    return fetch('/api/plugins/signal/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientID: pluginUI.clientId, command: command })
    }).then(function(r) { return r.json(); });
}

// ===== Render functions =====

function renderTopbar() {
    var userEl = pluginUI.container.querySelector('#signal-user');
    var statusEl = pluginUI.container.querySelector('#signal-status');

    var spinner = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>';

    if (dbConnected) {
        statusEl.className = 'badge bg-success';
        statusEl.textContent = 'Connected';
        if (conversations.length > 0) {
            userEl.textContent = conversations.length + ' conversation(s)';
        }
    } else {
        statusEl.className = 'badge bg-secondary';
        statusEl.innerHTML = spinner + 'Syncing...';
    }
}

function renderConversations() {
    var container = pluginUI.container.querySelector('#signal-conv-list');
    if (!container) return;

    if (conversations.length === 0) {
        container.innerHTML = '<div class="text-muted small p-2">No conversations loaded</div>';
        return;
    }

    var privateCh = [];
    var groupCh = [];
    var filter = convFilter.toLowerCase();

    for (var i = 0; i < conversations.length; i++) {
        var c = conversations[i];
        if (filter && (c.name || '').toLowerCase().indexOf(filter) === -1) continue;

        if (c.type === 'group') groupCh.push(c);
        else privateCh.push(c);
    }

    var html = '';

    if (privateCh.length > 0) {
        html += '<div class="text-muted small px-2 pt-1" style="text-transform:uppercase;font-size:0.65rem;color:#7a8288">Contacts</div>';
        for (var p = 0; p < privateCh.length; p++) {
            html += convItem(privateCh[p]);
        }
    }

    if (groupCh.length > 0) {
        html += '<div class="text-muted small px-2 pt-2" style="text-transform:uppercase;font-size:0.65rem;color:#7a8288">Groups</div>';
        for (var g = 0; g < groupCh.length; g++) {
            html += convItem(groupCh[g]);
        }
    }

    if (!html) {
        html = '<div class="text-muted small p-2">No conversations match filter</div>';
    }

    container.innerHTML = html;

    // Wire click handlers
    var items = container.querySelectorAll('[data-conv-id]');
    for (var ci = 0; ci < items.length; ci++) {
        (function(item) {
            item.onclick = function() {
                var convId = item.getAttribute('data-conv-id');
                var convName = item.getAttribute('data-conv-name');
                selectConversation(convId, convName);

                for (var x = 0; x < items.length; x++) {
                    items[x].style.borderLeft = '';
                    items[x].style.background = '';
                }
                item.style.borderLeft = '3px solid #62c462';
                item.style.background = 'rgba(255,255,255,0.05)';
            };
        })(items[ci]);
    }
}

function convItem(c) {
    var active = c.id === currentConversationId;
    var style = 'padding:3px 8px;cursor:pointer;border-radius:3px;font-size:0.85rem;';
    if (active) {
        style += 'border-left:3px solid #62c462;background:rgba(255,255,255,0.05);';
    }

    var prefix = c.type === 'group' ? '\u{1F465} ' : '';
    var preview = '';
    if (c.lastMessage) {
        preview = '<div class="text-muted" style="font-size:0.7rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px">' + esc(c.lastMessage) + '</div>';
    }

    return '<div data-conv-id="' + esc(c.id) + '" data-conv-name="' + esc(c.name) + '" ' +
        'style="' + style + '">' +
        '<span class="text-muted">' + prefix + '</span>' + esc(c.name) +
        preview +
        '</div>';
}

function renderMessages() {
    var container = pluginUI.container.querySelector('#signal-messages');
    var nameEl = pluginUI.container.querySelector('#signal-conv-name');
    var typeEl = pluginUI.container.querySelector('#signal-conv-type');

    if (!container) return;

    if (!currentConversationId) {
        container.innerHTML = '<div class="text-muted small">Select a conversation to view messages</div>';
        nameEl.textContent = 'Select a conversation';
        typeEl.textContent = '';
        return;
    }

    nameEl.textContent = currentConversationName || currentConversationId;

    // Find conversation type
    var convType = '';
    for (var c = 0; c < conversations.length; c++) {
        if (conversations[c].id === currentConversationId) {
            convType = conversations[c].type === 'group' ? 'Group' : 'Private';
            break;
        }
    }
    typeEl.textContent = convType ? '| ' + convType : '';

    if (currentMessages.length === 0) {
        container.innerHTML = '<div class="text-muted small"><span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Fetching...</div>';
        return;
    }

    var html = '';
    for (var i = 0; i < currentMessages.length; i++) {
        var msg = currentMessages[i];
        var timeStr = '';
        if (msg.time) {
            try {
                var d = new Date(msg.time);
                timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch (e) {
                timeStr = '';
            }
        }

        var isOutgoing = msg.type === 'outgoing';
        var senderDisplay = msg.senderName || msg.source || 'unknown';
        if (isOutgoing) senderDisplay = 'You';

        var msgStyle = isOutgoing ? 'text-align:right;' : '';

        var attachHtml = '';
        if (msg.attachments && msg.attachments.length) {
            for (var ai = 0; ai < msg.attachments.length; ai++) {
                var att = msg.attachments[ai];
                attachHtml += '<div class="d-flex align-items-center mt-1" style="padding:4px 8px;background:#3a3f44;border-radius:3px;border-left:3px solid #52565a;gap:6px">' +
                    '<span>' + fileIcon(att.contentType) + '</span>' +
                    '<span class="small" style="color:#fff">' + esc(att.fileName) + '</span>' +
                    '<span class="text-muted small">(' + humanFileSize(att.size) + ')</span>';
                if (att.path || att.localKey) {
                    attachHtml += '<button class="btn btn-outline-secondary btn-sm ms-auto signal-att-dl" ' +
                        'data-msg-id="' + esc(msg.id) + '" data-att-idx="' + ai + '" data-name="' + esc(att.fileName) + '" ' +
                        'style="padding:1px 6px;font-size:0.7rem;line-height:1.2">Download</button>';
                }
                attachHtml += '</div>';
            }
        }

        html += '<div class="mb-2" style="' + msgStyle + '">' +
            '<span class="fw-bold" style="color:#fff">' + esc(senderDisplay) + '</span>' +
            '<span class="text-muted small ms-2">' + esc(timeStr) + '</span>' +
            '<div class="small" style="color:#aaa;word-break:break-word">' + formatSignalText(msg.body || '') + '</div>' +
            attachHtml +
            '</div>';
    }

    // Scroll preservation
    var wasNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;

    container.innerHTML = html;

    if (wasNearBottom) {
        container.scrollTop = container.scrollHeight;
    }

    // Wire attachment download buttons
    var dlBtns = container.querySelectorAll('.signal-att-dl');
    for (var di = 0; di < dlBtns.length; di++) {
        (function(btn) {
            var name = btn.getAttribute('data-name');
            if (_activeDownloads[name]) {
                btn.disabled = true;
                btn.textContent = _activeDownloads[name];
            }
            btn.onclick = function() {
                if (_activeDownloads[name]) return;
                var msgId = btn.getAttribute('data-msg-id');
                var attIdx = parseInt(btn.getAttribute('data-att-idx'), 10);
                btn.disabled = true;
                btn.textContent = 'Downloading...';
                _activeDownloads[name] = 'Downloading...';

                pluginUI.fetchData('attachment_data', 1, 0).then(function(snap) {
                    var snapRows = snap.rows || [];
                    var lastId = snapRows.length > 0 ? snapRows[0].id : 0;

                    sendCommand({ action: 'download_attachment', messageId: msgId, attachmentIndex: attIdx });

                    var polls = 0;
                    var dlTimer = setInterval(function() {
                        polls++;
                        if (polls > 60) {
                            clearInterval(dlTimer);
                            delete _activeDownloads[name];
                            var curBtn = container.querySelector('.signal-att-dl[data-name="' + CSS.escape(name) + '"]');
                            if (curBtn) { curBtn.textContent = 'Timeout'; curBtn.disabled = false; }
                            return;
                        }
                        pluginUI.fetchData('attachment_data', 5, 0).then(function(result) {
                            var rows = result.rows || [];
                            for (var r = 0; r < rows.length; r++) {
                                var row = rows[r];
                                var d = row.data || {};
                                if (d.fileName !== name || row.id <= lastId) continue;
                                if (d.data) {
                                    clearInterval(dlTimer);
                                    var byteChars = atob(d.data);
                                    var byteArray = new Uint8Array(byteChars.length);
                                    for (var b = 0; b < byteChars.length; b++) {
                                        byteArray[b] = byteChars.charCodeAt(b);
                                    }
                                    var blob = new Blob([byteArray], { type: d.contentType || 'application/octet-stream' });
                                    var a = document.createElement('a');
                                    a.href = URL.createObjectURL(blob);
                                    a.download = name;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(a.href);
                                    _activeDownloads[name] = 'Downloaded';
                                    var curBtn = container.querySelector('.signal-att-dl[data-name="' + CSS.escape(name) + '"]');
                                    if (curBtn) { curBtn.textContent = 'Downloaded'; curBtn.disabled = false; }
                                    setTimeout(function() { delete _activeDownloads[name]; }, 3000);
                                    return;
                                }
                                if (d.error) {
                                    clearInterval(dlTimer);
                                    delete _activeDownloads[name];
                                    var curBtn = container.querySelector('.signal-att-dl[data-name="' + CSS.escape(name) + '"]');
                                    if (curBtn) { curBtn.textContent = 'Error'; curBtn.disabled = false; }
                                    return;
                                }
                            }
                        });
                    }, 1000);
                });
            };
        })(dlBtns[di]);
    }
}

function formatSignalText(text) {
    var escaped = esc(text);
    // Bold: *text*
    escaped = escaped.replace(/\*([^*]+)\*/g, '<b>$1</b>');
    // Italic: _text_
    escaped = escaped.replace(/\b_([^_]+)_\b/g, '<i>$1</i>');
    // Code: `text`
    escaped = escaped.replace(/`([^`]+)`/g, '<code style="background:#3a3f44;padding:1px 4px;border-radius:3px">$1</code>');
    // URLs
    escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#fff">$1</a>');
    // Newlines
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
}

var _lastErrorCount = 0;
function renderErrors() {
    var toggle = pluginUI.container.querySelector('#signal-errors-toggle');
    var countEl = pluginUI.container.querySelector('#signal-error-count');
    var tbody = pluginUI.container.querySelector('#signal-errors-body');

    if (allErrors.length > 0) {
        toggle.style.display = '';
        countEl.textContent = allErrors.length;

        // Only re-render the table if error count changed (prevents selection clobbering)
        if (allErrors.length !== _lastErrorCount) {
            _lastErrorCount = allErrors.length;
            var html = '';
            for (var i = 0; i < allErrors.length; i++) {
                var row = allErrors[i];
                var d = row.data || {};
                html += '<tr>' +
                    '<td class="small">' + esc(d.phase || '') + '</td>' +
                    '<td class="small" style="max-width:400px;word-break:break-all;user-select:text">' + esc(d.error || JSON.stringify(d)) + '</td>' +
                    '<td class="small text-muted">' + (row.timeStamp ? new Date(row.timeStamp).toLocaleString() : '') + '</td>' +
                    '</tr>';
            }
            tbody.innerHTML = html;
        }
    } else {
        toggle.style.display = 'none';
        _lastErrorCount = 0;
    }
}

function renderSearchResults() {
    var panel = pluginUI.container.querySelector('#signal-search-panel');
    var container = pluginUI.container.querySelector('#signal-search-results');
    var titleEl = pluginUI.container.querySelector('#signal-search-title');

    if (!searchResults || !panel) return;

    panel.style.display = '';
    titleEl.textContent = 'Search: "' + searchResults.query + '" (' + (searchResults.total || 0) + ' results)';

    var matches = searchResults.matches || [];
    if (matches.length === 0) {
        var msg = 'No messages found';
        if (searchResults.error) msg = 'Search error: ' + searchResults.error;
        container.innerHTML = '<div class="text-muted small">' + esc(msg) + '</div>';
        return;
    }

    var html = '';
    for (var i = 0; i < matches.length; i++) {
        var m = matches[i];
        var timeStr = '';
        if (m.time) {
            try { timeStr = new Date(m.time).toLocaleString(); } catch (e) {}
        }

        var convLabel = m.conversationName || m.conversationId || '';

        html += '<div class="mb-2 pb-2" style="border-bottom:1px solid #3a3f44">' +
            '<div>' +
            '<span class="fw-bold" style="color:#fff">' + esc(m.senderName || m.source || 'unknown') + '</span>' +
            '<span class="badge bg-dark ms-2">' + esc(convLabel) + '</span>' +
            '<span class="text-muted small ms-2">' + esc(timeStr) + '</span>' +
            '</div>' +
            '<div class="small" style="color:#aaa;word-break:break-word">' + formatSignalText(m.body || '') + '</div>';

        if (m.conversationId) {
            html += ' <a href="#" class="small signal-search-goto" data-conv-id="' + esc(m.conversationId) + '" data-conv-name="' + esc(m.conversationName || m.conversationId) + '" style="color:#fff">open conversation</a>';
        }

        html += '</div>';
    }

    container.innerHTML = html;

    // Wire "open conversation" links
    var gotos = container.querySelectorAll('.signal-search-goto');
    for (var g = 0; g < gotos.length; g++) {
        (function(el) {
            el.onclick = function(e) {
                e.preventDefault();
                selectConversation(el.getAttribute('data-conv-id'), el.getAttribute('data-conv-name'));
            };
        })(gotos[g]);
    }
}

// ===== Conversation selection =====

function selectConversation(convId, convName) {
    currentConversationId = convId;
    currentConversationName = convName || convId;
    currentMessages = [];
    renderMessages();

    var input = pluginUI.container.querySelector('#signal-msg-input');
    var sendBtn = pluginUI.container.querySelector('#signal-send-btn');
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;

    updateInjectControls();

    // Check if we already have messages for this conversation
    pluginUI.fetchData('messages', 50, 0).then(function(result) {
        var rows = result.rows || [];
        for (var i = 0; i < rows.length; i++) {
            var d = rows[i].data || {};
            if (d.conversationId === convId) {
                currentMessages = d.messages || [];
                renderMessages();
                return;
            }
        }
        // No cached messages, request fetch
        sendCommand({ action: 'fetch_messages', conversationId: convId, conversationName: convName, options: { limit: 50 } });
    });
}

// ===== Data loading =====

function loadMessages() {
    if (!currentConversationId) return;
    pluginUI.fetchData('messages', 50, 0).then(function(result) {
        var rows = result.rows || [];
        for (var i = 0; i < rows.length; i++) {
            var d = rows[i].data || {};
            if (d.conversationId === currentConversationId) {
                currentMessages = d.messages || [];
                renderMessages();
                break;
            }
        }
    });
}

function loadData() {
    if (!pluginUI.container || !pluginUI.container.parentNode) {
        if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
        return;
    }

    // Load conversations
    pluginUI.fetchData('conversations', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            if (latest.conversations && latest.conversations.length > 0) {
                conversations = latest.conversations;
                dbConnected = true;
                renderTopbar();
                renderConversations();
            }
        }
    });

    // Load contacts (for inject user picker)
    pluginUI.fetchData('contact_list', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            if (latest.contacts && latest.contacts.length > 0) {
                contacts = latest.contacts;
            }
        }
    });

    // Load messages for current conversation
    if (currentConversationId) {
        pluginUI.fetchData('messages', 50, 0).then(function(result) {
            var rows = result.rows || [];
            for (var i = 0; i < rows.length; i++) {
                var d = rows[i].data || {};
                if (d.conversationId === currentConversationId) {
                    currentMessages = d.messages || [];
                    renderMessages();
                    break;
                }
            }
        });
    }

    // Load injected message tracking
    pluginUI.fetchData('injected_messages', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            injectedMessageCount = latest.count || 0;
            updateClearInjectedButton();
        }
    });

    // Load errors
    pluginUI.fetchData('_error', 50, 0).then(function(result) {
        allErrors = result.rows || [];
        renderErrors();
    });
}

// ===== Wire up controls =====

// Conversation filter
var filterInput = pluginUI.container.querySelector('#signal-conv-filter');
if (filterInput) {
    filterInput.oninput = function() {
        convFilter = filterInput.value;
        renderConversations();
    };
}

// Refresh conversations button
var refreshBtn = pluginUI.container.querySelector('#signal-refresh-btn');
if (refreshBtn) {
    refreshBtn.onclick = function() {
        sendCommand({ action: 'fetch_conversations' });
    };
}

// Send message
var msgInput = pluginUI.container.querySelector('#signal-msg-input');
var sendBtn = pluginUI.container.querySelector('#signal-send-btn');

if (sendBtn) {
    sendBtn.onclick = function() {
        if (!currentConversationId || !msgInput || !msgInput.value.trim()) return;
        sendCommand({ action: 'send_message', conversationId: currentConversationId, text: msgInput.value.trim() });
        msgInput.value = '';

        var polls = 0;
        if (_sendPollTimer) clearInterval(_sendPollTimer);
        _sendPollTimer = setInterval(function() {
            polls++;
            if (polls > 8 || !pluginUI.container || !pluginUI.container.parentNode) {
                clearInterval(_sendPollTimer);
                _sendPollTimer = null;
                return;
            }
            loadMessages();
        }, 1000);
    };
}

if (msgInput) {
    msgInput.onkeydown = function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (sendBtn) sendBtn.click();
        }
    };
}

// Export
var exportBtn = pluginUI.container.querySelector('#signal-export-btn');
if (exportBtn) {
    exportBtn.onclick = function() {
        var exportData = {
            conversations: conversations,
            contacts: contacts,
            currentMessages: { conversationId: currentConversationId, conversationName: currentConversationName, messages: currentMessages },
            exportedAt: new Date().toISOString()
        };
        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'signal_extract_' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
    };
}

// Clear data
var clearBtn = pluginUI.container.querySelector('#signal-clear-btn');
if (clearBtn) {
    clearBtn.onclick = function() {
        if (confirm('Clear all extracted Signal data?')) {
            pluginUI.deleteData().then(function() {
                conversations = [];
                contacts = [];
                currentMessages = [];
                allErrors = [];
                currentConversationId = null;
                currentConversationName = '';
                dbConnected = false;
                renderTopbar();
                renderConversations();
                renderMessages();
                renderErrors();
            });
        }
    };
}

// DOM debug
var domDebugBtn = pluginUI.container.querySelector('#signal-dom-debug-btn');
if (domDebugBtn) {
    domDebugBtn.onclick = function() {
        sendCommand({ action: 'dom_discovery', conversationId: currentConversationId });
    };
}

// Error toggle
var errToggle = pluginUI.container.querySelector('#signal-errors-toggle');
var errPanel = pluginUI.container.querySelector('#signal-errors-panel');
if (errToggle && errPanel) {
    errToggle.onclick = function(e) {
        e.preventDefault();
        errPanel.style.display = errPanel.style.display === 'none' ? '' : 'none';
    };
}

// ===== Search controls =====

var searchInput = pluginUI.container.querySelector('#signal-search-input');
var searchBtn = pluginUI.container.querySelector('#signal-search-btn');
var searchStatusEl = pluginUI.container.querySelector('#signal-search-status');
var searchCloseBtn = pluginUI.container.querySelector('#signal-search-close');

function doSearch(query) {
    if (!query || !query.trim()) return;
    searchQuery = query.trim();
    searchResults = null;
    if (searchStatusEl) searchStatusEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Searching...';
    sendCommand({ action: 'search', query: searchQuery });

    var polls = 0;
    if (_searchPollTimer) clearInterval(_searchPollTimer);
    _searchPollTimer = setInterval(function() {
        polls++;
        if (polls > 30) {
            clearInterval(_searchPollTimer);
            _searchPollTimer = null;
            if (searchStatusEl) searchStatusEl.textContent = 'Timed out \u2014 try again';
            return;
        }
        pluginUI.fetchData('search_results', 5, 0).then(function(result) {
            var rows = result.rows || [];
            for (var i = 0; i < rows.length; i++) {
                var d = rows[i].data || {};
                if (d.query === searchQuery) {
                    searchResults = d;
                    renderSearchResults();
                    if (searchStatusEl) searchStatusEl.textContent = '';
                    clearInterval(_searchPollTimer);
                    _searchPollTimer = null;
                    break;
                }
            }
        });
    }, 1000);
}

if (searchBtn) {
    searchBtn.onclick = function() {
        doSearch(searchInput ? searchInput.value : '');
    };
}

if (searchInput) {
    searchInput.onkeydown = function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            doSearch(searchInput.value);
        }
    };
}

if (searchCloseBtn) {
    searchCloseBtn.onclick = function() {
        var panel = pluginUI.container.querySelector('#signal-search-panel');
        if (panel) panel.style.display = 'none';
        searchResults = null;
        if (searchStatusEl) searchStatusEl.textContent = '';
    };
}

// ===== Inject controls =====

function updateInjectControls() {
    var textInput = pluginUI.container.querySelector('#signal-inject-text');
    var injectBtn = pluginUI.container.querySelector('#signal-inject-btn');
    var enabled = !!(selectedInjectUser && currentConversationId);
    if (textInput) textInput.disabled = !enabled;
    if (injectBtn) injectBtn.disabled = !enabled;
}

function renderInjectUserDropdown(filter) {
    var dropdown = pluginUI.container.querySelector('#signal-inject-user-dropdown');
    if (!dropdown) return;

    if (!filter || filter.length < 1) {
        dropdown.style.display = 'none';
        return;
    }

    var lf = filter.toLowerCase();
    var matches = [];
    for (var i = 0; i < contacts.length; i++) {
        var c = contacts[i];
        var nameMatch = (c.name || '').toLowerCase().indexOf(lf) !== -1;
        var e164Match = (c.e164 || '').indexOf(lf) !== -1;
        var idMatch = (c.id || '').toLowerCase().indexOf(lf) !== -1;
        if (nameMatch || e164Match || idMatch) {
            matches.push(c);
            if (matches.length >= 15) break;
        }
    }

    if (matches.length === 0) {
        dropdown.style.display = 'none';
        return;
    }

    var html = '';
    for (var m = 0; m < matches.length; m++) {
        var c = matches[m];
        html += '<div class="signal-inject-user-item d-flex align-items-center" data-idx="' + m + '" ' +
            'style="padding:4px 8px;cursor:pointer;border-bottom:1px solid #52565a;color:#aaa" ' +
            'onmouseover="this.style.background=\'#52565a\'" onmouseout="this.style.background=\'\'">';
        html += contactInitialAvatar(c.name || '', c.id || '');
        html += '<span style="color:#fff">' + esc(c.name || '') + '</span>';
        if (c.e164) {
            html += '<span class="text-muted ms-2 small">' + esc(c.e164) + '</span>';
        }
        html += '</div>';
    }

    dropdown.innerHTML = html;
    dropdown.style.display = '';

    // Wire click handlers
    var items = dropdown.querySelectorAll('.signal-inject-user-item');
    for (var ci = 0; ci < items.length; ci++) {
        (function(item, idx) {
            item.onmousedown = function(e) {
                e.preventDefault();
                var c = matches[idx];
                selectedInjectUser = { id: c.id, name: c.name, e164: c.e164 || '' };
                var labelEl = pluginUI.container.querySelector('#signal-inject-selected-user');
                if (labelEl) labelEl.innerHTML = '<span style="color:#fff">' + esc(c.name) + '</span> <span class="text-muted">(' + esc(c.e164 || c.id) + ')</span>';
                var searchInput = pluginUI.container.querySelector('#signal-inject-user-search');
                if (searchInput) searchInput.value = c.name;
                dropdown.style.display = 'none';
                updateInjectControls();
            };
        })(items[ci], ci);
    }
}

var injectUserSearch = pluginUI.container.querySelector('#signal-inject-user-search');
if (injectUserSearch) {
    injectUserSearch.oninput = function() {
        renderInjectUserDropdown(injectUserSearch.value);
    };
    injectUserSearch.onblur = function() {
        setTimeout(function() {
            var dropdown = pluginUI.container.querySelector('#signal-inject-user-dropdown');
            if (dropdown) dropdown.style.display = 'none';
        }, 200);
    };
}

// Inject button
var injectBtn = pluginUI.container.querySelector('#signal-inject-btn');
var injectTextInput = pluginUI.container.querySelector('#signal-inject-text');
if (injectBtn) {
    injectBtn.onclick = function() {
        if (!selectedInjectUser || !currentConversationId || !injectTextInput || !injectTextInput.value.trim()) return;
        var statusEl = pluginUI.container.querySelector('#signal-inject-status');
        if (statusEl) { statusEl.style.display = ''; statusEl.innerHTML = '<span class="text-muted"><span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Injecting...</span>'; }

        sendCommand({
            action: 'inject_message',
            conversationId: currentConversationId,
            senderName: selectedInjectUser.name || selectedInjectUser.id,
            text: injectTextInput.value.trim()
        });

        var polls = 0;
        if (_injectPollTimer) clearInterval(_injectPollTimer);
        _injectPollTimer = setInterval(function() {
            polls++;
            if (polls > 30) {
                clearInterval(_injectPollTimer);
                _injectPollTimer = null;
                if (statusEl) statusEl.innerHTML = '<span class="text-muted">Timed out waiting for result</span>';
                return;
            }
            pluginUI.fetchData('inject_result', 5, 0).then(function(result) {
                var rows = result.rows || [];
                if (rows.length > 0) {
                    var d = rows[0].data || {};
                    clearInterval(_injectPollTimer);
                    _injectPollTimer = null;
                    if (statusEl) {
                        if (d.success) {
                            statusEl.innerHTML = '<span class="text-muted">Injected successfully</span>';
                        } else {
                            statusEl.innerHTML = '<span class="text-muted">Failed: ' + esc(d.error || 'unknown') + '</span>';
                        }
                    }
                }
            });
        }, 1000);
    };
}

if (injectTextInput) {
    injectTextInput.onkeydown = function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (injectBtn) injectBtn.click();
        }
    };
}

// ===== Injected message cleanup =====

function updateClearInjectedButton() {
    var btn = pluginUI.container.querySelector('#signal-clear-injected-btn');
    var badge = pluginUI.container.querySelector('#signal-injected-count');
    if (!btn) return;
    if (injectedMessageCount > 0) {
        btn.style.display = '';
        if (badge) badge.textContent = injectedMessageCount;
    } else {
        btn.style.display = 'none';
    }
}

var clearInjectedBtn = pluginUI.container.querySelector('#signal-clear-injected-btn');
if (clearInjectedBtn) {
    clearInjectedBtn.onclick = function() {
        if (injectedMessageCount === 0) return;
        var statusEl = pluginUI.container.querySelector('#signal-inject-status');
        if (statusEl) { statusEl.style.display = ''; statusEl.innerHTML = '<span class="text-muted"><span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Cleaning up spoofed messages...</span>'; }

        sendCommand({ action: 'clear_injected' });

        var polls = 0;
        if (_clearInjectedPollTimer) clearInterval(_clearInjectedPollTimer);
        var _preClearCount = injectedMessageCount;
        _clearInjectedPollTimer = setInterval(function() {
            polls++;
            if (polls > 30) {
                clearInterval(_clearInjectedPollTimer);
                _clearInjectedPollTimer = null;
                if (injectedMessageCount === 0 && _preClearCount > 0) {
                    updateClearInjectedButton();
                    if (statusEl) statusEl.innerHTML = '<span class="text-muted">Cleared ' + _preClearCount + ' spoofed message(s)</span>';
                } else {
                    if (statusEl) statusEl.innerHTML = '<span class="text-muted">Cleanup timed out</span>';
                }
                return;
            }
            loadData();
            if (injectedMessageCount === 0 && _preClearCount > 0) {
                clearInterval(_clearInjectedPollTimer);
                _clearInjectedPollTimer = null;
                updateClearInjectedButton();
                if (statusEl) statusEl.innerHTML = '<span class="text-muted">Cleared ' + _preClearCount + ' spoofed message(s)</span>';
                return;
            }
            pluginUI.fetchData('clear_injected_result', 5, 0).then(function(result) {
                var rows = result.rows || [];
                if (rows.length > 0) {
                    var d = rows[0].data || {};
                    clearInterval(_clearInjectedPollTimer);
                    _clearInjectedPollTimer = null;
                    if (d.success) {
                        injectedMessageCount = 0;
                        updateClearInjectedButton();
                        if (statusEl) statusEl.innerHTML = '<span class="text-muted">Cleared ' + (d.cleared || 0) + ' spoofed message(s)</span>';
                    } else {
                        if (statusEl) statusEl.innerHTML = '<span class="text-muted">Cleanup failed: ' + esc(d.error || 'unknown') + '</span>';
                    }
                }
            });
        }, 1000);
    };
}

// Initial load + auto-refresh
loadData();
_refreshTimer = setInterval(loadData, 3000);
