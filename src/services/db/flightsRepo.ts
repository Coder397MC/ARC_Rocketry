// Flight CRUD against the SQLite DB. Maps Flight TS objects to/from rows.
//
// Temperature is stored in the DB as Fahrenheit (column `temp_f`), but the
// in-memory Flight type keeps Celsius (`tempC`) because physics calcs
// (airDensityKgM3, etc.) need Celsius. Conversion happens here at the
// boundary: cToF on write, fToC on read.

import type { Flight } from '../../types';
import { cToF, fToC } from '../units';
import { getDB, withWrite } from './sqliteDB';

export const COLUMNS = [
  'id', 'date', 'altitude', 'target_altitude', 'rocket_mass', 'time', 'duration',
  'rubber_band_cm', 'wind_speed_mph', 'temp_f', 'pressure_hpa', 'humidity_pct',
  'motor_lot', 'motor_temp_f', 'motor_anomaly', 'descent_time_sec', 'rod_angle_deg', 'motor_id',
  'parachute_diameter', 'wind_level', 'launch_field_id', 'weather_filled', 'notes',
] as const;

export type Row = Record<(typeof COLUMNS)[number], unknown>;

export function flightToRow(f: Flight): Row {
  return {
    id: f.id,
    date: f.date,
    altitude: f.altitude,
    target_altitude: f.targetAltitude ?? null,
    rocket_mass: f.rocketMass,
    time: f.time ?? null,
    duration: f.duration ?? null,
    rubber_band_cm: f.rubberBandCm ?? null,
    wind_speed_mph: f.windSpeedMph ?? null,
    temp_f: (() => {
      const c = f.tempC ?? f.temp;
      return typeof c === 'number' ? cToF(c) : null;
    })(),
    pressure_hpa: f.pressureHpa ?? null,
    humidity_pct: f.humidityPct ?? f.humidity ?? null,
    motor_lot: f.motorLot ?? null,
    motor_temp_f: f.motorTempF ?? null,
    motor_anomaly: f.motorAnomaly ? 1 : 0,
    descent_time_sec: f.descentTimeSec ?? null,
    rod_angle_deg: f.rodAngleDeg ?? null,
    motor_id: f.motorId ?? null,
    parachute_diameter: f.parachuteDiameter ?? null,
    wind_level: f.windLevel ?? null,
    launch_field_id: f.launchFieldId ?? null,
    weather_filled: f.weatherFilled ? 1 : 0,
    notes: f.notes ?? null,
  };
}

export function rowToFlight(r: Record<string, unknown>): Flight {
  const num = (k: string) => (r[k] == null ? undefined : Number(r[k]));
  const str = (k: string) => (r[k] == null ? undefined : String(r[k]));
  return {
    id: String(r.id),
    date: String(r.date),
    altitude: Number(r.altitude),
    targetAltitude: num('target_altitude') ?? 0,
    rocketMass: Number(r.rocket_mass),
    time: num('time') ?? 0,
    duration: num('duration'),
    rubberBandCm: num('rubber_band_cm'),
    windSpeedMph: num('wind_speed_mph'),
    tempC: (() => {
      const f = num('temp_f');
      return typeof f === 'number' ? fToC(f) : undefined;
    })(),
    pressureHpa: num('pressure_hpa'),
    humidityPct: num('humidity_pct'),
    motorLot: str('motor_lot'),
    motorTempF: num('motor_temp_f'),
    motorAnomaly: r.motor_anomaly === 1 || r.motor_anomaly === '1',
    descentTimeSec: num('descent_time_sec'),
    rodAngleDeg: num('rod_angle_deg'),
    motorId: str('motor_id') ?? '',
    parachuteDiameter: num('parachute_diameter') ?? 0,
    windLevel: ((str('wind_level') ?? 'low') as Flight['windLevel']),
    launchFieldId: str('launch_field_id'),
    weatherFilled: r.weather_filled === 1 || r.weather_filled === '1',
    notes: str('notes') ?? '',
  };
}

export const FlightsRepo = {
  list(): Flight[] {
    const db = getDB();
    const result = db.exec(`SELECT ${COLUMNS.join(',')} FROM flights ORDER BY date ASC, id ASC`);
    if (result.length === 0) return [];
    const { columns, values } = result[0];
    return values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((c, i) => { obj[c] = row[i]; });
      return rowToFlight(obj);
    });
  },

  async insertMany(flights: Flight[]): Promise<void> {
    if (flights.length === 0) return;
    await withWrite((db) => {
      const placeholders = COLUMNS.map(() => '?').join(',');
      const sql = `INSERT OR REPLACE INTO flights (${COLUMNS.join(',')}) VALUES (${placeholders})`;
      const stmt = db.prepare(sql);
      try {
        db.exec('BEGIN');
        for (const f of flights) {
          const row = flightToRow(f);
          stmt.run(COLUMNS.map((c) => row[c] as null | string | number));
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        stmt.free();
      }
    });
  },

  async insert(flight: Flight): Promise<void> {
    await this.insertMany([flight]);
  },

  async remove(id: string): Promise<void> {
    await withWrite((db) => {
      const stmt = db.prepare('DELETE FROM flights WHERE id = ?');
      try { stmt.run([id]); } finally { stmt.free(); }
    });
  },

  async clear(): Promise<void> {
    await withWrite((db) => { db.exec('DELETE FROM flights'); });
  },

  async replaceAll(flights: Flight[]): Promise<void> {
    await withWrite((db) => {
      db.exec('DELETE FROM flights');
      if (flights.length === 0) return;
      const placeholders = COLUMNS.map(() => '?').join(',');
      const sql = `INSERT INTO flights (${COLUMNS.join(',')}) VALUES (${placeholders})`;
      const stmt = db.prepare(sql);
      try {
        db.exec('BEGIN');
        for (const f of flights) {
          const row = flightToRow(f);
          stmt.run(COLUMNS.map((c) => row[c] as null | string | number));
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        stmt.free();
      }
    });
  },
};
