const express = require("express");
const router = express.Router();
const meteorService = require("../../services/meteorService");

// GET /api/meteor-showers?limit=&from_date=&to_date=
router.get("/", (req, res) => {
  const { limit, from_date, to_date, latitude } = req.query;

  try {
    const result = meteorService.getMeteorShowers({
      limit: limit == null ? undefined : Number(limit),
      fromDate: from_date,
      toDate: to_date,
      latitude,
    });
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

module.exports = router;
