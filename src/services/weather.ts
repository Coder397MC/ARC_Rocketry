// Open-Meteo current-weather client. Free, no API key, CORS-friendly.
// https://open-meteo.com/en/docs

export interface WeatherSnapshot {
  tempC: number;
  pressureHpa: number;        // surface pressure (station-level)
  humidityPct: number;
  windSpeedMph: number;
  windDirectionDeg: number;
  fetchedAt: string;          // ISO timestamp
  source: 'open-meteo';
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    surface_pressure?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
}

export async function fetchCurrentWeather(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<WeatherSnapshot> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m',
  );
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('temperature_unit', 'celsius');

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data: OpenMeteoResponse = await res.json();
  const c = data.current;
  if (
    !c ||
    c.temperature_2m === undefined ||
    c.surface_pressure === undefined ||
    c.relative_humidity_2m === undefined
  ) {
    throw new Error('Open-Meteo returned incomplete current data');
  }

  return {
    tempC: c.temperature_2m,
    pressureHpa: c.surface_pressure,
    humidityPct: c.relative_humidity_2m,
    windSpeedMph: c.wind_speed_10m ?? 0,
    windDirectionDeg: c.wind_direction_10m ?? 0,
    fetchedAt: new Date().toISOString(),
    source: 'open-meteo',
  };
}

// Historical archive (free, no key). Returns the snapshot from the most
// representative afternoon hour (14:00 local) on the given date.
// https://open-meteo.com/en/docs/historical-weather-api
export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  dateISO: string,            // YYYY-MM-DD
  signal?: AbortSignal,
): Promise<WeatherSnapshot> {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('start_date', dateISO);
  url.searchParams.set('end_date', dateISO);
  url.searchParams.set(
    'hourly',
    'temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m',
  );
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Open-Meteo archive HTTP ${res.status}`);
  const data = (await res.json()) as {
    hourly?: {
      time?: string[];
      temperature_2m?: (number | null)[];
      relative_humidity_2m?: (number | null)[];
      surface_pressure?: (number | null)[];
      wind_speed_10m?: (number | null)[];
      wind_direction_10m?: (number | null)[];
    };
  };

  const h = data.hourly;
  const times = h?.time ?? [];
  if (!h || times.length === 0) throw new Error('archive returned no hours');

  // Prefer 14:00 local; fall back to the first non-null hour near midday.
  let idx = times.findIndex((t) => t.endsWith('T14:00'));
  if (idx < 0) idx = Math.min(times.length - 1, 14);

  const pick = (arr?: (number | null)[]) => (arr && arr[idx] != null ? (arr[idx] as number) : null);

  const tempC = pick(h.temperature_2m);
  const pressureHpa = pick(h.surface_pressure);
  const humidityPct = pick(h.relative_humidity_2m);
  if (tempC == null || pressureHpa == null || humidityPct == null) {
    throw new Error('archive hour missing required fields');
  }

  return {
    tempC,
    pressureHpa,
    humidityPct,
    windSpeedMph: pick(h.wind_speed_10m) ?? 0,
    windDirectionDeg: pick(h.wind_direction_10m) ?? 0,
    fetchedAt: new Date().toISOString(),
    source: 'open-meteo',
  };
}
