// 1Password Vault Extractor — ui.js
// Dashboard UI for viewing extracted vault data.

var currentTab = 'items';
var allItems = [];
var allTotp = [];
var allSummary = [];
var allErrors = [];
var filterText = '';
var _refreshTimer = null;
var _totpTimer = null;

function esc(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
}

// ===== TOTP Generation (RFC 6238 / RFC 4226) =====

// Base32 decode (RFC 4648)
function base32Decode(input) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    input = input.replace(/[\s=-]+/g, '').toUpperCase();
    var bits = '';
    for (var i = 0; i < input.length; i++) {
        var val = alphabet.indexOf(input[i]);
        if (val === -1) continue;
        bits += ('00000' + val.toString(2)).slice(-5);
    }
    var bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (var b = 0; b < bytes.length; b++) {
        bytes[b] = parseInt(bits.substr(b * 8, 8), 2);
    }
    return bytes;
}

// Parse otpauth:// URI to extract secret and parameters
function parseOtpAuth(uri) {
    if (!uri || uri.indexOf('otpauth://') !== 0) return null;
    var result = { secret: '', digits: 6, period: 30, algorithm: 'SHA1' };
    var qIdx = uri.indexOf('?');
    if (qIdx === -1) return null;
    var params = uri.substring(qIdx + 1).split('&');
    for (var i = 0; i < params.length; i++) {
        var kv = params[i].split('=');
        var key = decodeURIComponent(kv[0]).toLowerCase();
        var val = decodeURIComponent(kv[1] || '');
        if (key === 'secret') result.secret = val;
        else if (key === 'digits') result.digits = parseInt(val) || 6;
        else if (key === 'period') result.period = parseInt(val) || 30;
        else if (key === 'algorithm') result.algorithm = val.toUpperCase();
    }
    return result.secret ? result : null;
}

// Generate TOTP code using Web Crypto API
function generateTOTP(secret, period, digits) {
    var key = base32Decode(secret);
    var epoch = Math.floor(Date.now() / 1000);
    var counter = Math.floor(epoch / period);

    // Convert counter to 8-byte big-endian buffer
    var counterBuf = new ArrayBuffer(8);
    var counterView = new DataView(counterBuf);
    counterView.setUint32(4, counter, false);

    return crypto.subtle.importKey(
        'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    ).then(function(cryptoKey) {
        return crypto.subtle.sign('HMAC', cryptoKey, counterBuf);
    }).then(function(sig) {
        var hmac = new Uint8Array(sig);
        var offset = hmac[hmac.length - 1] & 0x0f;
        var code = ((hmac[offset] & 0x7f) << 24) |
                   ((hmac[offset + 1] & 0xff) << 16) |
                   ((hmac[offset + 2] & 0xff) << 8) |
                   (hmac[offset + 3] & 0xff);
        var otp = (code % Math.pow(10, digits)).toString();
        while (otp.length < digits) otp = '0' + otp;
        return otp;
    }).catch(function() {
        return '------';
    });
}

// Get seconds remaining in current TOTP period
function getTotpRemaining(period) {
    return period - (Math.floor(Date.now() / 1000) % period);
}

// ===== Tab switching =====
var tabs = pluginUI.container.querySelectorAll('[data-op-tab]');
for (var t = 0; t < tabs.length; t++) {
    (function(tab) {
        tab.onclick = function(e) {
            e.preventDefault();
            currentTab = tab.getAttribute('data-op-tab');
            for (var x = 0; x < tabs.length; x++) {
                tabs[x].className = 'nav-link' + (tabs[x] === tab ? ' active' : '');
            }
            pluginUI.container.querySelector('#op-tab-items').style.display = currentTab === 'items' ? '' : 'none';
            pluginUI.container.querySelector('#op-tab-totp').style.display = currentTab === 'totp' ? '' : 'none';
            pluginUI.container.querySelector('#op-tab-summary').style.display = currentTab === 'summary' ? '' : 'none';
            pluginUI.container.querySelector('#op-tab-errors').style.display = currentTab === 'errors' ? '' : 'none';
        };
    })(tabs[t]);
}

// Filter
var filterInput = pluginUI.container.querySelector('#op-filter-input');
if (filterInput) {
    filterInput.oninput = function() {
        filterText = filterInput.value.toLowerCase();
        renderItems();
        renderTotp();
    };
}

// Sensitive field labels that get bold treatment
var SENSITIVE_LABELS = ['password', 'verification number', 'cvv', 'secret key', 'ssh', 'private key', 'secret', 'pin'];

function isSensitive(label) {
    var l = (label || '').toLowerCase();
    for (var i = 0; i < SENSITIVE_LABELS.length; i++) {
        if (l.indexOf(SENSITIVE_LABELS[i]) !== -1) return true;
    }
    return false;
}

function renderItems() {
    var tbody = pluginUI.container.querySelector('#op-items-body');
    if (!tbody) return;

    // De-duplicate: only show the latest entry per itemUuid
    var seen = {};
    var deduped = [];
    for (var di = 0; di < allItems.length; di++) {
        var r = allItems[di];
        var d = r.data || {};
        var key = d.itemUuid || d.title || di;
        if (!seen[key]) {
            seen[key] = true;
            deduped.push(r);
        }
    }

    var filtered = deduped;
    if (filterText) {
        filtered = deduped.filter(function(row) {
            var d = row.data || {};
            return (d.title || '').toLowerCase().indexOf(filterText) !== -1 ||
                   (d.category || '').toLowerCase().indexOf(filterText) !== -1 ||
                   (d.vault || '').toLowerCase().indexOf(filterText) !== -1 ||
                   JSON.stringify(d.fields || []).toLowerCase().indexOf(filterText) !== -1;
        });
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No items' + (filterText ? ' matching filter' : ' extracted yet') + '</td></tr>';
        return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var row = filtered[i];
        var d = row.data || {};
        var fields = d.fields || [];

        var catBadge = '';
        var cat = (d.category || '').toLowerCase();
        if (cat.indexOf('login') !== -1 || cat.indexOf('password') !== -1) catBadge = 'bg-danger';
        else if (cat.indexOf('credit') !== -1 || cat.indexOf('card') !== -1) catBadge = 'bg-warning text-dark';
        else if (cat.indexOf('ssh') !== -1) catBadge = 'bg-info';
        else if (cat.indexOf('note') !== -1 || cat.indexOf('secure') !== -1) catBadge = 'bg-secondary';
        else if (cat.indexOf('identity') !== -1) catBadge = 'bg-info';
        else catBadge = 'bg-dark';

        // Build field rows inline
        var fieldHtml = '';
        for (var f = 0; f < fields.length; f++) {
            var fld = fields[f];
            var label = fld.label || '';
            var val = fld.value || '';
            if (label === 'unknown' || label === '_parse_error') continue;
            // Skip OTP fields — they have their own live-updating TOTP tab
            var lbl = label.toLowerCase();
            if (lbl.indexOf('one-time') !== -1 || lbl.indexOf('totp') !== -1) continue;
            var sensitive = isSensitive(label);
            var valClass = sensitive ? 'font-weight:bold' : '';
            fieldHtml += '<div class="d-flex small" style="gap:8px">' +
                '<span class="text-muted" style="min-width:120px">' + esc(label) + '</span>' +
                '<span style="word-break:break-all;' + valClass + '">' + esc(val) + '</span>' +
                '</div>';
        }
        if (!fieldHtml) fieldHtml = '<span class="text-muted small">No fields</span>';

        html += '<tr>' +
            '<td style="vertical-align:top;white-space:nowrap">' +
            '<b>' + esc(d.title || 'Untitled') + '</b><br>' +
            '<span class="badge ' + catBadge + '">' + esc(d.category || '?') + '</span>' +
            ' <span class="text-muted small">' + esc(d.vault || '') + '</span>' +
            '</td>' +
            '<td>' + fieldHtml + '</td>' +
            '<td style="vertical-align:top;white-space:nowrap" class="small text-muted">' +
            (row.timeStamp ? new Date(row.timeStamp).toLocaleString() : '') +
            '</td>' +
            '</tr>';
    }
    tbody.innerHTML = html;
}

// De-duplicate TOTP entries — keep latest per itemUuid
function dedupTotp(rows) {
    var seen = {};
    var result = [];
    for (var i = 0; i < rows.length; i++) {
        var d = rows[i].data || {};
        var key = d.itemUuid || d.title || i;
        if (!seen[key]) {
            seen[key] = true;
            result.push(rows[i]);
        }
    }
    return result;
}

function renderTotp() {
    var tbody = pluginUI.container.querySelector('#op-totp-body');
    if (!tbody) return;

    var deduped = dedupTotp(allTotp);
    var filtered = deduped;
    if (filterText) {
        filtered = deduped.filter(function(row) {
            var d = row.data || {};
            return (d.title || '').toLowerCase().indexOf(filterText) !== -1;
        });
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No TOTP codes' + (filterText ? ' matching filter' : '') + '</td></tr>';
        return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var row = filtered[i];
        var d = row.data || {};
        var seed = d.seed || '';
        var parsed = parseOtpAuth(seed);
        var secretDisplay = (d.secret) ? d.secret : (parsed ? parsed.secret : (seed || 'awaiting seed'));

        html += '<tr>' +
            '<td><b>' + esc(d.title || '') + '</b><br><span class="text-muted small">' + esc(d.vault || '') + '</span></td>' +
            '<td class="totp-live-cell" data-seed="' + esc(seed) + '" style="white-space:nowrap">' +
            '<span class="totp-code" style="font-family:monospace;font-size:1.1em;letter-spacing:1px">------</span> ' +
            '<span class="totp-countdown text-muted small"></span>' +
            '</td>' +
            '<td class="small" style="max-width:250px;word-break:break-all;font-family:monospace">' + esc(secretDisplay) + '</td>' +
            '<td class="small">' + esc(d.vault || '') + '</td>' +
            '</tr>';
    }
    tbody.innerHTML = html;

    // Generate live codes immediately
    updateTotpCodes();
}

// Update all live TOTP code cells
function updateTotpCodes() {
    var cells = pluginUI.container.querySelectorAll('.totp-live-cell');
    for (var i = 0; i < cells.length; i++) {
        (function(cell) {
            var seed = cell.getAttribute('data-seed');
            var parsed = parseOtpAuth(seed);
            if (!parsed) {
                cell.querySelector('.totp-code').textContent = 'awaiting seed';
                cell.querySelector('.totp-countdown').textContent = '';
                return;
            }
            var remaining = getTotpRemaining(parsed.period);
            cell.querySelector('.totp-countdown').textContent = remaining + 's';

            generateTOTP(parsed.secret, parsed.period, parsed.digits).then(function(code) {
                var codeEl = cell.querySelector('.totp-code');
                if (codeEl) {
                    // Format as XXX XXX for 6-digit codes
                    if (code.length === 6) {
                        code = code.substring(0, 3) + ' ' + code.substring(3);
                    }
                    codeEl.textContent = code;
                }
            });
        })(cells[i]);
    }
}

function renderSummary() {
    var container = pluginUI.container.querySelector('#op-summary-content');
    if (!container) return;

    if (allSummary.length === 0) {
        container.innerHTML = '<span class="text-muted">No summary data yet</span>';
        return;
    }

    var latest = allSummary[0].data || {};
    var html = '<div class="mb-2">' +
        '<span class="badge bg-info me-2">Accounts: ' + (latest.accounts || 0) + '</span>' +
        '<span class="badge bg-success me-2">Unlocked Vaults: ' + (latest.unlockedVaults || 0) + '</span>' +
        '</div>';

    if (latest.lockedAccounts && latest.lockedAccounts.length > 0) {
        html += '<div class="text-warning small mb-2">Locked accounts: ' + esc(latest.lockedAccounts.join(', ')) + '</div>';
    }

    if (latest.vaults && latest.vaults.length > 0) {
        html += '<table class="table table-sm table-dark table-striped mb-0">';
        html += '<thead><tr><th>Account</th><th>Vault</th><th>UUID</th><th>Type</th></tr></thead><tbody>';
        for (var i = 0; i < latest.vaults.length; i++) {
            var v = latest.vaults[i];
            html += '<tr>' +
                '<td>' + esc(v.accountName || '') + '</td>' +
                '<td><b>' + esc(v.vaultName || '') + '</b></td>' +
                '<td class="small text-muted">' + esc(v.vaultUuid || '') + '</td>' +
                '<td>' + esc(v.vaultType || '') + '</td>' +
                '</tr>';
        }
        html += '</tbody></table>';
    }

    container.innerHTML = html;
}

function renderErrors() {
    var tbody = pluginUI.container.querySelector('#op-errors-body');
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

function loadAllData() {
    // Check that our container is still in the DOM (guard against stale intervals)
    if (!pluginUI.container || !pluginUI.container.parentNode) {
        if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
        if (_totpTimer) { clearInterval(_totpTimer); _totpTimer = null; }
        return;
    }

    var statusEl = pluginUI.container.querySelector('#op-status');

    pluginUI.fetchData('vault_item', 500, 0).then(function(result) {
        allItems = result.rows || [];
        // Count unique items
        var seen = {};
        var count = 0;
        for (var i = 0; i < allItems.length; i++) {
            var key = (allItems[i].data || {}).itemUuid || i;
            if (!seen[key]) { seen[key] = true; count++; }
        }
        if (statusEl) statusEl.textContent = count + ' items extracted';
        renderItems();
    });

    pluginUI.fetchData('totp_code', 500, 0).then(function(result) {
        allTotp = result.rows || [];
        renderTotp();
    });

    pluginUI.fetchData('vault_summary', 10, 0).then(function(result) {
        allSummary = result.rows || [];
        renderSummary();
    });

    pluginUI.fetchData('_error', 100, 0).then(function(result) {
        allErrors = result.rows || [];
        renderErrors();
        var errTab = pluginUI.container.querySelector('[data-op-tab="errors"]');
        if (errTab && allErrors.length > 0) {
            errTab.innerHTML = 'Errors <span class="badge bg-danger">' + allErrors.length + '</span>';
        }
    });
}

// Wire buttons
var clearBtn = pluginUI.container.querySelector('#op-clear-btn');
if (clearBtn) {
    clearBtn.onclick = function() {
        if (confirm('Clear all extracted 1Password data?')) {
            pluginUI.deleteData().then(function() { loadAllData(); });
        }
    };
}

var exportBtn = pluginUI.container.querySelector('#op-export-btn');
if (exportBtn) {
    exportBtn.onclick = function() {
        // De-duplicate for export
        var seen = {};
        var dedupedItems = allItems.filter(function(r) {
            var key = (r.data || {}).itemUuid || Math.random();
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
        var exportData = {
            items: dedupedItems.map(function(r) { return r.data; }),
            totp: dedupTotp(allTotp).map(function(r) { return r.data; }),
            summary: allSummary.map(function(r) { return r.data; }),
            exportedAt: new Date().toISOString()
        };
        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = '1password_extract_' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
    };
}

// Initial load + auto-refresh every 10 seconds (with stale guard)
loadAllData();
_refreshTimer = setInterval(loadAllData, 10000);

// Update TOTP live codes every second
_totpTimer = setInterval(function() {
    if (!pluginUI.container || !pluginUI.container.parentNode) {
        if (_totpTimer) { clearInterval(_totpTimer); _totpTimer = null; }
        return;
    }
    updateTotpCodes();
}, 1000);
