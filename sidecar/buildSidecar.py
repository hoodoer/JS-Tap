import json
import os
import shutil
import subprocess
import stat


def main():
    """
    Builds the Sidecar native messaging host.
    Cross-compiles Go binaries for all platforms, generates native messaging
    manifests, and creates install scripts for Chrome/Firefox on Linux/macOS/Windows.

    Reads configuration from config.json in this directory.
    """
    print("Starting Sidecar build process...")

    base_dir = os.path.dirname(os.path.abspath(__file__))

    # Load sidecar config — try local first, fall back to central config
    config_path = os.path.join(base_dir, 'config.json')
    central_config_path = os.path.join(base_dir, '..', 'bex-beacon', 'config.json')

    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            config = json.load(f)
    elif os.path.exists(central_config_path):
        print("No local config.json found, deriving from ../bex-beacon/config.json")
        with open(central_config_path, 'r') as f:
            central = json.load(f)
        ext_ids = central.get('extension_ids', {})
        sidecar_cfg = central.get('sidecar', {})
        config = {
            'host_name': sidecar_cfg.get('host_name', 'com.jstap.sidecar'),
            'binary_name': sidecar_cfg.get('binary_name', 'sidecar'),
            'chrome_extension_id': ext_ids.get('chrome_extension_id', ''),
            'firefox_extension_id': ext_ids.get('firefox_extension_id', ''),
        }
    else:
        print("ERROR: No config.json found in sidecar directory or ../bex-beacon/.")
        print("  Create sidecar/config.json with host_name and extension IDs,")
        print("  or run the unified build from the project root.")
        return

    host_name = config.get('host_name', 'com.jstap.sidecar')
    binary_name = config.get('binary_name', 'sidecar')
    chrome_ext_id = config.get('chrome_extension_id', '')
    firefox_ext_id = config.get('firefox_extension_id', '')

    # Verify Go source files exist
    if not os.path.exists(os.path.join(base_dir, 'go.mod')):
        print("ERROR: go.mod not found. Run this script from the sidecar/ directory.")
        return

    # Setup build output directories
    build_dir = os.path.join(base_dir, 'build')
    binaries_dir = os.path.join(build_dir, 'binaries')
    manifests_dir = os.path.join(build_dir, 'manifests')
    install_dir = os.path.join(build_dir, 'install')

    if os.path.exists(build_dir):
        shutil.rmtree(build_dir)

    os.makedirs(binaries_dir)
    os.makedirs(manifests_dir)
    os.makedirs(install_dir)
    print(f"Cleaned and created build directory: {build_dir}")

    # 1. Cross-compile Go binary for all platforms
    targets = [
        ('windows', 'amd64', f'{binary_name}-windows-amd64.exe'),
        ('linux',   'amd64', f'{binary_name}-linux-amd64'),
        ('darwin',  'amd64', f'{binary_name}-darwin-amd64'),
        ('darwin',  'arm64', f'{binary_name}-darwin-arm64'),
    ]

    print("\nCross-compiling sidecar binary...")
    for goos, goarch, output_name in targets:
        output_path = os.path.join(binaries_dir, output_name)
        env = os.environ.copy()
        env['GOOS'] = goos
        env['GOARCH'] = goarch
        env['CGO_ENABLED'] = '0'
        try:
            subprocess.run(
                ['go', 'build', '-ldflags', '-s -w', '-o', output_path, '.'],
                cwd=base_dir, env=env, check=True,
                capture_output=True, text=True
            )
            print(f"  Built: {output_name}")
        except subprocess.CalledProcessError as e:
            print(f"  FAILED: {output_name} - {e.stderr}")
            continue
        except FileNotFoundError:
            print("  ERROR: 'go' command not found. Install Go to build sidecar binaries.")
            return

    # 2. Generate native messaging manifests
    print("\nGenerating native messaging manifests...")

    chrome_manifest = {
        "name": host_name,
        "description": "JS-Tap Sidecar Native Messaging Host",
        "path": "/path/to/sidecar",
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{chrome_ext_id}/"] if chrome_ext_id else []
    }
    chrome_manifest_path = os.path.join(manifests_dir, f'{host_name}-chrome.json')
    with open(chrome_manifest_path, 'w') as f:
        json.dump(chrome_manifest, f, indent=2)
    print(f"  Chrome manifest: {chrome_manifest_path}")

    firefox_manifest = {
        "name": host_name,
        "description": "JS-Tap Sidecar Native Messaging Host",
        "path": "/path/to/sidecar",
        "type": "stdio",
        "allowed_extensions": [firefox_ext_id] if firefox_ext_id else []
    }
    firefox_manifest_path = os.path.join(manifests_dir, f'{host_name}-firefox.json')
    with open(firefox_manifest_path, 'w') as f:
        json.dump(firefox_manifest, f, indent=2)
    print(f"  Firefox manifest: {firefox_manifest_path}")

    # 3. Generate install scripts
    print("\nGenerating install scripts...")
    generate_install_scripts(install_dir, host_name, binary_name, chrome_ext_id, firefox_ext_id)

    # Summary
    print("\nSidecar build complete.")
    print(f"  Binaries:        {binaries_dir}")
    print(f"  Manifests:       {manifests_dir}")
    print(f"  Install scripts: {install_dir}")
    if not chrome_ext_id:
        print("  WARNING: chrome_extension_id is empty in config.json.")
    if not firefox_ext_id:
        print("  WARNING: firefox_extension_id is empty in config.json.")


def generate_install_scripts(install_dir, host_name, binary_name, chrome_ext_id, firefox_ext_id):
    """Generate platform-specific install scripts for both Chrome and Firefox."""

    # --- Linux Chrome ---
    write_script(os.path.join(install_dir, 'install-chrome-linux.sh'), f'''#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY_DIR="$SCRIPT_DIR/../binaries"
BINARY_SRC="$BINARY_DIR/{binary_name}-linux-amd64"

INSTALL_DIR="$HOME/.local/bin"
MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
BINARY_DEST="$INSTALL_DIR/{binary_name}"

mkdir -p "$INSTALL_DIR" "$MANIFEST_DIR"
cp "$BINARY_SRC" "$BINARY_DEST"
chmod +x "$BINARY_DEST"

cat > "$MANIFEST_DIR/{host_name}.json" << MANIFEST_EOF
{{
  "name": "{host_name}",
  "description": "JS-Tap Sidecar Native Messaging Host",
  "path": "$BINARY_DEST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://{chrome_ext_id}/"]
}}
MANIFEST_EOF

echo "Installed sidecar for Chrome on Linux."
echo "  Binary: $BINARY_DEST"
echo "  Manifest: $MANIFEST_DIR/{host_name}.json"
''')

    # --- Linux Chromium ---
    write_script(os.path.join(install_dir, 'install-chromium-linux.sh'), f'''#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY_DIR="$SCRIPT_DIR/../binaries"
BINARY_SRC="$BINARY_DIR/{binary_name}-linux-amd64"

INSTALL_DIR="$HOME/.local/bin"
MANIFEST_DIR="$HOME/.config/chromium/NativeMessagingHosts"
BINARY_DEST="$INSTALL_DIR/{binary_name}"

mkdir -p "$INSTALL_DIR" "$MANIFEST_DIR"
cp "$BINARY_SRC" "$BINARY_DEST"
chmod +x "$BINARY_DEST"

cat > "$MANIFEST_DIR/{host_name}.json" << MANIFEST_EOF
{{
  "name": "{host_name}",
  "description": "JS-Tap Sidecar Native Messaging Host",
  "path": "$BINARY_DEST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://{chrome_ext_id}/"]
}}
MANIFEST_EOF

echo "Installed sidecar for Chromium on Linux."
echo "  Binary: $BINARY_DEST"
echo "  Manifest: $MANIFEST_DIR/{host_name}.json"
''')

    # --- macOS Chromium ---
    write_script(os.path.join(install_dir, 'install-chromium-mac.sh'), f'''#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY_DIR="$SCRIPT_DIR/../binaries"

ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
    BINARY_SRC="$BINARY_DIR/{binary_name}-darwin-arm64"
else
    BINARY_SRC="$BINARY_DIR/{binary_name}-darwin-amd64"
fi

INSTALL_DIR="$HOME/.local/bin"
MANIFEST_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
BINARY_DEST="$INSTALL_DIR/{binary_name}"

mkdir -p "$INSTALL_DIR" "$MANIFEST_DIR"
cp "$BINARY_SRC" "$BINARY_DEST"
chmod +x "$BINARY_DEST"

cat > "$MANIFEST_DIR/{host_name}.json" << MANIFEST_EOF
{{
  "name": "{host_name}",
  "description": "JS-Tap Sidecar Native Messaging Host",
  "path": "$BINARY_DEST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://{chrome_ext_id}/"]
}}
MANIFEST_EOF

echo "Installed sidecar for Chromium on macOS."
echo "  Binary: $BINARY_DEST"
echo "  Manifest: $MANIFEST_DIR/{host_name}.json"
''')

    # --- Linux Firefox ---
    write_script(os.path.join(install_dir, 'install-firefox-linux.sh'), f'''#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY_DIR="$SCRIPT_DIR/../binaries"
BINARY_SRC="$BINARY_DIR/{binary_name}-linux-amd64"

INSTALL_DIR="$HOME/.local/bin"
MANIFEST_DIR="$HOME/.mozilla/native-messaging-hosts"
BINARY_DEST="$INSTALL_DIR/{binary_name}"

mkdir -p "$INSTALL_DIR" "$MANIFEST_DIR"
cp "$BINARY_SRC" "$BINARY_DEST"
chmod +x "$BINARY_DEST"

cat > "$MANIFEST_DIR/{host_name}.json" << MANIFEST_EOF
{{
  "name": "{host_name}",
  "description": "JS-Tap Sidecar Native Messaging Host",
  "path": "$BINARY_DEST",
  "type": "stdio",
  "allowed_extensions": ["{firefox_ext_id}"]
}}
MANIFEST_EOF

echo "Installed sidecar for Firefox on Linux."
echo "  Binary: $BINARY_DEST"
echo "  Manifest: $MANIFEST_DIR/{host_name}.json"
''')

    # --- macOS Chrome ---
    write_script(os.path.join(install_dir, 'install-chrome-mac.sh'), f'''#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY_DIR="$SCRIPT_DIR/../binaries"

# Detect architecture
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
    BINARY_SRC="$BINARY_DIR/{binary_name}-darwin-arm64"
else
    BINARY_SRC="$BINARY_DIR/{binary_name}-darwin-amd64"
fi

INSTALL_DIR="$HOME/.local/bin"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
BINARY_DEST="$INSTALL_DIR/{binary_name}"

mkdir -p "$INSTALL_DIR" "$MANIFEST_DIR"
cp "$BINARY_SRC" "$BINARY_DEST"
chmod +x "$BINARY_DEST"

cat > "$MANIFEST_DIR/{host_name}.json" << MANIFEST_EOF
{{
  "name": "{host_name}",
  "description": "JS-Tap Sidecar Native Messaging Host",
  "path": "$BINARY_DEST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://{chrome_ext_id}/"]
}}
MANIFEST_EOF

echo "Installed sidecar for Chrome on macOS."
echo "  Binary: $BINARY_DEST"
echo "  Manifest: $MANIFEST_DIR/{host_name}.json"
''')

    # --- macOS Firefox ---
    write_script(os.path.join(install_dir, 'install-firefox-mac.sh'), f'''#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY_DIR="$SCRIPT_DIR/../binaries"

ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
    BINARY_SRC="$BINARY_DIR/{binary_name}-darwin-arm64"
else
    BINARY_SRC="$BINARY_DIR/{binary_name}-darwin-amd64"
fi

INSTALL_DIR="$HOME/.local/bin"
MANIFEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
BINARY_DEST="$INSTALL_DIR/{binary_name}"

mkdir -p "$INSTALL_DIR" "$MANIFEST_DIR"
cp "$BINARY_SRC" "$BINARY_DEST"
chmod +x "$BINARY_DEST"

cat > "$MANIFEST_DIR/{host_name}.json" << MANIFEST_EOF
{{
  "name": "{host_name}",
  "description": "JS-Tap Sidecar Native Messaging Host",
  "path": "$BINARY_DEST",
  "type": "stdio",
  "allowed_extensions": ["{firefox_ext_id}"]
}}
MANIFEST_EOF

echo "Installed sidecar for Firefox on macOS."
echo "  Binary: $BINARY_DEST"
echo "  Manifest: $MANIFEST_DIR/{host_name}.json"
''')

    # --- Windows Chrome (.bat) ---
    write_script(os.path.join(install_dir, 'install-chrome-windows.bat'), f'''@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "BINARY_SRC=%SCRIPT_DIR%..\\binaries\\{binary_name}-windows-amd64.exe"
set "INSTALL_DIR=%LOCALAPPDATA%\\JSTap"
set "BINARY_DEST=%INSTALL_DIR%\\{binary_name}.exe"
set "MANIFEST_DIR=%LOCALAPPDATA%\\Google\\Chrome\\User Data\\NativeMessagingHosts"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%MANIFEST_DIR%" mkdir "%MANIFEST_DIR%"

copy /Y "%BINARY_SRC%" "%BINARY_DEST%"

(
echo {{
echo   "name": "{host_name}",
echo   "description": "JS-Tap Sidecar Native Messaging Host",
echo   "path": "%BINARY_DEST:\\=\\\\%",
echo   "type": "stdio",
echo   "allowed_origins": ["chrome-extension://{chrome_ext_id}/"]
echo }}
) > "%MANIFEST_DIR%\\{host_name}.json"

reg add "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\{host_name}" /ve /t REG_SZ /d "%MANIFEST_DIR%\\{host_name}.json" /f

echo Installed sidecar for Chrome on Windows.
echo   Binary: %BINARY_DEST%
echo   Manifest: %MANIFEST_DIR%\\{host_name}.json
pause
''', executable=False)

    # --- Windows Firefox (.bat) ---
    write_script(os.path.join(install_dir, 'install-firefox-windows.bat'), f'''@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "BINARY_SRC=%SCRIPT_DIR%..\\binaries\\{binary_name}-windows-amd64.exe"
set "INSTALL_DIR=%LOCALAPPDATA%\\JSTap"
set "BINARY_DEST=%INSTALL_DIR%\\{binary_name}.exe"
set "MANIFEST_DIR=%APPDATA%\\Mozilla\\NativeMessagingHosts"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%MANIFEST_DIR%" mkdir "%MANIFEST_DIR%"

copy /Y "%BINARY_SRC%" "%BINARY_DEST%"

(
echo {{
echo   "name": "{host_name}",
echo   "description": "JS-Tap Sidecar Native Messaging Host",
echo   "path": "%BINARY_DEST:\\=\\\\%",
echo   "type": "stdio",
echo   "allowed_extensions": ["{firefox_ext_id}"]
echo }}
) > "%MANIFEST_DIR%\\{host_name}.json"

reg add "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\{host_name}" /ve /t REG_SZ /d "%MANIFEST_DIR%\\{host_name}.json" /f

echo Installed sidecar for Firefox on Windows.
echo   Binary: %BINARY_DEST%
echo   Manifest: %MANIFEST_DIR%\\{host_name}.json
pause
''', executable=False)

    # --- Windows Registry files (.reg) for manual import ---
    manifest_path_chrome = f'%LOCALAPPDATA%\\\\Google\\\\Chrome\\\\User Data\\\\NativeMessagingHosts\\\\{host_name}.json'
    with open(os.path.join(install_dir, 'install-chrome-windows.reg'), 'w') as f:
        f.write(f'Windows Registry Editor Version 5.00\n\n')
        f.write(f'[HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\{host_name}]\n')
        f.write(f'@="{manifest_path_chrome}"\n')

    manifest_path_firefox = f'%APPDATA%\\\\Mozilla\\\\NativeMessagingHosts\\\\{host_name}.json'
    with open(os.path.join(install_dir, 'install-firefox-windows.reg'), 'w') as f:
        f.write(f'Windows Registry Editor Version 5.00\n\n')
        f.write(f'[HKEY_CURRENT_USER\\Software\\Mozilla\\NativeMessagingHosts\\{host_name}]\n')
        f.write(f'@="{manifest_path_firefox}"\n')


def write_script(path, content, executable=True):
    """Write a script file and optionally make it executable."""
    with open(path, 'w', newline='\n' if path.endswith('.sh') else None) as f:
        f.write(content)
    if executable:
        st = os.stat(path)
        os.chmod(path, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


if __name__ == '__main__':
    main()
