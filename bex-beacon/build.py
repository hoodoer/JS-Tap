import json
import os
import shutil

def main():
    """
    Builds the Chrome and Firefox extensions based on the settings in config.json.
    """
    print("Starting extension build process...")

    # Load configuration
    with open('config.json', 'r') as f:
        config = json.load(f)

    js_tap_server = config.get('js_tap_server', {})
    domain_scoping = config.get('domain_scoping', {})
    build_dir = 'build'

    # Determine domain permissions
    if domain_scoping.get('mode') == 'whitelist':
        permissions = domain_scoping.get('whitelist', [])
        print(f"Domain mode: Whitelist. Using {len(permissions)} domains.")
    else:
        permissions = ["<all_urls>"]
        print("Domain mode: All Domains.")

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
        if os.path.exists(rules_path) and domain_scoping.get('mode') == 'whitelist':
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

    print("\nBuild process completed successfully.")
    print(f"Configured extensions are located in the '{build_dir}' directory.")
if __name__ == '__main__':
    main()