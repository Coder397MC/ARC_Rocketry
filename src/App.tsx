import React, { useState, useEffect } from 'react';
import { Rocket, Save, Search } from 'lucide-react';
import { INITIAL_CALIBRATION_DATA } from './data/calibration';
import type { CalibrationRow } from './types';
import { StorageService } from './services/storage';

export default function App() {
  const [data, setData] = useState<CalibrationRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  useEffect(() => {
    const loadedCal = StorageService.getCalibration();
    if (loadedCal && loadedCal.length > 0) {
      setData(loadedCal);
    } else {
      setData(INITIAL_CALIBRATION_DATA);
      StorageService.saveCalibration(INITIAL_CALIBRATION_DATA);
    }
  }, []);

  const handleChange = (originalIndex: number, field: keyof CalibrationRow, value: string) => {
    const next = [...data];
    if (field === 'wind') {
      (next[originalIndex] as any)[field] = value;
    } else {
      const numValue = parseFloat(value);
      (next[originalIndex] as any)[field] = isNaN(numValue) && value !== '' ? 0 : value === '' ? '' : numValue;
    }
    setData(next);
  };

  const handleSave = () => {
    StorageService.saveCalibration(data);
    alert('Calibration data saved successfully!');
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedSearch(searchTerm);
  };

  const clearSearch = () => {
    setSearchTerm('');
    setAppliedSearch('');
  };

  const filteredData = appliedSearch 
    ? data.filter(row => row.targetHeight.toString() === appliedSearch)
    : data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-primary)' }}>
      {/* Top Header */}
      <header style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        padding: '1rem 1.5rem', 
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--bg-tertiary)',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        {/* Left: Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.25rem', fontWeight: 'bold' }}>
          <Rocket className="text-accent" /> ARC Analytics
        </div>
        
        {/* Middle: Search Box */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem', flex: '1 1 300px', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '400px' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="number" 
              className="form-input" 
              placeholder="Search Target Height (ft)..." 
              style={{ paddingLeft: '2.5rem', width: '100%' }}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ padding: '0.5rem 1rem' }}>
            Search
          </button>
          {appliedSearch && (
            <button type="button" onClick={clearSearch} className="btn btn-outline" style={{ padding: '0.5rem 1rem' }}>
              Clear
            </button>
          )}
        </form>

        {/* Right: Save Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleSave} className="btn btn-primary" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Save size={16} /> Save
          </button>
        </div>
      </header>

      {/* Main Content: Excel Sheet */}
      <main style={{ flex: 1, overflow: 'hidden', padding: '1rem' }}>
        <div className="card" style={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', minWidth: '600px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr style={{ textAlign: 'left', background: 'var(--bg-tertiary)', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '1rem 0.5rem' }}>Target (ft)</th>
                  <th style={{ padding: '1rem 0.5rem' }}>Weight (g)</th>
                  <th style={{ padding: '1rem 0.5rem' }}>Drill (s)</th>
                  <th style={{ padding: '1rem 0.5rem' }}>Duration (s)</th>
                  <th style={{ padding: '1rem 0.5rem' }}>Temp (°F)</th>
                  <th style={{ padding: '1rem 0.5rem' }}>Wind</th>
                  <th style={{ padding: '1rem 0.5rem' }}>Hum (%)</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((row) => {
                  // Find the original index in the main data array to update correctly
                  const originalIndex = data.findIndex(r => r === row);
                  return (
                    <tr key={originalIndex} style={{ borderBottom: '1px solid var(--bg-tertiary)' }}>
                      <td style={{ padding: '0.25rem' }}>
                        <input 
                          type="number" 
                          className="form-input" 
                          style={{ padding: '0.5rem', border: 'none', background: 'transparent', width: '100%' }} 
                          value={row.targetHeight} 
                          onChange={e => handleChange(originalIndex, 'targetHeight', e.target.value)}
                        />
                      </td>
                      <td style={{ padding: '0.25rem' }}>
                        <input 
                          type="number" 
                          className="form-input" 
                          style={{ padding: '0.5rem', border: 'none', background: 'rgba(56, 189, 248, 0.05)', width: '100%' }} 
                          value={row.requiredWeight} 
                          onChange={e => handleChange(originalIndex, 'requiredWeight', e.target.value)}
                        />
                      </td>
                      <td style={{ padding: '0.25rem' }}>
                        <input 
                          type="number" 
                          className="form-input" 
                          style={{ padding: '0.5rem', border: 'none', background: 'transparent', width: '100%' }} 
                          value={row.drill} 
                          onChange={e => handleChange(originalIndex, 'drill', e.target.value)}
                        />
                      </td>
                      <td style={{ padding: '0.25rem' }}>
                        <input 
                          type="number" 
                          className="form-input" 
                          style={{ padding: '0.5rem', border: 'none', background: 'transparent', width: '100%' }} 
                          value={row.duration === undefined ? '' : row.duration} 
                          onChange={e => handleChange(originalIndex, 'duration', e.target.value)}
                        />
                      </td>
                      <td style={{ padding: '0.25rem' }}>
                        <input 
                          type="number" 
                          className="form-input" 
                          style={{ padding: '0.5rem', border: 'none', background: 'transparent', width: '100%' }} 
                          value={row.temp === undefined ? '' : row.temp} 
                          onChange={e => handleChange(originalIndex, 'temp', e.target.value)}
                        />
                      </td>
                      <td style={{ padding: '0.25rem' }}>
                        <input 
                          type="text" 
                          className="form-input" 
                          style={{ padding: '0.5rem', border: 'none', background: 'transparent', width: '100%' }} 
                          value={row.wind || ''} 
                          onChange={e => handleChange(originalIndex, 'wind', e.target.value)}
                        />
                      </td>
                      <td style={{ padding: '0.25rem' }}>
                        <input 
                          type="number" 
                          className="form-input" 
                          style={{ padding: '0.5rem', border: 'none', background: 'transparent', width: '100%' }} 
                          value={row.humidity === undefined ? '' : row.humidity} 
                          onChange={e => handleChange(originalIndex, 'humidity', e.target.value)}
                        />
                      </td>
                    </tr>
                  )
                })}
                {filteredData.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No calibration records found for target height "{appliedSearch}".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
