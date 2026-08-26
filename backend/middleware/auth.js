const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Not signed in." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

// Like requireAuth but doesn't reject when there's no/invalid token — just
// leaves req.userId as null. Useful for endpoints that are public but behave
// differently when the caller happens to be signed in (e.g. "isFollowing").
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    req.userId = null;
    return next();
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
  } catch (err) {
    req.userId = null;
  }
  next();
}

module.exports = { requireAuth, optionalAuth, JWT_SECRET };
