const express = require("express");
const router = express.Router();
const launchService = require("../../services/launchService");

// GET /api/launches/links?name=&date=
router.get("/links", async (req, res) => {
  const { name, date } = req.query;
  try {
    const result = await launchService.getLaunchLinks({ name, date });
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

// GET /api/launches?limit=&from_date=&to_date=
router.get("/", async (req, res) => {
  const { limit = 5, from_date, to_date } = req.query;
  try {
    const result = await launchService.getLaunches({
      limit: Number(limit),
      fromDate: from_date,
      toDate: to_date,
    });
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

module.exports = router;
