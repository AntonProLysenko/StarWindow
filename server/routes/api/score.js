const express = require("express");
const router = express.Router();
const scoreService = require("../../services/scoreService");
const summaryService = require("../../services/summaryService");

function requiredCoordinate(value, name) {
  const coordinate = Number(value);
  if (value === undefined || value === "" || !Number.isFinite(coordinate)) {
    const error = new Error(`${name} is required and must be a valid coordinate.`);
    error.status = 400;
    throw error;
  }
  return coordinate;
}

// GET /api/score?lat=&lon=&light_pollution=&clouds_pct=&visibility_m=
// Viewing score for a location. Weather is fetched from lat/lon automatically
// clouds_pct / visibility_m are optional overrides
// that skip the weather fetch when both are supplied.
router.get("/", async (req, res) => {
  const { lat, lon, light_pollution, clouds_pct, visibility_m } = req.query;

  try {
    const result = await scoreService.getViewingScore({
      lat: requiredCoordinate(lat, "lat"),
      lon: requiredCoordinate(lon, "lon"),
      // Omitted => the service reads the real VIIRS level for the coordinate.
      lightPollutionLevel:
        light_pollution !== undefined ? Number(light_pollution) : undefined,
      cloudsPct: clouds_pct !== undefined ? Number(clouds_pct) : undefined,
      visibilityM: visibility_m !== undefined ? Number(visibility_m) : undefined,
    });
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

// GET /api/score/summary?lat=&lon=&light_pollution=
// One combined payload: weather + ISS + launches + events + bodies + score.
router.get("/summary", async (req, res) => {
  const { lat, lon, light_pollution } = req.query;

  try {
    const summary = await summaryService.getSummary({
      lat: requiredCoordinate(lat, "lat"),
      lon: requiredCoordinate(lon, "lon"),
      // Omitted => the service reads the real VIIRS level for the coordinate.
      lightPollutionLevel:
        light_pollution !== undefined ? Number(light_pollution) : undefined,
    });
    res.json(summary);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

module.exports = router;
