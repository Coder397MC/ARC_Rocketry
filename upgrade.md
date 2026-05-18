# ARC Rocketry — Upgrade Plan

A roadmap for evolving the in-field tool from a two-input table-lookup into a
physics-aware predictor, calibrator, and post-flight analyst.

Phases 0–6 below are **shipped**. The "Modeling roadmap" section at the end
captures the forward modeling work (uncertainty bands, motor-lot features,
calibrated drag, GP regression).

---

## Context (the assumptions everything below is built on)

- **Competition:** TARC National Finals. Targets (altitude, time window) are
  **fully editable from day one** — coach types them in at the start of each
  round; the app never hardcodes them.
- **Altimeter:** Jolly Logic AltimeterTwo — gives peak altitude, total time,
  apogee time, and descent time directly. We can log all four with one tap.
- **Rocket:** one rocket, all season. No per-rocket config layer needed yet.
- **Motor:** Aerotech **F63-10R** (total impulse ≈ 63 N·s, avg thrust ≈ 63 N,
  burn time ≈ 1.0 s, 10 s delay). Same motor every flight ⇒ we can fit
  motor-specific constants instead of doing full thrust-curve integration.
- **Parachute:** 20.5 in (≈ 0.521 m) flat round, **with a spill hole at the
  top** — that's a fixed geometric `C_D · A_chute` we'll measure once.
- **Calibration:** the existing `CalibrationRow` table was built by collecting
  **7–8 real flights** and using AI to fill in the rest of the 725–775 ft
  range. So the table has real signal at the anchor points and *interpolated*
  values everywhere else. Actual altitude is consistently a bit lower than
  the table predicts — likely a mix of density bias and an over-optimistic
  drag estimate from the AI fill-in.
- **User:** high-school coach. Comfortable with a tablet/laptop, not a CLI.
  Inputs must still be glove-and-cold-finger-friendly on launch day.
- **Connectivity:** must work fully offline at the launch field, but should
  *opportunistically* use a weather API when online (e.g., the morning of,
  on the parking-lot WiFi or a phone hotspot) to pre-fill conditions.
- **Storage:** one device is the source of truth for now. Migrating to
  **SQLite** later is on the roadmap, so storage code must be abstracted
  behind a small interface — not littered with `localStorage.setItem` calls.
- **Motor lot tracking:** the team **will record** the manufacturing lot
  number printed on each F63 motor's packaging. The app gets a `motorLot`
  field on every flight (Phase 3) and a lot-bias diagnosis (Phase 5) that
  flags lots flying consistently above/below the regression line.
- **Launch fields (lat/lon for the weather API):**
  - Home practice field: `47.70677362601196, -122.13947196072493`
  - TARC Finals field: `38.829184031331906, -77.8088339801777`
  Phase 0 seeds both as named entries in Settings; coach picks active field
  per session, defaulting to home.

---

## Phase 0 — Stop the bleed (½ day) [done]

Tiny corrections that pay off immediately, no architecture change.

- Make `TARGET_ALTITUDE`, `TARGET_TIME_MIN/MAX` editable in a **Settings**
  tab and persisted via the storage layer. Coach changes them per round.
- Add a **systematic bias correction** field: "calibration sheet predicts
  X ft, you actually fly X − Δ ft". Surface Δ as a single number the coach
  can tune (default 0 ft). Until Phase 3 gives us regression, this single
  knob handles the "always a little lower" problem.
- Mark which `CalibrationRow` rows are **anchor points** (the 7-8 real
  flights) vs. **interpolated** (AI fill-in). New optional flag on the type:
  `source: 'measured' | 'interpolated'`. Display anchors in bold or with a
  ⚓ icon — gives the coach intuition about where the table is trustworthy.
- Show the looked-up calibration row's **delta** (predicted vs actual) once
  flights are logged, so bias drift over the season is visible.
- **Storage abstraction:** introduce `src/services/storage/index.ts` with
  a small interface (`get`, `set`, `list`, `delete`). First implementation
  wraps `localStorage`; later a SQLite backend can drop in without touching
  the rest of the app. *Do this before any other phase.*

**Deliverable:** Settings tab, bias slider, anchor-point markers, storage
interface. Same model, but tunable and ready to grow.

---

## Phase 1 — Atmospheric inputs and density correction (1 day) [done]

The single biggest accuracy win. Air density swings altitude ±3-5% across
typical TARC weather (cold morning vs. warm afternoon, sea level vs. Virginia
finals at ~600 ft launch elevation).

### Variables to collect (new "Conditions" tab)

| Field | Units | Source |
|-------|-------|--------|
| Temperature | °F or °C | Phone weather app or pad thermometer |
| Barometric pressure | inHg or hPa | Phone weather app (sea-level corrected) or onsite |
| Relative humidity | % | Phone weather app |
| Field elevation | ft | One-time per launch site |
| Wind speed | mph | Anemometer |
| Wind direction relative to rod | deg (0 = headwind) | Compass + rod azimuth |

### Formulas

```
ρ = P / (R_eff · T)
R_eff ≈ 287.05 · (1 + 0.378·e/P)        # humid-air correction
e     = RH · 611.3 · exp(19.854 − 5423/T)  # saturation vapor pressure
```

(see `00-background-physics.md` and `05-atmosphere.md` in the OpenRocket notes)

Reference density at calibration day: store `ρ_cal` once when the table was
last validated. Then for today:

```
altitude_today ≈ altitude_table · (ρ_cal / ρ_today)
```

(coast-phase-only first-order rule; good to ~1% for our regime).

To recover the **target altitude** at today's density, the coach should use a
*heavier* rocket on a thin-air day:

```
mass_today = mass_table + (∂mass/∂altitude) · (altitude_table − target)
```

`∂mass/∂altitude` is already implicit in the calibration table slope
(≈ −0.6 g/ft from the 725→775 segment).

### App changes
- New **Conditions** tab with the six inputs above.
- "Today's density: 1.187 kg/m³ (8% lower than calibration)" status banner.
- Recommended-weight output blends table lookup + density correction.
- Persist last-used conditions via the storage interface.

### Field connectivity — weather API integration

Online (parking lot, hotspot, morning-of):
- "**Pull weather**" button calls a free API (e.g.,
  [Open-Meteo](https://open-meteo.com), no API key, CORS-friendly) using the
  field's lat/lon. Pre-fills temp, pressure, humidity, wind speed, wind
  direction.
- Cache the response in storage with timestamp. If stale > 30 min, button
  shows "Refresh".

Offline (at the pad):
- All fields editable by hand; no network call needed.
- The single-file `dist-single` build keeps working unchanged — the API
  client must `try/catch` and silently fall back to manual entry.
- "Last fetched: 8:42 AM" badge so the coach knows the cached data's age.

**Deliverable:** Density-corrected weight recommendation, visibly cited
("table says 614 g, density says +6 g, recommend **620 g**").

---

## Phase 2 — Physics-based descent / parachute model (1 day) [done]

Replace the rubber-band linear interpolation with a real terminal-velocity
solver. This means: when the team changes the chute, swaps in a backup, or
adds a spill-hole, the app keeps working without re-calibration.

### Variables to collect (one-time per chute)

| Field | Default for our 20.5" with spill hole |
|-------|---------------------------------------|
| Chute diameter (in) | 20.5 |
| Spill-hole diameter (in) | (measure it) |
| Material C_D | 0.75 (flat round nylon) |
| Effective C_D · A | computed |

### Formulas

```
A_full   = π · (d_chute/2)²
A_hole   = π · (d_hole/2)²
A_eff    = A_full − A_hole          # geometric area minus spill
C_D_A    = C_D · A_eff              # the one number that matters for descent
v_term   = √( 2·m·g / (ρ · C_D_A) )
t_descent ≈ h_apogee / v_term       # ignoring opening transient
total_time ≈ t_boost + t_coast + t_descent
```

For F63-10R + ~620 g rocket: t_boost ≈ 1 s, t_coast ≈ 7 s ⇒ 36–39 s window
implies v_term ≈ 19–22 ft/s ⇒ A_eff ≈ 0.20–0.25 m².

### Calibrate the rubber-band → A_eff mapping

The rubber band tightens the chute, effectively shrinking its open diameter.
We don't have a first-principles formula for this. Plan:
1. From the existing table (`14 cm @ 725 ft baseline → 26 cm @ 775 ft`), back
   out the implied A_eff at each rubber-band setting using the descent time.
2. Fit a 1-D curve `A_eff = f(rubber_band_cm)`.
3. From now on, the recommendation is:
   - target descent time ⇒ required `v_term`
   - required `v_term` + today's mass + today's ρ ⇒ required `A_eff`
   - required `A_eff` ⇒ rubber-band cm via `f⁻¹`

### App changes
- Add chute config (one row, edited in Settings).
- Replace `linearInterp(725..775)` rubber-band logic with the inverse-solver.
- Show predicted descent time and total flight time.

**Deliverable:** Rubber-band recommendation that's solved from physics, not
hardcoded. Switching chutes only requires updating one config row.

---

## Phase 3 — Flight log + regression-based calibration tuner (2 days) [done]

Turn the calibration table from a fixed asset into something that learns from
every flight.

### Variables to collect (per flight log entry)

The `Flight` type already lists most of these — wire them all up:

| Required | Optional | Auto-computed |
|----------|----------|---------------|
| Date/time | Notes | `ρ` (from Conditions) |
| Target altitude | Wind direction | Score (already exists) |
| Actual altitude (Jolly Logic) | Egg/payload OK? | Diagnoses (already exists) |
| Total time | | Δaltitude (predicted − actual) |
| Apogee time | | Δtime |
| Descent time | | |
| Liftoff mass (g) | | |
| Rubber-band setting (cm) | | |
| Motor lot/batch (string) | | |
| Wind speed | | |
| Temp / pressure / humidity | | |
| Rod angle | | |

### Regression model

Linear least-squares with chosen features, refit every time a flight is
logged. Predicting altitude from controllables + conditions:

```
altitude = β₀
         + β₁ · mass
         + β₂ · ρ
         + β₃ · v_wind
         + β₄ · v_wind²
         + β₅ · rod_angle
         + β₆ · (mass · ρ)            # interaction
```

Same form for descent time, with `rubber_band_cm` and `mass / ρ` as features.

`mathjs` (already in node_modules?) or a 50-line normal-equations solver is
enough — we won't have more than ~30 flights across a season.

### Outputs
- **Calibration trust meter:** "Model fit RMS = ±6.2 ft over 11 flights" with
  green/yellow/red bands.
- **What-if slider:** drag a mass/rubber-band slider, see predicted altitude
  + descent time update live with confidence band.
- **Recommended setup:** automatically picks the (mass, rubber-band) that
  minimizes predicted distance from target.
- **Suspicious-flight flag:** if a logged flight is >2σ from prediction,
  highlight it (likely motor anomaly or measurement error).

### Storage
- All flights persisted via the storage interface from Phase 0.
  `localStorage` today, SQLite later — same call sites.
- "Export season" → CSV download for post-season review.
- "Import season" → upload CSV (recovery / device migration).
- **Seed the regression with the 7-8 real anchor flights** that produced
  the original calibration table. Coach enters them once via "Import
  baseline flights"; thereafter, the regression is a real measurement-driven
  model rather than a fit to AI-generated points.

### Anchor flights data captured

Required per flight (now in the regression seed):

| Field | Why needed |
|-------|------------|
| Date | Sanity / ordering |
| Liftoff mass (g) | Primary input |
| Rubber-band setting (cm) | Primary input |
| Motor lot (if known) | Lot bias check |
| Measured altitude (ft) | Primary output |
| Total flight time (s) | Primary output |
| Descent time (s) — if Jolly Logic captured it | Decoupled descent fit |
| Wind speed at launch (mph) | Wind term |
| Temp / pressure / humidity (best estimate) | Density term |

Missing atmospheric values for old flights are backfilled from Open-Meteo's
historical archive at home field's lat/lon.

**Deliverable:** Flight Log tab; calibration improves automatically as the
season progresses. Eventually the regression replaces the calibration table
as the source of truth — the table becomes a fallback for "no flights logged
yet" cold-start.

---

## Phase 4 — Physics-based altitude predictor (2 days) [done]

For sanity-checking the regression, especially early-season when there's only
1–2 logged flights and the regression is overfit. Also lets the app handle
"what if we tried motor X" or "what if we shaved 10 g off?".

### Boost phase (numerical, ~50 lines)

```
m(t)   = m_0 − m_prop · (t / t_burn)            # F63: m_prop ≈ 28 g, t_burn ≈ 1 s
F_thrust(t) = F_avg                              # F63: avg ≈ 63 N (refine with curve later)
F_drag = ½ · ρ · v² · C_D · A_ref
a      = (F_thrust − F_drag − m·g) / m
       
v(t+dt) = v(t) + a·dt
h(t+dt) = h(t) + v·dt
```

Step `dt = 0.01 s` until `t = t_burn`. Captures `v_burnout` and `h_burnout`.

### Coast phase (closed form)

For drag in form `F_d = ½ρv²·C_D·A`:

```
k = ρ · C_D · A_ref / (2·m)
h_coast = (1/(2k)) · ln(1 + k·v_burnout² / g)
h_apogee = h_burnout + h_coast
t_coast = (1/√(g·k)) · atan(v_burnout · √(k/g))
```

(See `01-aerodynamics-drag.md` and `07-simulation-integration.md` for the
underlying force model.)

### Drag coefficient

`C_D` for our rocket isn't known a priori. Strategy:
- Initialize `C_D = 0.55` (typical TARC airframe).
- After Phase 3 has a few flights, **back-fit `C_D`** so the integrator
  matches measured altitudes. One free parameter, easy fit.
- Once fit, the integrator is the most predictive tool we have for
  off-calibration scenarios (different mass / motor / day).

### Wind-loss correction

Weathercocking: the rocket tilts into the wind during boost, lowering apogee.
Empirical TARC rule of thumb (refine from log):

```
Δh_wind ≈ −k_w · v_wind²       # k_w ≈ 0.3–0.6 ft/(mph²) for stable rockets
```

Drift (for recovery & safety):

```
drift ≈ v_wind · t_descent
```

### App changes
- New "Predict" view: enter mass + rubber-band + today's conditions → see
  altitude/time prediction from BOTH the regression and the integrator.
  Disagreement is informative.
- "What-if motor" mode (post-season exploration only — finals use F63).

**Deliverable:** Physics simulator that doesn't need any flight data to make
a first-cut prediction. Stays useful when conditions move outside the
calibration table's range.

---

## Phase 5 — Wire diagnostics to conditions (1 day) [done]

The existing `analysis.ts` already has the structure (boost/coast/descent
diagnoses with physics reasoning). Currently it only sees altitude and time.
Make it see *why*:

- "Flew 18 ft low. Air density was 6% higher than calibration. Recommend
  +4 g for next flight, or wait for the warmer afternoon slot."
- "Descent was 2 s short. Wind was 14 mph; downwind drift was likely
  ~310 ft. Consider tightening the rubber band one notch (more spill)."
- "Flight altitude variance over last 3 flights is ±22 ft, far above the
  ±8 ft fit RMS. Suspect motor lot inconsistency — check batch numbers."

### App changes
- `diagnoseFlight` takes the full flight + condition record, not just
  altitude/time.
- New diagnoses: density mismatch, motor anomaly, rod-angle effect,
  rubber-band drift.
- "Coach's notebook" view: chronological diagnoses across the season.

**Deliverable:** Each flight comes with not just a score but an actionable,
condition-aware explanation. This is the feature that turns the app from
"calculator" into "coach assistant".

---

## Phase 6 (stretch, post-finals) — Round-trip OpenRocket integration [done]

Long shot, only if time permits:

- Export the rocket's mass, CG, dimensions to an `.ork` file template.
- Use OpenRocket's CLI to run a high-fidelity sim with today's conditions
  for sanity-checking before a critical flight.
- Or: import OpenRocket-derived `C_D(M)` curve into Phase 4's integrator for
  better near-Mach behavior (probably overkill for F63 — we never go past
  M ≈ 0.5).

---

## Files that will change (rough map)

| Phase | File | Change |
|-------|------|--------|
| 0 | `src/types/index.ts` | Add `Settings` type, `source` flag on `CalibrationRow` |
| 0 | `src/services/storage/index.ts` *(new)* | Storage interface |
| 0 | `src/services/storage/localStorage.ts` *(new)* | First backend |
| 0 | `src/services/storage.ts` | Becomes a thin re-export shim |
| 0 | `src/data/calibration.ts` | Tag the 7-8 anchor rows as `measured` |
| 0 | `src/App.tsx` | Settings tab, anchor-point indicator, bias slider |
| 1 | `src/types/index.ts` | Add `Conditions` type |
| 1 | `src/services/atmosphere.ts` *(new)* | `ρ`, vapor-pressure formulas |
| 1 | `src/services/weather.ts` *(new)* | Open-Meteo client, offline fallback |
| 1 | `src/App.tsx` | Conditions tab, "Pull weather" button |
| 2 | `src/services/parachute.ts` *(new)* | Terminal-velocity solver |
| 2 | `src/data/calibration.ts` | Add chute config |
| 3 | `src/services/log.ts` *(new)* | Flight CRUD, CSV import/export |
| 3 | `src/services/regression.ts` *(new)* | Least-squares fit |
| 3 | `src/App.tsx` | Flight Log tab, What-if sliders |
| 4 | `src/services/simulator.ts` *(new)* | Boost+coast integrator |
| 4 | `src/App.tsx` | Predict tab |
| 5 | `src/services/analysis.ts` | Pass conditions through |

---

## Suggested order of work

```
Phase 0  → ½ day → ship   [done]
Phase 1  → 1 day → ship   [done]
Phase 2  → 1 day → ship   [done]
Phase 3  → 2 days → ship  [done]
Phase 4  → 2 days → ship  [done]
Phase 5  → 1 day → ship   [done]
                  ──────
                  ≈ 7.5 days of work
```

Each phase is independently shippable — every push leaves the app in a
working state for the field.

---

## Decisions captured

1. **Targets:** fully editable from day one (Phase 0 Settings tab). ✅
2. **Calibration source:** 7-8 real flights + AI fill-in. Phase 0 marks the
   real ones as anchors; Phase 3 imports those 7-8 as the regression seed
   instead of relying on the interpolated rows. ✅
3. **Field connectivity:** offline-first; opportunistic Open-Meteo fetch
   when online. Phase 1 includes both paths. ✅
4. **Storage:** one device today, SQLite later. Phase 0 introduces the
   storage interface so the swap is trivial. ✅
5. **Motor lot tracking:** team will record. `motorLot` field added in
   Phase 3; lot-bias diagnosis added in Phase 5. ✅
6. **Anchor flights data:** coach collected and provided; seeded into
   regression in Phase 3. ✅
7. **Launch fields:** home + finals coordinates captured in context block
   above; Phase 0 seeded both into Settings. ✅

---

# Modeling roadmap (next)

Forward-looking work for the **mass** and **rubber-band** recommendation
models. The current implementation in `services/regression.ts` plus
`services/atmosphere.ts` + `services/parachute.ts` is already the right
architecture for our data scale — this section is about *where to push next*,
not about replacing what works.

## Where we are today

Three layers feed every recommendation:

1. **Physics** (`atmosphere.ts`, `parachute.ts`) — humid-air density, terminal
   velocity, descent time. Closed-form, zero data needed.
2. **Physics-informed linear regression** (`regression.ts`) — OLS on
   physically-motivated features:
   - Altitude: `[mass, ρ, v_wind, v_wind², rod_angle, mass·ρ]`
   - Descent: `[rubber_band, mass/ρ, mass]`
   - Falls back to leaner feature sets when `n < k + 2`.
3. **Bayesian shrinkage** (`shrinkRubberBandToNeighbors`) — pulls the linear
   prior toward the mean of nearby successful flights with a triangular
   kernel; blend weight = `n / (n + k)`.

### Why not "just a bigger ML model"

With ~30 flights/season, a tree ensemble or neural net has more parameters
than training points. It will memorize noise and give confident-wrong
predictions on a new day. The current 3–6 physics-derived linear features hit
the degrees-of-freedom sweet spot and stay **interpretable** — `analysis.ts`
can attribute a miss to density, wind, motor, or rod angle.

### Why not "pure physics"

Every closed-form formula has unmodelled effects: motor impulse variance, fin
alignment, surface roughness, wadding mass, chute folding. Pure physics is
consistently off by ~10–30 ft because the constants drift across the season.

The hybrid — physics features, learned coefficients — is the right shape.

---

## Step 1 — Uncertainty bands on recommendations (½ day)

Right now we emit a single recommended mass / rubber-band. The regression
already knows its training RMS (`LinearModel.rms`). Surface it:

> Recommend **618 g** (±9 g, 1σ — fit RMS over 14 flights)

**Why this first:** zero new modeling, immediate trust calibration for the
coach. The team can see when the model is confident vs. when it's guessing.

**Where:** extend `recommendedMassG` and `recommendedRubberBandCm` in
`regression.ts` to return `{ value, sigma }`. Render the band in the Setup
tab.

**Math:** for a linear model the prediction variance is
`σ² · (1 + xᵀ(XᵀX)⁻¹x)` where `x` is the new feature vector. We already
compute `(XᵀX)⁻¹` implicitly in `solveLinearSystem`; cache it on the model
struct.

---

## Step 2 — Add motor impulse as a feature (1 day, gated on data)

The single biggest unmodelled variable is motor batch variance. Phase 3
already added a `motorLot` field. Once we have ≥ 3 flights per lot:

- Compute a per-lot residual mean from the existing altitude regression.
- Either (a) add `motor_lot_offset` as a categorical feature (one-hot per
  lot), or (b) fit a hierarchical model with a lot-level random effect.
- (a) is fine until we have many lots; (b) only matters if we ever pool
  across seasons.

**Why second:** the physics is already perfect for what we model — the win
isn't fancier math, it's giving the regression a variable it currently can't
see.

---

## Step 3 — Calibrated drag coefficient (1 day)

Phase 4's boost+coast integrator has `C_D` as a free parameter. Back-fit
`C_D` from flight history. Use cases:

- **Out-of-envelope predictions.** Regression only interpolates; the
  integrator extrapolates correctly when the team tries a new target altitude
  or shaves mass aggressively.
- **Sanity check on the regression.** When integrator and regression
  disagree by > 2σ, *something is wrong* — bad data point or model drift.

The integrator becomes the "physics floor" and the regression the "empirical
correction layer." Same hybrid pattern, deeper.

---

## Step 4 — Gaussian Process regression (2 days, optional)

The natural upgrade from linear OLS *if* and *only if* linear hits its
accuracy ceiling. Reasons GP fits ARC's situation:

- **Small-n friendly.** Works with 10–30 points, unlike most ML.
- **Calibrated uncertainty out of the box** — replaces Step 1's manual band.
- **Physics as the mean function.** Set `μ(x) = boost_coast_integrator(x)`,
  let the GP learn the residual. Best of both worlds.
- **Nonlinear without overfitting** — RBF kernel + length scale prior
  controls complexity automatically.

**Cost:** ~100 lines hand-rolled, or pull in `ml-gaussian-process` from npm
(~30 KB). Adds dependency surface to the offline build, so weigh carefully.

**Decision rule:** ship this only after Steps 1–3 are deployed and the team
has logged ≥ 25 flights with motor-lot data. Until then linear OLS is fine.

---

## Step 5 — Hierarchical / cross-season pooling (post-finals)

If the team carries rockets forward across seasons, fit a multi-level model:

- Season-level intercept (captures rocket-build differences year to year).
- Flight-level features as today.
- Lot-level random effect from Step 2.

This is genuinely valuable only after 2+ seasons of data exist. Not a 2026
priority.

---

## What we are explicitly NOT doing

- **Random forest / XGBoost / neural net on flight features.** Overfits at
  n ≈ 30. The team would lose the "why" attribution in `analysis.ts`.
- **LLM-as-predictor.** No physical grounding, no uncertainty, no offline
  story.
- **Per-flight Kalman filtering across the season.** Overkill for a quantity
  that changes once per round.

---

## Files that would change (modeling roadmap)

| Step | File | Change |
|------|------|--------|
| 1 | `services/regression.ts` | Return `{ value, sigma }`; cache `(XᵀX)⁻¹` on `LinearModel` |
| 1 | `App.tsx` (Setup tab) | Render ±σ band on mass / rubber-band recommendation |
| 2 | `services/regression.ts` | Add lot-level feature(s) once `motorLot` data is rich enough |
| 3 | `services/simulator.ts` | Cross-check against integrator; flag disagreements |
| 3 | `services/regression.ts` | Back-fit `C_D` against integrator residuals |
| 4 | `services/gp.ts` *(new, optional)* | GP regression with physics mean function |

---

## Decision summary

**Keep the current architecture.** It is the right answer for this data
scale. The wins are in (a) surfacing uncertainty, (b) adding physically
meaningful features the regression can't currently see (motor lot, drag
coefficient), and (c) cross-validating against a physics integrator. Reach
for nonlinear / Bayesian models only after those are in place.
