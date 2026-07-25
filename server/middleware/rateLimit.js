// Rate limiting / abuse protection (express-rate-limit, in-memory store).
//
// Three limiters, keyed by client IP:
//   - apiLimiter          baseline for every /api route (blocks scraping/abuse)
//   - externalApiLimiter  tighter, for unauthenticated routes that spend PAID
//                         external API quota (astronomy, weather, news, score, map)
//   - authLimiter         strict, for login/signup (credential brute force)
//
// Limits are per-instance (MemoryStore). That's fine for a single server; a
// multi-instance deploy would need a shared store (e.g. Redis). Behind a proxy,
// set TRUST_PROXY so req.ip is the real client (see server.js).

const { rateLimit } = require("express-rate-limit");

const MINUTE = 60 * 1000;

function jsonHandler(message) {
  return (req, res) => res.status(429).json({ error: message, status: 429 });
}

const common = {
  standardHeaders: "draft-7", // RateLimit-* headers
  legacyHeaders: false,
};

// Baseline: generous for a real user (a dashboard load is ~10-15 requests),
// restrictive for scrapers.
const apiLimiter = rateLimit({
  ...common,
  windowMs: MINUTE,
  limit: 120,
  handler: jsonHandler("Too many requests. Please slow down and try again shortly."),
});

// Paid-quota routes: tighter so an anonymous client can't burn through external
// API credits on demand (e.g. /api/news?refresh=true bypasses the cache).
const externalApiLimiter = rateLimit({
  ...common,
  windowMs: MINUTE,
  limit: 40,
  handler: jsonHandler("Too many requests to this resource. Please try again shortly."),
});

// Auth: only failed attempts count (skipSuccessfulRequests), so a legitimate
// user is never locked out but password guessing is throttled hard.
const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
  handler: jsonHandler("Too many attempts. Please wait a few minutes and try again."),
});

module.exports = { apiLimiter, externalApiLimiter, authLimiter };
