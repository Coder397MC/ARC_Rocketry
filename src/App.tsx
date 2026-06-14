import { useState, useEffect, useRef, Fragment } from 'react';
import { Rocket, Play, Pause, RotateCcw, Star, Plus, Trash2, Cloud, RefreshCw } from 'lucide-react';
import { INITIAL_CALIBRATION_DATA } from './data/calibration';
import { DEFAULT_SETTINGS, DEFAULT_CONDITIONS, mergeSettings, mergeConditions } from './data/settings';
import type { CalibrationRow, Settings, LaunchField, Conditions, Flight } from './types';
import { StorageService } from './services/storage';
import { airDensityKgM3, densityMassCorrectionG, STANDARD_DENSITY_KG_M3 } from './services/atmosphere';
import { fetchCurrentWeather } from './services/weather';
import {
  chuteCDA,
  chuteEffectiveAreaM2,
  predictDescent,
} from './services/parachute';
import { FlightLog, bootFlightLog } from './services/flightLog';
import { APPROVED_MOTORS, offRodVelocityMph } from './data/motors';
import { pullFromTurso, pushToTurso, getLastPull, getLastPush } from './services/db/tursoSync';
import {
  fitAltitudeModel, recommendedMassG,
  suspiciousFlightIndices, flightFeatures, shrinkRubberBandToNeighbors,
} from './services/regression';
import { estimateWindK } from './services/windCalib';
import { diagnoseFlight } from './services/analysis';
import { cToF, fToC } from './services/units';
import { NumberInput } from './components/NumberInput';

type Tab = 'conditions' | 'setup' | 'timer' | 'checklist' | 'flights' | 'settings';

const CHECKLIST_ITEMS = [
  'write down the last record',
  'motor build',
  'set up altimeter',
  'set rubber band on parachute',
  'pack parachute',
  'weight adjust',
  'check playdole position',
  'check motor temp should between 60°F to 75°F',
  'ignitor setup',
  'bring sandpaper, paper, masking tape, backup ignitor',
];

export default function App() {
  const [tab, setTab] = useState<Tab>('conditions');
  const [data, setData] = useState<CalibrationRow[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [conditions, setConditions] = useState<Conditions>(DEFAULT_CONDITIONS);
  const [weatherStatus, setWeatherStatus] = useState<{ kind: 'idle' | 'loading' | 'error'; message?: string }>({ kind: 'idle' });
  const [flights, setFlights] = useState<Flight[]>([]);
  const [expandedFlightId, setExpandedFlightId] = useState<string | null>(null);
  const [editingFlightId, setEditingFlightId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Flight>>({});
  const [dbReady, setDbReady] = useState(false);
  const [tursoStatus, setTursoStatus] = useState<{ kind: 'idle' | 'busy' | 'error' | 'done'; message?: string }>({ kind: 'idle' });
  const [lastPull, setLastPull] = useState<string | null>(getLastPull());
  const [lastPush, setLastPush] = useState<string | null>(getLastPush());
  const [targetHeight, setTargetHeight] = useState('');

  // Timer
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(false);
  const startRef = useRef<number | null>(null);
  const baseRef = useRef(0);

  // Checklist
  const [checked, setChecked] = useState<boolean[]>(() => CHECKLIST_ITEMS.map(() => false));

  useEffect(() => {
    const loadedCal = StorageService.getCalibration();
    if (loadedCal && loadedCal.length > 0) {
      // Merge in any rows present in INITIAL_CALIBRATION_DATA but missing from
      // storage — keeps user edits while letting expansions of the seed table
      // (e.g. new target-altitude rows) propagate without nuking saved state.
      const existing = new Set(loadedCal.map(r => r.targetHeight));
      const missing = INITIAL_CALIBRATION_DATA.filter(r => !existing.has(r.targetHeight));
      if (missing.length > 0) {
        const merged = [...loadedCal, ...missing].sort((a, b) => a.targetHeight - b.targetHeight);
        setData(merged);
        StorageService.saveCalibration(merged);
      } else {
        setData(loadedCal);
      }
    } else {
      setData(INITIAL_CALIBRATION_DATA);
      StorageService.saveCalibration(INITIAL_CALIBRATION_DATA);
    }
    setSettings(mergeSettings(StorageService.getSettings()));
    setConditions(mergeConditions(StorageService.getConditions()));
    (async () => {
      try {
        if (navigator.storage?.persist) {
          try { await navigator.storage.persist(); } catch { /* ignore */ }
        }
        await bootFlightLog();
        setFlights(FlightLog.list());
      } catch (e) {
        console.error('DB init failed', e);
      } finally {
        setDbReady(true);
      }
    })();
  }, []);

  const COUNTDOWN_MS = 45 * 60 * 1000;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (startRef.current !== null) {
        const next = baseRef.current + (Date.now() - startRef.current);
        if (next >= COUNTDOWN_MS) {
          setElapsedMs(COUNTDOWN_MS);
          baseRef.current = COUNTDOWN_MS;
          startRef.current = null;
          setRunning(false);
        } else {
          setElapsedMs(next);
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  const persistSettings = (next: Settings) => {
    setSettings(next);
    StorageService.saveSettings(next);
  };

  const persistConditions = (next: Conditions) => {
    setConditions(next);
    StorageService.saveConditions(next);
  };

  const pullWeather = async () => {
    const field = settings.launchFields.find(f => f.id === settings.activeFieldId);
    if (!field) {
      setWeatherStatus({ kind: 'error', message: 'No active launch field selected.' });
      return;
    }
    setWeatherStatus({ kind: 'loading' });
    try {
      const snap = await fetchCurrentWeather(field.lat, field.lon);
      persistConditions({
        ...conditions,
        tempC: snap.tempC,
        pressureHpa: snap.pressureHpa,
        humidityPct: snap.humidityPct,
        windSpeedMph: snap.windSpeedMph,
        windDirectionDeg: snap.windDirectionDeg,
        fetchedAt: snap.fetchedAt,
        fetchedFor: field.id,
      });
      setWeatherStatus({ kind: 'idle' });
    } catch (e) {
      setWeatherStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Fetch failed (offline?)' });
    }
  };

  const startStop = () => {
    if (running) {
      if (startRef.current !== null) {
        baseRef.current += Date.now() - startRef.current;
      }
      startRef.current = null;
      setRunning(false);
    } else {
      startRef.current = Date.now();
      setRunning(true);
    }
  };

  const resetTimer = () => {
    setRunning(false);
    startRef.current = null;
    baseRef.current = 0;
    setElapsedMs(0);
  };

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const targetNum = parseFloat(targetHeight);
  const windNum = conditions.windSpeedMph;
  const hasTarget = !isNaN(targetNum);
  const hasWind = Number.isFinite(windNum);

  const todayDensity = airDensityKgM3(conditions.tempC, conditions.pressureHpa, conditions.humidityPct);
  const densityRatio = settings.referenceDensityKgM3 / todayDensity;

  const altitudeModel = fitAltitudeModel(flights);
  const suspicious = altitudeModel ? suspiciousFlightIndices(altitudeModel) : [];

  // New-rocket policy: never recommend from the seeded 2026 calibration table —
  // it belongs to a different airframe. Only predict once the regression has
  // trained on enough real flights for the current rocket. Below the threshold,
  // the Values tab tells the coach to log flights instead of showing a number.
  const FLIGHTS_NEEDED = 4;
  const usableFlightCount = flights.filter((f) => !f.motorAnomaly).length;
  const modelReady = altitudeModel !== null && altitudeModel.n >= FLIGHTS_NEEDED;

  // The model is fitted only on non-anomaly flights, so residuals[k]/suspicious
  // index k line up with the k-th NON-anomaly flight — not with flights[i].
  // Key them by flight id so the table can look them up without assuming
  // positional alignment with the full flights array.
  const residualById = new Map<string, number>();
  const suspiciousIds = new Set<string>();
  if (altitudeModel) {
    flights.filter((f) => !f.motorAnomaly).forEach((f, k) => {
      if (k < altitudeModel.residuals.length) residualById.set(f.id, altitudeModel.residuals[k]);
      if (suspicious.includes(k)) suspiciousIds.add(f.id);
    });
  }

  // Log a data-driven WIND_K_G suggestion whenever the model or flight set
  // changes. Tag any two flights with "#calib" in notes to force-pick them as
  // the calibration pair; otherwise the helper picks the best automatic pair
  // (same motor lot, similar mass, biggest wind gap).
  useEffect(() => {
    if (!altitudeModel) {
      console.log('[WIND_K_G estimate] skipped: regression model not yet fitted');
      return;
    }
    const idxMass = altitudeModel.featureNames.indexOf('mass_kg');
    if (idxMass < 0) {
      console.log('[WIND_K_G estimate] skipped: model has no mass coefficient');
      return;
    }
    const coefMassFtPerKg = altitudeModel.beta[idxMass + 1];
    const est = estimateWindK(flights, coefMassFtPerKg);
    if (!est) {
      const usable = flights.filter(
        (f) => typeof f.windSpeedMph === 'number' && typeof f.altitude === 'number',
      );
      const winds = usable.map((f) => (f.windSpeedMph ?? 0).toFixed(1)).join(', ');
      console.log(
        `[WIND_K_G estimate] no valid pair found among ${usable.length} flights. ` +
        `Need two flights with: same motorId, mass within 10 g, wind ≥ 2 mph apart, ` +
        `matching motorLot (if both have one). ` +
        `Logged wind speeds: [${winds}]. ` +
        `Tag two flights with "#calib" in notes to force-pick them.`,
      );
      return;
    }
    const aw = est.flightA.windSpeedMph ?? 0;
    const bw = est.flightB.windSpeedMph ?? 0;
    console.log(
      `[WIND_K_G estimate] suggested = ${est.windK.toFixed(0)} g  ` +
      `(${est.source} pair: ${est.flightA.date} ${aw}mph→${est.flightA.altitude}ft  vs  ` +
      `${est.flightB.date} ${bw}mph→${est.flightB.altitude}ft;  ` +
      `Δratio²=${est.dRatioSq.toFixed(4)}, Δapogee=${est.dApogeeFt.toFixed(1)}ft, ` +
      `coefMass=${coefMassFtPerKg.toFixed(0)}ft/kg)`,
    );
  }, [altitudeModel, flights]);

  // Empirical bias: average (actual − target) over flights that had a target.
  // Positive = rocket flies higher than the table predicts.
  const biasFlights = flights.filter(f => f.targetAltitude > 0);
  const suggestedBiasFt = biasFlights.length > 0
    ? Math.round(biasFlights.reduce((s, f) => s + (f.altitude - f.targetAltitude), 0) / biasFlights.length)
    : null;

  const handleDeleteFlight = async (id: string) => {
    await FlightLog.remove(id);
    setFlights(FlightLog.list());
  };

  const handleClearAllFlights = async () => {
    if (flights.length === 0) return;
    if (!confirm(
      `Remove all ${flights.length} flights from this device and start a clean log for the new rocket?\n\n` +
      `Your 2026 season is archived in data/2026-season-flights.csv, so this is reversible by re-importing.\n` +
      `This does NOT change the cloud until you press "Upload to cloud".`,
    )) return;
    await FlightLog.saveAll([]);
    setFlights(FlightLog.list());
    setExpandedFlightId(null);
    setEditingFlightId(null);
  };

  const beginEditFlight = (f: Flight) => {
    setEditingFlightId(f.id);
    setEditDraft({
      date: f.date,
      targetAltitude: f.targetAltitude,
      altitude: f.altitude,
      rocketMass: f.rocketMass,
      time: f.time,
      descentTimeSec: f.descentTimeSec,
      rubberBandCm: f.rubberBandCm,
      windSpeedMph: f.windSpeedMph,
      tempC: f.tempC,
      pressureHpa: f.pressureHpa,
      humidityPct: f.humidityPct,
      rodAngleDeg: f.rodAngleDeg,
      motorId: f.motorId,
      motorLot: f.motorLot,
      motorTempF: f.motorTempF,
      motorAnomaly: f.motorAnomaly,
      notes: f.notes,
    });
  };

  const cancelEditFlight = () => {
    setEditingFlightId(null);
    setEditDraft({});
  };

  const saveEditFlight = async (original: Flight) => {
    const merged: Flight = {
      ...original,
      ...editDraft,
      // duration is the legacy alias of time — keep them in sync.
      duration: editDraft.time ?? original.time,
      // wind level derives from wind speed.
      windLevel: (() => {
        const w = editDraft.windSpeedMph ?? original.windSpeedMph ?? 0;
        return w > 10 ? 'high' : w >= 5 ? 'medium' : 'low';
      })(),
    };
    await FlightLog.update(merged);
    setFlights(FlightLog.list());
    cancelEditFlight();
  };

  const handlePullFromTurso = async () => {
    if (flights.length > 0 && !confirm(
      `This will replace all ${flights.length} flights on this device with whatever is in the cloud. Continue?`,
    )) return;
    setTursoStatus({ kind: 'busy', message: 'Loading from cloud…' });
    try {
      const n = await pullFromTurso();
      setFlights(FlightLog.list());
      setLastPull(getLastPull());
      setTursoStatus({ kind: 'done', message: `Loaded ${n} flights from cloud. Safe to go offline.` });
    } catch (e) {
      setTursoStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Pull failed' });
    }
  };

  const handlePushToTurso = async () => {
    const cutoff = settings.uploadCutoffDate;
    const excludedCount = cutoff ? flights.filter((f) => f.date < cutoff).length : 0;
    const toUpload = flights.length - excludedCount;
    if (toUpload === 0) {
      setTursoStatus({
        kind: 'error',
        message: excludedCount > 0
          ? `All ${flights.length} flights on this device are before the ${cutoff} cutoff — nothing uploaded, cloud left untouched.`
          : 'No flights to upload.',
      });
      return;
    }
    if (!confirm(
      `This replaces the cloud with ${toUpload} flight${toUpload === 1 ? '' : 's'} from this device` +
      (excludedCount > 0 ? ` (${excludedCount} older flight${excludedCount === 1 ? '' : 's'} before ${cutoff} excluded)` : '') +
      `. Continue?`,
    )) return;
    setTursoStatus({ kind: 'busy', message: 'Uploading to cloud…' });
    try {
      const { uploaded, excluded } = await pushToTurso(cutoff);
      setLastPush(getLastPush());
      setTursoStatus({
        kind: 'done',
        message: `Uploaded ${uploaded} flights to cloud${excluded > 0 ? ` (${excluded} pre-${cutoff} excluded)` : ''}.`,
      });
    } catch (e) {
      setTursoStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Push failed' });
    }
  };

  // The manual flight form only stores flight-specific fields. The atmospheric
  // fields (wind, temp, pressure, humidity, rod angle) are read live from
  // `conditions` so a Pull-Weather click or any edit on the Conditions tab
  // immediately flows into the form (and back out when the flight is saved).
  // targetAltitude and rubberBandCm are intentionally left undefined so the
  // form falls back to the Setup-tab values until the user overrides them.
  const blankNewFlight = (): Partial<Flight> => ({
    date: new Date().toISOString().slice(0, 10),
    rocketMass: undefined,
    altitude: undefined,
    time: undefined,
    descentTimeSec: undefined,
    motorId: APPROVED_MOTORS[0]?.id,
    motorLot: '',
    notes: '',
  });
  const [newFlight, setNewFlight] = useState<Partial<Flight>>(blankNewFlight());

  const handleAddFlight = async () => {
    if (
      typeof newFlight.rocketMass !== 'number' ||
      typeof newFlight.altitude !== 'number' ||
      typeof newFlight.time !== 'number' ||
      !newFlight.date
    ) {
      alert('Date, mass, actual altitude, and total time are required.');
      return;
    }
    const setupTarget = hasTarget ? targetNum : settings.targetAltitudeFt;
    const setupRubberBand = rubberBand !== null ? Math.round(rubberBand) : undefined;
    const f: Flight = {
      id: `flt_${newFlight.date}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: newFlight.date,
      altitude: newFlight.altitude,
      targetAltitude: newFlight.targetAltitude ?? setupTarget,
      time: newFlight.time,
      duration: newFlight.time,
      rocketMass: newFlight.rocketMass,
      rubberBandCm: newFlight.rubberBandCm ?? setupRubberBand,
      descentTimeSec: newFlight.descentTimeSec,
      // Atmospheric snapshot taken from the live Conditions state at save time.
      windSpeedMph: conditions.windSpeedMph,
      tempC: conditions.tempC,
      pressureHpa: conditions.pressureHpa,
      humidityPct: conditions.humidityPct,
      rodAngleDeg: conditions.rodAngleDeg,
      motorLot: newFlight.motorLot || undefined,
      motorTempF: newFlight.motorTempF ?? conditions.motorTempF,
      motorId: newFlight.motorId || APPROVED_MOTORS[0]?.id || 'F63-10R',
      parachuteDiameter: settings.chute.diameterIn,
      windLevel:
        conditions.windSpeedMph > 10 ? 'high'
          : conditions.windSpeedMph >= 5 ? 'medium' : 'low',
      launchFieldId: settings.activeFieldId,
      notes: newFlight.notes ?? '',
    };
    await FlightLog.add(f);
    setFlights(FlightLog.list());
    setNewFlight(blankNewFlight());
  };

  let weight: number | null = null;
  let rubberBand: number | null = null;
  let activeRow: CalibrationRow | undefined;
  let densityNudgeG = 0;
  let predictedDescentSec: number | null = null;
  let predictedTotalSec: number | null = null;
  let regressionMass: number | null = null;
  let rbShrink: { neighborsUsed: number; empiricalMean: number | null; prior: number } | null = null;

  if (hasTarget && hasWind && data.length > 0) {
    activeRow = data.find(r => r.targetHeight === targetNum);
    densityNudgeG = densityMassCorrectionG(targetNum, todayDensity, settings.referenceDensityKgM3);
    const defaultMotorId = newFlight.motorId ?? APPROVED_MOTORS[0]?.id;

    // Only recommend once the regression has trained on enough real flights for
    // this rocket. The seeded 2026 calibration table is never used as a live
    // recommendation — it belongs to a different airframe.
    if (modelReady && altitudeModel) {
      const recMass = recommendedMassG(
        altitudeModel, targetNum, todayDensity, conditions.rodAngleDeg,
      );
      if (recMass !== null && Number.isFinite(recMass) && recMass > 300 && recMass < 1200) {
        regressionMass = recMass;
      }
    }

    if (regressionMass !== null) {
      // Physics-based wind correction on the regression mass: apogee loss ∝
      // (v_wind/v_rod)². WIND_K_G is the mass-equivalent at ratio²=1 (a tornado);
      // calibrated so a typical config in 8 mph wind subtracts ~14 g. Density is
      // re-added explicitly because the regression's rho fit is unreliable with
      // a narrow training temperature spread.
      const vRod = offRodVelocityMph(defaultMotorId, regressionMass) ?? 30;
      const windRatioSq = (windNum / vRod) ** 2;
      const WIND_K_G = 200;
      const windMassG = WIND_K_G * windRatioSq;
      weight = regressionMass - windMassG + densityNudgeG;

      const massKg = weight / 1000;

      // Rubber-band recommendation: a physics-based prior blended toward nearby
      // logged successes. With no neighbour flights yet it leans on the prior.
      const CALIB_WIND = 5;
      const base =
        14 + ((targetNum - 725) * (26 - 14)) / (775 - 725) - 0.4 * CALIB_WIND;
      // Thinner air and a heavier rocket both speed up descent, requiring a
      // bigger chute = SMALLER rb. Δ(A_eff)/A_eff ≈ Δm/m − Δρ/ρ, and
      // A_eff / |dA_eff/drb| ≈ 14.4 cm from the parachute.ts fit slope.
      const RB_PER_REL_AREA = 14.4;
      const refDensity = settings.referenceDensityKgM3;
      const refMassG = activeRow?.requiredWeight ?? weight;
      const relDensityChange = refDensity > 0 ? todayDensity / refDensity - 1 : 0;
      const relMassChange = refMassG > 0 ? weight / refMassG - 1 : 0;
      const tempRbAdjust = -RB_PER_REL_AREA * (relMassChange - relDensityChange);
      const priorRb = base + 0.4 * windNum + tempRbAdjust;
      const shrunk = shrinkRubberBandToNeighbors(flights, targetNum, priorRb);
      rubberBand = shrunk.value;
      rbShrink = {
        neighborsUsed: shrunk.neighborsUsed,
        empiricalMean: shrunk.empiricalMean,
        prior: shrunk.prior,
      };
      const pred = predictDescent(settings.chute, targetNum, massKg, todayDensity);
      predictedDescentSec = pred.tDescentSec;
      predictedTotalSec = pred.totalTimeSec;
    }
  }

  const toggleAnchor = (targetHeight: number) => {
    const next = data.map(r =>
      r.targetHeight === targetHeight
        ? { ...r, source: r.source === 'measured' ? 'interpolated' as const : 'measured' as const }
        : r,
    );
    setData(next);
    StorageService.saveCalibration(next);
  };

  const addLaunchField = () => {
    const id = `field_${Date.now()}`;
    persistSettings({
      ...settings,
      launchFields: [
        ...settings.launchFields,
        { id, name: 'New field', lat: 0, lon: 0 },
      ],
    });
  };

  const updateLaunchField = (id: string, patch: Partial<LaunchField>) => {
    persistSettings({
      ...settings,
      launchFields: settings.launchFields.map(f =>
        f.id === id ? { ...f, ...patch } : f,
      ),
    });
  };

  const removeLaunchField = (id: string) => {
    if (settings.launchFields.length <= 1) {
      alert('Keep at least one launch field.');
      return;
    }
    const remaining = settings.launchFields.filter(f => f.id !== id);
    persistSettings({
      ...settings,
      launchFields: remaining,
      activeFieldId:
        settings.activeFieldId === id ? remaining[0].id : settings.activeFieldId,
    });
  };

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      style={{
        flex: 1,
        padding: '0.75rem 1rem',
        background: tab === id ? 'var(--bg-tertiary)' : 'transparent',
        color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)',
        border: 'none',
        borderBottom: tab === id ? '2px solid #38bdf8' : '2px solid transparent',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: '0.95rem',
      }}
    >
      {label}
    </button>
  );

  const isAnchor = activeRow?.source === 'measured';

  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <header className="app-header" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 1.5rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--bg-tertiary)', gap: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.25rem', fontWeight: 'bold' }}>
          <Rocket className="text-accent" /> ARC Analytics
        </div>
      </header>

      {/* Tabs */}
      <nav className="app-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--bg-tertiary)', background: 'var(--bg-secondary)', width: '100%' }}>
        {tabBtn('conditions', 'Conditions')}
        {tabBtn('setup', 'Setup')}
        {tabBtn('timer', 'Timer')}
        {tabBtn('checklist', 'Checklist')}
        {tabBtn('flights', 'Flights')}
        {tabBtn('settings', 'Settings')}
      </nav>

      <main className="app-main" style={{ padding: '2rem 1.5rem', display: 'flex', justifyContent: 'center' }}>
        {tab === 'setup' && (
          <div className="card" style={{ padding: '2rem', width: '100%', maxWidth: '960px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Target Height (ft)</label>
                <input type="number" className="form-input" placeholder={`e.g. ${settings.targetAltitudeFt}`}
                  style={{ width: '100%', padding: '0.75rem' }}
                  value={targetHeight} onChange={(e) => setTargetHeight(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Windspeed (mph)</label>
                <NumberInput step="0.1" className="form-input" placeholder="e.g. 5"
                  style={{ width: '100%', padding: '0.75rem' }}
                  value={conditions.windSpeedMph}
                  onChange={(v) => persistConditions({ ...conditions, windSpeedMph: v })} />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  Shared with the Conditions tab — measure with the anemometer at the pad and update here.
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Temperature (°F)</label>
                <NumberInput step="0.1" className="form-input" placeholder="e.g. 72"
                  style={{ width: '100%', padding: '0.75rem' }}
                  value={Number.isFinite(conditions.tempC) ? Number(cToF(conditions.tempC).toFixed(1)) : NaN}
                  onChange={(v) => persistConditions({ ...conditions, tempC: fToC(v) })} />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  Measured on the field — overrides Pull-Weather. Synced with Conditions tab and the manual flight log.
                </div>
              </div>
            </div>

            {hasTarget && hasWind && (() => {
              const maxTrainingWind = flights.reduce(
                (m, f) => Math.max(m, f.windSpeedMph ?? 0),
                0,
              );
              const highWindThreshold = Math.max(12, maxTrainingWind + 2);
              const highWind = windNum > highWindThreshold;
              return (
              <>
                {highWind && (
                  <div style={{
                    marginTop: '1.5rem', padding: '0.85rem 1rem',
                    background: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid rgba(245, 158, 11, 0.5)',
                    borderRadius: '0.5rem', color: '#fbbf24',
                    fontSize: '0.85rem', lineHeight: 1.5,
                  }}>
                    <strong>High-wind warning:</strong> {windNum.toFixed(1)} mph is
                    {maxTrainingWind > 0
                      ? ` above the training range (max logged: ${maxTrainingWind.toFixed(1)} mph).`
                      : ' outside the typical training range.'}
                    {' '}The recommendations below are extrapolated and may be off.
                    Because the regression's training data spans only low wind speeds,
                    the recommended mass is effectively a calm-day estimate and does not
                    fully account for apex loss from weather-cocking — consider trimming
                    a few grams below the recommendation to compensate. Tilt the rod
                    slightly <em>downwind</em> (weather-cocking pulls the rocket upwind
                    during boost — tilting with the wind cancels it out). Consider a
                    larger rubber-band number to shorten descent and cut drift. Log this
                    flight carefully — rod angle and wind direction matter most for next
                    year's predictions.
                  </div>
                )}
                <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
                  <div style={{ padding: '1.25rem', background: 'rgba(56, 189, 248, 0.08)', borderRadius: '0.5rem', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Weight (g)</div>
                    <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                      {weight !== null ? weight.toFixed(1) : '—'}
                    </div>
                    {weight === null ? (
                      <div style={{ fontSize: '0.78rem', color: '#f59e0b', marginTop: '0.35rem', lineHeight: 1.4 }}>
                        Log flights first. This rocket needs {Math.max(1, FLIGHTS_NEEDED - usableFlightCount)} more
                        logged flight{Math.max(1, FLIGHTS_NEEDED - usableFlightCount) === 1 ? '' : 's'} before the app
                        predicts a weight ({usableFlightCount}/{FLIGHTS_NEEDED}). Recommendations come from this rocket's
                        real flight data — not the old 2026 table.
                      </div>
                    ) : (
                      <>
                        {Math.abs(densityNudgeG) >= 0.1 && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            Density nudge: {densityNudgeG > 0 ? '+' : ''}{densityNudgeG.toFixed(1)} g
                            ({((densityRatio - 1) * 100 >= 0 ? '+' : '')}{((densityRatio - 1) * 100).toFixed(1)}% vs. reference)
                          </div>
                        )}
                        {altitudeModel && (
                          <div style={{ fontSize: '0.75rem', color: '#22c55e', marginTop: '0.25rem' }}>
                            Regression (n={altitudeModel.n}, RMS ±{altitudeModel.rms.toFixed(1)} ft, R²={altitudeModel.r2.toFixed(2)})
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div style={{ padding: '1.25rem', background: 'rgba(56, 189, 248, 0.08)', borderRadius: '0.5rem', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Rubber Band Position (cm)</div>
                    <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                      {rubberBand !== null ? Math.round(rubberBand) : '—'}
                    </div>
                    {rubberBand === null ? (
                      <div style={{ fontSize: '0.78rem', color: '#f59e0b', marginTop: '0.35rem', lineHeight: 1.4 }}>
                        Available once weight is being predicted (after {FLIGHTS_NEEDED} logged flights for this rocket).
                      </div>
                    ) : (
                      <>
                        {(targetNum < 725 || targetNum > 775) && (
                          <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: '0.25rem' }}>
                            Extrapolated outside 725–775 ft range
                          </div>
                        )}
                        {rbShrink && rbShrink.neighborsUsed > 0 && rbShrink.empiricalMean !== null ? (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            Blended {rbShrink.neighborsUsed} nearby success{rbShrink.neighborsUsed === 1 ? '' : 'es'} (mean {rbShrink.empiricalMean.toFixed(1)} cm) with physics prior {rbShrink.prior.toFixed(1)} cm
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            Physics prior — no nearby logged flights yet
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {predictedDescentSec !== null && predictedTotalSec !== null && (
                  <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                    <div style={{ padding: '0.85rem 1rem', background: 'var(--bg-tertiary)', borderRadius: '0.5rem' }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Predicted descent</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                        {predictedDescentSec.toFixed(1)} s
                      </div>
                    </div>
                    <div style={{ padding: '0.85rem 1rem', background: 'var(--bg-tertiary)', borderRadius: '0.5rem' }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Predicted total flight (target {settings.targetTimeMinSec}–{settings.targetTimeMaxSec}s)
                      </div>
                      <div style={{
                        fontSize: '1.25rem', fontWeight: 600,
                        color:
                          predictedTotalSec >= settings.targetTimeMinSec &&
                          predictedTotalSec <= settings.targetTimeMaxSec
                            ? '#22c55e'
                            : '#f59e0b',
                      }}>
                        {predictedTotalSec.toFixed(1)} s
                      </div>
                    </div>
                  </div>
                )}

                {activeRow && (
                  <div style={{
                    marginTop: '1.25rem', padding: '0.75rem 1rem',
                    background: isAnchor ? 'rgba(245, 158, 11, 0.08)' : 'var(--bg-tertiary)',
                    borderRadius: '0.5rem',
                    border: isAnchor ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                      Calibration row for {targetNum} ft is{' '}
                      <strong style={{ color: isAnchor ? '#f59e0b' : 'var(--text-primary)' }}>
                        {isAnchor ? 'a measured anchor' : 'interpolated'}
                      </strong>
                      .
                    </div>
                    <button
                      onClick={() => toggleAnchor(targetNum)}
                      className="btn btn-outline"
                      style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}
                      title={isAnchor ? 'Demote to interpolated' : 'Mark as a real measured flight'}
                    >
                      <Star size={14} fill={isAnchor ? '#f59e0b' : 'none'} />
                      {isAnchor ? 'Anchor' : 'Mark anchor'}
                    </button>
                  </div>
                )}
              </>
              );
            })()}
          </div>
        )}

        {tab === 'conditions' && (
          <div className="card" style={{ padding: '2rem', width: '100%', maxWidth: '720px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0 }}>Atmospheric Conditions</h2>
              <button onClick={pullWeather} disabled={weatherStatus.kind === 'loading'}
                className="btn btn-primary"
                style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {weatherStatus.kind === 'loading' ? <RefreshCw size={16} className="spin" /> : <Cloud size={16} />}
                Pull weather
              </button>
            </div>

            <div style={{
              padding: '0.85rem 1rem', marginBottom: '1.25rem',
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '0.5rem',
              display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem',
            }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Today's air density</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>
                  {todayDensity.toFixed(4)} kg/m³
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>vs. reference ({settings.referenceDensityKgM3.toFixed(4)})</div>
                <div style={{
                  fontSize: '1.4rem', fontWeight: 'bold',
                  color: Math.abs(densityRatio - 1) > 0.03 ? '#f59e0b' : 'inherit',
                }}>
                  {((todayDensity / settings.referenceDensityKgM3 - 1) * 100 >= 0 ? '+' : '')}
                  {((todayDensity / settings.referenceDensityKgM3 - 1) * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            {weatherStatus.kind === 'error' && (
              <div style={{ padding: '0.6rem 0.85rem', marginBottom: '1rem',
                background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: '0.4rem', fontSize: '0.85rem', color: '#fca5a5' }}>
                Weather fetch failed: {weatherStatus.message}. Edit fields manually below.
              </div>
            )}
            {conditions.fetchedAt && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Last fetched: {new Date(conditions.fetchedAt).toLocaleString()}
                {conditions.fetchedFor && ` (${settings.launchFields.find(f => f.id === conditions.fetchedFor)?.name ?? conditions.fetchedFor})`}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Temperature (°F)</label>
                <NumberInput step="0.1" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                  value={Number.isFinite(conditions.tempC) ? Number(cToF(conditions.tempC).toFixed(1)) : NaN}
                  onChange={(v) => persistConditions({ ...conditions, tempC: fToC(v) })} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Pressure (hPa, station)</label>
                <NumberInput step="0.1" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                  value={conditions.pressureHpa}
                  onChange={(v) => persistConditions({ ...conditions, pressureHpa: v })} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Humidity (%)</label>
                <NumberInput min="0" max="100" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                  value={conditions.humidityPct}
                  onChange={(v) => persistConditions({ ...conditions, humidityPct: v })} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Field elevation (ft)</label>
                <NumberInput className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                  value={conditions.fieldElevationFt}
                  onChange={(v) => persistConditions({ ...conditions, fieldElevationFt: v })} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Wind speed (mph)</label>
                <NumberInput step="0.1" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                  value={conditions.windSpeedMph}
                  onChange={(v) => persistConditions({ ...conditions, windSpeedMph: v })} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Wind direction (°, 0 = headwind)</label>
                <NumberInput min="0" max="359" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                  value={conditions.windDirectionDeg}
                  onChange={(v) => persistConditions({ ...conditions, windDirectionDeg: v })} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Rod angle from vertical (°)</label>
                <NumberInput step="0.5" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                  value={conditions.rodAngleDeg}
                  onChange={(v) => persistConditions({ ...conditions, rodAngleDeg: v })} />
              </div>
            </div>
          </div>
        )}

        {tab === 'flights' && (
          <div className="card" style={{ padding: '2rem', width: '100%', maxWidth: '960px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h2 style={{ margin: 0 }}>Flight Log</h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={handlePullFromTurso} className="btn btn-outline"
                  disabled={!dbReady || tursoStatus.kind === 'busy'}
                  title="Download all flights from Turso and replace local DB. Do this at home before going offline."
                  style={{ padding: '0.5rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Cloud size={14} /> Load from cloud
                </button>
                <button onClick={handlePushToTurso} className="btn btn-outline"
                  disabled={!dbReady || tursoStatus.kind === 'busy'}
                  title="Upload local flights to Turso (replaces cloud). Do this back at home after finals."
                  style={{ padding: '0.5rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Cloud size={14} /> Upload to cloud
                </button>
                <button onClick={handleClearAllFlights} className="btn btn-outline"
                  disabled={!dbReady || flights.length === 0}
                  title="Remove all flights from this device to start a clean log for a new rocket/season. The 2026 season stays archived in data/2026-season-flights.csv."
                  style={{ padding: '0.5rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#ef4444', borderColor: '#ef444466' }}>
                  <Trash2 size={14} /> Clear log
                </button>
              </div>
              <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Cloud — last loaded: {lastPull ? new Date(lastPull).toLocaleString() : 'never'}
                {' · '}
                last uploaded: {lastPush ? new Date(lastPush).toLocaleString() : 'never'}
              </div>
            </div>

            {tursoStatus.kind !== 'idle' && (
              <div style={{
                marginBottom: '1rem', padding: '0.6rem 0.85rem',
                background: tursoStatus.kind === 'error' ? 'rgba(239, 68, 68, 0.1)'
                  : tursoStatus.kind === 'done' ? 'rgba(34, 197, 94, 0.1)'
                  : 'rgba(56, 189, 248, 0.1)',
                border: `1px solid ${tursoStatus.kind === 'error' ? 'rgba(239, 68, 68, 0.35)'
                  : tursoStatus.kind === 'done' ? 'rgba(34, 197, 94, 0.35)'
                  : 'rgba(56, 189, 248, 0.35)'}`,
                borderRadius: '0.4rem', fontSize: '0.85rem',
              }}>
                {tursoStatus.message}
              </div>
            )}

            {!dbReady && (
              <div style={{ marginBottom: '1rem', padding: '0.6rem 0.85rem',
                background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '0.4rem', fontSize: '0.85rem' }}>
                Initialising SQLite database…
              </div>
            )}


            {altitudeModel ? (
              <div style={{
                marginBottom: '1rem', padding: '0.85rem 1rem',
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '0.5rem',
                display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem',
              }}>
                <div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Calibration trust meter</div>
                  <div style={{
                    fontSize: '1.25rem', fontWeight: 600,
                    color: altitudeModel.rms < 8 ? '#22c55e' : altitudeModel.rms < 16 ? '#f59e0b' : '#ef4444',
                  }}>
                    ±{altitudeModel.rms.toFixed(1)} ft over {altitudeModel.n} flights
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>R² · features</div>
                  <div style={{ fontSize: '0.95rem' }}>
                    {altitudeModel.r2.toFixed(3)} · {altitudeModel.featureNames.join(', ')}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                No regression yet — log at least 4 flights with mass + altitude.
              </div>
            )}

            <details style={{
              marginBottom: '1.25rem', padding: '1.25rem 1.5rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--bg-tertiary)',
              borderRadius: '0.6rem',
            }}>
              <summary style={{
                cursor: 'pointer', fontWeight: 700, fontSize: '1.05rem',
                color: 'var(--text-primary)',
              }}>
                + Log a flight manually
              </summary>
              <div style={{
                marginTop: '1.1rem',
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem 1rem',
              }}>
                {(() => {
                  const labelStyle = {
                    display: 'block', fontSize: '0.9rem', fontWeight: 600,
                    color: 'var(--text-primary)', marginBottom: '0.35rem',
                  } as const;
                  const inputStyle = {
                    width: '100%', padding: '0.6rem 0.7rem', fontSize: '1rem',
                    background: 'var(--bg-primary)', color: 'var(--text-primary)',
                    border: '1px solid var(--bg-tertiary)', borderRadius: '0.35rem',
                  } as const;
                  const flightFields: { label: string; key: keyof Flight; type: 'date' | 'number' | 'text' }[] = [
                    { label: 'Date', key: 'date', type: 'date' },
                    { label: 'Target (ft)', key: 'targetAltitude', type: 'number' },
                    { label: 'Actual altitude (ft) *', key: 'altitude', type: 'number' },
                    { label: 'Mass (g) *', key: 'rocketMass', type: 'number' },
                    { label: 'Total time (s) *', key: 'time', type: 'number' },
                    { label: 'Descent time (s)', key: 'descentTimeSec', type: 'number' },
                    { label: 'Rubber band (cm)', key: 'rubberBandCm', type: 'number' },
                    { label: 'Motor temp (°F)', key: 'motorTempF', type: 'number' },
                  ];
                  // Fall back to Setup values when the form field is empty so the
                  // user gets pre-filled Target, Mass, and Rubber band without
                  // losing the ability to override.
                  const setupFallback: Partial<Record<keyof Flight, number | undefined>> = {
                    targetAltitude: hasTarget ? targetNum : settings.targetAltitudeFt,
                    rocketMass: weight !== null ? Math.round(weight) : undefined,
                    rubberBandCm: rubberBand !== null ? Math.round(rubberBand) : undefined,
                    motorTempF: conditions.motorTempF,
                  };
                  const conditionFields: { label: string; key: keyof Conditions }[] = [
                    { label: 'Wind (mph) — live', key: 'windSpeedMph' },
                    { label: 'Temp (°F) — live', key: 'tempC' },
                    { label: 'Pressure (hPa) — live', key: 'pressureHpa' },
                    { label: 'Humidity (%) — live', key: 'humidityPct' },
                    { label: 'Rod angle (°) — live', key: 'rodAngleDeg' },
                  ];
                  return (
                    <>
                      {flightFields.map(({ label, key, type }) => {
                        const formVal = (newFlight as Record<string, unknown>)[key] as string | number | undefined;
                        const fallback = setupFallback[key];
                        if (type === 'number') {
                          const numVal =
                            typeof formVal === 'number' ? formVal :
                            typeof fallback === 'number' ? fallback : NaN;
                          return (
                            <div key={key}>
                              <label style={labelStyle}>{label}</label>
                              <NumberInput
                                step="0.1"
                                className="form-input"
                                style={inputStyle}
                                value={numVal}
                                onChange={(v) => setNewFlight({ ...newFlight, [key]: v })}
                              />
                            </div>
                          );
                        }
                        const displayVal = formVal ?? (fallback !== undefined ? fallback : '');
                        return (
                          <div key={key}>
                            <label style={labelStyle}>{label}</label>
                            <input
                              type={type}
                              className="form-input"
                              style={inputStyle}
                              value={displayVal}
                              onChange={(e) => {
                                const v = e.target.value;
                                setNewFlight({
                                  ...newFlight,
                                  [key]: v === '' ? undefined : v,
                                });
                              }}
                            />
                          </div>
                        );
                      })}
                      {conditionFields.map(({ label, key }) => {
                        const isTemp = key === 'tempC';
                        const raw = conditions[key] as number;
                        const numVal = Number.isFinite(raw)
                          ? (isTemp ? Number(cToF(raw).toFixed(1)) : raw)
                          : NaN;
                        return (
                          <div key={key}>
                            <label style={labelStyle} title="Bound to the Conditions tab — edits flow both ways">
                              {label}
                            </label>
                            <NumberInput
                              step="0.1"
                              className="form-input"
                              style={inputStyle}
                              value={numVal}
                              onChange={(v) => {
                                const next = isTemp ? fToC(v) : v;
                                persistConditions({ ...conditions, [key]: next });
                              }}
                            />
                          </div>
                        );
                      })}
                      <div>
                        <label style={labelStyle}>Motor</label>
                        <select
                          className="form-input"
                          style={inputStyle}
                          value={newFlight.motorId ?? APPROVED_MOTORS[0]?.id ?? ''}
                          onChange={(e) => setNewFlight({ ...newFlight, motorId: e.target.value })}
                        >
                          {APPROVED_MOTORS.map((m) => (
                            <option key={m.id} value={m.id}>{m.designation}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>Motor lot</label>
                        <input
                          type="text"
                          className="form-input"
                          style={inputStyle}
                          value={newFlight.motorLot ?? ''}
                          onChange={(e) => setNewFlight({ ...newFlight, motorLot: e.target.value })}
                        />
                      </div>
                    </>
                  );
                })()}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{
                    display: 'block', fontSize: '0.9rem', fontWeight: 600,
                    color: 'var(--text-primary)', marginBottom: '0.35rem',
                  }}>Notes</label>
                  <input type="text" className="form-input"
                    style={{
                      width: '100%', padding: '0.6rem 0.7rem', fontSize: '1rem',
                      background: 'var(--bg-primary)', color: 'var(--text-primary)',
                      border: '1px solid var(--bg-tertiary)', borderRadius: '0.35rem',
                    }}
                    value={newFlight.notes ?? ''}
                    onChange={(e) => setNewFlight({ ...newFlight, notes: e.target.value })} />
                </div>
              </div>
              <div style={{ marginTop: '1.1rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={handleAddFlight} className="btn btn-primary"
                  style={{ padding: '0.65rem 1.2rem', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Plus size={16} /> Add flight
                </button>
                <button onClick={() => setNewFlight(blankNewFlight())} className="btn btn-outline"
                  style={{ padding: '0.65rem 1rem', fontSize: '0.95rem' }}>
                  Reset
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Atmospheric fields ("live") share state with the Conditions tab — Pull-Weather updates,
                  manual edits here, and Setup-tab wind edits all stay in sync.
                  <strong style={{ color: 'var(--text-primary)' }}> *</strong> required.
                </span>
              </div>
            </details>

            {flights.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No flights logged. Import the anchor CSV or use the form above.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--bg-tertiary)', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem' }}>Date</th>
                      <th style={{ padding: '0.5rem' }}>Target</th>
                      <th style={{ padding: '0.5rem' }}>Actual</th>
                      <th style={{ padding: '0.5rem' }}>Δ</th>
                      <th style={{ padding: '0.5rem' }}>Mass</th>
                      <th style={{ padding: '0.5rem' }}>RB</th>
                      <th style={{ padding: '0.5rem' }}>Time</th>
                      <th style={{ padding: '0.5rem' }}>Wind</th>
                      <th style={{ padding: '0.5rem' }} title="Motor case temperature at launch">Motor °F</th>
                      <th style={{ padding: '0.5rem' }}>ρ</th>
                      <th style={{ padding: '0.5rem' }}>Resid</th>
                      <th style={{ padding: '0.5rem' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {flights.map((f, i) => {
                      const ff = flightFeatures(f);
                      const rho = ff?.rho;
                      const resid = residualById.has(f.id) ? residualById.get(f.id)! : null;
                      const isSus = suspiciousIds.has(f.id);
                      const isExpanded = expandedFlightId === f.id;
                      const diagnoses = isExpanded ? diagnoseFlight(f, {
                        targetAltitudeFt: settings.targetAltitudeFt,
                        targetTimeMinSec: settings.targetTimeMinSec,
                        targetTimeMaxSec: settings.targetTimeMaxSec,
                        referenceDensityKgM3: settings.referenceDensityKgM3,
                        altitudeModel,
                        history: flights.slice(0, i + 1),
                      }) : [];
                      return (
                        <Fragment key={f.id}>
                          <tr onClick={() => setExpandedFlightId(isExpanded ? null : f.id)}
                            style={{
                              borderBottom: isExpanded ? 'none' : '1px solid var(--bg-tertiary)',
                              background: isSus ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                              cursor: 'pointer',
                            }}>
                            <td style={{ padding: '0.5rem' }}>
                              <span style={{ display: 'inline-block', width: '0.9rem', color: 'var(--text-muted)' }}>
                                {isExpanded ? '▾' : '▸'}
                              </span>
                              {f.date}
                              {f.motorAnomaly && (
                                <span title="Motor anomaly — excluded from model training"
                                  style={{ marginLeft: '0.4rem', fontSize: '0.68rem', fontWeight: 600, color: '#ef4444', border: '1px solid #ef444466', borderRadius: '0.3rem', padding: '0.05rem 0.3rem' }}>
                                  anomaly
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '0.5rem' }}>{f.targetAltitude || '—'}</td>
                            <td style={{ padding: '0.5rem' }}>{f.altitude}</td>
                            <td style={{ padding: '0.5rem', color: f.targetAltitude && f.altitude < f.targetAltitude ? '#f59e0b' : 'inherit' }}>
                              {f.targetAltitude ? (f.altitude - f.targetAltitude > 0 ? '+' : '') + (f.altitude - f.targetAltitude) : '—'}
                            </td>
                            <td style={{ padding: '0.5rem' }}>{f.rocketMass}</td>
                            <td style={{ padding: '0.5rem' }}>{f.rubberBandCm ?? '—'}</td>
                            <td style={{ padding: '0.5rem' }}>{f.time || '—'}</td>
                            <td style={{ padding: '0.5rem' }}>{f.windSpeedMph ?? '—'}</td>
                            <td style={{ padding: '0.5rem', color: typeof f.motorTempF === 'number' && f.motorTempF > 75 ? '#f59e0b' : 'inherit' }}>
                              {typeof f.motorTempF === 'number' ? f.motorTempF.toFixed(0) : '—'}
                            </td>
                            <td style={{ padding: '0.5rem' }} title={f.weatherFilled ? 'Backfilled from Open-Meteo' : 'From flight record'}>
                              {rho ? rho.toFixed(3) : '—'}{f.weatherFilled ? '*' : ''}
                            </td>
                            <td style={{ padding: '0.5rem', color: isSus ? '#f59e0b' : 'inherit', fontWeight: isSus ? 600 : 400 }}>
                              {resid !== null ? (resid > 0 ? '+' : '') + resid.toFixed(0) : '—'}
                            </td>
                            <td style={{ padding: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => handleDeleteFlight(f.id)}
                                className="btn btn-outline" style={{ padding: '0.25rem 0.4rem' }} title="Delete">
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr style={{ borderBottom: '1px solid var(--bg-tertiary)' }}>
                              <td colSpan={12} style={{ padding: '0.6rem 1rem 1rem', background: 'var(--bg-primary)' }}>
                                {editingFlightId === f.id ? (
                                  <div style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '0.4rem', border: '1px solid var(--bg-tertiary)' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem 0.75rem' }}>
                                      {(() => {
                                        const lbl = { display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.2rem', color: 'var(--text-primary)' } as const;
                                        const inp = { width: '100%', padding: '0.4rem 0.5rem', fontSize: '0.9rem', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--bg-tertiary)', borderRadius: '0.3rem' } as const;
                                        const numFields: { label: string; key: keyof Flight }[] = [
                                          { label: 'Target (ft)', key: 'targetAltitude' },
                                          { label: 'Actual (ft)', key: 'altitude' },
                                          { label: 'Mass (g)', key: 'rocketMass' },
                                          { label: 'Time (s)', key: 'time' },
                                          { label: 'Descent (s)', key: 'descentTimeSec' },
                                          { label: 'RB (cm)', key: 'rubberBandCm' },
                                          { label: 'Wind (mph)', key: 'windSpeedMph' },
                                          { label: 'Motor °F', key: 'motorTempF' },
                                          { label: 'Rod angle (°)', key: 'rodAngleDeg' },
                                          { label: 'Pressure (hPa)', key: 'pressureHpa' },
                                          { label: 'Humidity (%)', key: 'humidityPct' },
                                        ];
                                        return (
                                          <>
                                            <div>
                                              <label style={lbl}>Date</label>
                                              <input type="date" style={inp} value={editDraft.date ?? ''}
                                                onChange={(e) => setEditDraft({ ...editDraft, date: e.target.value })} />
                                            </div>
                                            {numFields.map(({ label, key }) => {
                                              const v = (editDraft as Record<string, unknown>)[key] as number | undefined;
                                              return (
                                                <div key={key}>
                                                  <label style={lbl}>{label}</label>
                                                  <NumberInput step="0.1" style={inp}
                                                    value={typeof v === 'number' ? v : NaN}
                                                    onChange={(val) => setEditDraft({ ...editDraft, [key]: Number.isFinite(val) ? val : undefined })} />
                                                </div>
                                              );
                                            })}
                                            <div>
                                              <label style={lbl}>Temp (°F)</label>
                                              <NumberInput step="0.1" style={inp}
                                                value={typeof editDraft.tempC === 'number' ? Number(cToF(editDraft.tempC).toFixed(1)) : NaN}
                                                onChange={(val) => setEditDraft({ ...editDraft, tempC: Number.isFinite(val) ? fToC(val) : undefined })} />
                                            </div>
                                            <div>
                                              <label style={lbl}>Motor</label>
                                              <select style={inp}
                                                value={editDraft.motorId ?? APPROVED_MOTORS[0]?.id ?? ''}
                                                onChange={(e) => setEditDraft({ ...editDraft, motorId: e.target.value })}>
                                                {APPROVED_MOTORS.map((m) => (
                                                  <option key={m.id} value={m.id}>{m.designation}</option>
                                                ))}
                                              </select>
                                            </div>
                                            <div>
                                              <label style={lbl}>Motor lot</label>
                                              <input type="text" style={inp} value={editDraft.motorLot ?? ''}
                                                onChange={(e) => setEditDraft({ ...editDraft, motorLot: e.target.value || undefined })} />
                                            </div>
                                            <div style={{ gridColumn: '1 / -1' }}>
                                              <label style={lbl}>Notes</label>
                                              <input type="text" style={inp} value={editDraft.notes ?? ''}
                                                onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })} />
                                            </div>
                                            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                              <input type="checkbox" id={`anomaly-${f.id}`}
                                                style={{ width: '1.1rem', height: '1.1rem', cursor: 'pointer' }}
                                                checked={!!editDraft.motorAnomaly}
                                                onChange={(e) => setEditDraft({ ...editDraft, motorAnomaly: e.target.checked })} />
                                              <label htmlFor={`anomaly-${f.id}`} style={{ fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
                                                Motor anomaly — exclude from model training &amp; wind calibration
                                              </label>
                                            </div>
                                          </>
                                        );
                                      })()}
                                    </div>
                                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                                      <button className="btn btn-primary" style={{ padding: '0.35rem 0.85rem' }} onClick={() => saveEditFlight(f)}>Save</button>
                                      <button className="btn btn-outline" style={{ padding: '0.35rem 0.85rem' }} onClick={cancelEditFlight}>Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div style={{ marginBottom: '0.6rem' }}>
                                    <button className="btn btn-outline" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
                                      onClick={() => beginEditFlight(f)}>Edit flight</button>
                                  </div>
                                )}
                                {diagnoses.length === 0 ? (
                                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                    No diagnoses — this flight was within tolerance on all checks.
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                    {diagnoses.map((d, j) => {
                                      const sevColor = d.severity === 'high' ? '#ef4444'
                                        : d.severity === 'medium' ? '#f59e0b' : '#38bdf8';
                                      return (
                                        <div key={j} style={{
                                          padding: '0.65rem 0.85rem',
                                          background: 'var(--bg-secondary)',
                                          border: `1px solid ${sevColor}40`,
                                          borderLeft: `3px solid ${sevColor}`,
                                          borderRadius: '0.4rem',
                                        }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                            <strong style={{ fontSize: '0.92rem', color: sevColor }}>{d.title}</strong>
                                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                              {d.phase} · {d.severity}
                                            </span>
                                          </div>
                                          <div style={{ fontSize: '0.85rem', marginBottom: '0.3rem' }}>{d.description}</div>
                                          <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                                            <strong>→</strong> {d.recommendation}
                                          </div>
                                          <details style={{ marginTop: '0.35rem' }}>
                                            <summary style={{ fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                                              physics
                                            </summary>
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem', lineHeight: 1.4 }}>
                                              {d.physicsReasoning}
                                              <div style={{ marginTop: '0.25rem', fontStyle: 'italic' }}>{d.directionalEffect}</div>
                                            </div>
                                          </details>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Click a row to expand diagnoses. ρ marked * was back-filled from Open-Meteo historical archive.
                  Amber rows are &gt;2σ from the model — likely motor anomalies or measurement errors.
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'timer' && (
          <div className="card" style={{ padding: '2.5rem 2rem', width: '100%', maxWidth: '500px', textAlign: 'center' }}>
            {(() => {
              const size = 280;
              const stroke = 12;
              const r = (size - stroke) / 2;
              const c = 2 * Math.PI * r;
              const remainingMs = Math.max(0, COUNTDOWN_MS - elapsedMs);
              const progress = remainingMs / COUNTDOWN_MS;
              const dashOffset = c * (1 - progress);
              return (
                <div
                  onClick={startStop}
                  style={{
                    position: 'relative', width: size, height: size, margin: '0 auto 2rem',
                    cursor: 'pointer', userSelect: 'none',
                  }}
                  title="Tap to start/pause"
                >
                  <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                    <circle
                      cx={size / 2} cy={size / 2} r={r}
                      fill="rgba(56, 189, 248, 0.05)"
                      stroke="var(--bg-tertiary)" strokeWidth={stroke}
                    />
                    <circle
                      cx={size / 2} cy={size / 2} r={r}
                      fill="none"
                      stroke="#38bdf8" strokeWidth={stroke} strokeLinecap="round"
                      strokeDasharray={c} strokeDashoffset={dashOffset}
                      style={{ transition: running ? 'stroke-dashoffset 0.05s linear' : 'none' }}
                    />
                  </svg>
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '2.75rem', fontWeight: 'bold', fontFamily: 'monospace',
                  }}>
                    {formatTime(remainingMs)}
                  </div>
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button onClick={startStop} className="btn btn-primary"
                style={{ padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {running ? <><Pause size={18} /> Stop</> : <><Play size={18} /> Start</>}
              </button>
              <button onClick={resetTimer} className="btn btn-outline"
                style={{ padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <RotateCcw size={18} /> Reset
              </button>
            </div>
          </div>
        )}

        {tab === 'checklist' && (
          <div className="card" style={{ padding: '2rem', width: '100%', maxWidth: '600px' }}>
            <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Pre-flight Checklist</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {CHECKLIST_ITEMS.map((item, i) => (
                <li key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.75rem', borderBottom: i < CHECKLIST_ITEMS.length - 1 ? '1px solid var(--bg-tertiary)' : 'none',
                  cursor: 'pointer',
                }}
                  onClick={() => setChecked(c => c.map((v, j) => j === i ? !v : v))}
                >
                  <input
                    type="checkbox"
                    checked={checked[i]}
                    onChange={() => setChecked(c => c.map((v, j) => j === i ? !v : v))}
                    style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span style={{
                    fontSize: '1rem',
                    textDecoration: checked[i] ? 'line-through' : 'none',
                    color: checked[i] ? 'var(--text-muted)' : 'var(--text-primary)',
                  }}>
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'settings' && (
          <div className="card" style={{ padding: '2rem', width: '100%', maxWidth: '720px' }}>
            <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Settings</h2>

            <section style={{ marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Targets (editable per round)</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Target altitude (ft)</label>
                  <input type="number" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                    value={settings.targetAltitudeFt}
                    onChange={(e) => persistSettings({ ...settings, targetAltitudeFt: Number(e.target.value) })} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Min time (s)</label>
                  <input type="number" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                    value={settings.targetTimeMinSec}
                    onChange={(e) => persistSettings({ ...settings, targetTimeMinSec: Number(e.target.value) })} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Max time (s)</label>
                  <input type="number" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                    value={settings.targetTimeMaxSec}
                    onChange={(e) => persistSettings({ ...settings, targetTimeMaxSec: Number(e.target.value) })} />
                </div>
              </div>
            </section>

            <section style={{ marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Cloud upload cutoff</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
                Flights before this date are never uploaded to the cloud, so a device still
                holding last season's log can't overwrite the new season's cloud db.
                Bump this at the start of each season.
              </p>
              <input type="date" className="form-input" style={{ padding: '0.6rem' }}
                value={settings.uploadCutoffDate}
                onChange={(e) => persistSettings({ ...settings, uploadCutoffDate: e.target.value })} />
            </section>

            <section style={{ marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Altitude bias correction</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
                Positive value = the rocket flies <em>higher</em> than the table predicts; negative = lower.
                The Values tab uses this to nudge the recommended weight (≈ 0.6 g per ft).
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <input
                  type="range" min={-30} max={30} step={1}
                  value={settings.altitudeBiasFt}
                  onChange={(e) => persistSettings({ ...settings, altitudeBiasFt: Number(e.target.value) })}
                  style={{ flex: 1 }}
                />
                <input
                  type="number"
                  value={settings.altitudeBiasFt}
                  onChange={(e) => persistSettings({ ...settings, altitudeBiasFt: Number(e.target.value) })}
                  className="form-input"
                  style={{ width: '5rem', padding: '0.5rem' }}
                />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>ft</span>
              </div>
              {suggestedBiasFt !== null && (
                <div style={{
                  marginTop: '0.6rem', padding: '0.55rem 0.8rem',
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  borderRadius: '0.4rem',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
                }}>
                  <div style={{ fontSize: '0.85rem' }}>
                    Suggested from {biasFlights.length} flight{biasFlights.length === 1 ? '' : 's'}:
                    <strong style={{ marginLeft: '0.4rem' }}>
                      {suggestedBiasFt > 0 ? '+' : ''}{suggestedBiasFt} ft
                    </strong>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
                      (mean actual − target). Once the regression is in charge of weight
                      recommendations (≥4 flights), the bias slider mostly stops mattering.
                    </span>
                  </div>
                  <button
                    onClick={() => persistSettings({ ...settings, altitudeBiasFt: suggestedBiasFt })}
                    disabled={settings.altitudeBiasFt === suggestedBiasFt}
                    className="btn btn-outline"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                  >
                    Apply
                  </button>
                </div>
              )}
            </section>

            <section style={{ marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Reference air density</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
                The density (kg/m³) on the day the calibration table was anchored. Standard ISA = 1.225.
                Snapshot today's density once your calibration is trusted.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input type="number" step="0.0001" className="form-input"
                  style={{ width: '8rem', padding: '0.5rem' }}
                  value={settings.referenceDensityKgM3}
                  onChange={(e) => persistSettings({ ...settings, referenceDensityKgM3: Number(e.target.value) })} />
                <button onClick={() => persistSettings({ ...settings, referenceDensityKgM3: todayDensity })}
                  className="btn btn-outline" style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem' }}
                  title="Set reference to today's computed density">
                  Snapshot today ({todayDensity.toFixed(4)})
                </button>
                <button onClick={() => persistSettings({ ...settings, referenceDensityKgM3: STANDARD_DENSITY_KG_M3 })}
                  className="btn btn-outline" style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem' }}>
                  Reset to ISA
                </button>
              </div>
            </section>

            <section style={{ marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Parachute</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
                One-time geometry. Effective area = full disk minus spill hole; C<sub>D</sub>·A drives the
                terminal-velocity solver. Rubber-band recommendation back-fits A<sub>eff</sub>(rb_cm) from
                any calibration rows that carry a <em>duration</em>.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Chute diameter (in)</label>
                  <input type="number" step="0.1" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                    value={settings.chute.diameterIn}
                    onChange={(e) => persistSettings({ ...settings, chute: { ...settings.chute, diameterIn: Number(e.target.value) } })} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Spill-hole diameter (in)</label>
                  <input type="number" step="0.1" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                    value={settings.chute.spillHoleDiameterIn}
                    onChange={(e) => persistSettings({ ...settings, chute: { ...settings.chute, spillHoleDiameterIn: Number(e.target.value) } })} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Material C<sub>D</sub></label>
                  <input type="number" step="0.01" className="form-input" style={{ width: '100%', padding: '0.6rem' }}
                    value={settings.chute.materialCD}
                    onChange={(e) => persistSettings({ ...settings, chute: { ...settings.chute, materialCD: Number(e.target.value) } })} />
                </div>
              </div>
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                A<sub>eff</sub> = {chuteEffectiveAreaM2(settings.chute).toFixed(4)} m² &nbsp;·&nbsp;
                C<sub>D</sub>·A = {chuteCDA(settings.chute).toFixed(4)} m²
              </div>
            </section>

            <section>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '1rem', margin: 0 }}>Launch fields</h3>
                <button onClick={addLaunchField} className="btn btn-outline"
                  style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                  <Plus size={14} /> Add
                </button>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Active field</label>
                <select className="form-input" style={{ width: '100%', padding: '0.6rem', marginBottom: '1rem' }}
                  value={settings.activeFieldId}
                  onChange={(e) => persistSettings({ ...settings, activeFieldId: e.target.value })}>
                  {settings.launchFields.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              {settings.launchFields.map(f => (
                <div key={f.id} className="launch-field-row" style={{
                  padding: '0.75rem', marginBottom: '0.5rem',
                  background: 'var(--bg-tertiary)', borderRadius: '0.5rem',
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'center'
                }}>
                  <input type="text" className="form-input" style={{ padding: '0.4rem' }}
                    placeholder="Field name"
                    value={f.name}
                    onChange={(e) => updateLaunchField(f.id, { name: e.target.value })} />
                  <input type="number" step="any" className="form-input" style={{ padding: '0.4rem' }}
                    placeholder="lat"
                    value={f.lat}
                    onChange={(e) => updateLaunchField(f.id, { lat: Number(e.target.value) })} />
                  <input type="number" step="any" className="form-input" style={{ padding: '0.4rem' }}
                    placeholder="lon"
                    value={f.lon}
                    onChange={(e) => updateLaunchField(f.id, { lon: Number(e.target.value) })} />
                  <button onClick={() => removeLaunchField(f.id)}
                    className="btn btn-outline" style={{ padding: '0.4rem 0.5rem' }}
                    title="Remove field">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
