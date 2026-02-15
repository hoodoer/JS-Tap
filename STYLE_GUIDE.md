# JS-Tap UI Style Guide

This document defines the visual design language for all JS-Tap interfaces, based on the established patterns in the dashboard and admin UI. All new UI work should follow these guidelines.

## Foundation

- **Framework:** Bootstrap 5.3.0 with Bootswatch **Slate** theme
- **Key distinction:** `--bs-primary` in Slate is `#3a3f44` (dark gray), NOT Bootstrap's default blue. `btn-primary` renders as a gray button.

## Color Palette

### Backgrounds

| Context | Color | Notes |
|---------|-------|-------|
| Page body | `#272b30` | `--bs-body-bg`, `bg-dark` |
| Cards / panels | Slate default card bg | No explicit bg class needed — inherits from theme |
| Card headers (collapsible) | `#272b30` | `bg-dark text-white` |
| Input fields | Inherit card bg | Or `#272b30` if on a card surface |
| Terminal / code output | `#1e1e1e` | VS Code-inspired dark |
| Modal content | Default Slate card bg | `border: 2px solid #6c757d` |

### Text

| Context | Color | Class/Var |
|---------|-------|-----------|
| Default body text | `#aaa` | `--bs-body-color` |
| Emphasis / headings | `#fff` | `text-white` |
| Subtitles / timestamps | Slate muted gray | `text-muted` |
| Secondary info | `#adb5bd` | Inline style |
| Links | `#fff` | `--bs-link-color` |
| Terminal commands | `#66cc99` | Inline |
| Terminal errors | `#ff5555` | Inline |

### Semantic Colors (Slate Bootstrap Overrides)

| Name | Hex | Class prefix | Use for |
|------|-----|-------------|---------|
| Primary | `#3a3f44` | `*-primary` | Default/neutral actions, dark gray |
| Secondary | `#7a8288` | `*-secondary` | Dismiss, close, minor actions |
| Success | `#62c462` | `*-success` | Start, enable, inject, connected |
| Info | `#5bc0de` | `*-info` | Informational, auxiliary, links |
| Warning | `#f89406` | `*-warning` | Caution, secondary attention |
| Danger | `#ee5f5b` | `*-danger` | Stop, destructive, errors |
| Light | `#e9ecef` | `*-light` | Count badges, timestamp pills |
| Dark | `#272b30` | `*-dark` | Card headers, explicit dark bg |

### Structural Colors

| Element | Color |
|---------|-------|
| Borders (modals, navbar, rules) | `#6c757d` (gray-600) |
| Selection accent (left border) | `#6ea8fe` (blue-400) |
| Active toggle border | `green` (CSS keyword) |
| Filter notification dot | `#ffc107` (Bootstrap warning yellow) |

## Buttons

### Primary Actions
- `btn btn-primary` — main actions (Save, OK, Inject, Run, View Details)
- Renders as dark gray with white text in Slate

### Dismiss / Cancel
- `btn btn-secondary` — Cancel, Close, Import/Export

### Semantic Outline Buttons (Operational Context)
- `btn-outline-success` — Start, Enable, Inject (green)
- `btn-outline-danger` — Stop, Disable, Destructive (red)
- `btn-outline-info` — Informational/auxiliary (cyan)
- `btn-outline-warning` — Caution/secondary action (orange)
- `btn-outline-secondary` — Pagination, minor navigation
- `btn-outline-primary` — Browse, navigate

### Active Toggle Pattern
When a button represents a toggled-on state:
```javascript
btn.classList.add('active');
btn.style.borderWidth = '2px';
btn.style.borderColor = 'green';
```

### Sizing
- Most action buttons use `btn-sm`
- Modal footer buttons use default size
- Use `minWidth` inline style for consistent column widths when needed

## Badges

### Status Badges
- `badge bg-success` — Connected, active, secure
- `badge bg-warning text-dark` — Waiting, in-progress, truncated
- `badge bg-danger` — httpOnly flag, errors
- `badge bg-secondary` — Inactive, non-httpOnly, minor counts
- `badge bg-info` — Cookie-type events
- `badge bg-primary` — URL visited events
- `badge bg-dark` — API call events, child implant references

### Count Badges
- `badge bg-light text-dark` — numeric counts in tabs

### Timestamp Pills
- `badge bg-light text-dark rounded-pill`

## Cards

### Standard Pattern
```
card
  card-body
    h5.card-title
    h6.card-subtitle.mb-2.text-muted
    p.card-text
```
No explicit bg class — inherits Slate defaults.

### Collapsible Panel Pattern (Sidecar, Proxy, etc.)
```
card.mb-3.border-{semantic}
  card-header.bg-dark.text-white.d-flex.justify-content-between.align-items-center
    <span><b>Title</b> statusBadge</span>
    <chevron-svg>
  div.collapse#id
    card-body.p-3
```
- Sidecar: `border-secondary`
- Proxy: `border-info`

### Selected Card
```css
.table-active {
    background-color: rgba(255, 255, 255, 0.15);
    border-left: 3px solid #6ea8fe;
}
```

## Modals

- Standard Bootstrap 5 modal structure
- All modals get `border: 2px solid #6c757d` on `.modal-content`
- Footer: primary action right (`btn-primary`), dismiss left (`btn-secondary`)

## Toasts

```javascript
showToast(message, type)
// type: 'success' -> bg-success (default when omitted)
// type: 'danger'  -> bg-danger
// type: 'warning' -> bg-warning text-dark
// (anything else) -> bg-info
```
- Auto-dismiss after 3000ms
- Positioned bottom-right

## Extension Popups (BEX Conductor)

Extension popups should mirror the Slate aesthetic:
- Page bg: `#272b30`
- Card/input bg: `#3a3f44`
- Text: `#aaa` default, `#fff` for emphasis
- Borders: `#52565a` or `#6c757d`
- Headings: `#fff` (not colored)
- Section labels: `#7a8288` (secondary gray), uppercase, small
- Use `bg-success`, `bg-warning`, `bg-danger`, `bg-info`, `bg-secondary` for badge semantics rather than custom hex values
- Buttons follow the same semantic outline pattern as the dashboard
- Active items: use `#6ea8fe` left border or Slate success green, not custom highlight colors

## Anti-Patterns (Avoid)

- Custom background colors like `#1a1a2e`, `#16213e`, `#0f3460` — use Slate grays instead
- Custom button background colors — use Bootstrap Slate classes
- Colored headings (e.g., cyan `h1`) — headings should be `#fff`
- Custom green/brown/red backgrounds for buttons — use `btn-outline-*` classes
- Any blue-tinted dark backgrounds — Slate is gray-tinted, not blue-tinted
