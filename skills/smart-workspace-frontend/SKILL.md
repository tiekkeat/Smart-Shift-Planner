---
name: smart-workspace-frontend
description: Build or adapt React applications using Smart Shift Planner’s consistent workspace layout, system typography, blue palette, responsive sidebar, forms, tables, and dialogs. Use when the user requests this design family or invokes this skill for a new application; not for unrelated frontend work or roster backend changes.
---

# Smart Workspace Frontend

Reproduce the Smart Shift Planner visual language while adapting branding, navigation, and content to the requested product. The package is self-contained: the original repository and running roster are not required.

## Choose the starting point

- **New application:** copy the contents of [assets/frontend-template](assets/frontend-template/) into a new, empty project directory, including `.gitignore`. It is a runnable React/Vite application, not merely a visual mockup. Run `npm ci`, then `npm run dev`. Use Node 24–26.
- **Existing application:** inspect its framework, navigation, CSS, and shared components first. Integrate the relevant shell and visual patterns; preserve its business logic, working APIs, and existing user work. Do not replace its manifest or lockfile with the starter’s. If retaining its framework would conflict with an explicit request for this React stack, resolve that choice before a migration.

Read [references/design-system.md](references/design-system.md) for layout, tokens, typography, component contracts, and the adaptation checklist. Read [references/calendar.md](references/calendar.md) only when the application needs a calendar. Do not add FullCalendar, Luxon, a backend, authentication, or deployment infrastructure solely because the source project used them.

## Build the requested application

1. Identify the product’s pages, primary actions, data source, and branding from the request and existing project. Ask only about missing choices that materially affect the result.
2. For new apps, change `src/config.js`: assign a unique, stable `appId`, set branding, and replace the navigation and synthetic directory examples with the target domain. `appId` namespaces browser preferences; it is not the display name.
3. Compose pages from `WorkspaceShell` and `src/ui.jsx`. Reuse the existing CSS classes and tokens. Keep the pale background, blue accent, system font stack, compact density, white bordered panels, restrained shadows, and sidebar behavior unless the user requests changes.
4. Connect product behavior to the target application’s data and authentication. The starter directory uses in-memory synthetic data; branding/sidebar preferences use localStorage. Its sign-in example does not authenticate. Replace example actions and copy as the application requires, and report any remaining demo behavior.
5. Update the initial HTML title, app-title metadata, and theme color along with runtime branding. Replace example icons and assets as needed; do not copy installation branding or real user records.

Keep desktop navigation icons visible when collapsed. Keep the expand/collapse control in the bottom account footer beside sign-out when the target app supplies sign-out. Use the mobile menu trigger only for the mobile drawer. Retain Radix focus management, accessible icon labels, visible focus indicators, responsive heading actions, narrow-screen table scrolling, and reduced-motion handling.

Use the pinned frontend dependencies and included lockfile for a new app; do not upgrade them incidentally. In an existing app, respect its compatible dependency versions. The CSS is mostly semantic component classes with a Tailwind 4 import; do not replace it with an unrelated component library or introduce a downloaded font without a product reason.

## Verify the result

- Run the target application’s build. For the starter this is `npm run build` after `npm ci`.
- Exercise desktop expanded/collapsed navigation, mobile drawer open/close, Escape/focus return, hash navigation, form validation and save/cancel, search/empty state, and feedback.
- Inspect desktop and 390px mobile layouts, plus 320px and the 680/681px breakpoint when changing the shell. Wide tables should scroll within their wrapper rather than widening the page.
- Check branding in sidebar, header, browser title, and favicon; reload to verify preferences. Test with synthetic or disposable data.
- Report what actually works, checks performed, and remaining dependencies on backend/authentication. Deployment is separate from frontend implementation.

## Example requests

- “Use $smart-workspace-frontend to build an inventory management application with products, stock movements, and suppliers.”
- “Use $smart-workspace-frontend to apply the Smart Shift Planner layout to this existing React app, preserving its API integration.”

## Maintaining this package

The repository skill directory is the source of truth. After validating an update, compare it with the installed skill at `${CODEX_HOME:-$HOME/.codex}/skills/smart-workspace-frontend` and synchronize this package only. Do not overwrite divergent personal edits without reconciling them. Keep dependencies and build artifacts outside the skill package. Re-run the skill-creator validator when available; the application build and browser checks validate the starter independently.
