# BOF Design Document: BEX Beacon Install & Atomize Patching

## Overview

This document describes the design for two Beacon Object Files (BOFs) that extend JS-Tap's deployment capabilities into post-exploitation workflows via Sliver and Cobalt Strike. The BOFs automate operations that currently require manual file drops and script execution on compromised hosts:

1. **BEX Install BOF** -- Installs the bex-beacon browser extension (Chrome/Chromium/Firefox) on a target system.
2. **Atomize BOF** -- Patches an Electron application's ASAR archive with the atom-beacon implant.

Both operations are high-value in engagements where browser-level or application-level persistence and data collection are objectives. The BOFs translate what are currently multi-step manual procedures (file copies, registry writes, config file generation) into single-command implant actions.

### Why BOFs?

BOFs execute in-process within the Beacon/Sliver implant -- no child process, no new thread in a remote process, no on-disk executable. This makes them significantly more OPSEC-friendly than dropping and executing a standalone binary or script. The operations we need (file I/O, registry manipulation, process enumeration) map cleanly to the BOF programming model.

### C2 Framework Compatibility

| Feature | Cobalt Strike | Sliver |
|---------|--------------|--------|
| BOF loading | Native (`inline-execute`) | Native (`bof` / `inline-execute`) |
| Argument packing | `bof_pack` format | Compatible `bof_pack` format |
| Output capture | `BeaconPrintf` / `BeaconOutput` | Same API via `beacon_compatibility.h` |
| Data types | All standard BOF APIs | Supported via COFFLoader |

Sliver's BOF support uses TrustedSec's COFFLoader and is compatible with Cobalt Strike BOFs. We target the common subset: `beacon_compatibility.h` APIs, standard Windows API calls (on Windows), and POSIX syscalls (on Linux/macOS via ELF object files or the `--elf` flag in Sliver).

**Platform note:** Classic BOFs are COFF object files (Windows PE). For Linux/macOS targets, Sliver supports ELF-based "BOFs" through its extension system. The design below calls out where platform-specific compilation is needed. An alternative for Unix targets is packaging as a Sliver extension (shared library) rather than a strict BOF.

---

## 1. BEX Beacon Install BOF

### 1.1 Current Install Mechanisms

The existing `buildAll.py` generates per-platform deploy bundles. The install operations per platform are:

**Windows Chrome/Chromium:**
- Drop `extension.crx` to `%LOCALAPPDATA%\<dirname>\extension.crx`
- Write a JSON file pointing to the CRX: `%LOCALAPPDATA%\<dirname>\<chrome_id>.json`
- Create registry key: `HKCU\Software\Google\Chrome\Extensions\<chrome_id>` with `path` value pointing to the JSON

**Linux Chrome/Chromium (requires root):**
- Drop CRX to `/opt/<dirname>/extension.crx`
- Write Omaha-style `updates.xml` to `/opt/<dirname>/updates.xml`
- Write enterprise policy JSON to `/etc/opt/chrome/policies/managed/<dirname>_extension.json` (Chrome) or `/etc/chromium/policies/managed/<dirname>_extension.json` (Chromium)

**macOS Chrome/Chromium (requires root):**
- Drop CRX to `/opt/<dirname>/extension.crx`
- Write Omaha-style `updates.xml` to `/opt/<dirname>/updates.xml`
- Write managed preferences plist to `/Library/Managed Preferences/<bundle_id>.plist`

**Firefox (all platforms):**
- Parse `profiles.ini` to locate the default profile directory
- Drop `extension.xpi` as `<profile>/extensions/<firefox_extension_id>.xpi`

**Sidecar (optional, all platforms):**
- Drop native messaging host binary
- Write native messaging host manifest JSON
- Windows: additional registry key for native messaging host

### 1.2 Approach

The BOF receives the packed extension bytes (CRX or XPI) as an embedded binary blob argument, along with configuration parameters (extension ID, install directory name, browser target). It performs the platform-appropriate file drops and configuration writes directly from the implant process.

```
Operator                    C2 Server                Target Host (Beacon/Sliver)
   |                           |                           |
   |-- bex-install command --->|                           |
   |   (browser, crx/xpi)     |--- BOF + args ---------->|
   |                           |                           |-- Write CRX/XPI to disk
   |                           |                           |-- Write config (JSON/reg/plist)
   |                           |                           |-- [Optional] Restart browser
   |                           |<-- Output (success/fail) -|
   |<-- Results ---------------|                           |
```

### 1.3 BOF Arguments

```c
// Argument format (bof_pack)
struct bex_install_args {
    int    browser;          // 0=chrome, 1=chromium, 2=firefox
    char*  extension_id;     // 32-char chrome ID or Firefox addon ID
    char*  install_dirname;  // e.g. "webperf-tools"
    char*  ext_version;      // e.g. "2.1.4"
    blob   extension_data;   // raw CRX or XPI bytes
    int    install_sidecar;  // 0=no, 1=yes
    blob   sidecar_data;     // raw sidecar binary (optional, empty if not installing)
    char*  sidecar_host_name;// e.g. "com.jstap.sidecar"
    char*  sidecar_bin_name; // e.g. "sidecar"
    int    restart_browser;  // 0=no, 1=graceful, 2=force
};
```

### 1.4 Platform-Specific Implementation

#### 1.4.1 Windows Chrome/Chromium

Operations (all user-level, no elevation required):

1. **Create install directory:** `%LOCALAPPDATA%\<dirname>\`
2. **Write CRX:** `%LOCALAPPDATA%\<dirname>\extension.crx`
3. **Write external extension JSON:**
   ```json
   {
     "external_crx": "C:\\Users\\<user>\\AppData\\Local\\<dirname>\\extension.crx",
     "external_version": "<version>"
   }
   ```
   Written to `%LOCALAPPDATA%\<dirname>\<chrome_id>.json`
4. **Write registry key:**
   `HKCU\Software\Google\Chrome\Extensions\<chrome_id>` -> `path` = JSON path

Win32 APIs used:
- `CreateDirectoryA` / `CreateFileA` / `WriteFile` / `CloseHandle` (file operations)
- `RegCreateKeyExA` / `RegSetValueExA` / `RegCloseKey` (registry)

These are all standard BOF-friendly APIs callable via Dynamic Function Resolution (DFR).

**Sidecar (optional):**
- Write binary to `%LOCALAPPDATA%\<dirname>\sidecar.exe`
- Write NM manifest to `%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\<host_name>.json`
- Registry: `HKCU\Software\Google\Chrome\NativeMessagingHosts\<host_name>` -> manifest path

#### 1.4.2 Linux Chrome/Chromium

Operations (require root for enterprise policy path):

1. **Create directory:** `/opt/<dirname>/`
2. **Write CRX:** `/opt/<dirname>/extension.crx`
3. **Write updates.xml:** `/opt/<dirname>/updates.xml` (Omaha-style manifest pointing to local CRX)
4. **Write enterprise policy:** `/etc/opt/chrome/policies/managed/<dirname>_extension.json`

POSIX APIs: `mkdir()`, `open()`, `write()`, `close()`, `chmod()`.

If not running as root, fall back to user-level installation:
- Write CRX and unpacked extension to `~/.local/share/<dirname>/`
- Print instruction that the extension must be loaded manually via `chrome://extensions` developer mode

**Sidecar (optional):**
- Write binary to `~/.local/bin/<sidecar_bin_name>`
- Write NM manifest to `~/.config/google-chrome/NativeMessagingHosts/<host_name>.json`

#### 1.4.3 macOS Chrome/Chromium

Operations (require root for managed preferences):

1. **Create directory:** `/opt/<dirname>/`
2. **Write CRX:** `/opt/<dirname>/extension.crx`
3. **Write updates.xml:** `/opt/<dirname>/updates.xml`
4. **Write managed preferences plist:** `/Library/Managed Preferences/com.google.Chrome.plist`

If not running as root, same user-level fallback as Linux.

#### 1.4.4 Firefox (All Platforms)

The Firefox install mechanism is the same conceptually across platforms -- drop the XPI into the profile's `extensions/` directory:

1. **Locate profiles.ini:**
   - Windows: `%APPDATA%\Mozilla\Firefox\profiles.ini`
   - Linux: `~/.mozilla/firefox/profiles.ini`
   - macOS: `~/Library/Application Support/Firefox/profiles.ini`

2. **Parse profiles.ini** to find the default profile:
   - Look for `[Install*]` section, read `Default=` value
   - Fallback: find first `*.default-release` or `*.default*` directory

3. **Write XPI:** `<profile>/extensions/<firefox_extension_id>.xpi`

The profiles.ini parser is straightforward INI parsing -- read lines, find section headers, extract key=value pairs. No external library needed; this is easily done in C with `fopen`/`fgets`/`strstr`.

**Sidecar (optional):**
- Write binary to `~/.local/bin/<sidecar_bin_name>` (Linux/macOS) or `%LOCALAPPDATA%\<dirname>\sidecar.exe` (Windows)
- Write NM manifest to appropriate directory
- Windows: additional registry key under `HKCU\Software\Mozilla\NativeMessagingHosts\<host_name>`

### 1.5 Browser Restart Behavior

The extension is loaded on the next browser restart. Three options controlled by the `restart_browser` argument:

| Value | Behavior | OPSEC |
|-------|----------|-------|
| 0 | Do nothing. Extension loads on next natural restart. | Best. No user-visible disruption. |
| 1 | Graceful: attempt to close browser via IPC/signal, let it auto-restart if configured. | Moderate. User sees browser close and reopen. |
| 2 | Force kill browser process, do not restart. Extension loads when user re-opens. | Noisy. User notices, but guarantees extension loads on next use. |

**Recommendation:** Default to 0 (no restart). In most engagements, browsers restart within hours due to updates, user behavior, or system reboots. If urgency is needed, option 1 is preferable.

Implementation for graceful restart:
- Windows: `EnumWindows` to find Chrome/Firefox main window, `SendMessage(WM_CLOSE)`
- Linux: `kill(pid, SIGTERM)` on the browser process
- macOS: `kill(pid, SIGTERM)` or AppleScript `tell application "Google Chrome" to quit`

### 1.6 Aggressor/Alias Script

For Cobalt Strike, an aggressor script (`bex_install.cna`) wraps the BOF invocation:

```
alias bex-install {
    $browser = $1;      # chrome, chromium, firefox
    $options = $2;       # --restart, --sidecar, etc.

    # Read the appropriate extension file
    if ($browser eq "firefox") {
        $ext_data = read_file("extension.xpi");
    } else {
        $ext_data = read_file("extension.crx");
    }

    # Pack arguments and invoke BOF
    $args = bof_pack("iszsbisbss", ...);
    beacon_inline_execute($1, read_bof("bex_install"), $args);
}
```

For Sliver, a similar wrapper as an extension manifest:

```json
{
    "name": "bex-install",
    "command_name": "bex-install",
    "help": "Install JS-Tap BEX Beacon browser extension",
    "ext_files": [
        {"os": "windows", "arch": "amd64", "path": "bex_install.x64.o"},
        {"os": "linux", "arch": "amd64", "path": "bex_install_linux.x64.o"},
        {"os": "darwin", "arch": "amd64", "path": "bex_install_darwin.x64.o"}
    ],
    "arguments": [
        {"name": "browser", "type": "string", "desc": "Target browser (chrome/chromium/firefox)"},
        {"name": "restart", "type": "bool", "desc": "Restart browser after install", "optional": true}
    ]
}
```

### 1.7 Cleanup / Uninstall BOF

A companion `bex_uninstall` BOF reverses the install:
- Remove extension files (CRX/XPI, JSON, XML, plist)
- Remove registry keys (Windows)
- Remove enterprise policy files (Linux/macOS)
- Optionally remove sidecar binary and NM manifests

---

## 2. Atomize BOF

### 2.1 Current Patching Mechanism

`atomize.py` patches Electron apps by:

1. Locating the `app.asar` (or unpacked `app/` directory) within an Electron app bundle
2. Reading `package.json` from the ASAR to find the `main` entry point
3. Generating a bootstrap payload (config + `atom-agent.js` + embedded `atom-telemlib.js`)
4. Prepending the bootstrap to the entry point file
5. Writing the modified file back into the ASAR using `asar.patch_file()`

The `asar.patch_file()` function is efficient -- it reads all packed file entries, replaces the target file's contents, recalculates offsets in the header, and writes a new ASAR. No full extract/repack needed.

The ASAR format is:
```
[size pickle: 8 bytes] [header pickle: variable, 4-byte aligned] [concatenated file data]
```
Where the size pickle contains the length of the header pickle, and the header pickle contains a JSON string describing the directory tree with file offsets and sizes relative to the end of the header section.

### 2.2 Approach: Hybrid BOF + Inline Node.js Script

Three approaches were considered:

| Approach | Pros | Cons |
|----------|------|------|
| Pure C ASAR patcher | No disk artifacts beyond patched ASAR | Complex: JSON parsing + ASAR format in C |
| BOF drops standalone binary | Simple | Extra binary on disk, detection surface |
| **BOF + inline Node.js** | **Leverages target's own runtime, minimal C code, flexible** | **Brief script on disk (cleaned up immediately)** |

**Selected approach: Hybrid BOF + inline Node.js script.**

Every Electron app ships a Node.js runtime. The BOF's job is:
1. Locate the target Electron app and its bundled Node binary
2. Generate and drop a self-contained JS patcher script (the "atomizer script")
3. Execute the script using the Electron app's own Node runtime
4. Clean up the script from disk

This is operationally sound because:
- No foreign runtime dependencies (Python, Go, etc.)
- The Node binary is already present and expected on the system
- The patcher script is transient (written, executed, deleted in seconds)
- The ASAR manipulation logic is much simpler in JavaScript than in C
- The Electron Node binary is not flagged by EDR -- it's part of a legitimate application

### 2.3 Data Flow

```
Operator                     C2 Server                 Target Host
   |                            |                           |
   |-- atomize command -------->|                           |
   |   (target app, server URL, |--- BOF + args ---------->|
   |    tag)                    |                           |
   |                            |                           |-- 1. Find Electron app
   |                            |                           |-- 2. Locate Node binary
   |                            |                           |-- 3. Read detection info
   |                            |                           |-- 4. Write atomizer.js to temp
   |                            |                           |-- 5. Execute: node atomizer.js
   |                            |                           |      - Parse ASAR header
   |                            |                           |      - Read entry point
   |                            |                           |      - Prepend bootstrap
   |                            |                           |      - Write patched ASAR
   |                            |                           |-- 6. Delete atomizer.js
   |                            |                           |-- 7. [macOS] Re-sign if needed
   |                            |<-- Output (report) -------|
   |<-- Results ----------------|                           |
```

### 2.4 BOF Arguments

```c
struct atomize_args {
    char*  target_path;      // Path to Electron app, .asar, or app/ dir
    char*  server_url;       // JS-Tap C2 server URL
    char*  tag;              // Client tag (default: "atom")
    int    detect_only;      // 0=patch, 1=recon only
    int    no_backup;        // 0=create .bak, 1=skip backup
    blob   agent_payload;    // atom-agent.js contents
    blob   telemlib_payload; // atom-telemlib.js contents
};
```

The agent and telemlib payloads are passed as blob arguments rather than being hardcoded in the BOF. This allows updating payloads without recompiling the BOF, and keeps the BOF object file smaller (the payloads can be 50-100KB+ when the renderer telemetry lib is included).

### 2.5 BOF Implementation (C)

The BOF itself handles:

#### 2.5.1 Locate the Electron App

The BOF walks the target path to find:
- `resources/app.asar` (standard location)
- `Contents/Resources/app.asar` (macOS .app bundles)
- `resources/app/package.json` (unpacked apps)

This is straightforward directory traversal using `FindFirstFileA`/`FindNextFileA` (Windows) or `opendir`/`readdir` (POSIX).

#### 2.5.2 Locate the Node Binary

Electron apps embed a Node runtime. The binary location varies:

| Platform | Typical Location |
|----------|-----------------|
| Windows  | `<app_dir>\<appname>.exe` (the main Electron executable IS Node) |
| Linux    | `<app_dir>/<appname>` (ELF binary, same as Electron main) |
| macOS    | `<app_dir>/Contents/MacOS/<appname>` or `<app_dir>/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/Electron Helper.app/Contents/MacOS/Electron Helper` |

The key insight: every Electron app's main executable can act as a Node.js runtime when the `ELECTRON_RUN_AS_NODE=1` environment variable is set. This is a well-known technique (used by VS Code's remote extension, among others).

**Fuse check:** If the `RunAsNode` fuse is DISABLED (byte `0x30` at the fuse offset in the binary), the `ELECTRON_RUN_AS_NODE` trick won't work. The BOF should check for this:
1. Find the binary
2. Search for the fuse sentinel: `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`
3. Check byte at `sentinel_offset + len(sentinel) + 1` (RunAsNode fuse, index 0)
4. If `0x30` (DISABLED): report failure, suggest alternative (drop standalone Node, or use the pure C approach)
5. If `0x31` (ENABLED) or `0x72` (DEFAULT): proceed

#### 2.5.3 Generate the Atomizer Script

The BOF constructs a self-contained JavaScript file that:

```javascript
// atomizer.js -- generated and dropped by BOF, executed with ELECTRON_RUN_AS_NODE=1
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG = {
    asarPath: '__ASAR_PATH__',
    serverUrl: '__SERVER_URL__',
    tag: '__TAG__',
    ipcPrefix: '__ax' + crypto.randomBytes(4).toString('hex'),
    detectOnly: __DETECT_ONLY__,
    noBackup: __NO_BACKUP__
};

// ---- Inline ASAR library (ported from asar.py) ----
function align4(n) { return (n + 3) & ~3; }

function readHeader(asarPath) {
    const fd = fs.openSync(asarPath, 'r');
    const sizeBuf = Buffer.alloc(8);
    fs.readSync(fd, sizeBuf, 0, 8, 0);
    // Size pickle: 4-byte payload_size, 4-byte value
    const headerPickleSize = sizeBuf.readUInt32LE(4);
    // Header pickle: 4-byte payload_size, 4-byte string_length, then string
    const headerBuf = Buffer.alloc(headerPickleSize);
    fs.readSync(fd, headerBuf, 0, headerPickleSize, 8);
    const stringLength = headerBuf.readUInt32LE(4);
    const headerJson = headerBuf.toString('utf-8', 8, 8 + stringLength);
    fs.closeSync(fd);
    return { header: JSON.parse(headerJson), dataOffset: 8 + headerPickleSize };
}

function patchFile(asarPath, internalPath, newData, outputPath) {
    // ... (port of asar.py patch_file logic)
}

// ---- Agent payload (passed as argument, embedded by BOF) ----
const AGENT_CODE = __AGENT_CODE_JSON__;
const TELEMLIB_CODE = __TELEMLIB_CODE_JSON__;

// ---- Main ----
// ... detection, patching, reporting
```

The `__AGENT_CODE_JSON__` and `__TELEMLIB_CODE_JSON__` placeholders are replaced by the BOF with JSON-escaped string literals of the actual payload files. Template variables within the agent (`__ATOM_SERVER_URL__`, `__ATOM_TAG__`, `__ATOM_IPC_PREFIX__`) are substituted before embedding.

The script writes its output (detection results, success/failure) to stdout, which the BOF captures.

#### 2.5.4 Execute and Clean Up

```c
// Windows
SetEnvironmentVariableA("ELECTRON_RUN_AS_NODE", "1");
CreateProcessA(electron_path, "electron_path atomizer.js", ...);
WaitForSingleObject(process, timeout);
// Read stdout from pipe
DeleteFileA(atomizer_js_path);
SetEnvironmentVariableA("ELECTRON_RUN_AS_NODE", NULL);

// POSIX
setenv("ELECTRON_RUN_AS_NODE", "1", 1);
// fork/exec or popen
unlink(atomizer_js_path);
unsetenv("ELECTRON_RUN_AS_NODE");
```

**Temp file location:** The atomizer script is written to a temp directory (`GetTempPathA` on Windows, `/tmp` or `$TMPDIR` on POSIX). The filename should be innocuous (e.g., `node_modules_check.js` or similar).

### 2.6 Detection / Recon Mode

When `detect_only=1`, the atomizer script runs the detection logic without patching. This replicates the `--detect-only` mode from `atomize.py`:

- Entry point identification
- Security settings scan (nodeIntegration, contextIsolation, sandbox, etc.)
- Electron fuse analysis
- Code signing status (macOS)
- ASAR integrity check (macOS)
- Already-patched detection

The results are printed to stdout and captured by the BOF for relay to the operator. This is valuable recon before committing to a patch operation.

### 2.7 macOS Code Signing Considerations

On macOS, patching the ASAR invalidates the app's code signature. Depending on the system configuration:

- **Unsigned apps / ad-hoc signed:** May trigger Gatekeeper on first launch. Fix: `xattr -cr /path/to/App.app` or `codesign --force --deep --sign - /path/to/App.app`
- **Developer-signed apps:** Signature is broken. The app will still run (Gatekeeper checks happen at download time, not on every launch for already-installed apps), but signature verification tools will flag it.
- **Hardened runtime with library validation:** Could prevent the patched app from loading. Rare for Electron apps.

The BOF should:
1. Check current signing status before patching (report to operator)
2. After patching, attempt ad-hoc re-signing if `codesign` is available: `codesign --force --deep --sign - <app_path>`
3. Clear quarantine attributes: `xattr -cr <app_path>`

### 2.8 Handling the RunAsNode Fuse

If the RunAsNode fuse is disabled, the hybrid approach fails. Fallback options (in order of preference):

1. **Check for `NODE_OPTIONS` fuse:** If `EnableNodeOptionsEnvironmentVariable` is still enabled, inject via `NODE_OPTIONS=--require=atomizer.js` and launch the app normally. The app starts with the patcher loaded, patches itself, then the patcher lets the app continue.

2. **Use the app's own startup:** Drop the atomizer script as a preload script or into a location the app will `require()`. This is app-specific and fragile.

3. **Pure C ASAR patcher (Phase 3):** Implement the ASAR parsing and patching entirely in C within the BOF. No external process needed. This is the most robust fallback but requires significantly more implementation effort.

4. **Drop a standalone Node binary:** Least preferred. Increases disk footprint and detection surface.

### 2.9 Electron App Discovery BOF

A useful companion BOF for recon: enumerate Electron apps on the target system.

**Windows:**
- Scan `Program Files`, `Program Files (x86)`, `%LOCALAPPDATA%\Programs`
- Look for directories containing `resources\app.asar`

**Linux:**
- Scan `/usr/lib`, `/opt`, `/usr/share`, `/snap`, `~/.local/share`
- Look for directories containing `resources/app.asar`

**macOS:**
- Scan `/Applications`, `~/Applications`
- Look for `.app` bundles containing `Contents/Resources/app.asar`

Output: list of discovered Electron apps with path, app name (from `package.json`), Electron version, and fuse status summary.

---

## 3. Operational Considerations

### 3.1 OPSEC

**BEX Install BOF:**
- File writes to disk are unavoidable (the extension must persist). Use benign directory names (the existing `install_dirname` config, e.g., "webperf-tools", helps here).
- Registry writes (Windows) are to `HKCU`, not `HKLM`. User-level operations are less likely to trigger alerts.
- Enterprise policy writes (Linux/macOS) require root and touch system directories. These are more likely to be monitored.
- The extension itself is the primary detection surface. Its behavior (DOM manipulation, network requests to the C2) is where EDR/network monitoring matters most.

**Atomize BOF:**
- The ASAR modification changes file hashes. File integrity monitoring (FIM) on the app's resources directory will detect this.
- The temporary atomizer script exists on disk for seconds. Use a benign filename and write to a non-monitored temp directory.
- The `ELECTRON_RUN_AS_NODE` environment variable is a known technique. Some EDR products flag its use. Consider: set it only for the spawned process (not system-wide), and clear it immediately.
- Process creation (`node atomizer.js`) creates a parent-child relationship visible in process trees. The parent is the implant process.
- Ad-hoc re-signing on macOS is a known indicator. The `codesign` execution will be logged.

### 3.2 Error Handling

Both BOFs should handle failures gracefully and report detailed status:

- **File permission errors:** Report and abort (don't leave partial state)
- **Browser/app not found:** Report available targets, suggest alternatives
- **Already installed/patched:** Detect and report (check for existing extension files, existing bootstrap marker in ASAR)
- **Fuse blocks:** Report fuse state and suggest alternatives
- **Disk space:** Check available space before writing (extension CRX can be 200KB+, sidecar binary can be 5MB+)

### 3.3 Cleanup

**BEX Install -- Cleanup considerations:**
- The `bex_uninstall` BOF should be able to fully reverse the install
- For Chrome enterprise policy installs, removing the policy file is sufficient -- Chrome will uninstall the extension on next restart
- For Firefox, removing the XPI from the profile `extensions/` directory and restarting Firefox uninstalls it

**Atomize -- Cleanup considerations:**
- If `--no-backup` was not set, the original ASAR is at `app.asar.bak`. Restore by renaming.
- If no backup exists, the original ASAR is lost. The app would need to be reinstalled to restore it.
- The atomizer script is deleted immediately after execution. If the BOF crashes mid-execution, a stale temp file remains. Consider: write a unique filename and attempt cleanup on next BOF invocation.

---

## 4. Implementation Roadmap

### Phase 1: BEX Install BOF (Windows)

**Scope:** Windows Chrome registry-based install + Firefox profile install.

This is the simplest starting point because:
- No elevation required for Chrome (HKCU registry + user-local file drops)
- No elevation required for Firefox (profile directory is user-owned)
- Windows BOFs are the most well-supported across both Cobalt Strike and Sliver
- Registry and file operations are well-documented BOF patterns

**Deliverables:**
- `bex_install.x64.o` -- COFF object file
- `bex_install.cna` -- Cobalt Strike aggressor script
- `bex_install.json` -- Sliver extension manifest
- `bex_uninstall.x64.o` -- Cleanup BOF
- Build integration: `buildAll.py` generates BOF argument blobs alongside deploy bundles

**Estimated effort:** 1-2 weeks

### Phase 2: BEX Install BOF (Linux/macOS) + Atomize BOF (All Platforms)

**Scope:**
- Linux/macOS BEX install (ELF-based BOFs or Sliver extensions)
- Atomize BOF for all platforms (hybrid approach)

**Deliverables:**
- `bex_install_linux.x64.o`, `bex_install_darwin.x64.o`
- `atomize.x64.o` (Windows), `atomize_linux.x64.o`, `atomize_darwin.x64.o`
- `atomize_discover.x64.o` -- Electron app discovery/recon BOF
- Aggressor and Sliver extension manifests

**Estimated effort:** 2-3 weeks

### Phase 3: Pure C ASAR Patcher (Fallback)

**Scope:** Implement ASAR parsing and single-file patching entirely in C, for cases where the RunAsNode fuse is disabled.

This requires:
- Chromium Pickle format parser (straightforward -- just uint32 reads with alignment)
- Minimal JSON parser (only need to navigate `files` tree and read `offset`/`size`/`main` fields -- a full JSON parser is overkill; a purpose-built one targeting ASAR headers is ~200 lines of C)
- ASAR writer (header pickle + concatenated file data)

**Deliverables:**
- Updated `atomize.x64.o` with built-in C patcher as fallback
- No external process creation needed

**Estimated effort:** 2 weeks

### Phase 4: Build System Integration

**Scope:** Integrate BOF compilation into the `buildAll.py` unified build system.

- Add `--bof` flag to `buildAll.py`
- Cross-compile BOFs for each platform (requires appropriate toolchains)
- Package BOFs with pre-configured arguments (extension bytes, IDs, server URL baked into argument templates)
- Generate ready-to-use Cobalt Strike kit and Sliver extension packages

**Deliverables:**
- `build/bof/` directory with all compiled BOFs + wrapper scripts
- `build/bof/cobalt-strike/` -- CNA scripts + object files
- `build/bof/sliver/` -- Extension manifests + object files

**Estimated effort:** 1 week

---

## 5. Open Questions and Future Considerations

### Open Questions

1. **Extension size limits in BOF arguments:** CRX/XPI files are typically 100-300KB. Sidecar binaries can be 5-10MB. Cobalt Strike BOF arguments have practical size limits (the entire BOF + args must fit in a single task). For large payloads, should we stage the files separately (e.g., via `upload` command) and pass only the path to the BOF?

2. **Multi-profile Firefox support:** The current approach finds and patches a single default profile. Should the BOF enumerate all profiles and install to each? Some users have multiple profiles (work/personal).

3. **Chromium derivative support:** Edge, Brave, Opera, Vivaldi, etc. all use Chromium's extension system but with different paths. Should the BOF support these? The install mechanism is identical -- only the file paths and registry keys differ.

4. **Atomic install:** Should the BOF verify the install succeeded before reporting success? For Chrome, this could mean checking that the registry key exists after writing. For Firefox, checking the XPI file size matches.

5. **Sidecar compilation:** The sidecar is currently cross-compiled as a Go binary. Should BOF bundles include pre-compiled sidecar binaries for all platforms, or should the sidecar be a separate deployment step?

### Future Considerations

- **Extension update mechanism:** The enterprise policy approach (Chrome Linux/macOS) supports update URLs. This could be pointed at the JS-Tap server to enable OTA extension updates without re-running the BOF.

- **Electron app auto-discovery + bulk patching:** An operator workflow: run discovery BOF, review results, select targets, run atomize BOF against each. Could be wrapped in a single high-level command.

- **Anti-forensics:** Consider timestomping the dropped files (`SetFileTime` on Windows, `utimes` on POSIX) to match surrounding files in the same directory. A CRX file with a recent creation timestamp in `/opt/` or `%LOCALAPPDATA%` may stand out.

- **BOF chaining:** Sliver and Cobalt Strike both support sequential BOF execution. A workflow like "discover -> detect -> patch -> verify" could be automated as a chain.

- **Process hollowing for Node execution:** Instead of creating a visible child process to run the atomizer script, inject the script into an existing Node/Electron process. Significantly more complex but avoids process creation events.

- **Persistence via Electron auto-update:** Some Electron apps auto-update, which would overwrite the patched ASAR. Consider hooking the update mechanism or re-patching after updates. The atom-beacon agent could monitor for its own removal and signal the C2 server.
