const jwt = require("jsonwebtoken");

module.exports = function(req, res, next) {
  // Header-only: never accept the JWT from the query string — query params leak
  // into server/proxy access logs and browser history. Clients send it as
  // `Authorization: Bearer <token>` (see client send-request.ts).
  let token = req.get("Authorization");

  if (token) {
    token = token.replace("Bearer ", "");

    jwt.verify(token, process.env.SECRET, function(err, decoded) {
      req.user = err ? null : decoded.user;
      req.exp = err ? null : new Date(decoded.exp * 1000);
      return next();
    });
  } else {
    req.user = null;
    return next();
  }
};
