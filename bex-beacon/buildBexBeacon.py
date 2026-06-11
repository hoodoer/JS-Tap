import json
import os
import shutil

def main():
    """
    Builds the legacy Chrome and Firefox extensions based on the settings in config.json.
    Processes the src-chrome-extension/ and src-firefox-extension/ template directories.

    For the WXT-based build, use: npx wxt build
    For the Sidecar build, use: python3 ../sidecar/buildSidecar.py (or cd sidecar && python3 buildSidecar.py)
    """
    print("Starting legacy extension build process...")

    # Load configuration
    with open('config.json', 'r') as f:
        config = json.load(f)

    js_tap_server = config.get('js_tap_server', {})
    domain_scoping = config.get('domain_scoping', {})
    sidecar_config = config.get('sidecar', {})
    ext_meta = config.get('extension', {})
    ext_ids = config.get('extension_ids', {})
    build_dir = 'build'

    # Determine domain permissions
    if domain_scoping.get('whitelist_enabled', False):
        permissions = domain_scoping.get('whitelist', [])
        print(f"Domain scoping: Whitelist enabled. Using {len(permissions)} domains.")
    else:
        permissions = ["<all_urls>"]
        print("Domain scoping: All Domains.")

    if not permissions:
        raise ValueError("Permissions list cannot be empty. Check your config.json whitelist.")

    # Clean and recreate build directory
    if os.path.exists(build_dir):
        shutil.rmtree(build_dir)
    os.makedirs(build_dir)
    print(f"Cleaned and created build directory: '{build_dir}'")

    # --- Process both extensions ---
    for ext_name in ['src-chrome-extension', 'src-firefox-extension']:
        print(f"--- Building {ext_name} ---")
        source_dir = ext_name
        # Create the destination directory name by removing the 'src-' prefix
        dest_dir_name = ext_name.replace('src-', '')
        dest_dir = os.path.join(build_dir, dest_dir_name)
        shutil.copytree(source_dir, dest_dir)

        # 1. Create config.js
        config_js_content = f'const JS_TAP_CONFIG = {json.dumps(js_tap_server)};'
        config_js_path = os.path.join(dest_dir, 'config.js')
        with open(config_js_path, 'w') as f:
            f.write(config_js_content)
        print(f"Generated config.js for {ext_name}")

        # 2. Modify manifest.json
        manifest_path = os.path.join(dest_dir, 'manifest.json')
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)

        if 'host_permissions' in manifest: # Chrome (MV3)
            manifest['host_permissions'] = permissions
        if 'permissions' in manifest and ext_name == 'firefox-extension': # Firefox (MV2)
            # Filter out old domain permissions AND <all_urls> before adding the new ones
            existing_perms = [
                p for p in manifest['permissions']
                if not ('://' in p or p == '<all_urls>')
            ]
            final_perms = existing_perms + permissions
            manifest['permissions'] = final_perms
            print(f"Final Firefox permissions set to: {final_perms}")

        # Add nativeMessaging permission if sidecar is enabled
        if sidecar_config.get('enabled', False):
            if 'permissions' in manifest:
                if 'nativeMessaging' not in manifest['permissions']:
                    manifest['permissions'].append('nativeMessaging')
            else:
                manifest['permissions'] = ['nativeMessaging']
            print(f"Added nativeMessaging permission to {ext_name}")

        # Apply extension metadata from config
        if ext_meta.get('name'):
            manifest['name'] = ext_meta['name']
        if ext_meta.get('version'):
            manifest['version'] = ext_meta['version']
        if ext_meta.get('description'):
            manifest['description'] = ext_meta['description']
        if ext_meta.get('short_name'):
            manifest['short_name'] = ext_meta['short_name']
        if ext_meta.get('author'):
            manifest['author'] = ext_meta['author']
        if ext_meta.get('homepage_url'):
            manifest['homepage_url'] = ext_meta['homepage_url']
        print(f"Applied extension metadata: {ext_meta.get('name', 'default')} v{ext_meta.get('version', '1.0')}")

        # Inject extension IDs for static ID support
        if ext_name == 'src-chrome-extension' and ext_ids.get('chrome_key'):
            manifest['key'] = ext_ids['chrome_key']
            print(f"Injected Chrome key for static extension ID")
        if ext_name == 'src-firefox-extension' and ext_ids.get('firefox_extension_id'):
            manifest.setdefault('browser_specific_settings', {})
            manifest['browser_specific_settings']['gecko'] = {
                'id': ext_ids['firefox_extension_id']
            }
            print(f"Injected Firefox extension ID: {ext_ids['firefox_extension_id']}")

        if 'content_scripts' in manifest:
            for script in manifest['content_scripts']:
                # Prepend config.js so it loads first
                if 'js' in script:
                    script['js'].insert(0, 'config.js')
                if 'matches' in script:
                    script['matches'] = permissions

        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)
        print(f"Updated manifest.json for {ext_name} with new permissions and config script.")

        # 3. Modify Chrome's rules.json if it exists
        rules_path = os.path.join(dest_dir, 'rules.json')
        if os.path.exists(rules_path) and domain_scoping.get('whitelist_enabled', False):
            with open(rules_path, 'r') as f:
                rules = json.load(f)

            request_domains = []
            for p in permissions:
                if '://' in p:
                    # Parse domain and strip port number
                    domain_full = p.split('://')[1].split('/')[0]
                    domain = domain_full.split(':')[0]
                    if domain.startswith('*.'):
                        domain = domain[2:]
                    request_domains.append(domain)

            for rule in rules:
                if 'condition' in rule:
                    rule['condition']['requestDomains'] = request_domains
                    rule['condition'].pop('urlFilter', None)

            with open(rules_path, 'w') as f:
                json.dump(rules, f, indent=2)
            print(f"Updated rules.json for {ext_name} with whitelisted domains.")

    print("\nLegacy extension build completed successfully.")
    print(f"Configured extensions are located in the '{build_dir}' directory.")
    print("\nNote: This is the legacy build. For a full build (WXT + sidecar + deploy bundles),")
    print("run from the project root: python3 buildAll.py")


if __name__ == '__main__':
    main()
