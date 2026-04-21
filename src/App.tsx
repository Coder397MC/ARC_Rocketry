import React, { useState, useEffect, useMemo } from 'react';
import { 
  Rocket, 
  Plus, 
  History, 
  BarChart3, 
  TrendingUp, 
  AlertTriangle,
  Target,
  Clock,
  Trash2,
  Table,
  Save,
  FileSpreadsheet
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  ReferenceLine,
  AreaChart,
  Area
} from 'recharts';
import type { Flight, CalibrationRow } from './types';
import { APPROVED_MOTORS } from './data/motors';
import { INITIAL_CALIBRATION_DATA } from './data/calibration';
import { StorageService } from './services/storage';
import { calculateScore, diagnoseFlight, TARGET_ALTITUDE, TARGET_TIME_MIN, TARGET_TIME_MAX } from './services/analysis';

// --- Dashboard Component ---
const Dashboard = ({ flights }: { flights: Flight[] }) => {
  const stats = useMemo(() => {
    if (flights.length === 0) return null;
    const scores = flights.map(f => calculateScore(f).totalScore);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const lastScore = scores[flights.length - 1];
    const trend = flights.length > 1 ? lastScore - scores[flights.length - 2] : 0;
    const altStdDev = Math.sqrt(flights.map(f => Math.pow(f.altitude - TARGET_ALTITUDE, 2)).reduce((a, b) => a + b, 0) / flights.length);

    return { avgScore, lastScore, trend, altStdDev };
  }, [flights]);

  const chartData = useMemo(() => {
    return flights.map((f, i) => ({
      name: `F${i + 1}`,
      altitude: f.altitude,
      time: f.time,
      score: calculateScore(f).totalScore
    }));
  }, [flights]);

  if (flights.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <Rocket size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
        <h3>No Flight Data Yet</h3>
        <p style={{ color: 'var(--text-secondary)' }}>Log your first flight to start tracking performance convergence.</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Last Score</div>
          <div className="stat-value">{stats?.lastScore.toFixed(1)}</div>
          <div style={{ fontSize: '0.75rem', color: (stats?.trend || 0) <= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {(stats?.trend || 0) <= 0 ? '↓ Improving' : '↑ Increasing'}
          </div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: 'var(--accent-secondary)' }}>
          <div className="stat-label">Avg Altitude Error</div>
          <div className="stat-value">{stats?.altStdDev.toFixed(1)} <span style={{fontSize: '0.875rem', color: 'var(--text-muted)'}}>ft</span></div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: 'var(--success)' }}>
          <div className="stat-label">Stability Margin</div>
          <div className="stat-value">{(100 - (stats?.altStdDev || 0) / 2).toFixed(0)}%</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {(stats?.altStdDev || 0) < 15 ? 'Finals Ready' : 'High Variance'}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card">
          <div className="card-title"><Target size={18} /> Altitude Convergence</div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" domain={['dataMin - 50', 'dataMax + 50']} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                  itemStyle={{ color: '#f8fafc' }}
                />
                <ReferenceLine y={TARGET_ALTITUDE} stroke="var(--success)" strokeDasharray="5 5" label={{ value: '750ft', fill: 'var(--success)', position: 'insideTopRight' }} />
                <Line type="monotone" dataKey="altitude" stroke="#38bdf8" strokeWidth={3} dot={{ r: 6, fill: '#38bdf8' }} activeDot={{ r: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-title"><Clock size={18} /> Time Window Stability</div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" domain={[0, 50]} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                  itemStyle={{ color: '#f8fafc' }}
                />
                <ReferenceLine y={TARGET_TIME_MIN} stroke="var(--warning)" strokeDasharray="3 3" />
                <ReferenceLine y={TARGET_TIME_MAX} stroke="var(--warning)" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="time" stroke="#fb923c" fill="rgba(251, 146, 60, 0.2)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><AlertTriangle size={18} /> Diagnostic Engine Outputs</div>
        <div className="diagnostics-list">
          {flights.length > 0 && diagnoseFlight(flights[flights.length - 1], flights).map((d: any, i: number) => (
            <div key={i} className={`diagnostic-item severity-${d.severity}`} style={{
              padding: '1rem',
              borderRadius: 'var(--radius-md)',
              borderLeft: '4px solid',
              borderColor: d.severity === 'high' ? 'var(--danger)' : d.severity === 'medium' ? 'var(--warning)' : 'var(--accent-primary)',
              backgroundColor: 'rgba(255,255,255,0.02)',
              marginBottom: '0.75rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{d.title}</span>
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', opacity: 0.8 }}>Phase: {d.phase}</span>
              </div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{d.description}</p>
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontWeight: '600', fontSize: '0.875rem', color: 'var(--accent-primary)' }}>Action Plan:</div>
                <div style={{ fontSize: '0.875rem' }}>{d.recommendation}</div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <strong>Physics:</strong> {d.physicsReasoning}
                </div>
                <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--success)', fontWeight: '600' }}>
                  Result: {d.directionalEffect}
                </div>
              </div>
            </div>
          ))}
          {flights.length > 0 && diagnoseFlight(flights[flights.length - 1], flights).length === 0 && (
            <div style={{ color: 'var(--success)', textAlign: 'center', padding: '1rem' }}>
              <TrendingUp size={24} style={{ marginBottom: '0.5rem' }} />
              <div>Optimal Flight Performance Detected. Minimum variance observed.</div>
            </div>
          )}
        </div>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-title"><BarChart3 size={18} /> Systematic Pattern Analysis</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div style={{ border: '1px solid var(--bg-tertiary)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>ALTITUDE BIAS</div>
            <div style={{ fontSize: '0.9rem' }}>
              {flights.every(f => f.altitude > TARGET_ALTITUDE) ? "Systematic Overshoot Detected" : 
               flights.every(f => f.altitude < TARGET_ALTITUDE) ? "Systematic Undershoot Detected" : "Balanced Distribution"}
            </div>
          </div>
          <div style={{ border: '1px solid var(--bg-tertiary)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>TIME/ALT TRADEOFF</div>
            <div style={{ fontSize: '0.9rem' }}>
              {flights.length > 2 && flights[flights.length-1].altitude < TARGET_ALTITUDE && flights[flights.length-1].time > TARGET_TIME_MAX 
                ? "Low Energy / Slow Descent (Imbalanced)" : "Energy/Drag Balanced"}
            </div>
          </div>
          <div style={{ border: '1px solid var(--bg-tertiary)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>WIND SENSITIVITY</div>
            <div style={{ fontSize: '0.9rem' }}>
              {flights.some(f => f.windLevel === 'high' && Math.abs(f.altitude - TARGET_ALTITUDE) > 30) 
                 ? "Critical Wind Impact Detected" : "Stable Cross-Conditioning"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Flight Log Component ---
const FlightLog = ({ flights, onDelete }: { flights: Flight[], onDelete: (id: string) => void }) => {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--bg-tertiary)' }}>
        <div className="card-title" style={{ margin: 0 }}><History size={18} /> Raw Flight Telemetry</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', background: 'rgba(0,0,0,0.2)' }}>
              <th style={{ padding: '1rem' }}>Date</th>
              <th style={{ padding: '1rem' }}>Motor</th>
              <th style={{ padding: '1rem' }}>Altitude</th>
              <th style={{ padding: '1rem' }}>Time</th>
              <th style={{ padding: '1rem' }}>Mass</th>
              <th style={{ padding: '1rem' }}>Score</th>
              <th style={{ padding: '1rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {flights.map((f: Flight) => {
              const score = calculateScore(f);
              const motor = APPROVED_MOTORS.find(m => m.id === f.motorId);
              return (
                <tr key={f.id} style={{ borderBottom: '1px solid var(--bg-tertiary)' }}>
                  <td style={{ padding: '1rem' }}>{new Date(f.date).toLocaleDateString()}</td>
                  <td style={{ padding: '1rem' }}>{motor ? motor.designation : 'Unknown'}</td>
                  <td style={{ padding: '1rem', color: Math.abs(f.altitude-750) < 10 ? 'var(--success)' : 'var(--text-primary)' }}>{f.altitude} ft</td>
                  <td style={{ padding: '1rem', color: (f.time >= 36 && f.time <= 39) ? 'var(--success)' : 'var(--text-primary)' }}>{f.time}s</td>
                  <td style={{ padding: '1rem' }}>{f.rocketMass}g</td>
                  <td style={{ padding: '1rem', fontWeight: 'bold' }}>{score.totalScore.toFixed(1)}</td>
                  <td style={{ padding: '1rem' }}>
                    <button 
                      onClick={() => onDelete(f.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- Add Flight Form ---
const AddFlight = ({ onAdd }: { onAdd: (f: Flight) => void }) => {
  const [formData, setFormData] = useState({
    altitude: '',
    time: '',
    motorId: 'f63-10r',
    mass: '',
    parachuteDiameter: '',
    windLevel: 'low' as const,
    notes: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.altitude || !formData.time) return;

    onAdd({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      altitude: parseFloat(formData.altitude),
      time: parseFloat(formData.time),
      motorId: formData.motorId,
      rocketMass: parseFloat(formData.mass) || 0,
      parachuteDiameter: parseFloat(formData.parachuteDiameter) || 0,
      windLevel: formData.windLevel,
      notes: formData.notes
    });

    setFormData({
      ...formData,
      altitude: '',
      time: '',
      notes: ''
    });
  };

  return (
    <div className="card">
      <div className="card-title"><Plus size={18} /> Log Competition Flight</div>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Altitude (ft)</label>
            <input 
              type="number" 
              className="form-input" 
              value={formData.altitude} 
              onChange={e => setFormData({...formData, altitude: e.target.value})} 
              placeholder="e.g. 748"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Flight Time (s)</label>
            <input 
              type="number" 
              step="0.01" 
              className="form-input" 
              value={formData.time} 
              onChange={e => setFormData({...formData, time: e.target.value})} 
              placeholder="e.g. 37.5"
              required
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Motor Type (Fixed)</label>
            <input 
              type="text" 
              className="form-input" 
              value="AeroTech F63-10R (49.5 Ns)" 
              disabled 
              style={{ backgroundColor: 'var(--bg-primary)', opacity: 0.7 }}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Launch Mass (g)</label>
            <input 
              type="number" 
              className="form-input" 
              value={formData.mass} 
              onChange={e => setFormData({...formData, mass: e.target.value})} 
              placeholder="Total weight with motor"
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Wind Conditions</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {['low', 'medium', 'high'].map(level => (
              <button
                key={level}
                type="button"
                className={`btn btn-outline`}
                style={{ flex: 1, textTransform: 'capitalize', borderColor: formData.windLevel === level ? 'var(--accent-primary)' : '' }}
                onClick={() => setFormData({...formData, windLevel: level as any})}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea 
            className="form-textarea" 
            value={formData.notes} 
            onChange={e => setFormData({...formData, notes: e.target.value})} 
            rows={3}
            placeholder="Rail angle, weather notes, etc."
          ></textarea>
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
          Finalize Flight Record
        </button>
      </form>
    </div>
  );
};

// --- Calibration Sheet Component ---
const CalibrationSheet = ({ data, onUpdate }: { data: CalibrationRow[], onUpdate: (data: CalibrationRow[]) => void }) => {
  const [localData, setLocalData] = useState(data);

  const handleChange = (index: number, field: keyof CalibrationRow, value: string) => {
    const next = [...localData];
    const numValue = field === 'wind' ? value : parseFloat(value);
    (next[index] as any)[field] = isNaN(numValue as any) && field !== 'wind' ? 0 : numValue;
    setLocalData(next);
  };

  const handleSave = () => {
    onUpdate(localData);
    alert('Calibration data saved to local storage.');
  };

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--bg-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="card-title" style={{ margin: 0 }}><FileSpreadsheet size={18} /> Performance Calibration Sheet</div>
        <button onClick={handleSave} className="btn btn-primary" style={{ padding: '0.5rem 1rem' }}>
          <Save size={16} /> Save Changes
        </button>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <tr style={{ textAlign: 'left', background: 'var(--bg-tertiary)' }}>
              <th style={{ padding: '0.75rem' }}>Target (ft)</th>
              <th style={{ padding: '0.75rem' }}>Weight (g)</th>
              <th style={{ padding: '0.75rem' }}>Drill (s)</th>
              <th style={{ padding: '0.75rem' }}>Duration (s)</th>
              <th style={{ padding: '0.75rem' }}>Temp (F)</th>
              <th style={{ padding: '0.75rem' }}>Wind</th>
              <th style={{ padding: '0.75rem' }}>Hum (%)</th>
            </tr>
          </thead>
          <tbody>
            {localData.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--bg-tertiary)' }}>
                <td style={{ padding: '0.25rem' }}>
                  <input 
                    type="number" 
                    className="form-input" 
                    style={{ padding: '0.25rem', border: 'none', background: 'transparent' }} 
                    value={row.targetHeight} 
                    onChange={e => handleChange(i, 'targetHeight', e.target.value)}
                  />
                </td>
                <td style={{ padding: '0.25rem' }}>
                  <input 
                    type="number" 
                    className="form-input" 
                    style={{ padding: '0.25rem', border: 'none', background: 'rgba(56, 189, 248, 0.05)' }} 
                    value={row.requiredWeight} 
                    onChange={e => handleChange(i, 'requiredWeight', e.target.value)}
                  />
                </td>
                <td style={{ padding: '0.25rem' }}>
                  <input 
                    type="number" 
                    className="form-input" 
                    style={{ padding: '0.25rem', border: 'none', background: 'transparent' }} 
                    value={row.drill} 
                    onChange={e => handleChange(i, 'drill', e.target.value)}
                  />
                </td>
                <td style={{ padding: '0.25rem' }}>
                  <input 
                    type="number" 
                    className="form-input" 
                    style={{ padding: '0.25rem', border: 'none', background: 'transparent' }} 
                    value={row.duration || ''} 
                    onChange={e => handleChange(i, 'duration', e.target.value)}
                  />
                </td>
                <td style={{ padding: '0.25rem' }}>
                  <input 
                    type="number" 
                    className="form-input" 
                    style={{ padding: '0.25rem', border: 'none', background: 'transparent' }} 
                    value={row.temp || ''} 
                    onChange={e => handleChange(i, 'temp', e.target.value)}
                  />
                </td>
                <td style={{ padding: '0.25rem' }}>
                  <input 
                    type="text" 
                    className="form-input" 
                    style={{ padding: '0.25rem', border: 'none', background: 'transparent' }} 
                    value={row.wind || ''} 
                    onChange={e => handleChange(i, 'wind', e.target.value)}
                  />
                </td>
                <td style={{ padding: '0.25rem' }}>
                  <input 
                    type="number" 
                    className="form-input" 
                    style={{ padding: '0.25rem', border: 'none', background: 'transparent' }} 
                    value={row.humidity || ''} 
                    onChange={e => handleChange(i, 'humidity', e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- Main App Component ---
export default function App() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [calibrationData, setCalibrationData] = useState<CalibrationRow[]>([]);
  const [activeTab, setActiveTab] = useState<'dash' | 'log' | 'add' | 'cal'>('dash');

  useEffect(() => {
    const loadedFlights = StorageService.getFlights();
    if (loadedFlights.length === 0) {
      const demoFlights: Flight[] = [
        { id: '1', date: new Date(Date.now() - 86400000 * 3).toISOString(), altitude: 785, time: 34.2, motorId: 'f63-10r', rocketMass: 642, parachuteDiameter: 18, windLevel: 'low', notes: 'First test' },
        { id: '2', date: new Date(Date.now() - 86400000 * 2).toISOString(), altitude: 765, time: 35.8, motorId: 'f63-10r', rocketMass: 648, parachuteDiameter: 18, windLevel: 'medium', notes: 'Added 6g weight' },
        { id: '3', date: new Date(Date.now() - 86400000 * 1).toISOString(), altitude: 748, time: 37.1, motorId: 'f63-10r', rocketMass: 652, parachuteDiameter: 18, windLevel: 'low', notes: 'Near perfect' },
      ];
      setFlights(demoFlights);
      demoFlights.forEach(f => StorageService.saveFlight(f));
    } else {
      setFlights(loadedFlights);
    }

    const loadedCal = StorageService.getCalibration();
    if (!loadedCal) {
      setCalibrationData(INITIAL_CALIBRATION_DATA);
      StorageService.saveCalibration(INITIAL_CALIBRATION_DATA);
    } else {
      setCalibrationData(loadedCal);
    }
  }, []);

  const handleUpdateCalibration = (data: CalibrationRow[]) => {
    setCalibrationData(data);
    StorageService.saveCalibration(data);
  };

  const handleAddFlight = (f: Flight) => {
    setFlights([...flights, f]);
    StorageService.saveFlight(f);
    setActiveTab('dash');
  };

  const handleDeleteFlight = (id: string) => {
    const next = flights.filter(f => f.id !== id);
    setFlights(next);
    StorageService.deleteFlight(id);
  };

  return (
    <div className="app-container">
      <div className="hero-banner"></div>
      <header>
        <div>
          <div className="logo"><Rocket /> ARC ANALYTICS <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>2026</span></div>
          <div className="subtitle">High Precision Flight Iteration & Diagnostic Engine</div>
        </div>
        <div style={{ textAlign: 'right', display: 'none' /* Hidden on mobile */ }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>TEAM READY STATUS</div>
          <div style={{ color: 'var(--success)', fontWeight: 'bold' }}>FINALS QUALIFIED</div>
        </div>
      </header>

      <nav className="nav-tabs">
        <div className={`nav-tab ${activeTab === 'dash' ? 'active' : ''}`} onClick={() => setActiveTab('dash')}>
          <BarChart3 size={18} style={{ display: 'block', margin: '0 auto 0.25rem' }} /> Dashboard
        </div>
        <div className={`nav-tab ${activeTab === 'log' ? 'active' : ''}`} onClick={() => setActiveTab('log')}>
          <History size={18} style={{ display: 'block', margin: '0 auto 0.25rem' }} /> History
        </div>
        <div className={`nav-tab ${activeTab === 'add' ? 'active' : ''}`} onClick={() => setActiveTab('add')}>
          <Plus size={18} style={{ display: 'block', margin: '0 auto 0.25rem' }} /> New Flight
        </div>
        <div className={`nav-tab ${activeTab === 'cal' ? 'active' : ''}`} onClick={() => setActiveTab('cal')}>
          <Table size={18} style={{ display: 'block', margin: '0 auto 0.25rem' }} /> Calibration
        </div>
      </nav>

      <div style={{ background: 'rgba(56, 189, 248, 0.1)', border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <Target className="text-accent" />
        <div style={{ fontSize: '0.875rem' }}>
          <strong>Finals Strategy:</strong> {flights.length > 0 ? (
            calculateScore(flights[flights.length - 1]).totalScore < 10 && flights.length > 2 
            ? "Your current setup is score-optimal but monitor wind variation for final stability."
            : "Focus on reducing altitude variance. Within 20ft of target but consistency is below finals grade."
          ) : "Initialize flight profile to generate finals strategy intelligence."}
        </div>
      </div>

      <main style={{ flex: 1 }}>
        {activeTab === 'dash' && <Dashboard flights={flights} />}
        {activeTab === 'log' && <FlightLog flights={flights} onDelete={handleDeleteFlight} />}
        {activeTab === 'add' && <AddFlight onAdd={handleAddFlight} />}
        {activeTab === 'cal' && <CalibrationSheet data={calibrationData} onUpdate={handleUpdateCalibration} />}
      </main>

      <footer style={{ marginTop: '3rem', padding: '1rem 0', borderTop: '1px solid var(--bg-tertiary)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
        TARC 2026 Finals Optimization Tool • Physics-Based Recommendation Engine
      </footer>
    </div>
  );
}
