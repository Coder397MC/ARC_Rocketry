# American Rocketry Challenge 2027 — Official Rules (key points)

> Transcribed from the ARC 2027 rules sheet (`C:\Users\lhp62\Downloads\ARC2027.png`).
> This is the authoritative in-repo source for the season's target altitudes,
> duration window, mass/length limits, and deadlines. If anything here ever
> conflicts with the official ARC rulebook, the official rulebook wins.

## Key dates
- Registration opens: **June 2026**.
- Registration deadline: **December 6, 2026**.
- No limit on the number of teams.
- Qualification flight deadline: **April 4, 2027**.
- National Finals: **May 15, 2027** at Great Meadow.

## Team
- At least **three**, no more than **ten** students, grades **6–12**, from a US
  school or host organization (national youth organization, incorporated
  youth-focused non-profit, or incorporated homeschool association).

## Rocket limits
- Overall length: **≥ 650 mm**.
- Liftoff weight (with rocket motor): **≤ 650 g**.
- **Single-staged.**
- Total impulse: **≤ 80 N·s** combined, ARC-approved model rocket motors only.
  - **Note:** a number of AeroTech motors were recently discontinued by the
    manufacturer — including all those using the **24/40 reloadable casing** —
    and have been removed from the 2027 ARC-approved list.
  - **Team's 2027 motor: AeroTech F51-10R** (2026 was the F63-10R). It is the
    default motor in the app (`src/data/motors.ts`). Confirm it's on the 2027
    approved list and verify its data-sheet specs (total impulse, propellant
    mass) before finals; the app currently carries nominal values (avg thrust
    ≈ 51 N, total impulse ≈ 55 N·s).
- Airframe: at least **two different-diameter body tubes**. One must be a
  **12-inch or greater length of T-80 tube (66 mm diameter)**. All others must
  be **at least 10 mm different** (larger or smaller) in external diameter.

## Recovery
- One or more parachutes; **all parts of the rocket must remain tethered
  together** during recovery.

## Payload
- **Two large eggs, 55–63 g** each, carried in any orientation.

## Targets — the part that drives this app

| | Altitude target | Duration target |
|---|---|---|
| **Qualification** | **800 ft — fixed**, measured by an ARC-approved altimeter | **37–40 s** |
| **National Finals** | **775–825 ft** — i.e. qualification height **± 25 ft**; announced at the event, and **explicitly never exactly 800 ft** | **37–40 s** |

**The key distinction:** qualification is a **single fixed altitude (800 ft)**.
Finals is a **band** — the target lands somewhere in **775–825 ft (800 ± 25)**
and is announced morning-of, never exactly 800. The **duration window is the
same 37–40 s** for both qualification and finals.

Implication for practice: don't tune the rocket to hit 800 ft on the nose and
stop. Build and calibrate so you can confidently retarget anywhere in
**775–825 ft** on finals morning with a small mass/ballast change.
