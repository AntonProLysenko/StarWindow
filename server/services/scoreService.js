// Viewing-score service.
//
// calculateViewingScore() is the pure math (cloud cover + ground visibility +
// light pollution, scaled by how dark the sky is -> 0-100). getViewingScore() is
// the wrapper the /api/score route uses: it pulls live weather, the REAL VIIRS
// light-pollution level for the coordinate, and the sun's altitude, so callers
// only need lat/lon.
//
// Two factors gate the raw sky score:
//   - light pollution: read server-side from lightPollutionService (VIIRS), NOT
//     trusted from the client. A red-zone location is scored as a red zone.
//   - darkness: the sun's altitude. While the sun is up you can't stargaze, so
//     the score collapses toward 0 during the day and is only "full" at night.

const weatherService = require("./weatherService");
const { getLightPollutionAt } = require("./lightPollutionService");
const { sunAltitudeDeg } = require("../utils/sun");

// Sun altitude (deg) at/above which it's daytime (score 0) and below which the
// sky is fully dark for scoring. Between 0 and -18 (astronomical twilight) the
// darkness factor ramps linearly.
const NIGHT_ALTITUDE_DEG = -18;

/**
 * Darkness factor 0..1 from the sun's altitude. 0 when the sun is at or above
 * the horizon (daytime — no stargazing), 1 once it's past astronomical twilight,
 * linear in between.
 * @param {number} sunAltDeg - sun altitude in degrees.
 * @returns {number} 0..1
 */
function darknessFactor(sunAltDeg) {
  if (sunAltDeg >= 0) return 0;
  if (sunAltDeg <= NIGHT_ALTITUDE_DEG) return 1;
  return sunAltDeg / NIGHT_ALTITUDE_DEG;
}

/**
 * @param {number} clouds_pct - cloud cover percentage, 0-100.
 * @param {number} visibility_m - ground visibility in metres (OpenWeather caps ~10000).
 * @param {number} lightPollutionLevel - Bortle-like scale 0 (pristine) .. 9 (inner city).
 * @param {object} [options]
 * @param {number} [options.darkness=1] - 0..1 darkness factor (see darknessFactor).
 * @param {string} [options.logContext] - when set, logs the input/score breakdown.
 * @returns {number} integer score 0-100.
 */
function calculateViewingScore(clouds_pct, visibility_m, lightPollutionLevel, options = {}) {
  const { darkness = 1, logContext } = options;

  const weatherScore = (1 - clouds_pct / 100) * 50;
  const visibilityScore = Math.min(visibility_m / 10000, 1) * 30;
  const pollutionScore = (1 - lightPollutionLevel / 9) * 20;
  const base = weatherScore + visibilityScore + pollutionScore;
  const total = Math.round(base * darkness);

  // Diagnostic logging (opt-in via logContext so the 33-point best-spot search
  // doesn't spam). Shows exactly which inputs produced the score.
  if (logContext) {
    console.log(
      `[viewing-score] ${logContext} inputs: clouds_pct=${clouds_pct} ` +
        `visibility_m=${visibility_m} light_pollution_level=${lightPollutionLevel} ` +
        `darkness=${darkness.toFixed(2)}`
    );
    console.log(
      `[viewing-score] ${logContext} breakdown: ` +
        `weather=${weatherScore.toFixed(1)}/50 ` +
        `visibility=${visibilityScore.toFixed(1)}/30 ` +
        `pollution=${pollutionScore.toFixed(1)}/20 ` +
        `base=${base.toFixed(1)} x darkness ${darkness.toFixed(2)} => total=${total}`
    );
  }

  return total;
}

/**
 * Compute a viewing score for a location, fetching weather, real light
 * pollution, and the sun's altitude when not supplied directly.
 * @param {object} opts
 * @param {number} opts.lat
 * @param {number} opts.lon
 * @param {number} [opts.lightPollutionLevel] - override; otherwise read from VIIRS.
 * @param {number} [opts.cloudsPct]   - override; skips the weather fetch if both overrides given.
 * @param {number} [opts.visibilityM] - override.
 * @param {string} [opts.units="imperial"]
 * @param {Date}   [opts.date]         - moment to score (defaults to now).
 * @returns {Promise<object>} { viewing_score, inputs, weather }
 */
async function getViewingScore({
  lat,
  lon,
  lightPollutionLevel,
  cloudsPct,
  visibilityM,
  units = "imperial",
  date = new Date(),
}) {
  let clouds_pct = cloudsPct;
  let visibility_m = visibilityM;
  let weather = null;

  // Only hit the weather API if we're missing an input.
  if (clouds_pct == null || visibility_m == null) {
    weather = await weatherService.getWeather({ lat, lon, units });
    if (clouds_pct == null) clouds_pct = weather.clouds_pct;
    if (visibility_m == null) visibility_m = weather.visibility_m;
  }

  // Real VIIRS light pollution for the coordinate unless an explicit override
  // was passed (the client does not set one — this is server-derived).
  const light_pollution_level =
    lightPollutionLevel != null
      ? Number(lightPollutionLevel)
      : await getLightPollutionAt(lat, lon);

  const sun_altitude_deg = sunAltitudeDeg(lat, lon, date);
  const darkness = darknessFactor(sun_altitude_deg);

  // Fallbacks if a source omitted a field: no cloud data => assume overcast (0 pts),
  // no visibility => assume 0.
  const viewing_score = calculateViewingScore(
    Number(clouds_pct ?? 100),
    Number(visibility_m ?? 0),
    Number(light_pollution_level),
    { darkness, logContext: `/api/score (${lat}, ${lon})` }
  );

  return {
    viewing_score,
    inputs: {
      clouds_pct,
      visibility_m,
      light_pollution_level,
      sun_altitude_deg: Math.round(sun_altitude_deg * 10) / 10,
      darkness_factor: Math.round(darkness * 100) / 100,
    },
    weather,
  };
}

module.exports = { calculateViewingScore, getViewingScore, darknessFactor };
