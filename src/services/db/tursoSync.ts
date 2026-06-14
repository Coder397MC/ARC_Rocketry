// Manual two-way sync between local sql.js DB and Turso (libSQL).
//
// Local stays the read source so the app works offline. These functions are
// only invoked when the user clicks the sync buttons, typically:
//   - pullFromTurso() at home before going offline
//   - pushToTurso() back at home after logging flights at finals
// Both are "replace" operations, not merge — last-writer-wins.

import { createClient, type Client } from '@libsql/client/web';
import type { Flight } from '../../types';
import { FlightsRepo, COLUMNS, flightToRow, rowToFlight } from './flightsRepo';
import { SCHEMA_SQL } from './sqliteDB';

let cached: Client | null = null;

function client(): Client {
  if (cached) return cached;
  const url = import.meta.env.VITE_TURSO_URL as string | undefined;
  const authToken = import.meta.env.VITE_TURSO_TOKEN as string | undefined;
  if (!url || !authToken) {
    throw new Error('Turso not configured: set VITE_TURSO_URL and VITE_TURSO_TOKEN in .env.local');
  }
  cached = createClient({ url, authToken });
  return cached;
}

const LAST_PULL_KEY = 'turso:lastPull';
const LAST_PUSH_KEY = 'turso:lastPush';

// Idempotent: bring the remote schema up to date with columns added after the
// cloud DB was first created. Safe to call on every sync — each ALTER runs at
// most once. Must cover every column in COLUMNS that a legacy remote may lack,
// or push/pull (which reference all of COLUMNS) will fail with "no such column".
async function ensureRemoteSchema(c: Client): Promise<void> {
  // Create the flights table + index on a fresh remote DB (e.g. after pointing
  // the app at a newly-created Turso database). IF NOT EXISTS makes it a no-op
  // on an existing DB, so push/pull work the first time against a blank DB.
  await c.executeMultiple(SCHEMA_SQL);
  const info = await c.execute("PRAGMA table_info(flights)");
  const cols = info.rows.map((r) => String((r as Record<string, unknown>).name));
  if (!cols.includes('motor_temp_f')) {
    await c.execute('ALTER TABLE flights ADD COLUMN motor_temp_f REAL');
  }
  if (!cols.includes('motor_anomaly')) {
    await c.execute('ALTER TABLE flights ADD COLUMN motor_anomaly INTEGER');
  }
}

export function getLastPull(): string | null {
  return localStorage.getItem(LAST_PULL_KEY);
}

export function getLastPush(): string | null {
  return localStorage.getItem(LAST_PUSH_KEY);
}

/** Download all flights from Turso and overwrite the local DB. */
export async function pullFromTurso(): Promise<number> {
  const c = client();
  await ensureRemoteSchema(c);
  const r = await c.execute(
    `SELECT ${COLUMNS.join(',')} FROM flights ORDER BY date ASC, id ASC`,
  );
  const flights: Flight[] = r.rows.map((row) =>
    rowToFlight(row as unknown as Record<string, unknown>),
  );
  await FlightsRepo.replaceAll(flights);
  localStorage.setItem(LAST_PULL_KEY, new Date().toISOString());
  return flights.length;
}

/** Upload local flights to Turso, replacing whatever is there. */
export async function pushToTurso(): Promise<number> {
  const flights = FlightsRepo.list();
  const c = client();
  await ensureRemoteSchema(c);
  const placeholders = COLUMNS.map(() => '?').join(',');
  const insertSql = `INSERT INTO flights (${COLUMNS.join(',')}) VALUES (${placeholders})`;

  const stmts: { sql: string; args: (string | number | null)[] }[] = [
    { sql: 'DELETE FROM flights', args: [] },
    ...flights.map((f) => {
      const row = flightToRow(f);
      return {
        sql: insertSql,
        args: COLUMNS.map((col) => row[col] as string | number | null),
      };
    }),
  ];

  await c.batch(stmts, 'write');
  localStorage.setItem(LAST_PUSH_KEY, new Date().toISOString());
  return flights.length;
}
