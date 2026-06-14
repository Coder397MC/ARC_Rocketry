// Flight log: storage CRUD + CSV import/export.
//
// CSV import is tolerant — header names are matched case-insensitively against
// known aliases. The anchor-flights.csv format the coach already provided is
// the canonical schema:
//   Date, Target height (feet), Weight (g), Actual height (feet),
//   Duration (second), Rubber band location (cm), Wind Speed (mph)

import type { Flight, LaunchField } from '../types';
import { StorageService } from './storage';
import { fetchHistoricalWeather } from './weather';
import { FlightsRepo } from './db/flightsRepo';
import { initDB } from './db/sqliteDB';

const LEGACY_FLIGHTS_KEY = 'arc_rocketry_flights';

/** Run on app boot. Loads SQLite, migrates any legacy localStorage flights. */
export async function bootFlightLog(): Promise<void> {
  await initDB();
  const existing = FlightsRepo.list();
  if (existing.length > 0) return;

  // One-time migration from the old localStorage key.
  const raw = typeof localStorage !== 'undefined'
    ? localStorage.getItem(LEGACY_FLIGHTS_KEY)
    : null;
  if (!raw) return;
  try {
    const legacy = JSON.parse(raw) as Flight[];
    if (Array.isArray(legacy) && legacy.length > 0) {
      await FlightsRepo.insertMany(legacy);
      // Stash the old payload under a backup key, then drop the live key, so
      // we don't double-migrate next reload but the user can recover if needed.
      localStorage.setItem(`${LEGACY_FLIGHTS_KEY}_backup`, raw);
      localStorage.removeItem(LEGACY_FLIGHTS_KEY);
    }
  } catch {
    // ignore — bad JSON in legacy slot
  }
}

export const FlightLog = {
  list(): Flight[] {
    return FlightsRepo.list();
  },
  async saveAll(flights: Flight[]): Promise<void> {
    await FlightsRepo.replaceAll(flights);
  },
  async add(f: Flight): Promise<void> {
    await FlightsRepo.insert(f);
  },
  async update(f: Flight): Promise<void> {
    // INSERT OR REPLACE under the hood — same id replaces the existing row.
    await FlightsRepo.insert(f);
  },
  async remove(id: string): Promise<void> {
    await FlightsRepo.remove(id);
  },
};

// Keep StorageService import alive — referenced elsewhere via re-export
// patterns and we don't want a tree-shake to hide it.
void StorageService;

// ---------- CSV ----------

const HEADER_ALIASES: Record<string, string[]> = {
  date: ['date'],
  targetAltitude: ['target height (feet)', 'target', 'target_ft', 'target altitude'],
  rocketMass: ['weight (g)', 'weight', 'mass', 'mass (g)', 'rocketmass'],
  altitude: ['actual height (feet)', 'altitude', 'altitude (ft)', 'actual'],
  time: ['duration (second)', 'duration (s)', 'duration', 'time', 'time (s)', 'total time'],
  rubberBandCm: ['rubber band location (cm)', 'rubber band', 'rb', 'rb_cm', 'rubber band (cm)'],
  windSpeedMph: ['wind speed (mph)', 'wind', 'wind speed', 'windspeed'],
  motorLot: ['motor lot', 'lot', 'batch'],
  motorAnomaly: ['motor anomaly', 'anomaly', 'motoranomaly'],
  descentTimeSec: ['descent time (s)', 'descent time', 'descent (s)'],
  tempC: ['temp (c)', 'temperature', 'temp', 'temperature (c)'],
  pressureHpa: ['pressure (hpa)', 'pressure'],
  humidityPct: ['humidity (%)', 'humidity'],
  rodAngleDeg: ['rod angle (deg)', 'rod angle'],
  notes: ['notes', 'comment', 'comments'],
};

function findColumn(headers: string[], canonical: string): number {
  const aliases = HEADER_ALIASES[canonical] ?? [canonical];
  const norm = (s: string) => s.trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    if (aliases.some((a) => h === a || h.includes(a))) return i;
  }
  return -1;
}

/** Parse `M/D/YYYY` or `YYYY-MM-DD` to ISO `YYYY-MM-DD`. */
function normalizeDate(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const [, mo, d, yRaw] = m;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y.padStart(4, '0')}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return t;
}

function splitCSVLine(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { buf += '"'; i++; }
      else if (c === '"') inQ = false;
      else buf += c;
    } else {
      if (c === ',') { out.push(buf); buf = ''; }
      else if (c === '"' && buf === '') inQ = true;
      else buf += c;
    }
  }
  out.push(buf);
  return out;
}

export interface CSVImportResult {
  flights: Flight[];
  warnings: string[];
}

export function parseFlightCSV(text: string): CSVImportResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { flights: [], warnings: ['empty csv'] };

  const headers = splitCSVLine(lines[0]);
  const idx = {
    date: findColumn(headers, 'date'),
    targetAltitude: findColumn(headers, 'targetAltitude'),
    rocketMass: findColumn(headers, 'rocketMass'),
    altitude: findColumn(headers, 'altitude'),
    time: findColumn(headers, 'time'),
    rubberBandCm: findColumn(headers, 'rubberBandCm'),
    windSpeedMph: findColumn(headers, 'windSpeedMph'),
    motorLot: findColumn(headers, 'motorLot'),
    motorAnomaly: findColumn(headers, 'motorAnomaly'),
    descentTimeSec: findColumn(headers, 'descentTimeSec'),
    tempC: findColumn(headers, 'tempC'),
    pressureHpa: findColumn(headers, 'pressureHpa'),
    humidityPct: findColumn(headers, 'humidityPct'),
    rodAngleDeg: findColumn(headers, 'rodAngleDeg'),
    notes: findColumn(headers, 'notes'),
  };

  const warnings: string[] = [];
  const required: (keyof typeof idx)[] = ['date', 'rocketMass', 'altitude'];
  for (const r of required) {
    if (idx[r] < 0) warnings.push(`missing required column: ${r}`);
  }

  const flights: Flight[] = [];
  for (let lineNo = 1; lineNo < lines.length; lineNo++) {
    const cells = splitCSVLine(lines[lineNo]);
    const cell = (j: number) => (j >= 0 ? cells[j]?.trim() ?? '' : '');
    const num = (j: number): number | undefined => {
      const v = cell(j);
      if (v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const bool = (j: number): boolean => {
      const v = cell(j).toLowerCase();
      return v === '1' || v === 'true' || v === 'yes' || v === 'y';
    };

    const massG = num(idx.rocketMass);
    const altitude = num(idx.altitude);
    const date = normalizeDate(cell(idx.date));
    if (massG === undefined || altitude === undefined || !date) {
      warnings.push(`row ${lineNo + 1} skipped: missing required field`);
      continue;
    }

    const rb = num(idx.rubberBandCm);
    const f: Flight = {
      id: `flt_${date}_${lineNo}_${Math.random().toString(36).slice(2, 7)}`,
      date,
      altitude,
      targetAltitude: num(idx.targetAltitude) ?? 0,
      rocketMass: massG,
      time: num(idx.time) ?? 0,
      duration: num(idx.time),
      rubberBandCm: rb,
      windSpeedMph: num(idx.windSpeedMph),
      tempC: num(idx.tempC),
      pressureHpa: num(idx.pressureHpa),
      humidityPct: num(idx.humidityPct),
      descentTimeSec: num(idx.descentTimeSec),
      rodAngleDeg: num(idx.rodAngleDeg),
      motorLot: cell(idx.motorLot) || undefined,
      motorAnomaly: bool(idx.motorAnomaly),
      motorId: 'F63-10R',
      parachuteDiameter: 20.5,
      windLevel:
        (num(idx.windSpeedMph) ?? 0) > 10 ? 'high'
          : (num(idx.windSpeedMph) ?? 0) >= 5 ? 'medium' : 'low',
      notes: cell(idx.notes) || '',
    };
    flights.push(f);
  }
  return { flights, warnings };
}

/** Best-effort weather backfill. Mutates each flight in place. */
export async function backfillWeather(
  flights: Flight[],
  field: LaunchField,
  onProgress?: (done: number, total: number) => void,
): Promise<{ filled: number; failed: number; errors: string[] }> {
  const errors: string[] = [];
  let filled = 0;
  let failed = 0;
  for (let i = 0; i < flights.length; i++) {
    const f = flights[i];
    if (
      typeof f.tempC === 'number' &&
      typeof f.pressureHpa === 'number' &&
      typeof f.humidityPct === 'number'
    ) {
      onProgress?.(i + 1, flights.length);
      continue;
    }
    try {
      const w = await fetchHistoricalWeather(field.lat, field.lon, f.date);
      f.tempC = f.tempC ?? w.tempC;
      f.pressureHpa = f.pressureHpa ?? w.pressureHpa;
      f.humidityPct = f.humidityPct ?? w.humidityPct;
      if (typeof f.windSpeedMph !== 'number') f.windSpeedMph = w.windSpeedMph;
      f.weatherFilled = true;
      f.launchFieldId = field.id;
      filled += 1;
    } catch (e) {
      failed += 1;
      errors.push(`${f.date}: ${e instanceof Error ? e.message : 'fetch failed'}`);
    }
    onProgress?.(i + 1, flights.length);
  }
  return { filled, failed, errors };
}

export function flightsToCSV(flights: Flight[]): string {
  const headers = [
    'Date', 'Target height (feet)', 'Weight (g)', 'Actual height (feet)',
    'Duration (second)', 'Rubber band location (cm)', 'Wind Speed (mph)',
    'Temp (C)', 'Pressure (hPa)', 'Humidity (%)', 'Descent time (s)',
    'Rod angle (deg)', 'Motor lot', 'Motor anomaly', 'Notes',
  ];
  const fmt = (v: number | string | undefined) =>
    v === undefined || v === null ? '' :
    typeof v === 'string' && /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` :
    String(v);
  const lines = [headers.join(',')];
  for (const f of flights) {
    lines.push([
      f.date, f.targetAltitude, f.rocketMass, f.altitude,
      f.time || f.duration || '', f.rubberBandCm ?? '', f.windSpeedMph ?? '',
      f.tempC ?? '', f.pressureHpa ?? '', f.humidityPct ?? '', f.descentTimeSec ?? '',
      f.rodAngleDeg ?? '', f.motorLot ?? '', f.motorAnomaly ? 1 : '', f.notes ?? '',
    ].map(fmt).join(','));
  }
  return lines.join('\n');
}
