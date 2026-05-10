// sql.js + IndexedDB persistence layer.
//
// Lifecycle:
//   1. App startup awaits initDB() once.
//   2. initDB loads the WASM, restores the previous DB blob from IndexedDB
//      (or creates an empty one), and runs migrations.
//   3. Every mutating call (e.g. exec/run) is wrapped by `withWrite` so the
//      updated blob is flushed to IndexedDB.
//
// The DB blob is also exposed via exportBytes / importBytes for users to
// download a `.db` file or load one from disk.

import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const IDB_NAME = 'arc-rocketry';
const IDB_STORE = 'sqlite';
const IDB_KEY = 'db';

let dbPromise: Promise<Database> | null = null;
let dbInstance: Database | null = null;

// Schema: every Flight field as a column. Optional fields are nullable.
// Temperature is stored as Fahrenheit (`temp_f`); see flightsRepo.ts for
// the C↔F conversion at the boundary.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  altitude REAL NOT NULL,
  target_altitude REAL,
  rocket_mass REAL NOT NULL,
  time REAL,
  duration REAL,
  rubber_band_cm REAL,
  wind_speed_mph REAL,
  temp_f REAL,
  pressure_hpa REAL,
  humidity_pct REAL,
  motor_lot TEXT,
  descent_time_sec REAL,
  rod_angle_deg REAL,
  motor_id TEXT,
  parachute_diameter REAL,
  wind_level TEXT,
  launch_field_id TEXT,
  weather_filled INTEGER,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(date);
`;

// One-shot migration: rename pre-existing temp_c column to temp_f and
// convert stored Celsius values to Fahrenheit. Safe to call repeatedly —
// only fires when temp_c exists and temp_f does not.
function migrateTempCelsiusToFahrenheit(db: Database): void {
  const info = db.exec("PRAGMA table_info(flights)");
  const cols = info[0]?.values.map((r) => String(r[1])) ?? [];
  if (cols.includes('temp_c') && !cols.includes('temp_f')) {
    db.exec('ALTER TABLE flights RENAME COLUMN temp_c TO temp_f');
    db.exec('UPDATE flights SET temp_f = temp_f * 9.0 / 5.0 + 32.0 WHERE temp_f IS NOT NULL');
  }
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadBytes(): Promise<Uint8Array | null> {
  const idb = await openIdb();
  return new Promise<Uint8Array | null>((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function saveBytes(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  return new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function initDB(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (!dbPromise) {
    dbPromise = (async () => {
      const SQL = await initSqlJs({ locateFile: () => wasmUrl });
      const existing = await loadBytes();
      const db = existing ? new SQL.Database(existing) : new SQL.Database();
      if (existing) migrateTempCelsiusToFahrenheit(db);
      db.exec(SCHEMA_SQL);
      await saveBytes(db.export());
      dbInstance = db;
      return db;
    })();
  }
  return dbPromise;
}

export function getDB(): Database {
  if (!dbInstance) throw new Error('DB not initialised — await initDB() first');
  return dbInstance;
}

/** Persist after a write. Caller does the writes inside `fn`, then we flush. */
export async function withWrite<T>(fn: (db: Database) => T): Promise<T> {
  const db = getDB();
  const result = fn(db);
  await saveBytes(db.export());
  return result;
}

/** Snapshot the current DB as a downloadable byte array. */
export function exportBytes(): Uint8Array {
  return getDB().export();
}

/** Replace the DB with the supplied bytes (e.g. user uploaded a .db file). */
export async function importBytes(bytes: Uint8Array): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const newDb = new SQL.Database(bytes);
  migrateTempCelsiusToFahrenheit(newDb);
  newDb.exec(SCHEMA_SQL);
  if (dbInstance) dbInstance.close();
  dbInstance = newDb;
  await saveBytes(newDb.export());
}
