#!/usr/bin/env python3
"""
Unified build script for JS-Tap.

Builds WXT browser extensions (Chrome MV3 + Firefox MV2), packs them as
.crx/.xpi for deployment, optionally builds the sidecar native messaging host,
and generates self-contained deploy bundles for each browser/OS combination.

Usage:
    python3 buildAll.py                  # Build everything
    python3 buildAll.py --ext-only       # Extensions only
    python3 buildAll.py --sidecar-only   # Sidecar only
    python3 buildAll.py --legacy         # Also build legacy extensions
"""

import argparse
import base64
import hashlib
import io
import json
import os
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile


PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
BEX_BEACON_DIR = os.path.join(PROJECT_ROOT, 'bex-beacon')
SIDECAR_DIR = os.path.join(PROJECT_ROOT, 'sidecar')
BUILD_DIR = os.path.join(PROJECT_ROOT, 'build')
DEPLOY_DIR = os.path.join(BUILD_DIR, 'deploy')


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def compute_chrome_id_from_key(chrome_key_b64):
    """Compute the 32-char Chrome extension ID from a base64-encoded DER public key."""
    if not chrome_key_b64:
        return None
    try:
        key_bytes = base64.b64decode(chrome_key_b64)
    except Exception:
        return None
    digest = hashlib.sha256(key_bytes).hexdigest()
    return ''.join(chr(ord('a') + int(c, 16)) for c in digest[:32])


def load_config():
    """Load and return the central config from bex-beacon/config.json."""
    config_path = os.path.join(BEX_BEACON_DIR, 'config.json')
    if not os.path.exists(config_path):
        print("ERROR: bex-beacon/config.json not found.")
        sys.exit(1)
    with open(config_path, 'r') as f:
        return json.load(f)


def ensure_key_pem(config):
    """Ensure a key.pem exists for CRX packing. Auto-generates one if needed.

    Returns the absolute path to the .pem file and updates config in-place
    with the derived chrome_key and chrome_extension_id.
    """
    ext_ids = config.setdefault('extension_ids', {})
    pem_rel = ext_ids.get('chrome_key_pem', '')

    # Resolve path — default to key.pem in project root
    if pem_rel:
        pem_path = os.path.join(PROJECT_ROOT, pem_rel) if not os.path.isabs(pem_rel) else pem_rel
    else:
        pem_path = os.path.join(PROJECT_ROOT, 'key.pem')

    # Generate key if it doesn't exist
    if not os.path.exists(pem_path):
        print(f"Generating new key: {os.path.relpath(pem_path, PROJECT_ROOT)}")
        try:
            result = subprocess.run(
                ['openssl', 'genrsa', '2048'],
                capture_output=True, text=True, check=True
            )
            with open(pem_path, 'w') as f:
                f.write(result.stdout)
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            print(f"  WARNING: Could not generate key.pem: {e}")
            print("  .crx packing will not be available.")
            return None
        print(f"  Saved: {os.path.relpath(pem_path, PROJECT_ROOT)}")
        print(f"  Keep this file to maintain a stable Chrome extension ID across builds.")
        print()

    # Extract public key (DER base64) from the PEM private key
    chrome_key = ext_ids.get('chrome_key', '')
    if not chrome_key:
        try:
            result = subprocess.run(
                ['openssl', 'rsa', '-in', pem_path, '-pubout', '-outform', 'DER'],
                capture_output=True, check=True
            )
            chrome_key = base64.b64encode(result.stdout).decode()
            ext_ids['chrome_key'] = chrome_key
        except (subprocess.CalledProcessError, FileNotFoundError):
            print("  WARNING: Could not extract public key from key.pem")
            return pem_path

    # Compute extension ID from key
    chrome_id = ext_ids.get('chrome_extension_id', '')
    computed_id = compute_chrome_id_from_key(chrome_key)
    if computed_id:
        if chrome_id and chrome_id != computed_id:
            print(f"WARNING: chrome_extension_id mismatch!")
            print(f"  Config says: {chrome_id}")
            print(f"  Key implies: {computed_id}")
            print()
        else:
            ext_ids['chrome_extension_id'] = computed_id

    # Update pem path in config so pack_crx can find it
    ext_ids['chrome_key_pem'] = os.path.relpath(pem_path, PROJECT_ROOT)

    return pem_path


def get_ext_ids(config):
    """Extract extension ID info from config, computing chrome ID from key if needed."""
    ext_ids = config.get('extension_ids', {})
    chrome_key = ext_ids.get('chrome_key', '')
    chrome_id = ext_ids.get('chrome_extension_id', '')
    firefox_id = ext_ids.get('firefox_extension_id', '')

    if chrome_key and not chrome_id:
        chrome_id = compute_chrome_id_from_key(chrome_key) or ''

    return chrome_key, chrome_id, firefox_id


def validate_config(config):
    """Validate config and print warnings for missing extension IDs."""
    ext_ids = config.get('extension_ids', {})
    firefox_id = ext_ids.get('firefox_extension_id', '')

    if not firefox_id:
        print("NOTE: No firefox_extension_id set. Firefox extension will use a random ID.")
        print()

    sidecar = config.get('sidecar', {})
    _, chrome_id, _ = get_ext_ids(config)
    if sidecar.get('enabled') and not chrome_id and not firefox_id:
        print("WARNING: Sidecar is enabled but no extension IDs are configured.")
        print("  Native messaging manifests will have empty allowed_origins/extensions.")
        print()


# ---------------------------------------------------------------------------
# Build steps
# ---------------------------------------------------------------------------

def build_wxt_extensions(config):
    """Build Chrome and Firefox extensions using WXT."""
    print("\n=== Building WXT Extensions ===\n")

    # Pre-build: copy telemlib.js into public/ so WXT bundles it in the extension package.
    # This is required for chrome.scripting.executeScript({ files: ['telemlib.js'] }).
    telemlib_src = os.path.join(PROJECT_ROOT, 'telemlib.js')
    telemlib_dest = os.path.join(BEX_BEACON_DIR, 'public', 'telemlib.js')
    if os.path.isfile(telemlib_src):
        shutil.copy2(telemlib_src, telemlib_dest)
        print("  Copied telemlib.js into bex-beacon/public/")

    print("Building Chrome MV3 extension...")
    result = subprocess.run(
        ['npx', 'wxt', 'build'],
        cwd=BEX_BEACON_DIR, capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"ERROR: Chrome build failed:\n{result.stderr}")
        sys.exit(1)
    print("  Chrome MV3 build complete.")

    print("Building Firefox MV2 extension...")
    result = subprocess.run(
        ['npx', 'wxt', 'build', '-b', 'firefox'],
        cwd=BEX_BEACON_DIR, capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"ERROR: Firefox build failed:\n{result.stderr}")
        sys.exit(1)
    print("  Firefox MV2 build complete.")

    # Post-build: patch Firefox manifest with gecko ID
    ext_ids = config.get('extension_ids', {})
    firefox_id = ext_ids.get('firefox_extension_id', '')
    firefox_dist = os.path.join(BEX_BEACON_DIR, 'dist', 'firefox-mv2')

    if not os.path.isdir(firefox_dist):
        for name in os.listdir(os.path.join(BEX_BEACON_DIR, 'dist')):
            if 'firefox' in name.lower():
                firefox_dist = os.path.join(BEX_BEACON_DIR, 'dist', name)
                break

    if firefox_id and os.path.isdir(firefox_dist):
        manifest_path = os.path.join(firefox_dist, 'manifest.json')
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
            manifest.setdefault('browser_specific_settings', {})
            manifest['browser_specific_settings']['gecko'] = {'id': firefox_id}
            with open(manifest_path, 'w') as f:
                json.dump(manifest, f, indent=2)
            print(f"  Patched Firefox manifest with gecko ID: {firefox_id}")


def build_legacy_extensions():
    """Build legacy Chrome and Firefox extensions using bex-beacon/buildBexBeacon.py."""
    print("\n=== Building Legacy Extensions ===\n")
    result = subprocess.run(
        [sys.executable, 'buildBexBeacon.py'],
        cwd=BEX_BEACON_DIR, capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"ERROR: Legacy build failed:\n{result.stderr}")
        sys.exit(1)
    print(result.stdout)


def sync_sidecar_config(config):
    """Generate sidecar/config.json from central config."""
    ext_ids = config.get('extension_ids', {})
    sidecar_cfg = config.get('sidecar', {})
    _, chrome_id, firefox_id = get_ext_ids(config)

    sidecar_config = {
        'host_name': sidecar_cfg.get('host_name', 'com.jstap.sidecar'),
        'binary_name': sidecar_cfg.get('binary_name', 'sidecar'),
        'chrome_extension_id': chrome_id,
        'firefox_extension_id': firefox_id,
    }

    config_path = os.path.join(SIDECAR_DIR, 'config.json')
    with open(config_path, 'w') as f:
        json.dump(sidecar_config, f, indent=2)
        f.write('\n')
    print(f"  Synced sidecar/config.json from central config.")


def build_sidecar(config):
    """Build sidecar native messaging host."""
    print("\n=== Building Sidecar ===\n")
    sync_sidecar_config(config)

    result = subprocess.run(
        [sys.executable, 'buildSidecar.py'],
        cwd=SIDECAR_DIR, capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"ERROR: Sidecar build failed:\n{result.stderr}")
        sys.exit(1)
    print(result.stdout)


# ---------------------------------------------------------------------------
# Extension packing
# ---------------------------------------------------------------------------

def _protobuf_varint(value):
    """Encode an integer as a protobuf varint."""
    result = []
    while value > 0x7f:
        result.append((value & 0x7f) | 0x80)
        value >>= 7
    result.append(value & 0x7f)
    return bytes(result)


def _protobuf_field(field_number, data):
    """Encode a length-delimited protobuf field (wire type 2)."""
    tag = _protobuf_varint((field_number << 3) | 2)
    return tag + _protobuf_varint(len(data)) + data


def pack_crx(config):
    """Pack Chrome extension as .crx (CRX3 format) using Python + openssl.

    CRX3 format:
      "Cr24" (4 bytes) + version=3 (uint32 LE) + header_len (uint32 LE)
      + CrxFileHeader (protobuf) + ZIP data

    Returns path to .crx or None.
    """
    print("\n=== Packing Chrome Extension (.crx) ===\n")

    ext_ids = config.get('extension_ids', {})
    pem_rel = ext_ids.get('chrome_key_pem', '')
    if not pem_rel:
        print("  No key.pem available, skipping .crx packing.")
        return None

    pem_path = os.path.join(PROJECT_ROOT, pem_rel) if not os.path.isabs(pem_rel) else pem_rel
    if not os.path.exists(pem_path):
        print(f"  Key file '{pem_rel}' not found, skipping .crx packing.")
        return None

    chrome_dir = os.path.join(BUILD_DIR, 'chrome-mv3')
    if not os.path.isdir(chrome_dir):
        print("  ERROR: build/chrome-mv3/ not found. Build extensions first.")
        return None

    # 1. Create ZIP of extension directory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(chrome_dir):
            dirs.sort()
            for fname in sorted(files):
                abs_path = os.path.join(root, fname)
                arc_name = os.path.relpath(abs_path, chrome_dir)
                zf.write(abs_path, arc_name)
    zip_data = zip_buffer.getvalue()

    # 2. Get DER public key from PEM private key
    try:
        der_key = subprocess.run(
            ['openssl', 'rsa', '-in', pem_path, '-pubout', '-outform', 'DER'],
            capture_output=True, check=True
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"  WARNING: Could not extract public key: {e}")
        return None

    # 3. Compute crx_id (first 16 bytes of SHA-256 of public key)
    crx_id = hashlib.sha256(der_key).digest()[:16]

    # 4. Build SignedData protobuf: { field 1 (bytes): crx_id }
    signed_data = _protobuf_field(1, crx_id)

    # 5. Build the message to sign:
    #    "CRX3 SignedData\x00" + uint32_le(len(signed_data)) + signed_data + zip_data
    sign_payload = (
        b"CRX3 SignedData\x00"
        + struct.pack('<I', len(signed_data))
        + signed_data
        + zip_data
    )

    # 6. Sign with SHA-256 + RSA using openssl
    try:
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(sign_payload)
            tmp_path = tmp.name
        signature = subprocess.run(
            ['openssl', 'dgst', '-sha256', '-sign', pem_path, tmp_path],
            capture_output=True, check=True
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"  WARNING: Signing failed: {e}")
        return None
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    # 7. Build AsymmetricKeyProof: { field 1 (bytes): public_key, field 2 (bytes): signature }
    key_proof = _protobuf_field(1, der_key) + _protobuf_field(2, signature)

    # 8. Build CrxFileHeader: { field 2 (message): sha256_with_rsa, field 10000 (bytes): signed_header_data }
    header = _protobuf_field(2, key_proof) + _protobuf_field(10000, signed_data)

    # 9. Write CRX3 file
    crx_path = os.path.join(BUILD_DIR, 'extension.crx')
    with open(crx_path, 'wb') as f:
        f.write(b'Cr24')                          # magic
        f.write(struct.pack('<I', 3))              # version
        f.write(struct.pack('<I', len(header)))    # header length
        f.write(header)
        f.write(zip_data)

    crx_size = os.path.getsize(crx_path)
    print(f"  Packed: {crx_path} ({crx_size} bytes, {len(zip_data)} bytes compressed)")
    return crx_path


def pack_xpi(config):
    """Pack Firefox extension as .xpi (zip). Returns path to .xpi or None."""
    print("\n=== Packing Firefox Extension (.xpi) ===\n")

    firefox_dir = os.path.join(BUILD_DIR, 'firefox-mv2')
    if not os.path.isdir(firefox_dir):
        print("  ERROR: build/firefox-mv2/ not found. Build extensions first.")
        return None

    xpi_path = os.path.join(BUILD_DIR, 'extension.xpi')
    with zipfile.ZipFile(xpi_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(firefox_dir):
            for fname in files:
                abs_path = os.path.join(root, fname)
                arc_name = os.path.relpath(abs_path, firefox_dir)
                zf.write(abs_path, arc_name)

    print(f"  Packed: {xpi_path}")
    return xpi_path


# ---------------------------------------------------------------------------
# Assemble build output
# ---------------------------------------------------------------------------

def copy_build_outputs(config, include_legacy, include_sidecar):
    """Copy all build outputs to the unified build/ directory."""
    print("\n=== Assembling Build Output ===\n")

    if os.path.exists(BUILD_DIR):
        shutil.rmtree(BUILD_DIR)
    os.makedirs(BUILD_DIR)

    chrome_src = os.path.join(BEX_BEACON_DIR, 'dist', 'chrome-mv3')
    if os.path.isdir(chrome_src):
        shutil.copytree(chrome_src, os.path.join(BUILD_DIR, 'chrome-mv3'))
        print("  Copied chrome-mv3/")

    firefox_src = os.path.join(BEX_BEACON_DIR, 'dist', 'firefox-mv2')
    if os.path.isdir(firefox_src):
        shutil.copytree(firefox_src, os.path.join(BUILD_DIR, 'firefox-mv2'))
        print("  Copied firefox-mv2/")

    # Bundle telemlib.js into extension directories for CSP-bypassing injection
    telemlib_src = os.path.join(PROJECT_ROOT, 'telemlib.js')
    if os.path.isfile(telemlib_src):
        for ext_dir in ['chrome-mv3', 'firefox-mv2']:
            dest = os.path.join(BUILD_DIR, ext_dir, 'telemlib.js')
            if os.path.isdir(os.path.join(BUILD_DIR, ext_dir)):
                shutil.copy2(telemlib_src, dest)
                print(f"  Copied telemlib.js into {ext_dir}/")

    if include_legacy:
        legacy_build = os.path.join(BEX_BEACON_DIR, 'build')
        if os.path.isdir(legacy_build):
            for name in os.listdir(legacy_build):
                src = os.path.join(legacy_build, name)
                if os.path.isdir(src):
                    dest_name = f"legacy-{name}"
                    shutil.copytree(src, os.path.join(BUILD_DIR, dest_name))
                    print(f"  Copied {dest_name}/")

    if include_sidecar:
        sidecar_build = os.path.join(SIDECAR_DIR, 'build')
        if os.path.isdir(sidecar_build):
            shutil.copytree(sidecar_build, os.path.join(BUILD_DIR, 'sidecar'))
            print("  Copied sidecar/")


# ---------------------------------------------------------------------------
# Deploy bundle generation
# ---------------------------------------------------------------------------

def write_script(path, content, executable=True):
    """Write a script file and optionally make it executable."""
    with open(path, 'w', newline='\n' if path.endswith('.sh') else None) as f:
        f.write(content)
    if executable:
        st = os.stat(path)
        os.chmod(path, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


def create_deploy_bundles(config, crx_path, xpi_path, include_sidecar):
    """Create self-contained deploy bundles for each browser/OS combination."""
    print("\n=== Creating Deploy Bundles ===\n")

    if os.path.exists(DEPLOY_DIR):
        shutil.rmtree(DEPLOY_DIR)
    os.makedirs(DEPLOY_DIR)

    _, chrome_id, firefox_id = get_ext_ids(config)
    ext_meta = config.get('extension', {})
    ext_version = ext_meta.get('version', '1.0.0')
    sidecar_cfg = config.get('sidecar', {})
    host_name = sidecar_cfg.get('host_name', 'com.jstap.sidecar')
    binary_name = sidecar_cfg.get('binary_name', 'sidecar')
    sidecar_enabled = include_sidecar and sidecar_cfg.get('enabled', False)
    sidecar_binaries_dir = os.path.join(BUILD_DIR, 'sidecar', 'binaries')
    has_crx = crx_path and os.path.exists(crx_path)
    has_xpi = xpi_path and os.path.exists(xpi_path)

    # (name, os_type, sidecar_bin, nm_dir, ext_json_dir, browser_label, archive_type)
    chrome_bundles = [
        ('chrome-linux',    'linux',   f'{binary_name}-linux-amd64',       '.config/google-chrome/NativeMessagingHosts',                    '/opt/google/chrome/extensions',                         'Chrome',   'tar.gz'),
        ('chrome-mac',      'mac',     None,                               'Library/Application Support/Google/Chrome/NativeMessagingHosts', '/Library/Google/Chrome/External Extensions',             'Chrome',   'tar.gz'),
        ('chrome-windows',  'windows', f'{binary_name}-windows-amd64.exe', None,                                                           None,                                                    'Chrome',   'zip'),
        ('chromium-linux',  'linux',   f'{binary_name}-linux-amd64',       '.config/chromium/NativeMessagingHosts',                         '/usr/share/chromium/extensions',                        'Chromium', 'tar.gz'),
        ('chromium-mac',    'mac',     None,                               'Library/Application Support/Chromium/NativeMessagingHosts',      '/Library/Application Support/Chromium/External Extensions', 'Chromium', 'tar.gz'),
        ('edge-windows',    'windows', f'{binary_name}-windows-amd64.exe', None,                                                           None,                                                    'Edge',     'zip'),
    ]

    firefox_bundles = [
        ('firefox-linux',   'linux',   f'{binary_name}-linux-amd64',       '.mozilla/native-messaging-hosts',                           'Firefox', 'tar.gz'),
        ('firefox-mac',     'mac',     None,                               'Library/Application Support/Mozilla/NativeMessagingHosts',   'Firefox', 'tar.gz'),
        ('firefox-windows', 'windows', f'{binary_name}-windows-amd64.exe', None,                                                       'Firefox', 'zip'),
    ]

    # --- Chrome-based bundles ---
    for name, os_type, sidecar_bin, nm_dir, ext_json_dir, browser_label, archive_type in chrome_bundles:
        bundle_dir = os.path.join(DEPLOY_DIR, name)
        os.makedirs(bundle_dir)

        # Copy extension
        if has_crx:
            shutil.copy2(crx_path, os.path.join(bundle_dir, 'extension.crx'))
        else:
            shutil.copytree(
                os.path.join(BUILD_DIR, 'chrome-mv3'),
                os.path.join(bundle_dir, 'chrome-mv3')
            )

        # Copy sidecar binary
        if sidecar_enabled:
            if os_type == 'mac':
                # macOS: include both architectures
                for arch_bin in [f'{binary_name}-darwin-amd64', f'{binary_name}-darwin-arm64']:
                    src = os.path.join(sidecar_binaries_dir, arch_bin)
                    if os.path.exists(src):
                        shutil.copy2(src, os.path.join(bundle_dir, arch_bin))
            elif sidecar_bin:
                src = os.path.join(sidecar_binaries_dir, sidecar_bin)
                if os.path.exists(src):
                    shutil.copy2(src, os.path.join(bundle_dir, sidecar_bin))

        # Generate install/uninstall scripts
        if os_type == 'windows':
            _gen_chrome_windows_script(bundle_dir, config, has_crx, sidecar_enabled, browser_label)
            _gen_chrome_windows_uninstall(bundle_dir, config, has_crx, sidecar_enabled, browser_label)
        else:
            _gen_chrome_unix_script(bundle_dir, config, os_type, has_crx, sidecar_enabled,
                                   nm_dir, ext_json_dir, sidecar_bin, browser_label)
            _gen_chrome_unix_uninstall(bundle_dir, config, os_type, has_crx, sidecar_enabled,
                                      nm_dir, ext_json_dir, browser_label)

        # Archive
        _archive_bundle(bundle_dir, name, archive_type)
        print(f"  {name}.{archive_type}")

    # --- Firefox bundles ---
    for name, os_type, sidecar_bin, nm_dir, browser_label, archive_type in firefox_bundles:
        bundle_dir = os.path.join(DEPLOY_DIR, name)
        os.makedirs(bundle_dir)

        # Copy extension
        if has_xpi:
            shutil.copy2(xpi_path, os.path.join(bundle_dir, 'extension.xpi'))
        else:
            shutil.copytree(
                os.path.join(BUILD_DIR, 'firefox-mv2'),
                os.path.join(bundle_dir, 'firefox-mv2')
            )

        # Copy sidecar binary
        if sidecar_enabled:
            if os_type == 'mac':
                for arch_bin in [f'{binary_name}-darwin-amd64', f'{binary_name}-darwin-arm64']:
                    src = os.path.join(sidecar_binaries_dir, arch_bin)
                    if os.path.exists(src):
                        shutil.copy2(src, os.path.join(bundle_dir, arch_bin))
            elif sidecar_bin:
                src = os.path.join(sidecar_binaries_dir, sidecar_bin)
                if os.path.exists(src):
                    shutil.copy2(src, os.path.join(bundle_dir, sidecar_bin))

        # Generate install/uninstall scripts
        if os_type == 'windows':
            _gen_firefox_windows_script(bundle_dir, config, has_xpi, sidecar_enabled)
            _gen_firefox_windows_uninstall(bundle_dir, config, has_xpi, sidecar_enabled)
        else:
            _gen_firefox_unix_script(bundle_dir, config, os_type, has_xpi, sidecar_enabled,
                                    nm_dir, sidecar_bin)
            _gen_firefox_unix_uninstall(bundle_dir, config, os_type, has_xpi, sidecar_enabled,
                                       nm_dir)

        # Archive
        _archive_bundle(bundle_dir, name, archive_type)
        print(f"  {name}.{archive_type}")


def _archive_bundle(bundle_dir, name, archive_type):
    """Archive a bundle directory as .tar.gz or .zip."""
    if archive_type == 'tar.gz':
        archive_path = os.path.join(DEPLOY_DIR, f'{name}.tar.gz')
        with tarfile.open(archive_path, 'w:gz') as tf:
            tf.add(bundle_dir, arcname=name)
    else:
        archive_path = os.path.join(DEPLOY_DIR, f'{name}.zip')
        with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(bundle_dir):
                for fname in files:
                    abs_path = os.path.join(root, fname)
                    arc_name = os.path.join(name, os.path.relpath(abs_path, bundle_dir))
                    zf.write(abs_path, arc_name)


# ---------------------------------------------------------------------------
# Chrome install script generators
# ---------------------------------------------------------------------------

def _gen_chrome_unix_script(bundle_dir, config, os_type, has_crx, sidecar_enabled,
                            nm_dir, ext_json_dir, sidecar_bin, browser_label):
    """Generate a Chrome/Chromium install script for Linux or macOS."""
    _, chrome_id, _ = get_ext_ids(config)
    ext_meta = config.get('extension', {})
    ext_version = ext_meta.get('version', '1.0.0')
    dirname = ext_meta.get('install_dirname', 'jstap')
    sidecar_cfg = config.get('sidecar', {})
    host_name = sidecar_cfg.get('host_name', 'com.jstap.sidecar')
    binary_name = sidecar_cfg.get('binary_name', 'sidecar')

    crx_store_dir = f'/opt/{dirname}'
    sidecar_dest = f'$HOME/.local/bin/{binary_name}'

    if os_type == 'linux':
        sidecar_copy = f'''    cp "$SCRIPT_DIR/{sidecar_bin}" "{sidecar_dest}"
    chmod +x "{sidecar_dest}"'''
    else:  # mac
        sidecar_copy = f'''    ARCH="$(uname -m)"
    if [ "$ARCH" = "arm64" ]; then
        cp "$SCRIPT_DIR/{binary_name}-darwin-arm64" "{sidecar_dest}"
    else
        cp "$SCRIPT_DIR/{binary_name}-darwin-amd64" "{sidecar_dest}"
    fi
    chmod +x "{sidecar_dest}"'''

    # Extension installation (requires sudo)
    if has_crx and chrome_id and ext_json_dir:
        if os_type == 'linux':
            # Linux: use enterprise policy to avoid the GUI error popup that the
            # external extensions directory scan produces.
            if browser_label == 'Chrome':
                policy_dir = '/etc/opt/chrome/policies/managed'
            else:
                policy_dir = '/etc/chromium/policies/managed'
            ext_section = f'''
# --- Install Extension via Enterprise Policy (requires sudo) ---
echo "Installing {browser_label} extension via enterprise policy..."
sudo mkdir -p "{crx_store_dir}"
sudo cp "$SCRIPT_DIR/extension.crx" "{crx_store_dir}/extension.crx"

# Write Omaha-style update manifest pointing to local CRX
sudo tee "{crx_store_dir}/updates.xml" > /dev/null << 'UPDATE_EOF'
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='{chrome_id}'>
    <updatecheck codebase='file://{crx_store_dir}/extension.crx' version='{ext_version}' />
  </app>
</gupdate>
UPDATE_EOF

# Write enterprise policy that force-installs the extension
sudo mkdir -p "{policy_dir}"
sudo tee "{policy_dir}/{dirname}_extension.json" > /dev/null << 'POLICY_EOF'
{{
  "ExtensionSettings": {{
    "{chrome_id}": {{
      "installation_mode": "force_installed",
      "update_url": "file://{crx_store_dir}/updates.xml"
    }}
  }}
}}
POLICY_EOF
echo "  CRX: {crx_store_dir}/extension.crx"
echo "  Policy: {policy_dir}/{dirname}_extension.json"
'''
        else:
            # macOS: use enterprise policy via managed preferences plist
            if browser_label == 'Chrome':
                plist_bundle_id = 'com.google.Chrome'
            else:
                plist_bundle_id = 'org.chromium.Chromium'
            plist_dir = '/Library/Managed Preferences'
            plist_path = f'{plist_dir}/{plist_bundle_id}.plist'
            ext_section = f'''
# --- Install Extension via Enterprise Policy (requires sudo) ---
echo "Installing {browser_label} extension via enterprise policy..."
sudo mkdir -p "{crx_store_dir}"
sudo cp "$SCRIPT_DIR/extension.crx" "{crx_store_dir}/extension.crx"

# Write Omaha-style update manifest pointing to local CRX
sudo tee "{crx_store_dir}/updates.xml" > /dev/null << 'UPDATE_EOF'
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='{chrome_id}'>
    <updatecheck codebase='file://{crx_store_dir}/extension.crx' version='{ext_version}' />
  </app>
</gupdate>
UPDATE_EOF

# Write managed preferences plist that force-installs the extension
sudo mkdir -p "{plist_dir}"
sudo tee "{plist_path}" > /dev/null << 'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>ExtensionSettings</key>
    <dict>
        <key>{chrome_id}</key>
        <dict>
            <key>installation_mode</key>
            <string>force_installed</string>
            <key>update_url</key>
            <string>file://{crx_store_dir}/updates.xml</string>
        </dict>
    </dict>
</dict>
</plist>
PLIST_EOF
echo "  CRX: {crx_store_dir}/extension.crx"
echo "  Policy: {plist_path}"
'''
    else:
        if os_type == 'linux':
            install_base = f'$HOME/.local/share/{dirname}'
        else:
            install_base = f'$HOME/Library/Application Support/{dirname}'
        ext_section = f'''
# --- Install Extension ---
EXT_DEST="{install_base}/chrome-extension"
mkdir -p "$(dirname "$EXT_DEST")"
rm -rf "$EXT_DEST"
cp -r "$SCRIPT_DIR/chrome-mv3" "$EXT_DEST"
echo "Installed {browser_label} extension to: $EXT_DEST"
'''

    # Sidecar installation section (user-level, no sudo)
    sidecar_section = ''
    if sidecar_enabled:
        sidecar_section = f'''
# --- Install Sidecar ---
echo "Installing sidecar native messaging host..."
SIDECAR_DEST="{sidecar_dest}"
NM_DIR="$HOME/{nm_dir}"
mkdir -p "$(dirname "$SIDECAR_DEST")" "$NM_DIR"
{sidecar_copy}

cat > "$NM_DIR/{host_name}.json" << MANIFEST_EOF
{{
  "name": "{host_name}",
  "description": "JS-Tap Sidecar Native Messaging Host",
  "path": "$SIDECAR_DEST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://{chrome_id}/"]
}}
MANIFEST_EOF
echo "Installed sidecar."
echo "  Binary: $SIDECAR_DEST"
echo "  Manifest: $NM_DIR/{host_name}.json"
'''

    # Final instructions
    if has_crx and chrome_id and ext_json_dir:
        instructions = f'''
echo ""
echo "Installation complete."
echo "Restart {browser_label}. The extension will be force-installed via enterprise policy."
'''
    else:
        instructions = f'''
echo ""
echo "To load the extension:"
echo "  1. Open chrome://extensions"
echo "  2. Enable Developer mode"
echo "  3. Click 'Load unpacked' and select: $EXT_DEST"
'''

    write_script(os.path.join(bundle_dir, 'install.sh'), f'''#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "JS-Tap {browser_label} Installer"
echo "================================"
{ext_section}{sidecar_section}{instructions}''')


def _gen_chrome_unix_uninstall(bundle_dir, config, os_type, has_crx, sidecar_enabled,
                                nm_dir, ext_json_dir, browser_label):
    """Generate a Chrome/Chromium uninstall script for Linux or macOS."""
    _, chrome_id, _ = get_ext_ids(config)
    ext_meta = config.get('extension', {})
    dirname = ext_meta.get('install_dirname', 'jstap')
    sidecar_cfg = config.get('sidecar', {})
    host_name = sidecar_cfg.get('host_name', 'com.jstap.sidecar')
    binary_name = sidecar_cfg.get('binary_name', 'sidecar')

    crx_store_dir = f'/opt/{dirname}'
    sidecar_dest = f'$HOME/.local/bin/{binary_name}'

    # Extension removal
    if has_crx and chrome_id and ext_json_dir:
        if os_type == 'linux':
            if browser_label == 'Chrome':
                policy_dir = '/etc/opt/chrome/policies/managed'
            else:
                policy_dir = '/etc/chromium/policies/managed'
            ext_section = f'''
# --- Remove Extension (requires sudo) ---
echo "Removing {browser_label} extension..."
sudo rm -f "{policy_dir}/{dirname}_extension.json"
sudo rm -rf "{crx_store_dir}"
echo "  Removed enterprise policy and CRX."
'''
        else:
            # macOS: remove managed preferences plist
            if browser_label == 'Chrome':
                plist_bundle_id = 'com.google.Chrome'
            else:
                plist_bundle_id = 'org.chromium.Chromium'
            plist_path = f'/Library/Managed Preferences/{plist_bundle_id}.plist'
            ext_section = f'''
# --- Remove Extension (requires sudo) ---
echo "Removing {browser_label} extension..."
sudo rm -f "{plist_path}"
sudo rm -rf "{crx_store_dir}"
# Flush macOS preferences cache so the policy removal takes effect immediately
sudo killall cfprefsd 2>/dev/null || true
echo "  Removed enterprise policy plist and CRX."
'''
    else:
        if os_type == 'linux':
            install_base = f'$HOME/.local/share/{dirname}'
        else:
            install_base = f'$HOME/Library/Application Support/{dirname}'
        ext_section = f'''
# --- Remove Extension ---
echo "Removing {browser_label} extension..."
rm -rf "{install_base}/chrome-extension"
echo "  Removed unpacked extension."
'''

    # Sidecar removal
    sidecar_section = ''
    if sidecar_enabled:
        sidecar_section = f'''
# --- Remove Sidecar ---
echo "Removing sidecar native messaging host..."
rm -f "{sidecar_dest}"
rm -f "$HOME/{nm_dir}/{host_name}.json"
echo "  Removed sidecar binary and manifest."
'''

    write_script(os.path.join(bundle_dir, 'uninstall.sh'), f'''#!/bin/bash
set -e

echo "JS-Tap {browser_label} Uninstaller"
echo "=================================="
{ext_section}{sidecar_section}
echo ""
echo "Uninstall complete. Restart {browser_label} for changes to take effect."
''')


def _gen_chrome_windows_script(bundle_dir, config, has_crx, sidecar_enabled, browser_label):
    """Generate a Chrome/Chromium/Edge install script for Windows."""
    _, chrome_id, _ = get_ext_ids(config)
    ext_meta = config.get('extension', {})
    ext_version = ext_meta.get('version', '1.0.0')
    dirname = ext_meta.get('install_dirname', 'jstap')
    sidecar_cfg = config.get('sidecar', {})
    host_name = sidecar_cfg.get('host_name', 'com.jstap.sidecar')
    binary_name = sidecar_cfg.get('binary_name', 'sidecar')

    # Registry and NM paths differ for Edge vs Chrome
    if browser_label == 'Edge':
        reg_base = 'Microsoft\\Edge'
        nm_appdata_dir = 'Microsoft\\Edge\\User Data\\NativeMessagingHosts'
    else:
        reg_base = 'Google\\Chrome'
        nm_appdata_dir = 'Google\\Chrome\\User Data\\NativeMessagingHosts'

    install_base = f'%LOCALAPPDATA%\\{dirname}'

    if has_crx and chrome_id:
        if browser_label == 'Edge':
            # Edge on unmanaged Windows devices blocks automated extension
            # install (file:// URLs, registry path+JSON, forcelist all blocked).
            # On managed (domain-joined) devices, ExtensionInstallForcelist works.
            # Detect managed state and use the appropriate path.
            ext_section = f'''
REM --- Install Extension ---
set "EXT_DIR={install_base}"
if not exist "%EXT_DIR%" mkdir "%EXT_DIR%"
copy /Y "%SCRIPT_DIR%extension.crx" "%EXT_DIR%\\extension.crx"

REM Detect if device is managed (domain-joined or Azure AD joined)
set "MANAGED=0"
dsregcmd /status 2>nul | findstr /c:"DomainJoined : YES" >nul && set "MANAGED=1"
dsregcmd /status 2>nul | findstr /c:"AzureAdJoined : YES" >nul && set "MANAGED=1"

if "%MANAGED%"=="0" goto :manual_ext_install

REM --- Managed device: automated install via ExtensionInstallForcelist policy ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo Device is managed - automated extension install is available.
    echo Re-run as administrator for automated install, or install manually below.
    goto :manual_ext_install
)

set "CRX_URL=file:///%EXT_DIR:\\=/%/extension.crx"
set "XML_URL=file:///%EXT_DIR:\\=/%/updates.xml"

(
echo ^<?xml version='1.0' encoding='UTF-8'?^>
echo ^<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'^>
echo   ^<app appid='{chrome_id}'^>
echo     ^<updatecheck codebase='%CRX_URL%' version='{ext_version}' /^>
echo   ^</app^>
echo ^</gupdate^>
) > "%EXT_DIR%\\updates.xml"

reg add "HKLM\\SOFTWARE\\Policies\\{reg_base}\\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "{chrome_id};%XML_URL%" /f
gpupdate /force >nul 2>&1
echo Extension force-install policy set. Extension will install on next Edge restart.
goto :ext_install_done

:manual_ext_install
echo.
echo To install the extension:
echo   1. Open edge://extensions
echo   2. Enable "Developer mode" (toggle in bottom-left)
echo   3. Drag and drop this file into the Edge extensions page:
echo      %EXT_DIR%\\extension.crx
echo.
echo Opening edge://extensions now...
start msedge edge://extensions

:ext_install_done
'''
        else:
            ext_section = f'''
REM --- Install Extension ---
set "EXT_DIR={install_base}"
if not exist "%EXT_DIR%" mkdir "%EXT_DIR%"
copy /Y "%SCRIPT_DIR%extension.crx" "%EXT_DIR%\\extension.crx"

(
echo {{
echo   "external_crx": "%EXT_DIR:\\=\\\\%\\\\extension.crx",
echo   "external_version": "{ext_version}"
echo }}
) > "%EXT_DIR%\\{chrome_id}.json"

reg add "HKCU\\Software\\{reg_base}\\Extensions\\{chrome_id}" /v path /t REG_SZ /d "%EXT_DIR%\\{chrome_id}.json" /f
echo Installed {browser_label} extension via registry.
'''
    elif has_crx:
        ext_section = f'''
REM --- Install Extension ---
set "EXT_DIR={install_base}"
if not exist "%EXT_DIR%" mkdir "%EXT_DIR%"
copy /Y "%SCRIPT_DIR%extension.crx" "%EXT_DIR%\\extension.crx"
echo Copied extension to: %EXT_DIR%\\extension.crx
'''
    else:
        ext_section = f'''
REM --- Install Extension ---
set "EXT_DEST={install_base}\\chrome-extension"
if not exist "%EXT_DEST%" mkdir "%EXT_DEST%"
xcopy /E /Y /I "%SCRIPT_DIR%chrome-mv3" "%EXT_DEST%"
echo Installed {browser_label} extension to: %EXT_DEST%
'''

    sidecar_section = ''
    if sidecar_enabled:
        sidecar_section = f'''
REM --- Install Sidecar ---
set "SIDECAR_DEST={install_base}\\{binary_name}.exe"
set "NM_DIR=%LOCALAPPDATA%\\{nm_appdata_dir}"
if not exist "{install_base}" mkdir "{install_base}"
if not exist "%NM_DIR%" mkdir "%NM_DIR%"

copy /Y "%SCRIPT_DIR%{binary_name}-windows-amd64.exe" "%SIDECAR_DEST%"

(
echo {{
echo   "name": "{host_name}",
echo   "description": "JS-Tap Sidecar Native Messaging Host",
echo   "path": "%SIDECAR_DEST:\\=\\\\%",
echo   "type": "stdio",
echo   "allowed_origins": ["chrome-extension://{chrome_id}/"]
echo }}
) > "%NM_DIR%\\{host_name}.json"

reg add "HKCU\\Software\\{reg_base}\\NativeMessagingHosts\\{host_name}" /ve /t REG_SZ /d "%NM_DIR%\\{host_name}.json" /f
echo Installed sidecar.
echo   Binary: %SIDECAR_DEST%
echo   Manifest: %NM_DIR%\\{host_name}.json
'''

    ext_url = 'edge://extensions' if browser_label == 'Edge' else 'chrome://extensions'

    if has_crx and chrome_id:
        if browser_label == 'Edge':
            instructions = '''
echo.
echo Installation complete.
'''
        else:
            instructions = f'''
echo.
echo Installation complete. Restart {browser_label}.
echo The extension will be installed automatically.
'''
    elif has_crx:
        instructions = f'''
echo.
echo To install the extension:
echo   Drag and drop the .crx file into {ext_url}
echo   CRX location: {install_base}\\extension.crx
'''
    else:
        instructions = f'''
echo.
echo To load the extension:
echo   1. Open {ext_url}
echo   2. Enable Developer mode
echo   3. Click "Load unpacked" and select: {install_base}\\chrome-extension
'''

    admin_check = ''

    write_script(os.path.join(bundle_dir, 'install.bat'), f'''@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
echo JS-Tap {browser_label} Installer
echo ================================
{admin_check}{ext_section}{sidecar_section}{instructions}
pause
''', executable=False)


def _gen_chrome_windows_uninstall(bundle_dir, config, has_crx, sidecar_enabled, browser_label):
    """Generate a Chrome/Chromium/Edge uninstall script for Windows."""
    _, chrome_id, _ = get_ext_ids(config)
    ext_meta = config.get('extension', {})
    dirname = ext_meta.get('install_dirname', 'jstap')
    sidecar_cfg = config.get('sidecar', {})
    host_name = sidecar_cfg.get('host_name', 'com.jstap.sidecar')
    binary_name = sidecar_cfg.get('binary_name', 'sidecar')
    install_base = f'%LOCALAPPDATA%\\{dirname}'

    # Registry and NM paths differ for Edge vs Chrome
    if browser_label == 'Edge':
        reg_base = 'Microsoft\\Edge'
        nm_appdata_dir = 'Microsoft\\Edge\\User Data\\NativeMessagingHosts'
    else:
        reg_base = 'Google\\Chrome'
        nm_appdata_dir = 'Google\\Chrome\\User Data\\NativeMessagingHosts'

    if has_crx and chrome_id:
        if browser_label == 'Edge':
            ext_section = f'''
REM --- Remove Extension ---
REM Clean up force-install policy (requires admin, silent if not available)
reg delete "HKLM\\SOFTWARE\\Policies\\{reg_base}\\ExtensionInstallForcelist" /f 2>nul
reg delete "HKLM\\SOFTWARE\\WOW6432Node\\Policies\\{reg_base}\\ExtensionInstallForcelist" /f 2>nul
REM Clean up old registry entries from previous install methods
reg delete "HKLM\\Software\\{reg_base}\\Extensions\\{chrome_id}" /f 2>nul
reg delete "HKCU\\Software\\{reg_base}\\Extensions\\{chrome_id}" /f 2>nul

REM Remove extension files
if exist "{install_base}\\extension.crx" del /F "{install_base}\\extension.crx"
if exist "{install_base}\\updates.xml" del /F "{install_base}\\updates.xml"
if exist "{install_base}\\{chrome_id}.json" del /F "{install_base}\\{chrome_id}.json"
echo Removed extension files and registry entries.
echo NOTE: If the extension is still visible in Edge, remove it from edge://extensions
echo TIP: Run as administrator to also clean up managed extension policies.
echo NOTE: Close all Edge processes (check Task Manager) as Edge runs in the background.
'''
        else:
            ext_section = f'''
REM --- Remove Extension ---
reg delete "HKCU\\Software\\{reg_base}\\Extensions\\{chrome_id}" /f 2>nul
if exist "{install_base}\\{chrome_id}.json" del /F "{install_base}\\{chrome_id}.json"
if exist "{install_base}\\extension.crx" del /F "{install_base}\\extension.crx"
echo Removed {browser_label} extension registry entry and files.
'''
    else:
        ext_section = f'''
REM --- Remove Extension ---
if exist "{install_base}\\chrome-extension" rmdir /S /Q "{install_base}\\chrome-extension"
if exist "{install_base}\\extension.crx" del /F "{install_base}\\extension.crx"
echo Removed {browser_label} extension files.
'''

    sidecar_section = ''
    if sidecar_enabled:
        sidecar_section = f'''
REM --- Remove Sidecar ---
reg delete "HKCU\\Software\\{reg_base}\\NativeMessagingHosts\\{host_name}" /f 2>nul
set "NM_DIR=%LOCALAPPDATA%\\{nm_appdata_dir}"
if exist "%NM_DIR%\\{host_name}.json" del /F "%NM_DIR%\\{host_name}.json"
if exist "{install_base}\\{binary_name}.exe" del /F "{install_base}\\{binary_name}.exe"
echo Removed sidecar binary, manifest, and registry entry.
'''

    cleanup = f'''
REM --- Cleanup ---
if exist "{install_base}" rmdir /Q "{install_base}" 2>nul
'''

    admin_check = ''

    write_script(os.path.join(bundle_dir, 'uninstall.bat'), f'''@echo off
setlocal

echo JS-Tap {browser_label} Uninstaller
echo ==================================
{admin_check}{ext_section}{sidecar_section}{cleanup}
echo.
echo Uninstall complete. Restart {browser_label} for changes to take effect.
pause
''', executable=False)


# ---------------------------------------------------------------------------
# Firefox install script generators
# ---------------------------------------------------------------------------

def _find_firefox_profile_bash(os_type):
    """Return bash snippet that sets PROFILE_PATH to the default Firefox profile."""
    if os_type == 'linux':
        profiles_dir = '$HOME/.mozilla/firefox'
        ini_path = f'{profiles_dir}/profiles.ini'
        profile_rel_base = '$PROFILES_DIR'
    else:
        profiles_dir = '$HOME/Library/Application Support/Firefox/Profiles'
        ini_path = '$HOME/Library/Application Support/Firefox/profiles.ini'
        # On macOS, profiles.ini Default= paths are relative to the Firefox dir, not Profiles/
        profile_rel_base = '$(dirname "$PROFILES_DIR")'

    return f'''# Find Firefox default profile
PROFILES_DIR="{profiles_dir}"
PROFILE_PATH=""

# Try to find default profile from profiles.ini [Install*] section
if [ -f "{ini_path}" ]; then
    PROFILE_REL=$(grep -A5 '^\\[Install' "{ini_path}" | grep '^Default=' | head -1 | cut -d= -f2)
    if [ -n "$PROFILE_REL" ]; then
        PROFILE_PATH="{profile_rel_base}/$PROFILE_REL"
    fi
fi

# Fallback: find *.default-release profile
if [ -z "$PROFILE_PATH" ] || [ ! -d "$PROFILE_PATH" ]; then
    PROFILE_PATH=$(ls -d "$PROFILES_DIR"/*.default-release 2>/dev/null | head -1)
fi

# Last resort: any profile directory
if [ -z "$PROFILE_PATH" ] || [ ! -d "$PROFILE_PATH" ]; then
    PROFILE_PATH=$(ls -d "$PROFILES_DIR"/*.default* 2>/dev/null | head -1)
fi
'''


def _gen_firefox_unix_script(bundle_dir, config, os_type, has_xpi, sidecar_enabled,
                             nm_dir, sidecar_bin):
    """Generate a Firefox install script for Linux or macOS."""
    _, _, firefox_id = get_ext_ids(config)
    ext_meta = config.get('extension', {})
    dirname = ext_meta.get('install_dirname', 'jstap')
    sidecar_cfg = config.get('sidecar', {})
    host_name = sidecar_cfg.get('host_name', 'com.jstap.sidecar')
    binary_name = sidecar_cfg.get('binary_name', 'sidecar')

    if os_type == 'linux':
        install_base = f'$HOME/.local/share/{dirname}'
        sidecar_dest = f'$HOME/.local/bin/{binary_name}'
        sidecar_copy = f'''    cp "$SCRIPT_DIR/{sidecar_bin}" "{sidecar_dest}"
    chmod +x "{sidecar_dest}"'''
    else:  # mac
        install_base = f'$HOME/Library/Application Support/{dirname}'
        sidecar_dest = f'$HOME/.local/bin/{binary_name}'
        sidecar_copy = f'''    ARCH="$(uname -m)"
    if [ "$ARCH" = "arm64" ]; then
        cp "$SCRIPT_DIR/{binary_name}-darwin-arm64" "{sidecar_dest}"
    else
        cp "$SCRIPT_DIR/{binary_name}-darwin-amd64" "{sidecar_dest}"
    fi
    chmod +x "{sidecar_dest}"'''

    # Extension installation
    if has_xpi and firefox_id:
        profile_finder = _find_firefox_profile_bash(os_type)
        ext_section = f'''
# --- Install Extension ---
{profile_finder}
if [ -n "$PROFILE_PATH" ] && [ -d "$PROFILE_PATH" ]; then
    EXT_DIR="$PROFILE_PATH/extensions"
    mkdir -p "$EXT_DIR"
    cp "$SCRIPT_DIR/extension.xpi" "$EXT_DIR/{firefox_id}.xpi"
    echo "Installed Firefox extension to profile: $EXT_DIR/{firefox_id}.xpi"
else
    echo "WARNING: Could not find Firefox profile directory."
    echo "Copying extension to: {install_base}/extension.xpi"
    mkdir -p "{install_base}"
    cp "$SCRIPT_DIR/extension.xpi" "{install_base}/extension.xpi"
    echo "Manually install by opening about:addons and dragging in the .xpi file."
fi
'''
    elif has_xpi:
        ext_section = f'''
# --- Install Extension ---
mkdir -p "{install_base}"
cp "$SCRIPT_DIR/extension.xpi" "{install_base}/extension.xpi"
echo "Copied extension to: {install_base}/extension.xpi"
'''
    else:
        ext_section = f'''
# --- Install Extension ---
EXT_DEST="{install_base}/firefox-extension"
mkdir -p "$(dirname "$EXT_DEST")"
rm -rf "$EXT_DEST"
cp -r "$SCRIPT_DIR/firefox-mv2" "$EXT_DEST"
echo "Installed Firefox extension to: $EXT_DEST"
'''

    # Sidecar installation
    sidecar_section = ''
    if sidecar_enabled:
        sidecar_section = f'''
# --- Install Sidecar ---
echo "Installing sidecar native messaging host..."
SIDECAR_DEST="{sidecar_dest}"
NM_DIR="$HOME/{nm_dir}"
mkdir -p "$(dirname "$SIDECAR_DEST")" "$NM_DIR"
{sidecar_copy}

cat > "$NM_DIR/{host_name}.json" << MANIFEST_EOF
{{
  "name": "{host_name}",
  "description": "JS-Tap Sidecar Native Messaging Host",
  "path": "$SIDECAR_DEST",
  "type": "stdio",
  "allowed_extensions": ["{firefox_id}"]
}}
MANIFEST_EOF
echo "Installed sidecar."
echo "  Binary: $SIDECAR_DEST"
echo "  Manifest: $NM_DIR/{host_name}.json"
'''

    # Instructions
    if has_xpi and firefox_id:
        instructions = '''
echo ""
echo "Installation complete. Restart Firefox."
echo "Firefox will prompt you to enable the extension on next launch."
'''
    elif has_xpi:
        instructions = f'''
echo ""
echo "To install the extension:"
echo "  1. Open about:addons in Firefox"
echo "  2. Drag and drop: {install_base}/extension.xpi"
'''
    else:
        instructions = '''
echo ""
echo "To load the extension:"
echo "  1. Open about:debugging#/runtime/this-firefox"
echo "  2. Click 'Load Temporary Add-on'"
echo "  3. Select manifest.json in: $EXT_DEST"
'''

    write_script(os.path.join(bundle_dir, 'install.sh'), f'''#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "JS-Tap Firefox Installer"
echo "========================"
{ext_section}{sidecar_section}{instructions}''')


def _gen_firefox_windows_script(bundle_dir, config, has_xpi, sidecar_enabled):
    """Generate a Firefox install script for Windows."""
    _, _, firefox_id = get_ext_ids(config)
    ext_meta = config.get('extension', {})
    dirname = ext_meta.get('install_dirname', 'jstap')
    sidecar_cfg = config.get('sidecar', {})
    host_name = sidecar_cfg.get('host_name', 'com.jstap.sidecar')
    binary_name = sidecar_cfg.get('binary_name', 'sidecar')
    install_base = f'%LOCALAPPDATA%\\{dirname}'

    if has_xpi and firefox_id:
        ext_section = f'''
REM --- Install Extension ---
REM Find Firefox default profile
set "FF_PROFILES=%APPDATA%\\Mozilla\\Firefox\\Profiles"
set "PROFILE_PATH="

REM Find first *.default-release profile
for /d %%D in ("%FF_PROFILES%\\*.default-release") do (
    if not defined PROFILE_PATH set "PROFILE_PATH=%%D"
)
REM Fallback: any *.default* profile
if not defined PROFILE_PATH (
    for /d %%D in ("%FF_PROFILES%\\*.default*") do (
        if not defined PROFILE_PATH set "PROFILE_PATH=%%D"
    )
)

if defined PROFILE_PATH (
    set "EXT_DIR=%PROFILE_PATH%\\extensions"
    if not exist "%EXT_DIR%" mkdir "%EXT_DIR%"
    copy /Y "%SCRIPT_DIR%extension.xpi" "%EXT_DIR%\\{firefox_id}.xpi"
    echo Installed Firefox extension to profile: %EXT_DIR%\\{firefox_id}.xpi
) else (
    echo WARNING: Could not find Firefox profile directory.
    if not exist "{install_base}" mkdir "{install_base}"
    copy /Y "%SCRIPT_DIR%extension.xpi" "{install_base}\\extension.xpi"
    echo Copied extension to: {install_base}\\extension.xpi
    echo Manually install by opening about:addons and dragging in the .xpi file.
)
'''
    elif has_xpi:
        ext_section = f'''
REM --- Install Extension ---
if not exist "{install_base}" mkdir "{install_base}"
copy /Y "%SCRIPT_DIR%extension.xpi" "{install_base}\\extension.xpi"
echo Copied extension to: {install_base}\\extension.xpi
'''
    else:
        ext_section = f'''
REM --- Install Extension ---
set "EXT_DEST={install_base}\\firefox-extension"
if not exist "%EXT_DEST%" mkdir "%EXT_DEST%"
xcopy /E /Y /I "%SCRIPT_DIR%firefox-mv2" "%EXT_DEST%"
echo Installed Firefox extension to: %EXT_DEST%
'''

    sidecar_section = ''
    if sidecar_enabled:
        sidecar_section = f'''
REM --- Install Sidecar ---
set "SIDECAR_DEST={install_base}\\{binary_name}.exe"
set "NM_DIR=%APPDATA%\\Mozilla\\NativeMessagingHosts"
if not exist "{install_base}" mkdir "{install_base}"
if not exist "%NM_DIR%" mkdir "%NM_DIR%"

copy /Y "%SCRIPT_DIR%{binary_name}-windows-amd64.exe" "%SIDECAR_DEST%"

(
echo {{
echo   "name": "{host_name}",
echo   "description": "JS-Tap Sidecar Native Messaging Host",
echo   "path": "%SIDECAR_DEST:\\=\\\\%",
echo   "type": "stdio",
echo   "allowed_extensions": ["{firefox_id}"]
echo }}
) > "%NM_DIR%\\{host_name}.json"

reg add "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\{host_name}" /ve /t REG_SZ /d "%NM_DIR%\\{host_name}.json" /f
echo Installed sidecar.
echo   Binary: %SIDECAR_DEST%
echo   Manifest: %NM_DIR%\\{host_name}.json
'''

    if has_xpi and firefox_id:
        instructions = '''
echo.
echo Installation complete. Restart Firefox.
echo Firefox will prompt you to enable the extension on next launch.
'''
    elif has_xpi:
        instructions = f'''
echo.
echo To install the extension:
echo   1. Open about:addons in Firefox
echo   2. Drag and drop: {install_base}\\extension.xpi
'''
    else:
        instructions = f'''
echo.
echo To load the extension:
echo   1. Open about:debugging#/runtime/this-firefox
echo   2. Click "Load Temporary Add-on"
echo   3. Select manifest.json in: {install_base}\\firefox-extension
'''

    write_script(os.path.join(bundle_dir, 'install.bat'), f'''@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
echo JS-Tap Firefox Installer
echo ========================
{ext_section}{sidecar_section}{instructions}
pause
''', executable=False)


def _gen_firefox_unix_uninstall(bundle_dir, config, os_type, has_xpi, sidecar_enabled, nm_dir):
    """Generate a Firefox uninstall script for Linux or macOS."""
    _, _, firefox_id = get_ext_ids(config)
    ext_meta = config.get('extension', {})
    dirname = ext_meta.get('install_dirname', 'jstap')
    sidecar_cfg = config.get('sidecar', {})
    host_name = sidecar_cfg.get('host_name', 'com.jstap.sidecar')
    binary_name = sidecar_cfg.get('binary_name', 'sidecar')

    if os_type == 'linux':
        install_base = f'$HOME/.local/share/{dirname}'
        sidecar_dest = f'$HOME/.local/bin/{binary_name}'
    else:
        install_base = f'$HOME/Library/Application Support/{dirname}'
        sidecar_dest = f'$HOME/.local/bin/{binary_name}'

    # Extension removal
    if has_xpi and firefox_id:
        profile_finder = _find_firefox_profile_bash(os_type)
        ext_section = f'''
# --- Remove Extension ---
{profile_finder}
if [ -n "$PROFILE_PATH" ] && [ -d "$PROFILE_PATH" ]; then
    rm -f "$PROFILE_PATH/extensions/{firefox_id}.xpi"
    echo "Removed extension from profile: $PROFILE_PATH/extensions/{firefox_id}.xpi"
else
    echo "WARNING: Could not find Firefox profile. You may need to remove the extension manually."
fi
rm -f "{install_base}/extension.xpi"
'''
    else:
        ext_section = f'''
# --- Remove Extension ---
rm -rf "{install_base}/firefox-extension"
rm -f "{install_base}/extension.xpi"
echo "Removed Firefox extension files."
'''

    sidecar_section = ''
    if sidecar_enabled:
        sidecar_section = f'''
# --- Remove Sidecar ---
echo "Removing sidecar native messaging host..."
rm -f "{sidecar_dest}"
rm -f "$HOME/{nm_dir}/{host_name}.json"
echo "  Removed sidecar binary and manifest."
'''

    write_script(os.path.join(bundle_dir, 'uninstall.sh'), f'''#!/bin/bash
set -e

echo "JS-Tap Firefox Uninstaller"
echo "=========================="
{ext_section}{sidecar_section}
echo ""
echo "Uninstall complete. Restart Firefox for changes to take effect."
''')


def _gen_firefox_windows_uninstall(bundle_dir, config, has_xpi, sidecar_enabled):
    """Generate a Firefox uninstall script for Windows."""
    _, _, firefox_id = get_ext_ids(config)
    ext_meta = config.get('extension', {})
    dirname = ext_meta.get('install_dirname', 'jstap')
    sidecar_cfg = config.get('sidecar', {})
    host_name = sidecar_cfg.get('host_name', 'com.jstap.sidecar')
    binary_name = sidecar_cfg.get('binary_name', 'sidecar')
    install_base = f'%LOCALAPPDATA%\\{dirname}'

    if has_xpi and firefox_id:
        ext_section = f'''
REM --- Remove Extension ---
set "FF_PROFILES=%APPDATA%\\Mozilla\\Firefox\\Profiles"
set "PROFILE_PATH="

for /d %%D in ("%FF_PROFILES%\\*.default-release") do (
    if not defined PROFILE_PATH set "PROFILE_PATH=%%D"
)
if not defined PROFILE_PATH (
    for /d %%D in ("%FF_PROFILES%\\*.default*") do (
        if not defined PROFILE_PATH set "PROFILE_PATH=%%D"
    )
)

if defined PROFILE_PATH (
    if exist "%PROFILE_PATH%\\extensions\\{firefox_id}.xpi" del /F "%PROFILE_PATH%\\extensions\\{firefox_id}.xpi"
    echo Removed extension from profile.
) else (
    echo WARNING: Could not find Firefox profile. Remove the extension manually.
)
if exist "{install_base}\\extension.xpi" del /F "{install_base}\\extension.xpi"
'''
    else:
        ext_section = f'''
REM --- Remove Extension ---
if exist "{install_base}\\firefox-extension" rmdir /S /Q "{install_base}\\firefox-extension"
if exist "{install_base}\\extension.xpi" del /F "{install_base}\\extension.xpi"
echo Removed Firefox extension files.
'''

    sidecar_section = ''
    if sidecar_enabled:
        sidecar_section = f'''
REM --- Remove Sidecar ---
reg delete "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\{host_name}" /f 2>nul
set "NM_DIR=%APPDATA%\\Mozilla\\NativeMessagingHosts"
if exist "%NM_DIR%\\{host_name}.json" del /F "%NM_DIR%\\{host_name}.json"
if exist "{install_base}\\{binary_name}.exe" del /F "{install_base}\\{binary_name}.exe"
echo Removed sidecar binary, manifest, and registry entry.
'''

    cleanup = f'''
REM --- Cleanup ---
if exist "{install_base}" rmdir /Q "{install_base}" 2>nul
'''

    write_script(os.path.join(bundle_dir, 'uninstall.bat'), f'''@echo off
setlocal

echo JS-Tap Firefox Uninstaller
echo ==========================
{ext_section}{sidecar_section}{cleanup}
echo.
echo Uninstall complete. Restart Firefox for changes to take effect.
pause
''', executable=False)


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def print_summary(config, include_legacy, include_sidecar):
    """Print build summary."""
    print("\n" + "=" * 50)
    print("BUILD COMPLETE")
    print("=" * 50)
    print(f"\nOutput directory: {BUILD_DIR}/")
    print()

    # Dev artifacts
    print("Dev artifacts (load unpacked):")
    if os.path.isdir(os.path.join(BUILD_DIR, 'chrome-mv3')):
        print("  chrome-mv3/")
    if os.path.isdir(os.path.join(BUILD_DIR, 'firefox-mv2')):
        print("  firefox-mv2/")
    if include_legacy:
        for name in sorted(os.listdir(BUILD_DIR)):
            if name.startswith('legacy-'):
                print(f"  {name}/")
    if include_sidecar and os.path.isdir(os.path.join(BUILD_DIR, 'sidecar')):
        print("  sidecar/")

    # Packed extensions
    if os.path.exists(os.path.join(BUILD_DIR, 'extension.crx')):
        print("\n  extension.crx")
    if os.path.exists(os.path.join(BUILD_DIR, 'extension.xpi')):
        print("  extension.xpi")

    # Deploy bundles
    if os.path.isdir(DEPLOY_DIR):
        archives = sorted(f for f in os.listdir(DEPLOY_DIR)
                         if f.endswith('.tar.gz') or f.endswith('.zip'))
        if archives:
            print("\nDeploy bundles (self-contained, copy to target):")
            for a in archives:
                size = os.path.getsize(os.path.join(DEPLOY_DIR, a))
                if size > 1024 * 1024:
                    size_str = f"{size / (1024*1024):.1f} MB"
                else:
                    size_str = f"{size / 1024:.0f} KB"
                print(f"  deploy/{a:40s} {size_str}")

    _, chrome_id, firefox_id = get_ext_ids(config)
    print()
    print(f"  Chrome ID:  {chrome_id or '(dynamic)'}")
    print(f"  Firefox ID: {firefox_id or '(dynamic)'}")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Unified JS-Tap build script')
    parser.add_argument('--ext-only', action='store_true',
                        help='Build extensions only (skip sidecar)')
    parser.add_argument('--sidecar-only', action='store_true',
                        help='Build sidecar only (skip extensions)')
    parser.add_argument('--legacy', action='store_true',
                        help='Also build legacy extensions')
    args = parser.parse_args()

    print("JS-Tap Unified Build")
    print("=" * 50)

    config = load_config()

    # Auto-increment patch version so Edge/Chrome force-install picks up new builds
    ext_meta = config.setdefault('extension', {})
    old_version = ext_meta.get('version', '1.0.0')
    parts = old_version.split('.')
    parts[-1] = str(int(parts[-1]) + 1)
    new_version = '.'.join(parts)
    ext_meta['version'] = new_version

    config_path = os.path.join(BEX_BEACON_DIR, 'config.json')
    with open(config_path, 'r') as f:
        raw_config = json.load(f)
    raw_config.setdefault('extension', {})['version'] = new_version
    with open(config_path, 'w') as f:
        json.dump(raw_config, f, indent=2)
        f.write('\n')
    print(f"Version bumped: {old_version} -> {new_version}")

    ensure_key_pem(config)
    validate_config(config)

    _, chrome_id, firefox_id = get_ext_ids(config)
    print(f"Chrome extension ID: {chrome_id or '(will be assigned by browser)'}")
    print(f"Firefox extension ID: {firefox_id or '(will be assigned by browser)'}")
    print()

    sidecar_enabled = config.get('sidecar', {}).get('enabled', False)
    include_sidecar = sidecar_enabled and not args.ext_only
    include_extensions = not args.sidecar_only
    include_legacy = args.legacy and include_extensions

    if args.sidecar_only and not sidecar_enabled:
        print("WARNING: --sidecar-only specified but sidecar is disabled in config.")
        print("  Set sidecar.enabled = true in bex-beacon/config.json to build sidecar.")
        sys.exit(1)

    # Build extensions
    if include_extensions:
        build_wxt_extensions(config)
        if include_legacy:
            build_legacy_extensions()

    # Build sidecar
    if include_sidecar or args.sidecar_only:
        build_sidecar(config)

    # Assemble dev build output
    copy_build_outputs(config, include_legacy, include_sidecar or args.sidecar_only)

    # Pack extensions (only if we built them)
    crx_path = None
    xpi_path = None
    if include_extensions:
        crx_path = pack_crx(config)
        xpi_path = pack_xpi(config)

    # Create deploy bundles (only if we built extensions)
    if include_extensions:
        create_deploy_bundles(config, crx_path, xpi_path,
                              include_sidecar or args.sidecar_only)

    print_summary(config, include_legacy, include_sidecar or args.sidecar_only)


if __name__ == '__main__':
    main()
