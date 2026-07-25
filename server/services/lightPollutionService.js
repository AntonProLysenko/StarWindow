// ============================================================================
//  Light pollution at arbitrary coordinates — real VIIRS-derived data
// ============================================================================
//
// getLightPollutionAt(lat, lon) returns a Bortle-like level 0 (pristine dark
// sky) .. 9 (inner-city), which feeds scoreService.calculateViewingScore().
//
// SOURCE: David J. Lorenz's 2024 light-pollution atlas tiles
//   (https://djlorenz.github.io/astronomy/lp/), computed from NASA VIIRS
//   nighttime-lights radiance. These are the SAME tiles the frontend map
//   overlays (see client star-map.impl.web.tsx), so the viewing score and the
//   on-map overlay agree.
//
// HOW: the atlas is a pyramid of 1024px PNG tiles addressed as
//   .../tiles2024/tile_{z}_{x}_{y}.png, with 2^z tiles per axis (Web Mercator).
//   We compute the tile + pixel covering (lat, lon), read the pixel colour, and
//   nearest-match it to Lorenz's discrete zone palette (sampled from his
//   colorbar.png legend — see ZONE_PALETTE). Each zone maps to a Bortle-like
//   level. Tiles are lossless flat-colour PNGs, so the match is exact.
//
// If a tile read fails (network error), getLightPollutionAt falls back to the
// city-glow heuristic below so the best-spot search never breaks.
// ============================================================================

const { PNG } = require("pngjs");
const { haversineMiles } = require("../utils/geo");

// Real VIIRS reads are live. Set false to force the heuristic fallback.
const VIIRS_ENABLED = true;

const TILE_BASE = "https://djlorenz.github.io/astronomy/image_tiles/tiles2024";
const TILE_SIZE = 1024;
// Primary tile-zoom to read. z6 is ~0.6 km/px — far finer than the score needs,
// and each tile covers ~390 mi so a best-spot search's 33 samples share 1-2
// tiles. We fall back to shallower zooms only where a deeper tile is absent
// (e.g. coastlines); z0-z2 exist globally so a read always resolves.
const VIIRS_ZOOM = 6;
const VIIRS_MIN_ZOOM = 2;
// Web Mercator is undefined past ~85.05°; clamp to stay inside the projection.
const MERCATOR_MAX_LAT = 85.05112878;
// Missing tile (ocean / no data) => darkest real sky.
const NO_DATA_LEVEL = 1.0;

// Zone palette sampled directly from Lorenz's colorbar.png legend, darkest ->
// brightest: [r, g, b, level]. Zones 1a..7b (gray -> blue -> green -> yellow ->
// orange -> red -> white) plus black (below zone 1 / no data). `level` is a
// Bortle-like 0..9 anchored on Lorenz's own zone/Bortle notes (green zone 3
// ~ Bortle 4, yellow zone 4 ~ Bortle 5, orange zone 5 ~ Bortle 6).
const ZONE_PALETTE = [
  [0, 0, 0, 1.0], // black — below zone 1 / no data
  [34, 34, 34, 2.0], // 1a
  [66, 66, 66, 2.5], // 1b
  [20, 47, 114, 3.0], // 2a
  [33, 84, 216, 3.5], // 2b
  [15, 87, 20, 4.0], // 3a
  [31, 161, 42, 4.5], // 3b
  [110, 100, 30, 5.0], // 4a
  [184, 166, 37, 5.5], // 4b
  [191, 100, 30, 6.0], // 5a
  [253, 150, 80, 6.5], // 5b
  [251, 90, 73, 7.0], // 6a
  [251, 153, 138, 7.5], // 6b
  [160, 160, 160, 8.5], // 7a
  [242, 242, 242, 9.0], // 7b
];

// Decoded-tile cache: "z/x/y" -> Promise<{ width, levels } | null>. Levels are a
// Uint8Array of round(level * 2) (one byte/px, ~1 MB/tile) — far lighter than
// the 4 MB RGBA buffer. Caching the Promise dedupes the concurrent reads the
// best-spot search fires for one tile. Tiles are immutable annual data, so
// entries never go stale; we bound the count with simple LRU eviction.
const MAX_CACHED_TILES = 32;
const tileCache = new Map();

/**
 * Light pollution level at a coordinate, 0 (darkest) .. 9 (brightest).
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<number>}
 */
async function getLightPollutionAt(lat, lon) {
  if (VIIRS_ENABLED) {
    try {
      const level = await readViirsLevel(lat, lon);
      if (Number.isFinite(level)) return clampLevel(level);
    } catch (err) {
      // Never let a network hiccup break the whole best-spot search — fall back
      // to the heuristic and log it.
      console.warn("VIIRS lookup failed, using city-glow fallback:", err.message);
    }
  }
  return fallbackCityGlowLevel(lat, lon);
}

/**
 * Read the VIIRS-derived level from Lorenz's tiles. Tries the primary zoom, then
 * shallower zooms where a deeper tile is absent. Returns NO_DATA_LEVEL if even
 * the shallowest tile is missing (ocean). Throws only on a real fetch/decode
 * failure so the caller can fall back.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<number>}
 */
async function readViirsLevel(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`invalid coordinate ${lat},${lon}`);
  }

  for (let z = VIIRS_ZOOM; z >= VIIRS_MIN_ZOOM; z--) {
    const { tileX, tileY, pxX, pxY } = tileCoords(lat, lon, z);
    const tile = await getTile(z, tileX, tileY);
    if (!tile) continue; // no tile at this zoom — try shallower
    return tile.levels[pxY * tile.width + pxX] / 2;
  }

  return NO_DATA_LEVEL;
}

/** Map (lat, lon) -> tile indices + pixel within the tile at tile-zoom z. */
function tileCoords(lat, lon, z) {
  const clampedLat = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
  const globalPx = TILE_SIZE * 2 ** z;

  const x = ((lon + 180) / 360) * globalPx;
  const latRad = (clampedLat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    globalPx;

  const clampPx = (v) => Math.max(0, Math.min(globalPx - 1, Math.floor(v)));
  const gx = clampPx(x);
  const gy = clampPx(y);

  return {
    tileX: Math.floor(gx / TILE_SIZE),
    tileY: Math.floor(gy / TILE_SIZE),
    pxX: gx % TILE_SIZE,
    pxY: gy % TILE_SIZE,
  };
}

/** Get a decoded tile's level map, from cache or by fetching + decoding. */
function getTile(z, x, y) {
  const key = `${z}/${x}/${y}`;

  const cached = tileCache.get(key);
  if (cached) {
    tileCache.delete(key); // refresh LRU position
    tileCache.set(key, cached);
    return cached;
  }

  const pending = fetchAndDecodeTile(z, x, y).catch((err) => {
    // Don't cache transient failures — drop the entry so the next call retries,
    // then rethrow so getLightPollutionAt falls back for this point.
    tileCache.delete(key);
    throw err;
  });

  tileCache.set(key, pending);
  while (tileCache.size > MAX_CACHED_TILES) {
    tileCache.delete(tileCache.keys().next().value); // evict oldest
  }
  return pending;
}

/**
 * Fetch a tile PNG and reduce it to a per-pixel level map. Resolves null for a
 * genuinely missing tile (HTTP 404 = no data at this zoom).
 * @returns {Promise<{ width:number, levels:Uint8Array } | null>}
 */
async function fetchAndDecodeTile(z, x, y) {
  const res = await fetch(`${TILE_BASE}/tile_${z}_${x}_${y}.png`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y} HTTP ${res.status}`);

  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  const { width, height, data } = png;
  const levels = new Uint8Array(width * height);

  for (let p = 0; p < width * height; p++) {
    const i = p << 2;
    levels[p] = Math.round(nearestZoneLevel(data[i], data[i + 1], data[i + 2]) * 2);
  }

  return { width, levels };
}

/** Nearest zone level (0..9) to an RGB pixel by squared Euclidean distance. */
function nearestZoneLevel(r, g, b) {
  let bestLevel = ZONE_PALETTE[0][3];
  let bestDist = Infinity;
  for (const [pr, pg, pb, level] of ZONE_PALETTE) {
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestLevel = level;
    }
  }
  return bestLevel;
}

// ---------------------------------------------------------------------------
// Fallback heuristic: superposed city glow (inverse-square-ish falloff). Used
// only if a VIIRS tile read errors out. Each city contributes brightness ∝
// weight / (1 + (d/scale)²); summing gives a smooth field, bright near metros
// and fading to dark in the countryside. NOT a measurement.
// ---------------------------------------------------------------------------

// A small set of major US cities: [name, lat, lon, weight ~ log10(population)].
const MAJOR_CITIES = [
  ["New York", 40.7128, -74.006, 7.3],
  ["Los Angeles", 34.0522, -118.2437, 7.0],
  ["Chicago", 41.8781, -87.6298, 6.9],
  ["Houston", 29.7604, -95.3698, 6.8],
  ["Phoenix", 33.4484, -112.074, 6.7],
  ["Philadelphia", 39.9526, -75.1652, 6.7],
  ["San Antonio", 29.4241, -98.4936, 6.6],
  ["San Diego", 32.7157, -117.1611, 6.6],
  ["Dallas", 32.7767, -96.797, 6.6],
  ["San Jose", 37.3382, -121.8863, 6.5],
  ["Austin", 30.2672, -97.7431, 6.5],
  ["Columbus", 39.9612, -82.9988, 6.4],
  ["Indianapolis", 39.7684, -86.1581, 6.3],
  ["Cincinnati", 39.1031, -84.512, 6.2],
  ["Denver", 39.7392, -104.9903, 6.4],
  ["Seattle", 47.6062, -122.3321, 6.4],
  ["Atlanta", 33.749, -84.388, 6.4],
  ["Miami", 25.7617, -80.1918, 6.4],
  ["Boston", 42.3601, -71.0589, 6.4],
  ["Minneapolis", 44.9778, -93.265, 6.3],
  ["Detroit", 42.3314, -83.0458, 6.4],
  ["Las Vegas", 36.1699, -115.1398, 6.4],
  ["Portland", 45.5152, -122.6784, 6.3],
  ["Nashville", 36.1627, -86.7816, 6.2],
  ["St. Louis", 38.627, -90.1994, 6.2],
];

// How quickly a city's glow falls off with distance (miles). Larger = its glow
// reaches farther. Roughly tuned so a ~7-weight metro still tints the sky ~40mi out.
const GLOW_SCALE_MILES = 22;

function fallbackCityGlowLevel(lat, lon) {
  let brightness = 0;
  for (const [, cLat, cLon, weight] of MAJOR_CITIES) {
    const d = haversineMiles(lat, lon, cLat, cLon);
    // Weight is log-population; convert to a linear-ish intensity before falloff.
    const intensity = Math.pow(10, weight - 6); // ~1 for a weight-6 city
    brightness += intensity / (1 + (d / GLOW_SCALE_MILES) ** 2);
  }

  // Map brightness → 0..9. log compresses the huge dynamic range between
  // "downtown" and "middle of nowhere". Constants tuned so a mid-size metro core
  // (brightness ~1.6) lands ~8, big metros clamp to 9, and deep rural ~1.5-2.
  const level = 16 * Math.log10(1 + brightness) + 1.4;
  return clampLevel(level);
}

function clampLevel(level) {
  return Math.max(0, Math.min(9, Math.round(level * 10) / 10));
}

module.exports = {
  getLightPollutionAt,
  readViirsLevel,
  // exported for the conceptual demo / tests:
  fallbackCityGlowLevel,
  VIIRS_ENABLED,
};
