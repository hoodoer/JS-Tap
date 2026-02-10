# bexBeacon Cross-Browser Extension

This project provides a browser extension that removes specific security headers (`Content-Security-Policy`, `X-Frame-Options`, and `Content-Security-Policy-Report-Only`) and CSP meta tags. It's designed to assist with web development and testing scenarios where these security measures need to be bypassed.

The project uses a build script to generate configured extensions for both Chrome-based browsers and Firefox.

## Project Structure

-   `./src-chrome-extension/`: Source template for the Chrome extension. **Do not load this in your browser.**
-   `./src-firefox-extension/`: Source template for the Firefox extension. **Do not load this in your browser.**
-   `./build/`: This directory is created by the build script. It contains the final, configured extensions that you should load into your browser.
-   `build.py`: The Python script used to build the extensions from the source templates and `config.json`.
-   `config.json`: The configuration file for the build process.

## Configuration

The extension's behavior is controlled by the `config.json` file. You must run the build script (`python3 build.py`) after making any changes to this file.

### `config.json` Structure:

```json
{
  "js_tap_server": {
    "domain": "localhost",
    "port": 9001
  },
  "domain_scoping": {
    "mode": "all_domains",
    "whitelist": [
      "https://*.example.com/*",
      "http://localhost:8000/*"
    ]
  }
}
```

-   `js_tap_server`:
    -   `domain`: The domain of the JS-Tap server that the extension will eventually connect to.
    -   `port`: The port of the JS-Tap server.
-   `domain_scoping`:
    -   `mode`: Determines which domains the extension will operate on.
        -   `"all_domains"`: The extension will attempt to strip headers and meta CSPs on all websites (`<all_urls>`).
        -   `"whitelist"`: The extension will only operate on the domains specified in the `whitelist` array.
    -   `whitelist`: An array of URL match patterns (e.g., `"https://*.example.com/*"`, `"http://localhost:8000/*"`). This is only used when `mode` is set to `"whitelist"`.

## Build Process

To generate the browser extensions with your specified configurations:

1.  **Configure:** Edit the `config.json` file to set your desired JS-Tap server details and domain scoping.

2.  **Build:** Run the Python build script from your project root:
    ```bash
    python3 build.py
    ```
    This will create a `build/` directory containing two subdirectories:
    -   `build/chrome-extension/` (for Chrome-based browsers)
    -   `build/firefox-extension/` (for Firefox)

## How to Install the Built Extensions

After running `python3 build.py`, you will load the extensions from the `build/` directory.

### For Chrome-based Browsers (Chrome, Edge, Brave)

1.  Open your browser and navigate to `chrome://extensions`.
2.  Enable **"Developer mode"** using the toggle switch.
3.  Click the **"Load unpacked"** button.
4.  In the file dialog that appears, select the `./build/chrome-extension/` directory.

### For Firefox

1.  Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2.  Click the **"Load Temporary Add-on..."** button.
3.  In the file dialog, navigate into the `./build/firefox-extension/` directory and select the `manifest.json` file.