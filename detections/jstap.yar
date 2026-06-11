/*
    JS-Tap Detection Rules
    https://github.com/hoodoer/JS-Tap

    These YARA rules detect the three JS-Tap client components:
      1. JS-Tap Implant (telemlib.js) — JavaScript payload injected into web pages
      2. BEX Beacon — Browser extension (Chrome MV3 / Firefox MV2)
      3. Sidecar — Native messaging Go binary

    Usage:
      yara jstap.yar /path/to/scan
      yara jstap.yar -r /path/to/directory

    These rules are designed for defenders to detect JS-Tap artifacts on disk,
    in browser extension directories, or in network captures (with raw content).
*/


// ─────────────────────────────────────────────────────────────────────────────
// 1. JS-Tap Implant Payload (telemlib.js)
// ─────────────────────────────────────────────────────────────────────────────

rule JSTap_Implant_Payload
{
    meta:
        description = "Detects the JS-Tap JavaScript implant payload (telemlib.js)"
        author      = "JS-Tap Project"
        reference   = "https://github.com/hoodoer/JS-Tap"
        component   = "JS-Tap Implant"

    strings:
        // Core initialization and globals
        $init_globals       = "initGlobals" ascii
        $taper_mode         = "window.taperMode" ascii
        $taper_exfil_server = "window.taperexfilServer" ascii
        $taper_xhr          = "window.taperXHR" ascii
        $taper_session_uuid = "window.taperSessionUUID" ascii
        $taper_metrics_box  = "window.taperMetricsBox" ascii
        $taper_tag          = "window.taperTag" ascii
        $taper_fingerprint  = "window.taperFingerprint" ascii

        // Session storage persistence markers
        $ss_loaded          = "taperSystemLoaded" ascii
        $ss_uuid            = "taperSessionUUID" ascii

        // Exfiltration API endpoints
        $ep_screenshot      = "/loot/screenshot" ascii
        $ep_formpost        = "/loot/formPost" ascii
        $ep_input           = "/loot/input" ascii
        $ep_html            = "/loot/html" ascii
        $ep_location        = "/loot/location" ascii
        $ep_metrics         = "/client/metrics" ascii
        $ep_key_exchange    = "/client/keyExchange" ascii
        $ep_get_token       = "/client/getToken" ascii

        // Monkeypatching
        $monkeypatch_xhr    = "monkeyPatchXHR" ascii
        $monkeypatch_fetch  = "monkeyPatchFetch" ascii
        $no_intercept       = "noIntercept" ascii
        $original_fetch     = "window.originalFetch" ascii

        // Exfiltration function
        $custom_exfil       = "customExfil" ascii

        // iFrame trap technique
        $iframe_trap        = "iframe_a" ascii

        // Encryption init
        $init_metrics       = "initMetrics" ascii
        $init_catcher       = "initCatcher" ascii

        // SPA hooks
        $spa_hooked         = "_taperImplantSpaHooked" ascii

    condition:
        // Must be a text/script file (not a compiled binary)
        uint16(0) != 0x5A4D and uint32(0) != 0x464C457F and
        (
            // High confidence: multiple taper* window variables
            (3 of ($taper_*)) or

            // High confidence: exfil server + any loot endpoint
            ($taper_exfil_server and 2 of ($ep_*)) or

            // Medium confidence: monkeypatching + exfil patterns
            ($monkeypatch_xhr and $monkeypatch_fetch and $no_intercept) or

            // Medium confidence: init functions + session markers
            ($init_globals and $ss_loaded and $ss_uuid) or

            // Broad: 6+ of any strings present
            (6 of them)
        )
}


rule JSTap_Implant_Obfuscated
{
    meta:
        description = "Detects potentially obfuscated JS-Tap implant via behavioral string combinations"
        author      = "JS-Tap Project"
        reference   = "https://github.com/hoodoer/JS-Tap"
        component   = "JS-Tap Implant (obfuscated)"

    strings:
        // These endpoint paths are needed for server communication and are
        // harder to obfuscate without breaking functionality
        $ep_metrics      = "/client/metrics/" ascii
        $ep_key_exchange = "/client/keyExchange/" ascii
        $ep_get_token    = "/client/getToken/" ascii
        $ep_screenshot   = "/loot/screenshot" ascii
        $ep_formpost     = "/loot/formPost" ascii
        $ep_input        = "/loot/input" ascii
        $ep_location     = "/loot/location" ascii
        $ep_html         = "/loot/html" ascii

        // AES-GCM encryption markers (WebCrypto API usage)
        $aesgcm          = "AES-GCM" ascii
        $rsaoaep         = "RSA-OAEP" ascii

    condition:
        uint16(0) != 0x5A4D and uint32(0) != 0x464C457F and
        (
            // Multiple loot endpoints + token endpoint
            (3 of ($ep_*) and $ep_get_token) or

            // Key exchange + metrics + encryption
            ($ep_key_exchange and $ep_metrics and $aesgcm)
        )
}


// ─────────────────────────────────────────────────────────────────────────────
// 2. BEX Beacon — Browser Extension
// ─────────────────────────────────────────────────────────────────────────────

rule JSTap_BEX_Beacon_Background
{
    meta:
        description = "Detects the BEX Beacon extension background/service worker script"
        author      = "JS-Tap Project"
        reference   = "https://github.com/hoodoer/JS-Tap"
        component   = "BEX Beacon (background script)"

    strings:
        // API endpoints used by the beacon
        $ep_get_token    = "/client/getToken/" ascii
        $ep_key_exchange = "/client/keyExchange/" ascii
        $ep_metrics      = "/client/metrics/" ascii

        // BEX-specific capture endpoints
        $ep_bex_capture    = "/bex/capture" ascii
        $ep_bex_report     = "/bex/report" ascii
        $ep_bex_screenshot = "/bex/screenshot/" ascii
        $ep_bex_sidecar_r  = "/bex/sidecar/result" ascii
        $ep_bex_sidecar_s  = "/bex/sidecar/status" ascii

        // Task types dispatched by server
        $task_inject     = "CONFIG_INJECTION" ascii
        $task_sidecar    = "SIDECAR_COMMAND" ascii

        // Message types
        $msg_telemetry   = "TELEMETRY" ascii
        $msg_screenshot  = "BEX_SCREENSHOT_REQUEST" ascii

        // Client type identifier
        $client_type     = "bex-beacon" ascii

        // Console log prefix
        $log_prefix      = "BEX:" ascii

        // Encryption
        $aesgcm          = "AES-GCM" ascii
        $rsaoaep         = "RSA-OAEP" ascii

    condition:
        (
            // High confidence: BEX-specific endpoints
            (2 of ($ep_bex_*) and $ep_metrics) or

            // High confidence: task types + client type
            ($task_inject and $client_type) or
            ($task_sidecar and $client_type) or

            // Medium confidence: registration flow + encryption
            ($ep_get_token and $ep_key_exchange and $aesgcm) or

            // Broad: multiple indicators
            (5 of them)
        )
}


rule JSTap_BEX_Beacon_Content
{
    meta:
        description = "Detects the BEX Beacon content script (DOM instrumentation)"
        author      = "JS-Tap Project"
        reference   = "https://github.com/hoodoer/JS-Tap"
        component   = "BEX Beacon (content script)"

    strings:
        $msg_screenshot  = "BEX_SCREENSHOT_REQUEST" ascii
        $msg_telemetry   = "TELEMETRY" ascii
        $client_type     = "bex-beacon" ascii
        $log_prefix      = "BEX:" ascii

        // Content scripts interact with page DOM and relay to background
        $capture_visible = "captureVisibleTab" ascii

    condition:
        ($msg_screenshot and $msg_telemetry) or
        ($msg_screenshot and $client_type) or
        ($capture_visible and $msg_telemetry and $client_type)
}


rule JSTap_BEX_Beacon_Manifest
{
    meta:
        description = "Detects BEX Beacon extension manifest files"
        author      = "JS-Tap Project"
        reference   = "https://github.com/hoodoer/JS-Tap"
        component   = "BEX Beacon (manifest)"

    strings:
        // Native messaging host name (if sidecar enabled)
        $nm_host         = "com.jstap.sidecar" ascii

        // Default identifiers that may survive in built manifests
        $firefox_id      = "bex-beacon@jstap" ascii

        // Permission combination characteristic of this extension
        $perm_cookies    = "cookies" ascii
        $perm_storage    = "storage" ascii
        $perm_tabs       = "tabs" ascii
        $perm_webrequest = "webRequest" ascii
        $perm_native     = "nativeMessaging" ascii
        $perm_dnr        = "declarativeNetRequest" ascii

        // Manifest keys
        $manifest_v3     = "manifest_version" ascii

    condition:
        // Direct identifiers
        ($nm_host) or
        ($firefox_id) or

        // Suspicious permission combination (all of these together)
        ($manifest_v3 and $perm_cookies and $perm_storage and $perm_tabs and
         $perm_webrequest and $perm_dnr)
}


// ─────────────────────────────────────────────────────────────────────────────
// 3. Sidecar — Native Messaging Go Binary
// ─────────────────────────────────────────────────────────────────────────────

rule JSTap_Sidecar_Binary
{
    meta:
        description = "Detects the JS-Tap Sidecar native messaging binary (compiled Go)"
        author      = "JS-Tap Project"
        reference   = "https://github.com/hoodoer/JS-Tap"
        component   = "Sidecar"

    strings:
        // Command names embedded in binary
        $cmd_list_dir   = "list_dir" ascii
        $cmd_read_file  = "read_file" ascii
        $cmd_exec_cmd   = "exec_cmd" ascii
        $cmd_write_file = "write_file" ascii

        // JSON response field names (Go struct tags survive compilation)
        $json_success   = "\"success\"" ascii
        $json_command   = "\"command\"" ascii
        $json_is_dir    = "\"isDir\"" ascii
        $json_mod_time  = "\"modTime\"" ascii

        // Error strings baked into the binary
        $err_invalid    = "Invalid JSON:" ascii
        $err_unknown    = "unknown command" ascii

        // Native messaging reads 4-byte LE length prefix from stdin
        // Go module path may appear in binary
        $go_module      = "sidecar" ascii

    condition:
        // Must be an executable (PE or ELF or Mach-O)
        (uint16(0) == 0x5A4D or uint32(0) == 0x464C457F or
         uint32(0) == 0xFEEDFACE or uint32(0) == 0xFEEDFACF or
         uint32(0) == 0xCEFAEDFE or uint32(0) == 0xCFFAEDFE) and
        (
            // High confidence: all four command names
            ($cmd_list_dir and $cmd_read_file and $cmd_exec_cmd) or

            // High confidence: command names + JSON response fields
            (2 of ($cmd_*) and $json_is_dir and $json_mod_time) or

            // Medium confidence: error strings + command names
            ($err_invalid and 2 of ($cmd_*)) or

            // Broad: multiple indicators in an executable
            (5 of them)
        )
}


rule JSTap_Sidecar_NativeMessaging_Manifest
{
    meta:
        description = "Detects Sidecar native messaging manifest JSON files"
        author      = "JS-Tap Project"
        reference   = "https://github.com/hoodoer/JS-Tap"
        component   = "Sidecar (manifest)"

    strings:
        $host_name   = "com.jstap.sidecar" ascii
        $nm_type     = "\"type\"" ascii
        $nm_stdio    = "\"stdio\"" ascii
        $nm_allowed  = "allowed_extensions" ascii
        $nm_origins  = "allowed_origins" ascii

    condition:
        $host_name and $nm_type and $nm_stdio and
        ($nm_allowed or $nm_origins)
}


// ─────────────────────────────────────────────────────────────────────────────
// 4. Combo / Campaign Rules
// ─────────────────────────────────────────────────────────────────────────────

rule JSTap_Encrypted_Comms_Pattern
{
    meta:
        description = "Detects JS-Tap encrypted communication patterns (implant or beacon)"
        author      = "JS-Tap Project"
        reference   = "https://github.com/hoodoer/JS-Tap"
        component   = "Network indicator"

    strings:
        $ep_metrics      = "/client/metrics/" ascii
        $ep_key_exchange = "/client/keyExchange/" ascii
        $aesgcm          = "AES-GCM" ascii
        $rsaoaep         = "RSA-OAEP" ascii

    condition:
        ($ep_metrics and $ep_key_exchange) and
        ($aesgcm or $rsaoaep)
}
