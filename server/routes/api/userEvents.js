const express = require("express");
const router = express.Router();
const ensureLoggedIn = require("../../config/ensureLoggedIn");
const userEventQueries = require("../../db/queries/userEvents");

// All routes derive the acting user from the JWT (`req.user.user_id`, decoded by
// the global checkToken middleware) and never trust an identifier from the body or
// query — ownership is enforced at the query layer against that user_id.

// GET /api/user-events?event_id=
// Report whether a user has already saved an event (seeds the modal's state).
router.get("/", ensureLoggedIn, async (req, res) => {
  const { event_id } = req.query;
  if (!event_id) {
    return res.status(400).json({ error: "event_id is required", status: 400 });
  }
  try {
    const row = await userEventQueries.getUserEvent(req.user.user_id, event_id);
    res.json({
      saved: Boolean(row),
      user_event_id: row?.user_event_id ?? null,
      event_comment: row?.event_comment ?? null,
      event_rating: row?.event_rating ?? null,
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

// GET /api/user-events/saved
// Return all events saved by the current logged-in user.
router.get("/saved", ensureLoggedIn, async (req, res) => {
  try {
    const events = await userEventQueries.getSavedEventsForUser(req.user.user_id);
    res.json(events);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

// POST /api/user-events  { event_id }
// Save an event for a user. Idempotent (won't duplicate an existing save).
router.post("/", ensureLoggedIn, async (req, res) => {
  const { event_id } = req.body || {};
  if (!event_id) {
    return res.status(400).json({ error: "event_id is required", status: 400 });
  }
  try {
    const saved = await userEventQueries.saveUserEvent(req.user.user_id, event_id);
    // 200 if it already existed, 201 if newly created.
    res.status(saved.already_saved ? 200 : 201).json(saved);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

// DELETE /api/user-events/:id   (:id = user_event_id) — unsave.
router.delete("/:id", ensureLoggedIn, async (req, res) => {
  try {
    const result = await userEventQueries.deleteUserEvent(req.params.id, req.user.user_id);
    if (!result?.deleted) {
      return res.status(404).json({ error: "Saved event not found", status: 404 });
    }
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

// PATCH /api/user-events/:id
// Update the saved event's private comment/rating.
router.patch("/:id", ensureLoggedIn, async (req, res) => {
  try {
    const updated = await userEventQueries.updateUserEventDetails(
      req.user.user_id,
      req.params.id,
      req.body || {}
    );
    res.json(updated);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

// POST /api/user-events/:id/images
// Attach an image URL to a saved event. First image per saved event awards points.
router.post("/:id/images", ensureLoggedIn, async (req, res) => {
  try {
    const image = await userEventQueries.addUserEventImage(
      req.user.user_id,
      req.params.id,
      req.body || {}
    );
    res.status(201).json(image);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

// DELETE /api/user-events/:id/images/:imageId
// Remove an attached image. Deleting the last image reverses image points.
router.delete("/:id/images/:imageId", ensureLoggedIn, async (req, res) => {
  try {
    const result = await userEventQueries.deleteUserEventImage(
      req.user.user_id,
      req.params.id,
      req.params.imageId
    );
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, status });
  }
});

module.exports = router;
