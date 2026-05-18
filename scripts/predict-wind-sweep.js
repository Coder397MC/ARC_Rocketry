// One-shot wind-sweep predictor. Paste into DevTools console at
// http://localhost:5173/ARC_Rocketry/ . Pulls flights from the app's
// live sql.js DB via Vite dynamic imports, then reproduces the Setup
// tab math (App.tsx:290-354) for two scenarios across wind 0-12 mph.
//
// Edit the `scenarios` array at the bottom to change date/target/conditions.
(async () => {
  // ---------- pull live data from the running app ----------
  // Vite dev server serves under base /ARC_Rocketry/ (vite.config.ts:10),
  // so source files live at /ARC_Rocketry/src/... not /src/...
  const BASE = '/ARC_Rocketry';
  const sqliteDB = await import(`${BASE}/src/services/db/sqliteDB.ts`);
  const flightsRepoMod = await import(`${BASE}/src/services/db/flightsRepo.ts`);
  const storageMod = await import(`${BASE}/src/services/storage.ts`);
  await sqliteDB.initDB();
  const flights = flightsRepoMod.FlightsRepo.list();
  const calib = storageMod.StorageService.getCalibration();
  const settings = storageMod.StorageService.getSettings() ?? {};
  const altBias = settings.altitudeBiasFt ?? 0;
  const rhoRef = settings.referenceDensityKgM3 ?? 1.225;

  if (!calib || !calib.length) {
    console.error('No calibration table loaded. Open Settings tab once to seed defaults, then retry.');
    return;
  }
  console.log(`Loaded ${flights.length} flights. altBias=${altBias} ft, refDensity=${rhoRef} kg/m³`);

  // ---------- physics (mirrors services/atmosphere.ts) ----------
  const R_DRY = 287.05, R_VAPOR = 461.495, HPA_TO_PA = 100;
  const satVP = (tC) => 611.3 * Math.exp(19.854 - 5423 / (tC + 273.15));
  const airDensity = (tC, pHpa, rhPct) => {
    const T = tC + 273.15, P = pHpa * HPA_TO_PA;
    const rh = Math.max(0, Math.min(1, rhPct / 100));
    const e = rh * satVP(tC);
    return (P - e) / (R_DRY * T) + e / (R_VAPOR * T);
  };
  const densityNudge = (tgtFt, rho, rhoRef, slope = 0.6) =>
    rho <= 0 ? 0 : tgtFt * (rhoRef / rho - 1) * slope;

  // ---------- regression (mirrors services/regression.ts) ----------
  const solve = (A, b) => {
    const k = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let i = 0; i < k; i++) {
      let p = i;
      for (let r = i + 1; r < k; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      if (p !== i) [M[i], M[p]] = [M[p], M[i]];
      if (Math.abs(M[i][i]) < 1e-12) return null;
      const d = M[i][i];
      for (let c = i; c <= k; c++) M[i][c] /= d;
      for (let r = 0; r < k; r++) {
        if (r === i) continue;
        const f = M[r][i]; if (f === 0) continue;
        for (let c = i; c <= k; c++) M[r][c] -= f * M[i][c];
      }
    }
    return M.map(r => r[k]);
  };
  const fitLinear = (rows, names) => {
    const n = rows.length, k = names.length + 1;
    if (n < k) return null;
    const X = rows.map(r => [1, ...r.features]), y = rows.map(r => r.y);
    const XtX = Array.from({ length: k }, () => Array(k).fill(0));
    const Xty = Array(k).fill(0);
    for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
    const beta = solve(XtX, Xty); if (!beta) return null;
    let sse = 0;
    rows.forEach((r, i) => {
      const yh = beta[0] + r.features.reduce((s, v, j) => s + v * beta[j + 1], 0);
      sse += (yh - y[i]) ** 2;
    });
    return { beta, featureNames: names, rms: Math.sqrt(sse / n), n, k };
  };
  const flightFeatures = (f) => {
    const massKg = f.rocketMass / 1000;
    const tC = f.tempC ?? f.temp;
    const pHpa = f.pressureHpa;
    const rhPct = f.humidityPct ?? f.humidity;
    const hasW = typeof tC === 'number' && typeof pHpa === 'number' && typeof rhPct === 'number';
    const rho = hasW ? airDensity(tC, pHpa, rhPct) : 1.225;
    return { massKg, rho, vWindMph: f.windSpeedMph ?? 0, rodAngleDeg: f.rodAngleDeg ?? 0 };
  };
  const fitAltitudeModel = (flights) => {
    const rows = flights.map(f => {
      const ff = flightFeatures(f); if (!ff) return null;
      return { features: [ff.massKg, ff.rho, ff.vWindMph, ff.vWindMph ** 2, ff.rodAngleDeg, ff.massKg * ff.rho], y: f.altitude };
    }).filter(Boolean);
    if (!rows.length) return null;
    const full = fitLinear(rows, ['mass_kg','rho','v_wind','v_wind_sq','rod_angle','mass_x_rho']);
    if (full && full.n >= full.k + 2) return full;
    const lean = rows.map(r => ({ features: r.features.slice(0,3), y: r.y }));
    const leanM = fitLinear(lean, ['mass_kg','rho','v_wind']);
    if (leanM && leanM.n >= leanM.k + 2) return leanM;
    return fitLinear(rows.map(r => ({ features: [r.features[0]], y: r.y })), ['mass_kg']);
  };
  const recMass = (model, tgtFt, rho, vWind, rodA) => {
    const iM = model.featureNames.indexOf('mass_kg'); if (iM < 0) return null;
    const iR = model.featureNames.indexOf('rho');
    const iV = model.featureNames.indexOf('v_wind');
    const iV2 = model.featureNames.indexOf('v_wind_sq');
    const iA = model.featureNames.indexOf('rod_angle');
    const iMR = model.featureNames.indexOf('mass_x_rho');
    let c = model.beta[0];
    if (iR >= 0) c += model.beta[iR+1] * rho;
    if (iV >= 0) c += model.beta[iV+1] * vWind;
    if (iV2 >= 0) c += model.beta[iV2+1] * vWind * vWind;
    if (iA >= 0) c += model.beta[iA+1] * rodA;
    let mC = model.beta[iM+1];
    if (iMR >= 0) mC += model.beta[iMR+1] * rho;
    if (Math.abs(mC) < 1e-9) return null;
    return ((tgtFt - c) / mC) * 1000;
  };
  const shrinkRb = (flights, tgtFt, prior, altWin=25, succWin=15, k=2) => {
    let wSum = 0, wRbSum = 0;
    for (const f of flights) {
      if (typeof f.rubberBandCm !== 'number' || f.rubberBandCm <= 0) continue;
      if (typeof f.targetAltitude !== 'number' || typeof f.altitude !== 'number') continue;
      if (Math.abs(f.altitude - f.targetAltitude) > succWin) continue;
      const d = Math.abs(f.targetAltitude - tgtFt);
      const w = Math.max(0, 1 - d / altWin);
      if (w <= 0) continue;
      wSum += w; wRbSum += w * f.rubberBandCm;
    }
    if (wSum === 0) return prior;
    const mean = wRbSum / wSum, blend = wSum / (wSum + k);
    return blend * mean + (1 - blend) * prior;
  };

  const model = fitAltitudeModel(flights);
  if (model) console.log(`Regression: n=${model.n}, k=${model.k}, RMS=${model.rms.toFixed(1)} ft, [${model.featureNames}]`);
  else console.log('No regression model — calibration table only.');

  // ---------- one-row predictor (mirrors App.tsx:290-354) ----------
  const predict = (target, tC, pHpa, rhPct, vWind, rodA = 0) => {
    const rho = airDensity(tC, pHpa, rhPct);
    const row = calib.find(r => r.targetHeight === target);
    if (!row) return { mass_g: '—', rubber_band_cm: '—', source: 'no-cal-row', rho_kgm3: rho.toFixed(3) };
    const slope = -0.6, biasM = altBias * slope;
    const dNudge = densityNudge(target, rho, rhoRef);
    let weight = row.requiredWeight - vWind - biasM + dNudge;
    let source = 'table';
    if (model && model.n >= 4) {
      const rm = recMass(model, target, rho, vWind, rodA);
      if (rm && isFinite(rm) && rm > 300 && rm < 1200) {
        weight = rm + dNudge; source = 'regression';
      }
    }
    const CALIB_WIND = 5, RB_PER_REL_AREA = 14.4;
    const base = 14 + ((target - 725) * (26 - 14)) / (775 - 725) - 0.4 * CALIB_WIND;
    const refMass = row.requiredWeight;
    const relRho = rhoRef > 0 ? rho / rhoRef - 1 : 0;
    const relM = refMass > 0 ? weight / refMass - 1 : 0;
    const tempRb = -RB_PER_REL_AREA * (relM - relRho);
    const priorRb = base + 0.4 * vWind + tempRb;
    const rb = shrinkRb(flights, target, priorRb);
    return { mass_g: Math.round(weight), rubber_band_cm: Math.round(rb * 10) / 10, source };
  };

  // ---------- plain-text table printer (no (index), no extras) ----------
  const printTable = (rows) => {
    const cols = ['wind_mph', 'mass_g', 'rubber_band_cm', 'source'];
    const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c]).length)));
    const fmt = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
    console.log(fmt(cols));
    console.log(widths.map(w => '-'.repeat(w)).join('  '));
    for (const r of rows) console.log(fmt(cols.map(c => r[c])));
  };

  // Tomorrow at The Plains, VA. Temps in °C. Edit as needed.
  const scenarios = [
    { name: 'MORNING ~9-10 AM, target 730 ft', target: 730, tC: 20.0, pHpa: 998, rhPct: 46 },
    { name: 'AFTERNOON ~3 PM, target 725 ft',  target: 725, tC: 28.6, pHpa: 995, rhPct: 32 },
  ];
  for (const s of scenarios) {
    const rows = [];
    for (let v = 0; v <= 12; v++) rows.push({ wind_mph: v, ...predict(s.target, s.tC, s.pHpa, s.rhPct, v) });
    console.log(`\n=== ${s.name}  (${s.tC}°C / ${s.pHpa} hPa / ${s.rhPct}% RH) ===`);
    printTable(rows);
  }
})();
