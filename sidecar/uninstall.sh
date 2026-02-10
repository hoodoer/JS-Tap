#!/bin/bash
#
# Removes the sidecar binary and all native messaging manifests.
# Useful for cleaning up between test iterations.
#

HOST_NAME="com.jstap.sidecar"
BINARY_PATH="$HOME/.local/bin/sidecar"

echo "Removing sidecar installation..."

# Remove binary
if [ -f "$BINARY_PATH" ]; then
    rm "$BINARY_PATH"
    echo "  Removed binary: $BINARY_PATH"
else
    echo "  Binary not found: $BINARY_PATH (skipped)"
fi

# Remove Chrome manifest (Linux)
CHROME_MANIFEST="$HOME/.config/google-chrome/NativeMessagingHosts/${HOST_NAME}.json"
if [ -f "$CHROME_MANIFEST" ]; then
    rm "$CHROME_MANIFEST"
    echo "  Removed Chrome manifest: $CHROME_MANIFEST"
else
    echo "  Chrome manifest not found (skipped)"
fi

# Remove Chromium manifest (Linux)
CHROMIUM_MANIFEST="$HOME/.config/chromium/NativeMessagingHosts/${HOST_NAME}.json"
if [ -f "$CHROMIUM_MANIFEST" ]; then
    rm "$CHROMIUM_MANIFEST"
    echo "  Removed Chromium manifest: $CHROMIUM_MANIFEST"
else
    echo "  Chromium manifest not found (skipped)"
fi

# Remove Firefox manifest (Linux)
FIREFOX_MANIFEST="$HOME/.mozilla/native-messaging-hosts/${HOST_NAME}.json"
if [ -f "$FIREFOX_MANIFEST" ]; then
    rm "$FIREFOX_MANIFEST"
    echo "  Removed Firefox manifest: $FIREFOX_MANIFEST"
else
    echo "  Firefox manifest not found (skipped)"
fi

# Remove Chrome manifest (macOS)
MAC_CHROME_MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json"
if [ -f "$MAC_CHROME_MANIFEST" ]; then
    rm "$MAC_CHROME_MANIFEST"
    echo "  Removed macOS Chrome manifest"
fi

# Remove Chromium manifest (macOS)
MAC_CHROMIUM_MANIFEST="$HOME/Library/Application Support/Chromium/NativeMessagingHosts/${HOST_NAME}.json"
if [ -f "$MAC_CHROMIUM_MANIFEST" ]; then
    rm "$MAC_CHROMIUM_MANIFEST"
    echo "  Removed macOS Chromium manifest"
fi

# Remove Firefox manifest (macOS)
MAC_FIREFOX_MANIFEST="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts/${HOST_NAME}.json"
if [ -f "$MAC_FIREFOX_MANIFEST" ]; then
    rm "$MAC_FIREFOX_MANIFEST"
    echo "  Removed macOS Firefox manifest"
fi

echo "Done. Sidecar uninstalled."
