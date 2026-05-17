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

// Idempotent: add motor_temp_f column to the remote schema if missing.
// Safe to call on every sync — runs at most one ALTER once.
async function ensureRemoteSchema(c: Client): Promise<void> {
  const info = await c.execute("PRAGMA table_info(flights)");
  const cols = info.rows.map((r) => String((r as Record<string, unknown>).name));
  if (!cols.includes('motor_temp_f')) {
    await c.execute('ALTER TABLE flights ADD COLUMN motor_temp_f REAL');
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
