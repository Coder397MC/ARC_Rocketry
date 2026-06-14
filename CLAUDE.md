# CLAUDE.md

Project context for Claude Code. Auto-loaded on any machine that clones this repo.

## User role

The user is the **coach** for the ARC Rocketry TARC team. They use the in-field app — they do not write the code themselves.

Implications:
- Planning docs in this repo should have a **coach-facing playbook** section (chronological, "do this on day X, type Y into the app"), not just a developer task list.
- When the user asks "what do I do" about a plan, they mean operationally — what to enter, when to fly, how to interpret the output. Not "what code to write."
- Engineering specifics (file paths, type diffs, migrations) belong in a separate section the coach can skip.
- Keep language concrete and grounded in the app's UI: "Settings tab → New rocket → enter mass" beats "extend `RocketConfig`."

When a doc reads too much like an engineering ticket and the coach pushes back with "I still don't understand what to do", the fix is to add a runbook from their perspective, not to add more engineering detail.

## 2027 TARC targets (American Rocketry Challenge 2027)

Full rules transcribed in `2027-rules.md`. The targets that drive this app:

- **Qualification altitude: 800 ft — fixed.** Duration **37–40 s**.
- **Finals altitude: 775–825 ft (qualification ± 25 ft), announced morning-of, never exactly 800 ft.** Duration **37–40 s**.
- Other limits: liftoff weight ≤ 650 g (incl. motor), overall length ≥ 650 mm, single-staged, ≤ 80 N·s total impulse, payload = two large eggs 55–63 g.

So **qualification is a single fixed altitude; finals is a ±25 ft band around it.** This is new for 2027 and differs from the 2026 numbers baked into the seeded calibration table (anchored 725–775 ft) and the rubber-band base formula. The app's *stored* Settings on the coach's device may still hold 2026 targets — for 2027, set **Target altitude = 800 ft** and the **time window = 37–40 s** on the Settings tab. `DEFAULT_SETTINGS` in `src/data/settings.ts` now seeds these 2027 values for fresh installs.

## Chute reef / rubber-band direction

The "rubber band cm" (a.k.a. reef / reel) value in the app means the amount the chute's bottom is pulled up by the band. **Higher number = chute pulled up more = smaller effective area = faster descent.** Lower number = chute more open = bigger area = slower descent.

The code at `src/App.tsx:343` and the recommendation logic at `src/App.tsx:339-353` already encode this convention. The full recommendation factors in wind, mass, and density adjustments.

**Do not** extrapolate from the raw schedule `rb(target) = 14 + (target-725)*12/50` in `src/services/parachute.ts` and treat it as "the recommendation" — the live app's recommendation can differ by several cm. Never tell the coach "you set the wrong value" without first computing what the live app would have displayed for the actual conditions they faced.

Note: `parachute.ts:fitRubberBandToAEff` previously derived a *positive* (physically backwards) slope of A_eff vs. rb because it fabricated each anchor's rb from its target altitude via a fixed schedule, conflating altitude and rb. As of the 2026 season cleanup it instead fits A_eff against the **real logged `rubberBandCm`** of each flight, backing A_eff out of that flight's own apogee — so the slope is now negative (higher rb → smaller A_eff → faster descent), matching the physics above. It takes `Flight[]` now, not `CalibrationRow[]`, and skips `motorAnomaly` flights. (It is still not wired into the live recommendation path, which uses `shrinkRubberBandToNeighbors`; the fix is to a latent helper.)

## Motor temperature — operational rules

Composite motor (AeroTech F63-10R in 2026, **F51-10R for 2027**, and similar) performance is characterized at **70°F**. Outside ~60–80°F, performance shifts and failure modes appear. The temperature rules below apply to any composite reload/single-use motor, so they carry over to the 2027 F51-10R unchanged.

**Target range for flight:** 60–75°F motor case temperature. The Setup tab shows a yellow warning banner when `conditions.motorTempF` is missing or > 75°F.

**Why these failure modes matter:**

| Motor temp | Failure mode | Source |
|---|---|---|
| > 95°F | Latent grain cracks expand → **staged pop** / impulse loss (5–15%). Delay grain shortens → **early ejection**. | Sun exposure on pad, hot car, summer storage |
| < 35°F | Burn rate drops → **chuffing** / low thrust. Delay grain lengthens → **late ejection** → zipper risk. Grain becomes brittle → handling cracks. | Winter launches, unheated storage |
| 60–80°F | Nominal. Predictable thrust curve and delay timing. | Target this window |

**Field handling rules:**
1. Insulated soft cooler + reusable ice packs, motors sealed in zip-top bags (prevents condensation). Target interior ~65°F.
2. Pull motor 5–10 min before launch so it equilibrates close to ambient.
3. In winter (< 50°F ambient), warm motor in jacket pocket for 15–20 min before launch.
4. IR thermometer ($15) to verify before loading. Enter the reading in the Setup tab.

**Data field:** `Flight.motorTempF` (optional) — records the case temperature at flight time. Stored as Fahrenheit in DB column `motor_temp_f`. The Conditions object also has a transient `motorTempF` that flows into the new Flight on save.

**Reference:** Apogee Components Peak of Flight newsletter #283 ("How Temperature Affects Rocket Motors") for the underlying physics.

## 2026-05-16 TARC Finals — launch 2 motor anomaly

On 2026-05-16 (TARC finals), launch 2 underperformed by ~75 ft below the mass+density-corrected model prediction (predicted ~748 ft, actual 673 ft, target 725 ft). Conditions: 83°F, 8 mph wind, rod vertical, no early ejection. Coach set weight and rubber band per the app's live recommendation, so the miss is **not** a setup error.

**Witness observation:** 3 of 5 observers saw a "double ignition" event on the motor. Split observation, not conclusive but suggestive.

A double-ignition (delay grain re-burn, propellant void, or staged pop) can shave 5–10% off total impulse — consistent with the ~75 ft apogee shortfall — and can disrupt recovery deployment integrity, which would also explain the unusually fast 16 s descent.

**Implications for the regression model:** This flight is an outlier driven by hardware, not a calibration signal. It should not be fed into regression training as a normal data point. A `motorAnomaly` flag on the Flight record would let the regression skip flagged flights.

Launch 1 on the same day (target 730 / actual 722 / duration 34 s / 63°F / 3 mph) matched the model to within 2 ft and had no motor anomaly observed.
