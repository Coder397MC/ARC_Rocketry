import { useState, useEffect, useRef } from 'react';
import { Rocket, Save, Play, Pause, RotateCcw } from 'lucide-react';
import { INITIAL_CALIBRATION_DATA } from './data/calibration';
import type { CalibrationRow } from './types';
import { StorageService } from './services/storage';

type Tab = 'values' | 'timer' | 'checklist';

const CHECKLIST_ITEMS = [
  'write down the last record',
  'motor build',
  'set up altimeter',
  'set rubber band on parachute',
  'pack parachute',
  'weight adjust',
  'ignitor setup',
  'bring sandpaper, paper, masking tape',
];

export default function App() {
  const [tab, setTab] = useState<Tab>('values');
  const [data, setData] = useState<CalibrationRow[]>([]);
  const [targetHeight, setTargetHeight] = useState('');
  const [windspeed, setWindspeed] = useState('');

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
      setData(loadedCal);
    } else {
      setData(INITIAL_CALIBRATION_DATA);
      StorageService.saveCalibration(INITIAL_CALIBRATION_DATA);
    }
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

  const handleSave = () => {
    StorageService.saveCalibration(data);
    alert('Calibration data saved successfully!');
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
  const windNum = parseFloat(windspeed);
  const hasTarget = !isNaN(targetNum);
  const hasWind = !isNaN(windNum);

  let weight: number | null = null;
  let rubberBand: number | null = null;

  if (hasTarget && hasWind && data.length > 0) {
    const row = data.find(r => r.targetHeight === targetNum);
    if (row) weight = Number(row.requiredWeight) - windNum;
    // Calibration endpoints (725→14, 775→26) were recorded at ~5 mph wind,
    // so subtract that wind contribution to get the no-wind base.
    const CALIB_WIND = 5;
    const base = 14 + (targetNum - 725) * (26 - 14) / (775 - 725) - 0.4 * CALIB_WIND;
    rubberBand = base + 0.4 * windNum;
  }

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 1.5rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--bg-tertiary)', gap: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.25rem', fontWeight: 'bold' }}>
          <Rocket className="text-accent" /> ARC Analytics
        </div>
        {tab === 'values' && (
          <button onClick={handleSave} className="btn btn-primary" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Save size={16} /> Save
          </button>
        )}
      </header>

      {/* Tabs */}
      <nav style={{ display: 'flex', borderBottom: '1px solid var(--bg-tertiary)', background: 'var(--bg-secondary)', width: '100%' }}>
        {tabBtn('values', 'Values')}
        {tabBtn('timer', 'Timer')}
        {tabBtn('checklist', 'Checklist')}
      </nav>

      <main style={{ padding: '2rem 1.5rem', display: 'flex', justifyContent: 'center' }}>
        {tab === 'values' && (
          <div className="card" style={{ padding: '2rem', width: '100%', maxWidth: '720px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Target Height (ft)</label>
                <input type="number" className="form-input" placeholder="e.g. 750"
                  style={{ width: '100%', padding: '0.75rem' }}
                  value={targetHeight} onChange={(e) => setTargetHeight(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Windspeed (mph)</label>
                <input type="number" className="form-input" placeholder="e.g. 5"
                  style={{ width: '100%', padding: '0.75rem' }}
                  value={windspeed} onChange={(e) => setWindspeed(e.target.value)} />
              </div>
            </div>

            {hasTarget && hasWind && (
              <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div style={{ padding: '1.25rem', background: 'rgba(56, 189, 248, 0.08)', borderRadius: '0.5rem', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Weight (g)</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                    {weight !== null ? weight.toFixed(1) : 'N/A'}
                  </div>
                  {weight === null && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      No table entry for {targetNum} ft
                    </div>
                  )}
                </div>
                <div style={{ padding: '1.25rem', background: 'rgba(56, 189, 248, 0.08)', borderRadius: '0.5rem', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Rubber Band Position (cm)</div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                    {rubberBand !== null ? rubberBand.toFixed(2) : 'N/A'}
                  </div>
                  {rubberBand !== null && (targetNum < 725 || targetNum > 775) && (
                    <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: '0.25rem' }}>
                      Extrapolated outside 725–775 ft range
                    </div>
                  )}
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
      </main>
    </div>
  );
}
