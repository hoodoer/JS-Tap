# JS-Tap Project Instructions

## UI Style Rules (MANDATORY)

Before creating or modifying ANY UI elements, read @STYLE_GUIDE.md.

This project uses Bootswatch **Slate** theme on Bootstrap 5.3. The palette is gray-toned, NOT blue-toned. Key rules:

- **Backgrounds**: `#272b30` (page), `#3a3f44` (cards/inputs). NEVER use blue-tinted darks like `#1a1a2e`, `#16213e`, `#0f3460`.
- **Text**: `#aaa` (body), `#fff` (emphasis/headings), `#7a8288` (muted/labels). NEVER use `#e0e0e0`.
- **Borders**: `#52565a` or `#6c757d`. NEVER use `#333`.
- **Buttons**: Use Bootstrap Slate semantic classes (`btn-primary`, `btn-outline-success`, `btn-outline-danger`, etc.). NEVER invent custom solid-fill button colors.
- **Badges**: Use `bg-success`, `bg-warning`, `bg-danger`, `bg-info`, `bg-secondary`, `bg-dark` on a `#272b30` background. NEVER use custom badge background colors.
- **Headings**: Always `#fff`. NEVER color headings cyan, blue, or any accent color.
- **Active indicators**: 3px left border using Slate semantic colors (`#62c462` success, `#f89406` warning). NEVER use full colored borders or custom highlight fills.
- **Status toast colors**: Match `showToast()` — `bg-success` (green), `bg-danger` (red), `bg-warning` (orange), `bg-info` (cyan default).

Extension popups (bex-conductor) must mirror the Slate aesthetic since they don't load Bootstrap CSS directly.

## Build & Run

- Use `python3` not `python`
- Python venv: `source /home/hoodoer/dev/JS-Tap/bin/activate`
- WXT builds: run from `bex-beacon/` directory
- Unified build: `python3 buildAll.py` from root
- Safe to delete `jsTap.db` between test runs
