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

/**
 * Merge local flights into Turso (additive upsert — never deletes).
 *
 * Each flight is INSERT-OR-REPLACE'd by id, so uploading only adds or updates
 * THIS device's flights and can never wipe another teammate's data. Deleting a
 * flight locally therefore does NOT remove it from the cloud (that needs a
 * deliberate cloud-side delete). Flights dated before `cutoffDate` (ISO
 * YYYY-MM-DD) are excluded so a stale old-season device can't re-add last
 * season's log. Returns how many were uploaded vs. excluded.
 */
export async function pushToTurso(
  cutoffDate?: string,
): Promise<{ uploaded: number; excluded: number }> {
  const all = FlightsRepo.list();
  const flights = cutoffDate ? all.filter((f) => f.date >= cutoffDate) : all;
  const excluded = all.length - flights.length;
  if (flights.length === 0) {
    throw new Error(
      excluded > 0
        ? `All ${excluded} flights on this device are before the ${cutoffDate} season cutoff — nothing to upload.`
        : 'No flights to upload.',
    );
  }
  const c = client();
  await ensureRemoteSchema(c);
  const placeholders = COLUMNS.map(() => '?').join(',');
  // Upsert by primary key (id): adds new flights, updates existing ones, and
  // leaves every other row in the cloud untouched. No DELETE — uploads merge.
  const upsertSql = `INSERT OR REPLACE INTO flights (${COLUMNS.join(',')}) VALUES (${placeholders})`;

  const stmts = flights.map((f) => {
    const row = flightToRow(f);
    return {
      sql: upsertSql,
      args: COLUMNS.map((col) => row[col] as string | number | null),
    };
  });

  await c.batch(stmts, 'write');
  localStorage.setItem(LAST_PUSH_KEY, new Date().toISOString());
  return { uploaded: flights.length, excluded };
}
