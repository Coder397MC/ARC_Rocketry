# ARC Rocketry

In-field tool for the ARC model-rocket team. Predicts launch settings from past
flights, captures live launch conditions, runs a launch-day timer and
checklist, and logs every flight so the predictions get sharper over time.

## What it does

The app is organized around the launch-day workflow:

1. **Conditions** — pull or enter today's weather (temp, pressure, humidity,
   wind, rod angle). Values are shared across the rest of the app.
2. **Setup** — enter target altitude. The app recommends:
   - **Weight (g)** from a linear regression over past flights (or the
     calibration table when there isn't enough data).
   - **Rubber band position (cm)** from a baseline interpolation, blended with
     the average of nearby successful flights via Bayesian-style shrinkage so
     fresh data nudges the recommendation without overshooting.
   - Predicted descent time and total flight time from a parachute model.
3. **Timer** — 45-minute circular countdown.
4. **Checklist** — pre-flight items, toggleable.
5. **Flights** — log a flight (manual entry pre-fills from Setup + Conditions),
   import / export CSV, backfill historical weather for old rows, push / pull a
   shared cloud copy.
6. **Settings** — calibration table, parachute geometry, launch fields
   (location → lat/lon for the weather API), reference density, optional
   Turso cloud sync.

### How predictions work

- **Altitude regression** (`services/regression.ts`) — ordinary least squares
  on `[mass, ρ, wind, wind², rod, mass×ρ]` against actual altitude. Falls back
  to leaner feature sets when the flight count is too small for the full
  model.
- **Density** (`services/atmosphere.ts`) — humid-air density from temp,
  pressure, humidity. Replaces the standard 1.225 kg/m³ when weather is
  available.
- **Rubber-band shrinkage** (`shrinkRubberBandToNeighbors`) — pulls the linear
  prior toward the mean of past flights whose target altitude is near today's
  target *and* that landed within ±15 ft of their own target. Each flight's
  contribution decays linearly with distance from the current target
  (triangular kernel) so the recommendation moves smoothly as you scan target
  values. Blend strength = `n / (n + k)`, with `k = 2`.
- **Descent regression** (`fitDescentModel`) — fits descent time on
  `[rubber-band, mass/ρ, mass]` for flights that record both rubber-band and
  duration.
- **Outlier flag** (`suspiciousFlightIndices`) — residuals beyond `2σ` of the
  training RMS get marked in the flight list.

### Data persistence

- **Flights** — `sql.js` SQLite database, persisted as a blob in IndexedDB.
  Migrations run automatically on app start (e.g. the `temp_c → temp_f`
  rename).
- **Settings, conditions, calibration** — localStorage, with merge functions
  in `data/settings.ts` so old shapes don't break new fields.
- **Cloud copy** — optional Turso (libSQL). Manual push / pull, replace-all
  semantics (last-writer-wins). See *Cloud sync* below.

### Weather

`services/weather.ts` calls Open-Meteo's free, key-less API:
- **Current** — `api.open-meteo.com/v1/forecast` for live launch conditions.
- **Historical** — `archive-api.open-meteo.com/v1/archive` for backfilling
  weather on old flights from their date + the launch field's lat/lon.

Temperature is **stored** in Fahrenheit (`temp_f` column in SQLite, F values
in Turso) but **handled internally** in Celsius (`Flight.tempC`) because the
density formula needs SI units. Conversion happens at the DB boundary in
`services/db/flightsRepo.ts`. Conversion helpers live in `services/units.ts`.

## Tech stack

React 19, TypeScript, Vite, sql.js (WASM SQLite), `@libsql/client` for Turso,
Open-Meteo for weather, lucide-react for icons.

## Getting started

```bash
npm install
npm run dev
```

The dev server runs at `http://localhost:5173/ARC_Rocketry/`.

## Cloud sync (optional)

To enable Turso push / pull, create `.env.local` in the project root:

```
VITE_TURSO_URL=libsql://your-db-name.turso.io
VITE_TURSO_TOKEN=eyJhbGciOi...
```

Without these, the local DB still works fully — only the **Push / Pull**
buttons in the Flights tab will fail with `Turso not configured`.

The flights schema in Turso must match `flightsRepo.ts:COLUMNS`. If you're
upgrading an existing Turso DB from the older `temp_c` schema, run once:

```sql
ALTER TABLE flights RENAME COLUMN temp_c TO temp_f;
UPDATE flights SET temp_f = temp_f * 9.0 / 5.0 + 32.0 WHERE temp_f IS NOT NULL;
```

Local browser DBs auto-migrate on next page load.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build for GitHub Pages (`dist/`) |
| `npm run build:single` | Self-contained single-HTML build (`dist-single/`) |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |

## Single offline HTML

For launch sites without internet access:

```bash
npm run build:single
```

Produces **`dist-single/index.html`** (~208 KB) with all JS and CSS inlined.
Copy that one file to any machine and open it in a browser — no server, no
network. Open-Meteo features (live + historical weather pull) and Turso sync
are unavailable offline; everything else works.

Notes:
- The Inter font is loaded from Google Fonts; offline it falls back to a
  system font (cosmetic only).

## Deployment

Pushes to `main` trigger the *Deploy static content to Pages* GitHub Actions
workflow, which publishes `dist/` to GitHub Pages.

## Project structure

```
src/
  App.tsx                 Top-level UI: tabs, layout, prediction wiring.
  components/
    NumberInput.tsx       Controlled number input that allows empty mid-edit.
  data/
    calibration.ts        Initial calibration table (target → weight, drill).
    settings.ts           Default settings + migration/merge helpers.
  services/
    units.ts              cToF / fToC.
    atmosphere.ts         Humid-air density from temp/pressure/humidity.
    weather.ts            Open-Meteo current + archive clients.
    parachute.ts          Chute CdA, terminal velocity, descent time.
    regression.ts         Linear OLS, altitude/descent models, shrinkage,
                          outlier flagging.
    flightLog.ts          Boot, list, add, CSV in/out, backfillWeather.
    analysis.ts           Per-flight diagnostics ("ran high because…").
    storage.ts            localStorage wrapper for settings/conditions.
    storage/              Pluggable storage backend (localStorage today).
    db/
      sqliteDB.ts         sql.js init, IndexedDB persistence, migrations.
      flightsRepo.ts      Flight ↔ row mapping + CRUD (C↔F at boundary).
      tursoSync.ts        Push / pull against Turso, replace-all.
  types/                  TypeScript types (Flight, Settings, Conditions, …).
data/
  anchor-flights.csv        Live flight log to import (empty header-only template — clean slate for 2027).
  2026-season-flights.csv   Archived, finalized 2026 season (12 practice + 2 finals flights).
                            Launch 2 of the finals is flagged as a motor anomaly so it is
                            excluded from model training; import this only if you want 2026 history back.
```

## Conventions

- Internal units are SI / Celsius. Display and DB use the team's preferred
  units (mph, °F, ft). Conversions are centralized in `services/units.ts`
  and at the DB boundary in `flightsRepo.ts`.
- Number fields use `<NumberInput>` so clearing the field stays empty
  instead of snapping to 0.
- DB writes go through `withWrite()` in `sqliteDB.ts`, which flushes the blob
  back to IndexedDB after every mutation.
