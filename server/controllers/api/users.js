const User = require('../../models/user');
const EventType = require('../../models/eventType');
const levelingQueries = require('../../db/queries/leveling');
const jwt = require('jsonwebtoken');

module.exports = {
  create,
  login,
  me,
  updateMe,
  checkToken,
  getEventTypes,
  updateEventTypes,
  getLevelSummary,
  getPointHistory,
};

// Send an error response without leaking internals. The full error is logged
// server-side; the client only sees the message for intentional 4xx errors (the
// ones we throw with an `error.status`), never raw error text or Postgres codes.
function sendError(res, err, context) {
  console.error(context, err);
  const status = err.status || 500;
  const message =
    status >= 400 && status < 500
      ? err.message
      : "Something went wrong. Please try again.";
  res.status(status).json({ error: message, status });
}

async function create(req, res) {
  try {
    const user = await User.create(req.body);
    res.json(createJWT(user));
  } catch (err) {
    sendError(res, err, "POST /api/users (signup) failed:");
  }
}

async function login(req, res) {
  try {
    const user = await User.findOne({ email: req.body.email });
    // Same response and timing whether the email is unknown or the password is
    // wrong (verifyPassword runs a bcrypt compare even when user is null), so
    // the endpoint can't be used to enumerate registered emails.
    const match = await User.verifyPassword(user, req.body.password);
    if (!user || !match) {
      return res.status(401).json({ error: "Invalid email or password", status: 401 });
    }

    res.json(createJWT(user));
  } catch (err) {
    sendError(res, err, "POST /api/users/login failed:");
  }
}

async function me(req, res) {
  try {
    const user = await User.findById(req.user.user_id);
    if (!user) return res.status(404).json({ error: "User not found", status: 404 });
    const level = await levelingQueries.getUserLevelSummary(req.user.user_id);
    res.json({ ...user, level });
  } catch (err) {
    sendError(res, err, "GET /api/users/me failed:");
  }
}

async function updateMe(req, res) {
  try {
    const user = await User.updateProfile(req.user.user_id, req.body);
    if (!user) return res.status(404).json({ error: "User not found", status: 404 });
    res.json(createJWT(user));
  } catch (err) {
    sendError(res, err, "PUT /api/users/me failed:");
  }
}

function checkToken(req, res) {
  res.json(req.exp);
}

async function getEventTypes(req, res) {
  try {
    const eventTypeIds = await EventType.getForUser(req.user.user_id);
    res.json({ eventTypeIds });
  } catch (err) {
    sendError(res, err, "GET /api/users/event-types failed:");
  }
}

async function updateEventTypes(req, res) {
  try {
    const eventTypeIds = Array.isArray(req.body.eventTypeIds) ? req.body.eventTypeIds : [];
    const savedEventTypeIds = await EventType.replaceForUser(req.user.user_id, eventTypeIds);
    res.json({ eventTypeIds: savedEventTypeIds });
  } catch (err) {
    sendError(res, err, "PUT /api/users/event-types failed:");
  }
}

async function getLevelSummary(req, res) {
  try {
    const level = await levelingQueries.getUserLevelSummary(req.user.user_id);
    if (!level) return res.status(404).json({ error: "User level not found", status: 404 });
    res.json(level);
  } catch (err) {
    sendError(res, err, "GET /api/users/level failed:");
  }
}

async function getPointHistory(req, res) {
  try {
    const history = await levelingQueries.getUserPointHistory(req.user.user_id, req.query.limit);
    res.json(history);
  } catch (err) {
    sendError(res, err, "GET /api/users/points/history failed:");
  }
}

function createJWT(user) {
  return jwt.sign(
    {
      user: {
        user_id: user.user_id,
        email: user.email,
        f_name: user.f_name,
        l_name: user.l_name,
        status_id: user.status_id,
        status: user.status,
        min_points: user.min_points,
      },
    },
    process.env.SECRET,
    { expiresIn: '24h' }
  );
}
