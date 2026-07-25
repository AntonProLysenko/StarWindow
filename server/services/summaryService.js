// Summary service: orchestrates every integration for a single coordinate into
// one combined payload plus the calculated viewing score.
//
// Looks up (or creates) the matching locations row, then fans out to weather,
// ISS, launches, events, and body positions in parallel via Promise.all. Each
// call is individually guarded so one failing upstream API degrades that section
// to { error } instead of failing the whole summary.

const locationQueries = require("../db/queries/locations");
const weatherService = require("./weatherService");
const issService = require("./issService");
const launchService = require("./launchService");
const eventService = require("./eventService");
const astronomyService = require("./astronomyService");
const scoreService = require("./scoreService");
const { getLightPollutionAt } = require("./lightPollutionService");
const { sunAltitudeDeg } = require("../utils/sun");

/**
 * @param {object} opts
 * @param {number} opts.lat
 * @param {number} opts.lon
 * @param {number} [opts.lightPollutionLevel] - override; otherwise read from VIIRS.
 * @returns {Promise<object>} combined payload + viewing_score.
 */
async function getSummary({ lat, lon, lightPollutionLevel }) {
  console.log(`\n=== BUILDING SUMMARY for (${lat}, ${lon}) ===`);

  // 1) Resolve (or create) the location these results belong to.
  const location = await locationQueries.findOrCreateLocation({ lat, long: lon });

  // 2) Fan out to every integration in parallel. guard() ensures a single
  //    rejection becomes { error } rather than rejecting the whole Promise.all.
  const [weather, iss, launches, events, bodies] = await Promise.all([
    guard("weather", weatherService.getWeather({ lat, lon, locationId: location.location_id })),
    guard("iss", issService.getIssPasses({ lat, lon, locationId: location.location_id })),
    guard("launches", launchService.getLaunches({ limit: 5 })),
    guard("events", eventService.getEvents({ limit: 5 })),
    guard(
      "bodies",
      astronomyService.getBodyPositions({ latitude: lat, longitude: lon })
    ),
  ]);

  // 3) Compute the viewing score from the weather result (when available),
  //    using the REAL VIIRS light pollution and the sun's altitude (darkness).
  let viewing_score = null;
  let light_pollution_level =
    lightPollutionLevel != null ? Number(lightPollutionLevel) : null;
  if (weather && !weather.error) {
    if (light_pollution_level == null) {
      light_pollution_level = await getLightPollutionAt(lat, lon);
    }
    const darkness = scoreService.darknessFactor(sunAltitudeDeg(lat, lon));
    viewing_score = scoreService.calculateViewingScore(
      Number(weather.clouds_pct ?? 100), // no data => assume fully clouded
      Number(weather.visibility_m ?? 0),
      Number(light_pollution_level),
      { darkness, logContext: `/api/score/summary (${lat}, ${lon})` }
    );
  }

  return {
    location: {
      location_id: location.location_id,
      name: location.name,
      lat: location.lat,
      lon: location.long,
      country: location.country,
    },
    viewing_score,
    light_pollution_level,
    weather,
    iss,
    launches,
    events,
    bodies,
  };
}

// Resolve a service promise to its value, or to { error } on failure, so one
// broken upstream API doesn't fail the entire summary.
async function guard(label, promise) {
  try {
    return await promise;
  } catch (error) {
    console.error(`Summary "${label}" failed:`, error.message);
    return { error: error.message };
  }
}

module.exports = { getSummary };
