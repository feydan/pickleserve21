# CLAUDE.md

Guidance for Claude Code (claude.ai/code) and other AI coding agents working in this repository. See `README.md` for setup, deploy and DNS details.

## Project

Single-page static site for PickleServe™ 21, a pickleball serve-training target mat by RCI. Two jobs: product marketing and game instructions (rules, strategy diagrams, an on-court scorekeeper, a printable scoresheet). Live at `https://pickleserve21.com/`.

## Content rules

- `public/pickleserve_21_instructions.pdf` is the single source of truth for product and game content: rules, scoring zones (red 5 / green 3 / yellow 1), strategy, sideline targets, scoresheet, legal lines. Do not invent product claims, specs, testimonials or features.
- No pricing or purchase info exists; don't add any.
- The only contact method is the email already on the page; don't add phone numbers, addresses or other contact details.
- Mark anything missing with a `<!-- TODO -->` comment rather than filling it in. Current TODO: real product photos (`index.html`).
- Illustrations are hand-authored inline SVG. Don't extract or reuse the photos inside the PDF.

## Commands

Node 22.12+ (`.nvmrc`).

- `npm run dev` — dev server
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — vitest (`src/scorekeeper/*.test.ts`)
- `npm run build` — typecheck + production build to `dist/`; `npm run preview` serves it
- `npm run scoresheet:pdf` — regenerate `public/pickleserve21_scoresheet.pdf` (headless Chromium prints the built page). Rerun after changing scoresheet markup or print CSS.

Run `typecheck` and `test` before considering a change done; CI runs both and blocks deploy on failure.

## Stack

Vite (vanilla-ts) + strict TypeScript. No UI framework and no runtime dependencies — keep it that way. Fonts are self-hosted via `@fontsource/barlow-condensed` and `@fontsource/inter` (devDependencies, bundled by Vite); don't add CDN or third-party requests.

## Deploy

GitHub Pages via `.github/workflows/deploy.yml` on push to `main` (typecheck, test, build, `actions/deploy-pages`). Not Jekyll. Custom domain comes from `public/CNAME`. `vite.config.ts` must keep `base: './'` so assets resolve both on the domain root and on the github.io project subpath.

## Architecture

- `index.html` — all content sections and inline SVG. A hidden `svg.svg-defs` holds shared symbols: `#court-base` (20×44 ft court, 1 unit = 1 ft, far side at top, server at bottom), `#fan-mat` (quarter circles r 3 / 5.5 / 8, corner at origin) and `#arrow`. Strategy tab panels reference them with `<use>` + transforms. SVG colours come from CSS classes (`.z5` / `.z3` / `.z1`, `.court-*`, `.serve-path`, …), not inline fills.
- `src/styles.css` — design tokens, layout, components, reveal animation, `@media print` (printing the page always yields only `#scoresheet`, on one letter/A4 page).
- `src/main.ts` — font/CSS imports, mobile nav + active-section highlight, scroll reveal (`.js-reveal` on `<html>`, skipped under reduced motion), accessible tabs, scorekeeper init.
- `src/serve-view/` — "Server's-eye view" under the strategy tabs: a first-person, perspective-projected SVG serve that follows the ball from the baseline to the target, synced to the selected strategy tab; its own serve buttons (built in `index.ts`) click those tabs so both stay in step. `projection.ts` (camera, near-plane clipping), `scene.ts` (pure scenario data per tab id, timeline, ball/camera motion; tested), `render.ts` (builds the SVG once, re-projects per frame), `index.ts` (play/pause/replay, autoplay once when scrolled into view, still frame under reduced motion). Scenario positions mirror the top-down diagrams; keep both in sync.
- `src/scorekeeper/model.ts` — pure logic, no DOM: sessions, trials, `addBall` / `undo` / `nextTrial`, averages, validation. Functions return the same object when an action is rejected (callers can compare by reference).
- `src/scorekeeper/storage.ts` — `createStore(backend?)`; localStorage keys `ps21.history.v1` / `ps21.current.v1`. Validates and normalizes on load; falls back to in-memory storage on any error. Bump the key version if the stored shape changes incompatibly.
- `src/scorekeeper/ui.ts` — DOM wiring, keyboard shortcuts (0/1/3/5, U) while the scorekeeper is on screen, in-page confirms (no `window.confirm`). A session auto-saves to history when its 3rd trial completes, or via "Save session"; "saved" means its id is in history.
- `src/scorekeeper/history.ts` — history list, per-mode personal best, SVG sparkline.

All scorekeeper data stays in the visitor's browser. Don't add analytics, tracking or network calls.

## Design constraints

- Dark "sporty premium" theme only: navy base. Mat colours are semantic everywhere (red = 5, green = 3, yellow = 1), including scorekeeper buttons and diagrams. White text on red uses `--red-strong` for contrast.
- Respect `prefers-reduced-motion`.
- Must work at ~375px width with no horizontal scroll.
- Social preview image is `public/og-image.jpg` (1200×630); update the `og:` / `twitter:` meta tags in `index.html` if it changes.
