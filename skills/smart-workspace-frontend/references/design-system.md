# Smart Workspace design system

## Provenance and intent

Extracted on 2026-11-25 from the current working-tree frontend of `tiekkeat/Smart-Shift-Planner`, including its then-uncommitted frontend refinements. Main sources were `src/style.css` (visual rules), `src/main.jsx` (workspace and branding), `src/ui.jsx` (shared controls), and `src/people.jsx` / `src/settings.jsx` (page composition). Dependencies were resolved from that repository’s `package-lock.json`.

This is an extracted snapshot, not an automatic link to the source app. All files needed for new applications are bundled. The starter generalizes coverage cards into summary cards, replaces roster content with synthetic examples, separates shell/config/pages, and uses Radix for the mobile drawer’s focus behavior. It introduces no production API access.

## Framework and styling

- React 19 with `createRoot` and StrictMode; JavaScript ES modules and JSX.
- Vite with React and Tailwind 4 Vite plugins. The base config has no `/api` proxy because no backend is assumed.
- Radix Dialog for accessible overlays and focus management; Radix Slot for button-as-link composition.
- Lucide icons: normally 16–21px, navigation 19px at stroke width 1.9.
- Semantic CSS in `src/style.css`, starting with `@import "tailwindcss"`. Utility classes support small helpers such as `sr-only` and reduced-motion-aware loading animations.
- Node `>=24 <27`; npm and the bundled lockfile. Exact direct dependency versions are in the starter manifest. Keep the lockfile with copied projects.

## Tokens and typography

| Property | Baseline |
| --- | --- |
| Font stack | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif` |
| Canvas | `#f6f8fc` |
| Text / `--text` | `#19243a` |
| Secondary text / `--muted` | `#60718b` |
| Border / `--line` | `#e2e8f2` |
| Surface / `--paper` | `#fff` |
| Accent / `--accent` | `#315fe8` |
| Accent hover / `--accent-dark` | `#224ccc` |
| Panel shadow / `--shadow` | `0 2px 5px #25365c08` |
| Active navigation | background `#edf2ff`, text `#224bc9` |
| Corners | controls 8px, panels 13px, dialogs 16px |

The font is a local system stack; `SF Pro Text` is a fallback name, not a bundled font. Rendering differs slightly across operating systems. No web font download is needed. Base line-height is 1.5, with font smoothing and `font-synthesis: none`.

Page titles use `clamp(1.25rem, 1.05rem + .5vw, 1.5rem)`, weight 600, line-height 1.3, and letter-spacing `-.025em`. Descriptions are approximately 13px. Body/table controls are typically 12–13px; small metadata is 11px; panel headings are 17px and dialog headings 22px. Preserve the compact hierarchy rather than enlarging every element.

Existing palette classes `color-blue`, `color-purple`, `color-green`, `color-orange`, `color-pink`, and `color-cyan` define `--tone-bg`, `--tone-text`, and `--tone-line`. They are useful for avatar and category labels. Status badges convey meaning through text as well as color.

## Shell and responsive behavior

| Width/state | Behavior |
| --- | --- |
| Above 950px | 237px sticky sidebar; 65px topbar; content padding `30px 31px 40px` |
| 681–950px | 199px sidebar; content padding `23px 18px 34px` |
| Desktop collapsed | 68px icon rail, independent of intermediate width |
| 680px and below | 228px modal navigation drawer; 56px topbar; content padding `17px 10px 28px` |
| 420px and below | One-column form grid; starter summary cards stack |

Content is centered within a maximum width of 1510px. Use `minmax(0, 1fr)` / `min-width: 0` to avoid content widening the shell. The minimum supported viewport is 320px. Sidebar account content stays at the bottom. Icon-only links retain accessible names and `title` text; the selected link uses `aria-current="page"`.

The starter uses a modal Radix mobile drawer: focus trap, body scroll lock, Escape/outside-click dismissal, and focus return to the menu trigger. Navigation selection closes the drawer. Desktop collapse state persists in `${appId}:sidebar-collapsed`; mobile visibility does not persist. Switching breakpoints resets mobile visibility. Collapse never hides the navigation icons or moves the footer expand control into the topbar.

## Component and composition contracts

| Interface | Intended usage |
| --- | --- |
| `WorkspaceShell({ branding, navigation, page, user, onSignOut?, children })` | Shared frame; `user` has `name` and `role`; optional sign-out callback belongs to the target app |
| `Brand({ branding })` | Icon/image, app name, and subtitle |
| Navigation item `{ id, title, icon }` | Hash navigation with a Lucide icon component |
| Branding `{ appId, appName, headerName, subtitle, logo, favicon }` | String values; blank image values use defaults; `appId` remains stable |
| `Button({ variant, size, asChild, ...props })` | Variants `primary`, `secondary`, `ghost`, `danger`; sizes `regular`, `small`, `icon`; defaults to `type="button"` |
| `Avatar({ name, color, size })` | Initials with palette classes, decorative to assistive technology |
| `Field({ name, label, hint, children, ...props })` | Labeled input or a single custom control; label explicitly when nesting multiple controls |
| `Panel({ title, actions, children, className })` | Bordered surface with optional toolbar; wrap padded content in `.panel-body` |
| `Badge({ tone, children })` | `positive`, `neutral`, `warning`, or `negative` |
| `Modal({ title, description, onClose, children })` | Controlled by conditional rendering; Radix owns focus/overlay behavior |
| `Empty({ title, description, icon })`, `Loading()` | Empty/loading states; adapt default icon for the product |
| `Status({ error, success })` | Error alert or success status; error takes precedence |

Use `.page-heading` with title/description and `.heading-actions` for actions. Headings and actions wrap on small screens. `.table-wrap` owns horizontal table overflow. Forms use `.form-stack`, two-column `.form-grid`, and `.dialog-footer`; keep cancel separate from submit. Native form validation is used in the starter. `.summary-grid` and `.summary-card` support the blue primary/white secondary overview pattern.

The sign-in appearance lives on the UI examples page, not in the application access path. It is explicitly an unconnected form example; it does not create a session or simulate authentication success. Keep authentication and authorization owned by the application backend.

## Adaptation checklist

1. Set a unique `appId` and the target app’s branding; update `index.html` defaults too. Use local logo/favicon assets when available.
2. Replace navigation definitions and add page renderers in `src/main.jsx`. Hash routing is the small starter default; integrate an existing router when adapting an application.
3. Replace the directory/overview examples with domain-specific pages, labels, real calculations, and product data. The bundled `example.com` identities are synthetic.
4. Directory edits live in memory and reset on reload. Branding persists in `${appId}:branding`. For a shared product, replace browser-only branding with its real settings service.
5. Keep app styles in shared CSS, with product-specific styles separate from component primitives. If theme changes are requested, update tokens and related hard-coded hover/status surfaces consistently.
6. Add only the dependencies actually needed. Backend libraries, roster permissions, worker polling, API prefixes, timezone defaults, production origins, and deployment credentials are not part of this design system.
7. Build and inspect interactions at desktop/mobile sizes. Preserve keyboard access and honest loading, error, and empty states as APIs replace examples.
