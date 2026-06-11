# JS-Tap Detection Rules

Detection signatures for blue teams and defenders to identify JS-Tap components in their environment.

## Files

| File | Format | Detects |
|---|---|---|
| `jstap.yar` | YARA | Files on disk — JS implant payload, BEX Beacon extension scripts/manifests, Sidecar binary and native messaging manifests |
| `jstap_network.rules` | Suricata/Snort | Network traffic — session registration, loot exfiltration, encrypted metrics, BEX Beacon telemetry, payload delivery |

## YARA Rules

**Rules included:**

| Rule | What It Detects |
|---|---|
| `JSTap_Implant_Payload` | The telemlib.js implant via `window.taper*` variables, `/loot/*` endpoints, monkeypatch functions, iframe trap markers |
| `JSTap_Implant_Obfuscated` | Obfuscated variants of the implant via API endpoint strings that must survive obfuscation for the implant to function |
| `JSTap_BEX_Beacon_Background` | BEX Beacon service worker via `/bex/*` endpoints, `CONFIG_INJECTION`/`SIDECAR_COMMAND` task types, encryption patterns |
| `JSTap_BEX_Beacon_Content` | BEX Beacon content script via `BEX_SCREENSHOT_REQUEST` message type, telemetry patterns |
| `JSTap_BEX_Beacon_Manifest` | Extension manifest files via `com.jstap.sidecar` host name, `bex-beacon@jstap` ID, suspicious permission combinations |
| `JSTap_Sidecar_Binary` | Compiled Go sidecar binary via `list_dir`/`read_file`/`exec_cmd`/`write_file` command strings, JSON struct tags, error messages |
| `JSTap_Sidecar_NativeMessaging_Manifest` | Native messaging host manifest JSON via `com.jstap.sidecar` identifier |
| `JSTap_Encrypted_Comms_Pattern` | Scripts using the JS-Tap encrypted communication pattern (key exchange + AES-GCM metrics channel) |

**Usage:**
```bash
# Scan a single file
yara detections/jstap.yar /path/to/suspicious/file.js

# Recursively scan a directory (e.g. browser extension directories)
yara -r detections/jstap.yar /path/to/extensions/

# Scan Chrome extensions on Linux
yara -r detections/jstap.yar ~/.config/google-chrome/Default/Extensions/

# Scan Firefox extensions on Linux
yara -r detections/jstap.yar ~/.mozilla/firefox/*/extensions/
```

## Network Rules (Suricata/Snort)

Detects JS-Tap network traffic patterns including:
- Client registration (`/client/getToken`)
- Key exchange (`/client/keyExchange`)
- Loot exfiltration in cleartext mode (`/loot/screenshot`, `/loot/input`, `/loot/formPost`, etc.)
- Encrypted metrics channel (`/client/metrics/` POST requests)
- BEX Beacon telemetry (`/bex/capture`, `/bex/report`, `/bex/screenshot`)
- Sidecar result uploads (`/bex/sidecar/result`)
- Payload delivery (`/lib/telemlib.js`)

**Usage (Suricata):**
```bash
cp detections/jstap_network.rules /etc/suricata/rules/
# Add to suricata.yaml under rule-files:
#   - jstap_network.rules
suricata -T -c /etc/suricata/suricata.yaml  # test config
```

## Evasion Notes

These rules detect the **default** JS-Tap configuration. An operator who customizes JS-Tap can evade many of these signatures by:

- Renaming API endpoints in telemlib.js and jsTapServer.py
- Obfuscating JavaScript variable and function names
- Changing the `com.jstap.sidecar` native messaging host name
- Changing the `bex-beacon@jstap` extension ID
- Enabling traffic obfuscation (renders individual `/loot/*` endpoint rules ineffective)

The encrypted metrics channel rules (`/client/metrics/` + key exchange) and behavioral YARA patterns (multiple `window.taper*` variables, monkeypatch function pairs) are more resilient to casual customization.
