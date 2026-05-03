# ARC Rocketry

A small in-field tool for ARC rocket launches. It computes flight settings from a calibration table and provides a launch-day timer and pre-flight checklist.

## Features

- **Values tab** — enter target height (ft) and windspeed (mph); the app shows:
  - **Weight (g)** — looked up from the calibration table for the target height, minus windspeed.
  - **Rubber band position (cm)** — linear interpolation between 725 ft → 14 cm and 775 ft → 26 cm at the 5 mph calibration baseline, plus a wind correction of `0.4 cm/mph`.
- **Timer tab** — 45-minute circular countdown with start, stop, and reset.
- **Checklist tab** — pre-flight checklist with toggleable items.
- Calibration data is editable and persisted in `localStorage`.

## Tech stack

React 19, TypeScript, Vite, lucide-react.

## Getting started

```bash
npm install
npm run dev
```

The dev server runs at `http://localhost:5173/ARC_Rocketry/`.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | Production build for GitHub Pages (`dist/`) |
| `npm run build:single` | Single self-contained HTML build (`dist-single/`) |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |

## Generate a single offline HTML

For taking the tool to the launch site without internet access, build a single self-contained HTML file:

```bash
npm run build:single
```

This produces **`dist-single/index.html`** (~208 KB). All JavaScript and CSS are inlined into that one file. Copy just `index.html` to any machine and open it in a browser — no server, no network required.

Notes:
- The Inter font is loaded from Google Fonts; offline it falls back to a system font (cosmetic only).
- The favicon reference is not inlined; missing it doesn't affect functionality.

## Deployment

Pushes to `main` trigger the `Deploy static content to Pages` GitHub Actions workflow, which publishes `dist/` to GitHub Pages.

## Project structure

```
src/
  App.tsx              UI and tab logic (Values / Timer / Checklist)
  data/calibration.ts  Initial calibration table (target height → weight, drill, etc.)
  services/storage.ts  localStorage wrappers
  types/               TypeScript types
```
