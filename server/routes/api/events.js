const express = require("express");
const router = express.Router();
const eventService = require("../../services/eventService");

// GET /api/events?limit=&from_date=&to_date=
router.get("/", async (req, res) => {
  const { limit, from_date, to_date } = req.query;
  try {
    const parsedLimit = limit == null ? undefined : Number(limit);
    const result = await eventService.getEvents({
      limit: parsedLimit,
      fromDate: from_date,
      toDate: to_date,
    });
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

// GET /api/events/list
// Unified upcoming list: space events + rocket launches merged into one array,
// normalized to a common shape and sorted soonest-first.
router.get("/list", async (req, res) => {
  try {
    const includePast = String(req.query.include_past ?? "").toLowerCase() === "true";
    const pastDays = req.query.past_days == null ? undefined : Number(req.query.past_days);
    const futureDays = req.query.future_days == null ? undefined : Number(req.query.future_days);
    const results = includePast
      ? await eventService.getTimelineList({ includePast, pastDays, futureDays })
      : await eventService.getUpcomingList();
    res.json(results);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

// GET /api/events/spacewalks?limit=  (cached EVA/spacewalk rows from events)
router.get("/spacewalks", async (req, res) => {
  const { limit = 5, from_date, to_date } = req.query;
  try {
    const result = await eventService.getSpacewalks({
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
