# 2026 TARC Finals — Lessons Learned

> Written by [coach name] shortly after the May 2026 TARC finals at The Plains, VA.
> Purpose: capture what happened, what we think it meant, and what we are changing
> before 2027. Re-read this before the next season starts.

---

## 1. The day at a glance

We flew two scored attempts at the 2026 TARC finals on **2026-05-16** at The Plains, VA. The morning launch went almost exactly to the model's prediction; the afternoon launch underperformed badly. The day exposed real gaps in our motor-handling protocol and in the wind correction inside our app's model — both of which we are addressing before next season.

[fill in: who was on the team, who was the timer, who was on the pad, any pre-event rocket changes since the last practice.]

## 2. Flight record

| | **Launch 1 (AM)** | **Launch 2 (PM, ~2:30)** |
|---|---|---|
| Target altitude | 730 ft | 725 ft |
| Actual altitude | 722 ft | 673 ft |
| Apogee miss | −8 ft | **−52 ft** |
| Duration | 34 s | 24 s |
| Duration window (36–39 s) | 2 s short | **12 s short** |
| Mass flown | 632 g | 638 g |
| Reef (rubber band) | 14 cm | 11 cm |
| Ambient temp | 63 °F | 83 °F |
| Wind | 3 mph | 8 mph |
| Motor lot | [fill in] | [fill in] |
| Notable observations | nothing unusual | **3 of 5 observers saw double ignition**; motor had been in direct sun for ~1 hour pre-launch |

Rod was vertical on both flights. No early ejection was observed on either.

[fill in: phone video / camera links if any.]

## 3. What worked

- **Launch 1 matched the model to within 2 ft of prediction**, confirming that the app's mass+density calibration is solid for normal conditions.
- The app's recommended weight and reef values for Launch 1 (~14 cm reef, ~625 g weight after density correction for cool air) were what we set; the rocket behaved as predicted. We did not have to second-guess the model in the morning.
- We carried the same setup discipline from practice into finals — weighing post-prep, reading conditions off the app, logging the flight in real time. That discipline is what made it possible to reconstruct exactly what happened in the afternoon.
- [fill in: anything else the team did well — recovery, range procedure, etc.]

## 4. What didn't work

- **Launch 2 missed apogee by 52 ft and missed the duration window by 12 s.** Two anomalies in one flight; both bigger than anything seen in practice this season.
- **Motor was in direct sun for approximately one hour before Launch 2.** We had no protocol for managing motor temperature at the field. Ambient air was 83 °F; the motor case was almost certainly 95–105 °F by ignition.
- **Three of five observers reported a "double ignition"** on Launch 2's motor. Two did not. We have no video to settle it.
- **No motor temperature recorded.** We didn't have an IR thermometer at the field, and the app had no field for motor temp at the time.
- **No motor lot logging discipline.** We don't know whether the two flights came from the same lot, which means we cannot quarantine a specific lot even if we wanted to.

## 5. Root cause analysis

We don't think Launch 2 has a single root cause. The honest reading is "multiple plausible factors lined up in the same direction." Below, each candidate with the evidence for, against, and our current confidence.

### Candidate A: Motor anomaly (double-ignition / staged pop) — **confidence: medium-high**
- **For:** 3 of 5 observers saw it; motor had been in direct sun (a known trigger for latent grain defects to open up under heat); the 75 ft shortfall from the model's prediction (~748 ft predicted vs. 673 ft actual) is consistent with a 5–15% impulse loss from a staged burn.
- **Against:** 2 observers did *not* see it; no video confirmation; we cannot inspect the spent motor.

### Candidate B: Heat-shortened delay grain → early ejection — **confidence: low**
- **For:** Hot motor; delay grains do shorten with temperature.
- **Against:** No observer reported early ejection; the chute appeared at altitude; no zipper or shock cord damage on recovery.

### Candidate C: Wind correction in the app is under-tuned — **confidence: medium**
- **For:** The app's table formula subtracts only −1 g per mph of wind, which is a linear approximation; real weathercocking force scales with v² and the literature suggests 3–6 ft of apogee loss per mph above ~5 mph. At 8 mph the model probably under-credits wind by 15–30 g of equivalent mass. The regression layer would normally absorb this, but most of our training flights are at low wind, so the v² coefficient is poorly fit. The high-wind warning banner in the Setup tab did fire for this flight.
- **Against:** Wind correction error alone cannot explain the *full* 75 ft shortfall — that would require a wind sensitivity coefficient (k ≈ 5 g/mph²) well above the literature range.

### Most likely combined story
A latent defect in the motor (manufacturing variation) was triggered by the hour of sun exposure, producing a staged pop that took 30–50 ft off the apogee. The model's gentle wind correction took an additional 15–30 ft. Together, that lands at roughly the 75 ft we lost. Neither factor alone is fully sufficient; together they fit.

We will likely never be able to fully separate these two contributors for *this* flight. But we can prevent both from happening again.

## 6. Process gaps exposed

1. **No motor temperature monitoring.** We had no thermometer and no app field. We made a thermal mistake without realizing it.
2. **No motor lot logging.** Even if we had wanted to quarantine a bad lot, we couldn't have. The app had a `motorLot` field but we weren't filling it in.
3. **Observer reports were inconsistent on the most important detail of the flight.** Five people, two different stories about whether the motor double-ignited. We need video as ground truth on every flight from now on.
4. **No way to flag a flight as anomalous in the regression.** L2's data, if added to the model as-is, will incorrectly teach it that hot conditions need much more mass than they actually do. We need a "this flight was hardware-faulted, exclude from training" flag.
5. **No pre-flight checklist.** Motor temperature, igniter check, lot recorded — none of these were prompted before we marked ourselves ready.

## 7. Changes already made in response

In the days following finals, we made these changes to the app and to our documentation:

- **Added `motorTempF` field** to the Flight record (DB + UI). The Setup tab now displays a yellow warning banner when motor temperature is missing or above 75 °F.
- **Added inline edit** for flight log entries so we can backfill motor temp on existing flights and mark anomalies retroactively.
- **Documented motor handling protocol** in `CLAUDE.md` — temperature ranges, cooler-with-bagged-motors technique for hot days, hand-warmer technique for cold days, and links to the underlying physics (Apogee Components newsletter #283).
- **Saved a per-event memory** under "2026-05-16 TARC Finals" in `CLAUDE.md` so future-coach (or future-Claude) re-reads the L2 context the next time anomalous flight data comes up.

## 8. Open questions for next season

These are things we still don't know and cannot answer without more data:

- **What is the true value of the wind sensitivity coefficient `k`** for our rocket? Literature puts it in the range 0.5–1.7 g/mph². Our model effectively assumes much less. We need a controlled experiment.
- **Was Launch 2's motor genuinely defective**, or was it a normal motor whose performance was degraded only by the heat? This is unfortunately not answerable after the fact.
- **What's the right motor source / lot management strategy** for finals? Buying all motors in one lot vs. spreading across lots is a real trade-off and we haven't decided.
- **Should we have a backup rocket configuration** for hot-windy days (different motor, different reef strategy)?

## 9. Action items before 2027 finals

### Field equipment ($35 total)
- [ ] Buy a small insulated soft cooler
- [ ] Buy 2 reusable ice packs
- [ ] Buy an IR thermometer
- [ ] Buy 1 box of food-storage zip-top bags

### Process discipline (no cost, just habit)
- [ ] Log motor lot number on every practice flight starting next session
- [ ] Take phone video of every flight (mounted, not handheld) for ground-truth review
- [ ] Pre-flight checklist: motor temp ≤ 75 °F, lot recorded, igniter continuity, rod angle ≤ 3°
- [ ] Cool motors in cooler from ~30 min before launch until ~10 min before launch

### Engineering changes to the app (talk to whoever maintains it)
- [ ] Add `motorAnomaly` boolean flag on Flight + UI toggle in the edit panel + regression exclusion
- [ ] Replace the table wind formula with `−k · max(0, v − 5)²` (start with k = 1.0, tune from data)
- [ ] Expose the fitted regression coefficients (`β_v_wind`, `β_v_wind_sq`) in the Setup tab so we can watch them stabilize as flight count grows
- [ ] Add a pre-flight checklist UI gate in Setup tab (motor temp confirmed, lot entered, igniter checked)

### Practice flights for calibration
- [ ] **Controlled wind experiment.** Two flights, same mass, same motor lot, ~5 mph apart in wind (e.g., 3 mph and 8 mph). Compare apogees, solve for `k`. Repeat once or twice for confidence.
- [ ] Build up the high-wind training dataset deliberately — fly on windy days, not only calm ones, so the regression has signal at 8+ mph.

---

## A note to whoever reads this next

The temptation when a competition flight goes wrong is to lock in a single explanation and "fix" it. We have resisted that. Launch 2 had at least two plausible contributing factors and we genuinely don't know the split. The right response is to **prevent both** rather than pretend we know which one mattered more. That's why the action items above are broad rather than narrow.

If, before next finals, the controlled wind experiment shows the model's wind correction is actually fine, then "motor heat" is the only remaining lever and our cooler protocol becomes the single most important change. If it shows the model is genuinely under-correcting wind by a lot, then we change `k` and re-run the regression. Either way, we'll know more than we know today — and we'll make the next decision from evidence, not guesswork.

[fill in: anything else the team wants future-us to remember.]
