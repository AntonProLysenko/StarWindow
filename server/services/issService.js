// ISS pass service: cache-check -> fetch ISS pass API -> transform -> save -> return.
//
// Now backed by the real `iss_passes` table. Raw UTC timestamps are stored; the
// localized (America/New_York) display strings are derived on read, so a cache
// hit returns the exact same shape as a fresh fetch. Saving is best-effort.

const issQueries = require("../db/queries/iss");
const locationQueries = require("../db/queries/locations");
const { isCacheStale, TTL_MINUTES } = require("../middleware/cache");

const ISS_API_BASE = process.env.ISS_API_BASE || "https://iss-api.polluxlabs.io";
const ISS_INFO_BASE = process.env.ISS_INFO_BASE || "https://issinfo.net";
const TZ = "America/New_York";
const ISS_API_MAX_DAYS_AHEAD = 14;
const ISS_API_REQUEST_TIMEOUT_MS = 10000;

/**
 * Get upcoming visible ISS passes for a coordinate.
 * @param {object} opts
 * @param {number} opts.lat
 * @param {number} opts.lon
 * @param {number} [opts.n=5]
 * @param {number} [opts.daysAhead=5]
 * @returns {Promise<object>} { observer, tle_epoch, generated_at, passes }
 */
async function getIssPasses({ lat, lon, n = 5, daysAhead = 5 }) {
  const passCount = normalizePositiveInteger(n, 5);
  const searchDays = Math.min(normalizePositiveInteger(daysAhead, 5), ISS_API_MAX_DAYS_AHEAD);
  const location = await locationQueries.findOrCreateLocation({ lat, long: lon });

  // 1) Cache check — reuse the most recent cached batch if still fresh.
  const cachedRows = await issQueries.getCachedPasses(location.location_id);
  if (hasUsablePassCache(cachedRows) && !isCacheStale(cachedRows[0].cached_at, TTL_MINUTES.ISS)) {
    console.log("\n=== ISS PASSES (cache hit) ===");
    return {
      observer: { lat, lon },
      tle_epoch: cachedRows[0].tle_epoch,
      generated_at: cachedRows[0].cached_at,
      passes: cachedRows.map(rowToDisplay),
    };
  }

  // 2) Fetch live.
  const data = await fetchLiveIssPasses({ lat, lon, passCount, searchDays });

  // 3) Transform into DB rows (raw timestamps) — display is derived from these.
  const dbRows = data.passes || [];

  console.log("\n=== ISS PASSES ===");
  console.log(`    Observer  : ${JSON.stringify(data.observer)}`);
  console.log(`    Passes    : ${dbRows.length}`);

  // 4) Save the batch (best-effort — caching must not break the response).
  try {
    await issQueries.savePasses(location.location_id, dbRows, { tleEpoch: data.tle_epoch });
  } catch (saveErr) {
    console.error("Failed to cache ISS passes:", saveErr.message);
  }

  return {
    observer: data.observer,
    tle_epoch: data.tle_epoch,
    generated_at: data.generated_at,
    passes: dbRows.map(dbRowToDisplay),
  };
}

async function fetchLiveIssPasses({ lat, lon, passCount, searchDays }) {
  try {
    const primary = await fetchPolluxIssPasses({ lat, lon, passCount, searchDays });
    if (primary.passes.length > 0) return primary;
    console.warn("Pollux ISS API returned no visible passes; trying issinfo.net fallback.");
  } catch (error) {
    console.warn("Pollux ISS API unavailable; trying issinfo.net fallback:", error.message);
  }

  return fetchIssInfoPass({ lat, lon });
}

async function fetchPolluxIssPasses({ lat, lon, passCount, searchDays }) {
  const url = `${ISS_API_BASE}/iss-pass?lat=${lat}&lon=${lon}&n=${passCount}&days_ahead=${searchDays}&visible_only=true`;
  const response = await fetchWithTimeout(url, ISS_API_REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    const err = new Error(`ISS API returned ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const data = await response.json();

  return {
    observer: data.observer,
    tle_epoch: data.tle_epoch,
    generated_at: data.generated_at,
    passes: (data.passes || []).map(polluxPassToDbRow),
  };
}

async function fetchIssInfoPass({ lat, lon }) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    sat: "iss",
    type: "visible",
    format: "json",
  });
  const response = await fetchWithTimeout(`${ISS_INFO_BASE}/next-pass?${params}`, ISS_API_REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    const err = new Error(`ISS fallback API returned ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const data = await response.json();

  return {
    observer: { lat, lon },
    tle_epoch: null,
    generated_at: data.generatedAt,
    passes: data.pass ? [issInfoPassToDbRow(data.pass)] : [],
  };
}

function polluxPassToDbRow(pass) {
  return {
    riseTime: pass.rise?.time || null,
    riseCompass: pass.rise?.compass || null,
    peakTime: pass.culmination?.time || null,
    peakCompass: pass.culmination?.compass || null,
    peakElevationDeg: pass.culmination?.elevation_deg ?? pass.culmination?.elevation ?? null,
    setTime: pass.set?.time || null,
    setCompass: pass.set?.compass || null,
    durationSec: pass.duration_sec ?? null,
    visibleDurationSec: pass.visible_duration_sec ?? null,
    visible: pass.visible ?? null,
  };
}

function issInfoPassToDbRow(pass) {
  return {
    riseTime: pass.start || null,
    riseCompass: pass.startDirection || null,
    peakTime: pass.peak || null,
    peakCompass: pass.peakDirection || null,
    peakElevationDeg: pass.maxElevation ?? null,
    setTime: pass.end || null,
    setCompass: pass.endDirection || null,
    durationSec: pass.durationSeconds ?? null,
    visibleDurationSec: pass.durationSeconds ?? null,
    visible: pass.visible ?? true,
  };
}

// Localize a timestamp to the display timezone; null-safe.
function localize(t) {
  if (!t) return null;
  return new Date(t).toLocaleString("en-US", { timeZone: TZ });
}

// From a freshly-built dbRow (camelCase, raw ISO strings).
function dbRowToDisplay(r) {
  return {
    rise: { time: localize(r.riseTime), direction: r.riseCompass },
    peak: { time: localize(r.peakTime), direction: r.peakCompass, elevation_deg: r.peakElevationDeg },
    set: { time: localize(r.setTime), direction: r.setCompass },
    duration_sec: r.durationSec,
    visible_duration_sec: r.visibleDurationSec,
    visible: r.visible,
  };
}

// From a cached DB row (snake_case, pg timestamps).
function rowToDisplay(row) {
  return {
    rise: { time: localize(row.rise_time), direction: row.rise_compass },
    peak: { time: localize(row.peak_time), direction: row.peak_compass, elevation_deg: num(row.peak_elevation_deg) },
    set: { time: localize(row.set_time), direction: row.set_compass },
    duration_sec: row.duration_sec,
    visible_duration_sec: row.visible_duration_sec,
    visible: row.visible,
  };
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

function hasUsablePassCache(rows) {
  return rows.length > 0 && rows.every((row) => row.peak_elevation_deg !== null);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("ISS API request timed out");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { getIssPasses };
