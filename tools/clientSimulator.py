#!/usr/bin/env python3
"""JS-Tap Client Simulator

Creates diverse fake clients, sends realistic loot, polls for custom payloads,
and prints a live status grid. Useful for testing target rules, match filtering,
autorun/repeat, and custom payload delivery.
"""

import argparse
import asyncio
import aiohttp
import base64
import json
import os
import random
import sys
import time

from cryptography.hazmat.primitives.asymmetric import rsa, padding as asym_padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


# ── User-Agent strings ─────────────────────────────────────────────────────────

LINUX_CHROME_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
LINUX_FIREFOX_UA = (
    "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"
)
WIN_CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
WIN_EDGE_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
)
MAC_SAFARI_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.2 Safari/605.1.15"
)

ELECTRON_SLACK_UA = "AtomBeacon/1.0 (Linux 6.6.99; x64) Electron/33.0.0 Node/v20.18.0"
ELECTRON_VSCODE_UA = "AtomBeacon/1.0 (Windows NT 10.0; x64) Electron/32.2.1 Node/v20.15.1"
ELECTRON_DISCORD_UA = "AtomBeacon/1.0 (Darwin 23.4.0; arm64) Electron/31.7.5 Node/v20.14.0"
ELECTRON_OBSIDIAN_UA = "AtomBeacon/1.0 (Linux 6.8.0; x64) Electron/32.0.0 Node/v20.16.0"

# ── Client profiles ────────────────────────────────────────────────────────────

CLIENT_PROFILES = [
    {"count": 3, "tag": "wp",    "user_agent": LINUX_CHROME_UA,  "label": "Linux/Chrome"},
    {"count": 2, "tag": "wp",    "user_agent": LINUX_FIREFOX_UA, "label": "Linux/Firefox"},
    {"count": 3, "tag": "admin", "user_agent": WIN_CHROME_UA,    "label": "Win/Chrome"},
    {"count": 2, "tag": "admin", "user_agent": WIN_EDGE_UA,      "label": "Win/Edge"},
    {"count": 2, "tag": "",      "user_agent": MAC_SAFARI_UA,    "label": "Mac/Safari"},
]

# ── Fake data pools ────────────────────────────────────────────────────────────

FAKE_URLS = [
    "https://targetapp.com/dashboard",
    "https://targetapp.com/admin/users",
    "https://targetapp.com/settings/profile",
    "https://targetapp.com/api/v1/data",
    "https://targetapp.com/login",
    "https://targetapp.com/checkout",
    "https://targetapp.com/account/billing",
    "https://targetapp.com/reports/quarterly",
]

FAKE_COOKIES = [
    ("PHPSESSID", "abc123def456"),
    ("jwt_token", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiYWRtaW4ifQ.fake"),
    ("_session_id", "s3cr3t_s3ss10n_v4lu3"),
    ("csrftoken", "9f2k4j8m3n1p5q7r"),
    ("remember_me", "dXNlcjEyMzQ1Ng=="),
    ("lang", "en-US"),
]

FAKE_LOCAL_STORAGE = [
    ("authToken", "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyQGNvcnAuY29tIn0.signature"),
    ("userPrefs", '{"theme":"dark","lang":"en","notifications":true}'),
    ("cartData", '[{"id":42,"name":"Widget","qty":2}]'),
    ("lastLogin", "2025-12-15T08:30:00Z"),
]

FAKE_SESSION_STORAGE = [
    ("csrfToken", "x9f2a7b4c1e8d3"),
    ("tempAuth", "tmp_8k3m9n2p5q1r"),
    ("wizardStep", "3"),
    ("formDraft", '{"field1":"partial","field2":"data"}'),
]

FAKE_INPUTS = [
    ("username", "admin"),
    ("password", "hunter2"),
    ("email", "user@corp.com"),
    ("search", "confidential reports"),
    ("credit_card", "4111-1111-1111-1111"),
    ("ssn", "123-45-6789"),
    ("api_key", "sk-proj-abc123def456"),
]

FAKE_HTML_SNIPPETS = [
    '<html><head><title>Dashboard</title></head><body><div class="user-panel"><h1>Welcome, admin</h1><p>Last login: Dec 15, 2025</p><ul><li>Pending orders: 14</li><li>Revenue: $48,230</li></ul></div></body></html>',
    '<html><head><title>User Management</title></head><body><table class="users"><tr><th>Name</th><th>Role</th></tr><tr><td>alice@corp.com</td><td>admin</td></tr><tr><td>bob@corp.com</td><td>user</td></tr></table></body></html>',
    '<html><head><title>Settings</title></head><body><form id="profile"><input name="email" value="admin@corp.com"/><input name="phone" value="+1-555-0142"/><select name="role"><option selected>Super Admin</option></select></form></body></html>',
    '<html><head><title>API Keys</title></head><body><div class="keys"><p>Production: sk-live-abc123</p><p>Staging: sk-test-def456</p><button>Regenerate</button></div></body></html>',
]

FAKE_XHR_CALLS = [
    {
        "method": "POST",
        "url": "https://targetapp.com/api/v1/users",
        "body": base64.b64encode(b'{"name":"newuser","role":"admin"}').decode(),
        "responseBody": base64.b64encode(b'{"id":42,"status":"created"}').decode(),
        "responseStatus": 201,
        "headers": {"Authorization": "Bearer eyJhbG...", "Content-Type": "application/json"},
    },
    {
        "method": "GET",
        "url": "https://targetapp.com/api/v1/secrets",
        "body": base64.b64encode(b'').decode(),
        "responseBody": base64.b64encode(b'{"db_password":"p@ssw0rd!","api_key":"sk-secret-789"}').decode(),
        "responseStatus": 200,
        "headers": {"Authorization": "Bearer eyJhbG...", "X-API-Key": "internal-key-123"},
    },
    {
        "method": "PUT",
        "url": "https://targetapp.com/api/v1/config",
        "body": base64.b64encode(b'{"debug":true,"maintenance":false}').decode(),
        "responseBody": base64.b64encode(b'{"updated":true}').decode(),
        "responseStatus": 200,
        "headers": {"Authorization": "Bearer eyJhbG..."},
    },
]

# ── Fake beacon data pools ────────────────────────────────────────────────────

FAKE_BEACON_DOMAINS = [
    "pizzatracker.biz",
    "catfacts.lol",
    "wizard-supplies.net",
    "not-a-virus.download",
    "free-robux.gg",
    "definitely-legit-bank.com",
    "flat-earth-proof.org",
    "crypto-moon-lambo.io",
    "grandmas-secret-recipes.co",
    "area51-tours.travel",
]

FAKE_BEACON_PATHS = {
    "pizzatracker.biz":          ["/track/order/42", "/menu/extra-cheese", "/coupons/BOGO", "/delivery-status"],
    "catfacts.lol":              ["/fact/daily", "/subscribe?confirm=yes", "/unsubscribe/impossible", "/gallery/chonkers"],
    "wizard-supplies.net":       ["/wands/elder", "/potions/invisibility", "/robes/sale", "/checkout"],
    "not-a-virus.download":      ["/totally-safe.exe", "/free-antivirus", "/toolbar-install", "/scan-results"],
    "free-robux.gg":             ["/generate?amount=99999", "/verify-human", "/survey/complete", "/download-hack"],
    "definitely-legit-bank.com": ["/login", "/account/transfer", "/admin/dashboard", "/api/v1/accounts"],
    "flat-earth-proof.org":      ["/evidence", "/nasa-lies", "/dome-theory", "/join-the-movement"],
    "crypto-moon-lambo.io":      ["/ico/presale", "/wallet/connect", "/stake/all-in", "/roadmap"],
    "grandmas-secret-recipes.co":["/cookies/chocolate-chip", "/casserole/surprise", "/meatloaf/classic", "/life-story-before-recipe"],
    "area51-tours.travel":       ["/book-tour", "/alien-gift-shop", "/restricted-zone", "/ufo-sightings"],
}

FAKE_BEACON_COOKIES = [
    ("session_id", "xK9mZp2qR7wN4vTy", '{"httpOnly": true, "secure": true, "sameSite": "Strict", "path": "/"}'),
    ("auth_token", "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYWRtaW4iLCJyb2xlIjoic3VwZXIifQ.fakesig", '{"httpOnly": false, "secure": true, "sameSite": "Lax"}'),
    ("tracking_id", "ua-777-pizza-lover-42", '{"httpOnly": false, "secure": false, "sameSite": "None"}'),
    ("preferences", "theme=dark&lang=en&pizza=yes", '{"httpOnly": false, "secure": false, "sameSite": "Lax", "path": "/settings"}'),
    ("admin_flag", "is_admin=true; role=superuser", '{"httpOnly": true, "secure": true, "sameSite": "Strict"}'),
    ("_csrf", "d3f1n1t3ly-n0t-gu3ss4bl3", '{"httpOnly": true, "secure": true, "sameSite": "Strict"}'),
    ("remember_me", "base64(user:wizardadmin)", '{"httpOnly": false, "secure": true, "sameSite": "Lax", "expires": "2099-12-31"}'),
]

FAKE_BEACON_LOCAL_STORAGE = [
    ("user_profile", '{"name": "Gandalf", "role": "wizard", "level": 99}'),
    ("api_key", "sk-live-n0t-4-pr0duct10n-us3-pl34s3"),
    ("feature_flags", '{"darkMode": true, "betaAccess": true, "secretMenu": true}'),
    ("cached_credentials", '{"username": "admin", "hash": "5f4dcc3b5aa765d61d8327deb882cf99"}'),
    ("app_state", '{"lastPage": "/dashboard", "cart": ["wand", "potion", "robe"]}'),
]

FAKE_BEACON_SESSION_STORAGE = [
    ("temp_token", "tmp_9x8w7v6u5t4s3r2q1p"),
    ("form_draft", '{"to": "accounts@bank.com", "amount": "$1,000,000", "memo": "totally normal"}'),
    ("search_history", '["password reset", "how to hack", "delete browser history"]'),
    ("checkout_step", '{"step": 3, "payment": "crypto", "shipping": "overnight"}'),
]

FAKE_BEACON_HEADERS = [
    ("Authorization", "Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IldpemFyZCBBZG1pbiJ9.fakesig"),
    ("X-API-Key", "prod-key-d0nt-sh4r3-th1s-0n3"),
    ("X-Internal-Token", "internal-microservice-secret-abc123"),
    ("X-Forwarded-For", "192.168.1.42, 10.0.0.1"),
    ("Cookie", "session=abc123; admin=true; debug=on"),
    ("X-Custom-Auth", "HMAC-SHA256:timestamp:nonce:signature"),
]

FAKE_SIDECAR_RESPONSES = {
    "list_dir": {
        "path": "/home/wizard",
        "contents": [
            "passwords.txt", "secret_plans.docx", ".ssh/", "bitcoin_wallet.dat",
            "totally_not_malware.exe", "grandmas_recipes_BACKUP.zip",
            "world_domination_checklist.md", "browser_history_DO_NOT_OPEN/",
        ],
    },
    "read_file": {
        "content": (
            "TOP SECRET - OPERATION PIZZA PARTY\n"
            "================================\n"
            "The treasure is buried under the third pizza oven.\n"
            "WiFi password: correct-horse-battery-staple\n"
            "Admin password: hunter2\n"
            "Launch codes: up up down down left right left right B A\n"
        ),
    },
    "exec_cmd": {
        "output": (
            "uid=1000(wizard) gid=1000(wizard) groups=1000(wizard),27(sudo),1337(hackers)\n"
            "Linux wizard-tower 6.1.0-wizardOS #1 SMP PREEMPT_DYNAMIC x86_64\n"
            "  PID TTY          TIME CMD\n"
            " 1337 pts/0    00:00:42 definitely-not-a-backdoor\n"
            " 9001 pts/1    00:13:37 crypto-miner --stealth\n"
        ),
    },
}

# ── Beacon client profiles ────────────────────────────────────────────────────

BEACON_PROFILES = [
    {"count": 2, "tag": "internal", "user_agent": LINUX_CHROME_UA,  "label": "Bex/Lin/Chrome"},
    {"count": 2, "tag": "internal", "user_agent": WIN_CHROME_UA,    "label": "Bex/Win/Chrome"},
    {"count": 1, "tag": "",         "user_agent": MAC_SAFARI_UA,    "label": "Bex/Mac/Safari"},
]

# ── Electron client profiles ─────────────────────────────────────────────────

ELECTRON_PROFILES = [
    {"count": 1, "tag": "internal", "user_agent": ELECTRON_SLACK_UA,    "label": "Atom/Slack"},
    {"count": 1, "tag": "dev",      "user_agent": ELECTRON_VSCODE_UA,   "label": "Atom/VSCode"},
    {"count": 1, "tag": "",         "user_agent": ELECTRON_DISCORD_UA,  "label": "Atom/Discord"},
    {"count": 1, "tag": "dev",      "user_agent": ELECTRON_OBSIDIAN_UA, "label": "Atom/Obsidian"},
]

# ── Fake electron data pools ─────────────────────────────────────────────────

FAKE_ELECTRON_DOMAINS = [
    "app.slack.com", "discord.com", "github.dev", "obsidian.md",
    "marketplace.visualstudio.com", "teams.microsoft.com", "notion.so", "figma.com",
]

FAKE_ELECTRON_PATHS = {
    "app.slack.com":                ["/client/T0123ABC/C0456DEF", "/files/U789GHI/F012JKL", "/admin/settings", "/archives/C0456DEF/p1700000000"],
    "discord.com":                  ["/channels/123456789/987654321", "/api/v9/users/@me", "/settings/appearance", "/guild-discovery"],
    "github.dev":                   ["/user/repo/blob/main/src/index.ts", "/user/repo/pull/42", "/codespaces/new", "/settings/tokens"],
    "obsidian.md":                  ["/vault/notes/daily/2026-02-15.md", "/vault/templates/meeting-notes.md", "/plugins/community", "/settings/sync"],
    "marketplace.visualstudio.com": ["/items?itemName=ms-python.python", "/manage/publishers/my-org", "/api/v1/extensions", "/search?query=theme"],
    "teams.microsoft.com":         ["/v2/conversations/19:meeting_abc@thread.v2", "/api/chats", "/files/shared", "/calendar/view/workweek"],
    "notion.so":                    ["/workspace/abc123/Project-Roadmap", "/api/v1/blocks", "/settings/members", "/templates/gallery"],
    "figma.com":                    ["/file/abc123/Design-System", "/proto/def456", "/files/team/789", "/settings/billing"],
}

FAKE_KEYLOGS = [
    {"keys": "admin@corp.com\tP@ssw0rd!2026\r", "target": "INPUT#email[type=email]", "url": "https://app.slack.com/client/T0123ABC"},
    {"keys": "ssh-rsa AAAAB3NzaC1yc2EAAAA", "target": "TEXTAREA#snippet-content", "url": "https://github.dev/user/repo/blob/main/.ssh/authorized_keys"},
    {"keys": "export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG", "target": "TEXTAREA.terminal-input", "url": "https://github.dev/codespaces/terminal"},
    {"keys": "vault password: Tr3@sure-Hunt3r", "target": "INPUT#vault-password[type=password]", "url": "https://obsidian.md/vault/settings/sync"},
    {"keys": "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh", "target": "INPUT#token-field[type=text]", "url": "https://github.dev/settings/tokens/new"},
    {"keys": "SELECT * FROM users WHERE role='admin'", "target": "TEXTAREA.query-editor", "url": "https://notion.so/workspace/abc123/Database-Query"},
]

FAKE_RESPONSE_HEADERS = [
    ("Set-Cookie", "session=eyJhbGciOiJIUzI1NiJ9.abc123; Path=/; HttpOnly; Secure"),
    ("X-Internal-Service", "auth-gateway-prod-us-east-1"),
    ("X-Request-ID", "req-7f3a9c2e-4b8d-11ee-be56-0242ac120002"),
    ("X-Ratelimit-Remaining", "47"),
    ("Server", "envoy/1.28.0"),
    ("X-Backend-Server", "api-worker-3.internal.corp.net:8443"),
    ("X-Debug-Token", "prof_abc123_1700000000"),
    ("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' cdn.example.com"),
]

ELECTRON_STATUS_PROFILES = {
    "Atom/Slack": {
        "hostname": "dev-workstation-01", "platform": "linux", "arch": "x64",
        "username": "wizard", "homedir": "/home/wizard",
        "capabilities": ["file_browser", "shell", "screenshot", "cookies", "headers", "renderer_injection"],
        "windows": [
            {"id": 1, "url": "https://app.slack.com/client/T0123ABC/C0456DEF", "title": "Slack - #general", "injected": True},
            {"id": 2, "url": "https://app.slack.com/client/T0123ABC/D789GHI", "title": "Slack - DM: Alice", "injected": True},
        ],
    },
    "Atom/VSCode": {
        "hostname": "DESKTOP-A1B2C3D", "platform": "win32", "arch": "x64",
        "username": "dev-user", "homedir": "C:\\Users\\dev-user",
        "capabilities": ["file_browser", "shell", "screenshot", "headers", "renderer_injection"],
        "windows": [
            {"id": 1, "url": "https://github.dev/user/repo/blob/main/src/index.ts", "title": "index.ts - repo - Visual Studio Code", "injected": True},
            {"id": 2, "url": "vscode-webview://webviewId/settings", "title": "Settings", "injected": False},
        ],
    },
    "Atom/Discord": {
        "hostname": "macbook-pro.local", "platform": "darwin", "arch": "arm64",
        "username": "gamer", "homedir": "/Users/gamer",
        "capabilities": ["file_browser", "shell", "screenshot", "cookies", "headers", "renderer_injection"],
        "windows": [
            {"id": 1, "url": "https://discord.com/channels/123456789/987654321", "title": "Discord - #lobby", "injected": True},
        ],
    },
    "Atom/Obsidian": {
        "hostname": "notes-station", "platform": "linux", "arch": "x64",
        "username": "researcher", "homedir": "/home/researcher",
        "capabilities": ["file_browser", "shell", "screenshot", "renderer_injection"],
        "windows": [
            {"id": 1, "url": "app://obsidian.md/vault/notes/daily/2026-02-15.md", "title": "Obsidian - Daily Note", "injected": True},
            {"id": 2, "url": "app://obsidian.md/plugins/community", "title": "Obsidian - Community Plugins", "injected": False},
            {"id": 3, "url": "app://obsidian.md/vault/templates/meeting-notes.md", "title": "Obsidian - Templates", "injected": True},
        ],
    },
}

# ── Screenshot data ────────────────────────────────────────────────────────────

SCREENSHOT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "clientSimulatorScreenshot.png")


# ── SimClient ──────────────────────────────────────────────────────────────────

class SimClient:
    def __init__(self, index, label, tag, user_agent, server):
        self.index = index
        self.label = label
        self.tag = tag
        self.user_agent = user_agent
        self.server = server.rstrip("/")
        self.uuid = None
        self.payloads_received = []  # list of label strings
        self.client_type = "app"

    @property
    def uuid_short(self):
        if not self.uuid:
            return "--------"
        return f"{self.uuid[:4]}..{self.uuid[-4:]}"

    async def register(self, session):
        tag_path = f"/{self.tag}" if self.tag else ""
        url = f"{self.server}/client/getToken{tag_path}"
        headers = {"User-Agent": self.user_agent}
        try:
            async with session.get(url, headers=headers, ssl=False) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.uuid = data["clientToken"]
                else:
                    print(f"  [!] Client {self.index} registration failed: HTTP {resp.status}")
        except Exception as e:
            print(f"  [!] Client {self.index} registration error: {e}")

    async def send_loot_round(self, session):
        if not self.uuid:
            return

        headers = {"User-Agent": self.user_agent}
        base = self.server

        # URL
        url = random.choice(FAKE_URLS)
        await self._post_json(session, f"{base}/loot/location/{self.uuid}",
                              {"url": url}, headers)

        # Cookies (1-2)
        for name, value in random.sample(FAKE_COOKIES, random.randint(1, 2)):
            await self._post_json(session, f"{base}/loot/dessert/{self.uuid}",
                                  {"cookieName": name, "cookieValue": value}, headers)

        # localStorage
        key, value = random.choice(FAKE_LOCAL_STORAGE)
        await self._post_json(session, f"{base}/loot/localstore/{self.uuid}",
                              {"key": key, "value": value}, headers)

        # sessionStorage
        key, value = random.choice(FAKE_SESSION_STORAGE)
        await self._post_json(session, f"{base}/loot/sessionstore/{self.uuid}",
                              {"key": key, "value": value}, headers)

        # User inputs (1-2)
        for name, value in random.sample(FAKE_INPUTS, random.randint(1, 2)):
            await self._post_json(session, f"{base}/loot/input/{self.uuid}",
                                  {"inputName": name, "inputValue": value}, headers)

        # HTML
        html_snippet = random.choice(FAKE_HTML_SNIPPETS)
        await self._post_json(session, f"{base}/loot/html/{self.uuid}",
                              {"url": url, "html": html_snippet}, headers)

        # Screenshot
        await self._post_screenshot(session, f"{base}/loot/screenshot/{self.uuid}", headers)

        # XHR call
        xhr = random.choice(FAKE_XHR_CALLS)
        await self._post_json(session, f"{base}/loot/xhrRequest/{self.uuid}", xhr, headers)

    async def poll_tasks(self, session):
        """Poll for payloads. Returns list of payload label strings."""
        if not self.uuid:
            return []

        headers = {"User-Agent": self.user_agent}
        url = f"{self.server}/client/taskCheck/{self.uuid}"
        new_payloads = []

        try:
            async with session.get(url, headers=headers, ssl=False) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    # Response: [{"id": N, "data": "base64-js-code"}, ...]
                    if isinstance(data, list):
                        for task in data:
                            code_b64 = task.get("data", "")
                            try:
                                code_text = base64.b64decode(code_b64).decode("utf-8", errors="replace")
                            except Exception:
                                code_text = code_b64
                            # Extract a label from the code (first ~50 meaningful chars)
                            label = self._extract_label(code_text)
                            new_payloads.append(label)
                            self.payloads_received.append(label)
                            # Send ACK
                            await self._ack_payload(session, code_text)
        except Exception:
            pass

        return new_payloads

    async def _ack_payload(self, session, payload_code):
        """ACK a received payload via customData endpoint."""
        snippet = payload_code[:80].replace("\n", " ")
        note_b64 = base64.b64encode(b"SimAck").decode()
        data_b64 = base64.b64encode(f"Received: {snippet}".encode()).decode()
        headers = {"User-Agent": self.user_agent}
        await self._post_json(session, f"{self.server}/loot/customData/{self.uuid}",
                              {"note": note_b64, "data": data_b64}, headers)

    @staticmethod
    def _extract_label(code_text):
        """Extract a short label from JS payload code."""
        # Try to find a comment like // name: ... or /* name */
        for line in code_text.split("\n")[:5]:
            stripped = line.strip()
            if stripped.startswith("//"):
                label = stripped.lstrip("/ ").strip()
                if label:
                    return label[:50]
        # Fall back to first non-empty line
        for line in code_text.split("\n"):
            stripped = line.strip()
            if stripped:
                return stripped[:50]
        return "(empty payload)"

    @staticmethod
    async def _post_json(session, url, payload, headers):
        try:
            async with session.post(url, json=payload, headers=headers, ssl=False) as resp:
                pass
        except Exception:
            pass

    async def _post_screenshot(self, session, url, headers):
        try:
            with open(SCREENSHOT_PATH, "rb") as f:
                img_data = f.read()
            hdrs = {**headers, "Content-Type": "image/png"}
            async with session.post(url, data=img_data, headers=hdrs, ssl=False) as resp:
                pass
        except Exception:
            pass


# ── SimBeaconClient ───────────────────────────────────────────────────────────

class SimBeaconClient:
    """Simulates a bex-beacon browser extension client with encrypted comms."""

    def __init__(self, index, label, tag, user_agent, server):
        self.index = index
        self.label = label
        self.tag = tag
        self.user_agent = user_agent
        self.server = server.rstrip("/")
        self.uuid = None
        self.send_key = None     # AES key for encrypting outgoing messages
        self.receive_key = None  # AES key for decrypting incoming responses
        self.sidecar_commands = []  # list of label strings for received commands
        self.client_type = "bex"

    @property
    def uuid_short(self):
        if not self.uuid:
            return "--------"
        return f"{self.uuid[:4]}..{self.uuid[-4:]}"

    @property
    def payloads_received(self):
        """Alias so StatusGrid can treat both client types uniformly."""
        return self.sidecar_commands

    async def register(self, session):
        tag_path = f"/{self.tag}" if self.tag else ""
        url = f"{self.server}/client/getToken{tag_path}/bex-beacon"
        headers = {"User-Agent": self.user_agent}
        try:
            async with session.get(url, headers=headers, ssl=False) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.uuid = data["clientToken"]
                else:
                    print(f"  [!] Beacon {self.index} registration failed: HTTP {resp.status}")
        except Exception as e:
            print(f"  [!] Beacon {self.index} registration error: {e}")

    async def key_exchange(self, session):
        if not self.uuid:
            return

        # Generate RSA-OAEP 2048-bit keypair
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_key = private_key.public_key()

        # Export public key as DER/SPKI, base64-encode
        pub_der = public_key.public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        pub_b64 = base64.b64encode(pub_der).decode("utf-8")

        headers = {"User-Agent": self.user_agent}
        url = f"{self.server}/client/keyExchange/{self.uuid}"

        try:
            async with session.post(url, json={"publicKey": pub_b64}, headers=headers, ssl=False) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data.get("enable") == "true":
                        encrypted_keys_b64 = data["encryptedKeys"]
                        encrypted_keys = base64.b64decode(encrypted_keys_b64)
                        # Decrypt with RSA-OAEP SHA-256
                        plaintext = private_key.decrypt(
                            encrypted_keys,
                            asym_padding.OAEP(
                                mgf=asym_padding.MGF1(algorithm=hashes.SHA256()),
                                algorithm=hashes.SHA256(),
                                label=None,
                            ),
                        )
                        # First 32 bytes = client's send key (server's receiveKey)
                        # Next 32 bytes = client's receive key (server's sendKey)
                        self.send_key = plaintext[:32]
                        self.receive_key = plaintext[32:64]
                    else:
                        print(f"  [!] Beacon {self.index} encryption not enabled by server")
                else:
                    print(f"  [!] Beacon {self.index} key exchange failed: HTTP {resp.status}")
        except Exception as e:
            print(f"  [!] Beacon {self.index} key exchange error: {e}")

    async def _send_encrypted(self, session, path, message_dict):
        """Encrypt and send a message through the metrics endpoint."""
        if not self.uuid or not self.send_key:
            return None

        iv = os.urandom(12)
        aesgcm = AESGCM(self.send_key)

        path_ct = aesgcm.encrypt(iv, path.encode("utf-8"), None)
        msg_ct = aesgcm.encrypt(iv, json.dumps(message_dict).encode("utf-8"), None)

        iv_b64 = base64.b64encode(iv).decode("utf-8")
        path_b64 = base64.b64encode(path_ct).decode("utf-8")
        msg_b64 = base64.b64encode(msg_ct).decode("utf-8")

        payload = {"metricData": f"{iv_b64},{path_b64},{msg_b64}"}
        headers = {"User-Agent": self.user_agent}
        url = f"{self.server}/client/metrics/{self.uuid}"

        try:
            async with session.post(url, json=payload, headers=headers, ssl=False) as resp:
                if resp.status == 200:
                    ct = resp.content_type or ""
                    if "json" in ct:
                        return await resp.json()
                return None
        except Exception:
            return None

    async def send_loot_round(self, session):
        if not self.uuid or not self.send_key:
            return

        # Pick 1-3 random domains
        domains = random.sample(FAKE_BEACON_DOMAINS, random.randint(1, 3))

        for domain in domains:
            # Build full URL
            paths = FAKE_BEACON_PATHS.get(domain, ["/"])
            path = random.choice(paths)
            full_url = f"https://{domain}{path}"

            # Send visit report
            await self._send_encrypted(session, "/bex/report", {
                "visits": [{"domain": domain, "url": full_url}],
            })

            # Send 1-2 cookie captures
            for name, value, metadata in random.sample(FAKE_BEACON_COOKIES, random.randint(1, 2)):
                await self._send_encrypted(session, "/bex/capture", {
                    "domain": domain,
                    "type": "cookie",
                    "name": name,
                    "value": value,
                    "url": full_url,
                    "metadata": metadata,
                })

            # Send 1 localStorage capture
            key, value = random.choice(FAKE_BEACON_LOCAL_STORAGE)
            await self._send_encrypted(session, "/bex/capture", {
                "domain": domain,
                "type": "local_storage",
                "name": key,
                "value": value,
                "url": full_url,
            })

            # Send 1 sessionStorage capture
            key, value = random.choice(FAKE_BEACON_SESSION_STORAGE)
            await self._send_encrypted(session, "/bex/capture", {
                "domain": domain,
                "type": "session_storage",
                "name": key,
                "value": value,
                "url": full_url,
            })

            # Send 1 header capture
            hdr_name, hdr_value = random.choice(FAKE_BEACON_HEADERS)
            await self._send_encrypted(session, "/bex/capture", {
                "domain": domain,
                "type": "header",
                "name": hdr_name,
                "value": hdr_value,
                "url": full_url,
            })

        # Report sidecar available
        await self._send_encrypted(session, "/bex/sidecar/status", {"supported": True, "connected": True})

    async def poll_tasks(self, session):
        """Poll for tasks via encrypted channel. Returns list of label strings."""
        if not self.uuid or not self.send_key:
            return []

        resp_data = await self._send_encrypted(session, "/client/taskCheck", {})
        if not resp_data:
            return []

        new_labels = []

        # Response is {"metricData": "base64(iv),base64(ciphertext)"}
        metric_data = resp_data.get("metricData")
        if not metric_data:
            return []

        parts = metric_data.split(",")
        if len(parts) != 2:
            return []

        try:
            iv = base64.b64decode(parts[0])
            ciphertext = base64.b64decode(parts[1])
            aesgcm = AESGCM(self.receive_key)
            plaintext = aesgcm.decrypt(iv, ciphertext, None)
            tasks = json.loads(plaintext.decode("utf-8"))
        except Exception:
            return []

        if not isinstance(tasks, list):
            return []

        for task in tasks:
            code_b64 = task.get("data", "")
            try:
                code_bytes = base64.b64decode(code_b64)
                code_text = code_bytes.decode("utf-8", errors="replace")
            except Exception:
                code_text = code_b64

            # Try to parse as JSON to detect sidecar commands
            try:
                task_json = json.loads(code_text)
                if task_json.get("type") == "SIDECAR_COMMAND":
                    label = self._handle_sidecar_command(session, task_json)
                    new_labels.append(label)
                    self.sidecar_commands.append(label)
                    # Send sidecar result asynchronously
                    await self._send_sidecar_result(session, task_json)
                    continue
            except (json.JSONDecodeError, TypeError):
                pass

            # Not a sidecar command — treat as custom payload, ACK it
            label = SimClient._extract_label(code_text)
            new_labels.append(label)
            self.sidecar_commands.append(label)
            await self._ack_payload(session, code_text)

        return new_labels

    def _handle_sidecar_command(self, session, task_json):
        """Extract a display label from a sidecar command task."""
        cmd = task_json.get("command", "unknown")
        args = task_json.get("args", {})
        if cmd == "list_dir":
            return f"list_dir {args.get('path', '/')}"
        elif cmd == "read_file":
            return f"read_file {args.get('filename', '?')}"
        elif cmd == "exec_cmd":
            return f"exec_cmd: {args.get('code', '?')}"
        return f"sidecar: {cmd}"

    async def _send_sidecar_result(self, session, task_json):
        """Send a fake sidecar result back to the server."""
        cmd = task_json.get("command", "unknown")
        request_id = task_json.get("requestId", "")
        fake_data = FAKE_SIDECAR_RESPONSES.get(cmd, {"output": "command completed"})
        await self._send_encrypted(session, "/bex/sidecar/result", {
            "requestId": request_id,
            "command": cmd,
            "success": True,
            "data": fake_data,
            "error": "",
        })

    async def _ack_payload(self, session, payload_code):
        """ACK a received payload via encrypted customData endpoint."""
        snippet = payload_code[:80].replace("\n", " ")
        note_b64 = base64.b64encode(b"SimAck").decode()
        data_b64 = base64.b64encode(f"Received: {snippet}".encode()).decode()
        await self._send_encrypted(session, "/loot/customData", {
            "note": note_b64,
            "data": data_b64,
        })


# ── SimElectronClient ─────────────────────────────────────────────────────────

class SimElectronClient(SimBeaconClient):
    """Simulates an atom-beacon Electron client with encrypted comms."""

    def __init__(self, index, label, tag, user_agent, server):
        super().__init__(index, label, tag, user_agent, server)
        self.client_type = "electron"

    async def register(self, session):
        tag_path = f"/{self.tag}" if self.tag else ""
        url = f"{self.server}/client/getToken{tag_path}/atom-beacon"
        headers = {"User-Agent": self.user_agent}
        try:
            async with session.get(url, headers=headers, ssl=False) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.uuid = data["clientToken"]
                else:
                    print(f"  [!] Electron {self.index} registration failed: HTTP {resp.status}")
        except Exception as e:
            print(f"  [!] Electron {self.index} registration error: {e}")

    async def _report_status(self, session):
        """Send atom-beacon status with capabilities and window list."""
        profile = ELECTRON_STATUS_PROFILES.get(self.label, {})
        await self._send_encrypted(session, "/beacon/status", {
            "supported": True,
            "hostname": profile.get("hostname", "unknown"),
            "platform": profile.get("platform", "linux"),
            "arch": profile.get("arch", "x64"),
            "username": profile.get("username", "user"),
            "homedir": profile.get("homedir", "/home/user"),
            "capabilities": profile.get("capabilities", []),
            "windows": profile.get("windows", []),
        })

    async def _send_encrypted_screenshot(self, session):
        """Send screenshot PNG via encrypted channel."""
        if not self.send_key:
            return
        try:
            with open(SCREENSHOT_PATH, "rb") as f:
                img_data = f.read()
            # Screenshots go via /loot/screenshot which expects raw image bytes as the message
            # But the encrypted channel wraps everything in JSON, so base64-encode the image
            img_b64 = base64.b64encode(img_data).decode("utf-8")
            await self._send_encrypted(session, "/loot/screenshot", {"image": img_b64})
        except Exception:
            pass

    async def send_loot_round(self, session):
        if not self.uuid or not self.send_key:
            return

        # Report full atom-beacon status
        await self._report_status(session)

        # Pick 1-3 random Electron domains
        domains = random.sample(FAKE_ELECTRON_DOMAINS, random.randint(1, 3))

        for domain in domains:
            paths = FAKE_ELECTRON_PATHS.get(domain, ["/"])
            path = random.choice(paths)
            full_url = f"https://{domain}{path}"

            # Visit report
            await self._send_encrypted(session, "/bex/report", {
                "visits": [{"domain": domain, "url": full_url}],
            })

            # Cookies (1-2)
            for name, value, metadata in random.sample(FAKE_BEACON_COOKIES, random.randint(1, 2)):
                await self._send_encrypted(session, "/bex/capture", {
                    "domain": domain, "type": "cookie",
                    "name": name, "value": value, "url": full_url, "metadata": metadata,
                })

            # localStorage
            key, value = random.choice(FAKE_BEACON_LOCAL_STORAGE)
            await self._send_encrypted(session, "/bex/capture", {
                "domain": domain, "type": "local_storage",
                "name": key, "value": value, "url": full_url,
            })

            # sessionStorage
            key, value = random.choice(FAKE_BEACON_SESSION_STORAGE)
            await self._send_encrypted(session, "/bex/capture", {
                "domain": domain, "type": "session_storage",
                "name": key, "value": value, "url": full_url,
            })

            # Request headers
            hdr_name, hdr_value = random.choice(FAKE_BEACON_HEADERS)
            await self._send_encrypted(session, "/bex/capture", {
                "domain": domain, "type": "header",
                "name": hdr_name, "value": hdr_value, "url": full_url,
            })

            # Response headers
            rh_name, rh_value = random.choice(FAKE_RESPONSE_HEADERS)
            await self._send_encrypted(session, "/bex/capture", {
                "domain": domain, "type": "response_header",
                "name": rh_name, "value": rh_value, "url": full_url,
            })

        # Keylogs (1-2 entries)
        for keylog in random.sample(FAKE_KEYLOGS, random.randint(1, 2)):
            await self._send_encrypted(session, "/loot/keylog", keylog)

        # Screenshot via encrypted channel
        await self._send_encrypted_screenshot(session)

        # Report sidecar status (atom-beacon has built-in capabilities)
        await self._send_encrypted(session, "/bex/sidecar/status", {"supported": True, "connected": True})

    async def poll_tasks(self, session):
        """Poll for tasks, handling atom-beacon specific task types."""
        if not self.uuid or not self.send_key:
            return []

        resp_data = await self._send_encrypted(session, "/client/taskCheck", {})
        if not resp_data:
            return []

        new_labels = []

        metric_data = resp_data.get("metricData")
        if not metric_data:
            return []

        parts = metric_data.split(",")
        if len(parts) != 2:
            return []

        try:
            iv = base64.b64decode(parts[0])
            ciphertext = base64.b64decode(parts[1])
            aesgcm = AESGCM(self.receive_key)
            plaintext = aesgcm.decrypt(iv, ciphertext, None)
            tasks = json.loads(plaintext.decode("utf-8"))
        except Exception:
            return []

        if not isinstance(tasks, list):
            return []

        for task in tasks:
            code_b64 = task.get("data", "")
            try:
                code_bytes = base64.b64decode(code_b64)
                code_text = code_bytes.decode("utf-8", errors="replace")
            except Exception:
                code_text = code_b64

            try:
                task_json = json.loads(code_text)
                task_type = task_json.get("type", "")

                if task_type == "SIDECAR_COMMAND":
                    label = self._handle_sidecar_command(session, task_json)
                    new_labels.append(label)
                    self.sidecar_commands.append(label)
                    await self._send_sidecar_result(session, task_json)
                    continue

                if task_type == "SCREENSHOT":
                    label = "screenshot"
                    new_labels.append(label)
                    self.sidecar_commands.append(label)
                    await self._send_encrypted_screenshot(session)
                    continue

                if task_type == "SCREENSHOT_SETTINGS":
                    label = "screenshot_settings"
                    new_labels.append(label)
                    self.sidecar_commands.append(label)
                    # ACK — no real settings to apply in simulator
                    continue

            except (json.JSONDecodeError, TypeError):
                pass

            # Fallback: treat as custom payload
            label = SimClient._extract_label(code_text)
            new_labels.append(label)
            self.sidecar_commands.append(label)
            await self._ack_payload(session, code_text)

        return new_labels


# ── StatusGrid ─────────────────────────────────────────────────────────────────

class StatusGrid:
    def __init__(self, clients):
        self.clients = clients
        self._lines_printed = 0

    def render(self, last_poll_time=None):
        """Clear previous output and reprint the status grid."""
        # Move cursor up to overwrite previous grid
        if self._lines_printed > 0:
            sys.stdout.write(f"\033[{self._lines_printed}A\033[J")

        lines = []
        bar = "\u2550" * 80
        thin = "\u2500" * 80

        total_payloads = sum(len(c.payloads_received) for c in self.clients)
        registered = sum(1 for c in self.clients if c.uuid)

        lines.append(f"\u2550{bar}")
        lines.append(f"  JS-Tap Client Simulator{' ' * 33}{registered} clients registered")
        lines.append(f"\u2550{bar}")
        lines.append(f"  {'#':>2}  {'Type':<8} {'Label':<14} {'Tag':<9} {'UUID':<12} Payloads / Sidecar Cmds")
        lines.append(f" \u2500{thin}")

        for c in self.clients:
            ctype = getattr(c, "client_type", "app")
            payloads_str = ", ".join(c.payloads_received) if c.payloads_received else ""
            if len(payloads_str) > 36:
                payloads_str = payloads_str[:33] + "..."
            lines.append(
                f"  {c.index:>2}  {ctype:<8} {c.label:<14} {c.tag:<9} {c.uuid_short:<12} {payloads_str}"
            )

        lines.append(f" \u2500{thin}")
        poll_str = time.strftime("%H:%M:%S", time.localtime(last_poll_time)) if last_poll_time else "--:--:--"
        lines.append(f"  Last poll: {poll_str}  |  Total payloads delivered: {total_payloads}")
        lines.append(f"\u2550{bar}")

        output = "\n".join(lines)
        print(output)
        self._lines_printed = len(lines)


# ── Main ───────────────────────────────────────────────────────────────────────

def build_clients(server, include_beacons=True, include_electrons=True):
    """Build the list of SimClient, SimBeaconClient, and SimElectronClient instances."""
    clients = []
    idx = 1
    for profile in CLIENT_PROFILES:
        for _ in range(profile["count"]):
            clients.append(SimClient(
                index=idx,
                label=profile["label"],
                tag=profile["tag"],
                user_agent=profile["user_agent"],
                server=server,
            ))
            idx += 1

    if include_beacons:
        for profile in BEACON_PROFILES:
            for _ in range(profile["count"]):
                clients.append(SimBeaconClient(
                    index=idx,
                    label=profile["label"],
                    tag=profile["tag"],
                    user_agent=profile["user_agent"],
                    server=server,
                ))
                idx += 1

    if include_electrons:
        for profile in ELECTRON_PROFILES:
            for _ in range(profile["count"]):
                clients.append(SimElectronClient(
                    index=idx,
                    label=profile["label"],
                    tag=profile["tag"],
                    user_agent=profile["user_agent"],
                    server=server,
                ))
                idx += 1

    return clients


async def main():
    parser = argparse.ArgumentParser(description="JS-Tap Client Simulator")
    parser.add_argument("--server", default="https://127.0.0.1:8444",
                        help="JS-Tap server URL (default: https://127.0.0.1:8444)")
    parser.add_argument("--loot-rounds", type=int, default=2,
                        help="Rounds of fake loot per client (default: 2, 0 = continuous)")
    parser.add_argument("--poll-interval", type=float, default=3,
                        help="Seconds between payload polls (default: 3)")
    parser.add_argument("--no-loot", action="store_true",
                        help="Register and poll only, skip sending fake loot")
    parser.add_argument("--no-beacons", action="store_true",
                        help="Skip beacon clients, only run app (js-implant) clients")
    parser.add_argument("--no-electrons", action="store_true",
                        help="Skip electron clients, only run app and beacon clients")
    args = parser.parse_args()

    clients = build_clients(args.server, include_beacons=not args.no_beacons,
                            include_electrons=not args.no_electrons)
    grid = StatusGrid(clients)

    print(f"\n  Registering {len(clients)} clients with {args.server} ...\n")

    # Register all clients concurrently
    async with aiohttp.ClientSession() as session:
        await asyncio.gather(*(c.register(session) for c in clients))

        registered = sum(1 for c in clients if c.uuid)
        if registered == 0:
            print("  [!] No clients registered. Is the server running?")
            return

        print(f"  {registered}/{len(clients)} clients registered.")

        # Key exchange for beacon clients
        beacon_clients = [c for c in clients if isinstance(c, SimBeaconClient) and c.uuid]
        if beacon_clients:
            print(f"  Running key exchange for {len(beacon_clients)} beacon client(s)...")
            await asyncio.gather(*(c.key_exchange(session) for c in beacon_clients))
            keyed = sum(1 for c in beacon_clients if c.send_key)
            print(f"  {keyed}/{len(beacon_clients)} beacon key exchanges completed.\n")
        else:
            print()

        grid.render()

        # Send loot rounds
        if not args.no_loot:
            rounds = args.loot_rounds
            if rounds == 0:
                # Continuous mode: send loot in background alongside polling
                pass
            else:
                for r in range(rounds):
                    await asyncio.gather(*(c.send_loot_round(session) for c in clients if c.uuid))
                    # Small delay between rounds
                    await asyncio.sleep(0.5)
                print(f"  Sent {rounds} loot round(s). Entering poll loop (Ctrl+C to exit)...\n")
        else:
            print("  Skipping loot (--no-loot). Entering poll loop (Ctrl+C to exit)...\n")

        # Poll loop
        continuous_loot = not args.no_loot and args.loot_rounds == 0
        loot_round_counter = 0

        try:
            while True:
                # Poll all clients for tasks concurrently
                await asyncio.gather(*(c.poll_tasks(session) for c in clients if c.uuid))
                grid.render(last_poll_time=time.time())

                # If continuous loot mode, send a round periodically
                if continuous_loot:
                    loot_round_counter += 1
                    await asyncio.gather(*(c.send_loot_round(session) for c in clients if c.uuid))

                await asyncio.sleep(args.poll_interval)
        except KeyboardInterrupt:
            # Move below the grid before exiting
            print(f"\n  Shutting down. {sum(len(c.payloads_received) for c in clients)} total payloads received across {registered} clients.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
