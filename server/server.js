const express = require('express');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, ".env") })

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

require("./config/database");

const cors=require("cors");//cors is a cross origin resource sharing  alows to use back end with a different url from front-end
const { apiLimiter, externalApiLimiter } = require("./middleware/rateLimit");
// Auth is a JWT sent in the Authorization header (no cookies), so we don't need
// credentialed CORS. That matters: `credentials:true` together with `origin:'*'`
// makes browsers reject the response, and a wildcard is only valid when the
// request is NOT credentialed — which is our case. So: allow any origin, no creds.
const corsOptions ={
  origin:'*',
  optionsSuccessStatus:200,   // some legacy browsers choke on 204 for preflight
}

const app = express();

// When deployed behind a reverse proxy/CDN, set TRUST_PROXY (e.g. 1) so req.ip
// is the real client IP the rate limiter keys on — not the proxy's. Leave unset
// for local/direct runs (trusting a non-existent proxy is itself a risk).
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
}

app.use(cors(corsOptions))
app.use(express.json());
app.use(require('./config/checkToken'))

// Baseline abuse protection for the whole API. Auth endpoints add a stricter
// limiter inside routes/api/users.js; paid-quota routes add externalApiLimiter.
app.use('/api', apiLimiter)

// Put API routes here, before the "catch all" route
app.use('/api/users', require("./routes/api/users"))
app.use('/api/event-types', require("./routes/api/eventTypes"))
app.use('/api/astronomy', externalApiLimiter, require("./routes/api/astronomy"))
app.use('/api/launches', require("./routes/api/launches"))
app.use('/api/events', require("./routes/api/events"))
app.use('/api/user-events', require("./routes/api/userEvents"))
app.use('/api/iss', require("./routes/api/iss"))
app.use('/api/weather', externalApiLimiter, require("./routes/api/weather"))
app.use('/api/score', externalApiLimiter, require("./routes/api/score"))
app.use('/api/map', externalApiLimiter, require("./routes/api/map"))
app.use('/api/news', externalApiLimiter, require("./routes/api/news"))

app.get("/", (req, res) => {
  res.send("API server is running");
});

const PORT = process.env.PORT || 3001//if we don't have port in .env it is automaticaly running on 3001

const server = app.listen(PORT, () => {
  console.log(`Express app is running on port: ${PORT}`)
})

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the existing server or set PORT to another value.`);
    process.exitCode = 1;
    return;
  }
  console.error("Express server error:", error);
  process.exitCode = 1;
});
