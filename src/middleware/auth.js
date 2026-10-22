const jwt = require("jsonwebtoken");
const env = require("../config/env");
const AppError = require("../utils/AppError");
const User = require("../models/User");

// Verifies the access token and attaches { id, role } to req.user.
// Also re-checks the user's live status so a suspended user is rejected
// immediately instead of only after their token expires.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new AppError(401, "Not authenticated"));

  let payload;
  try {
    payload = jwt.verify(token, env.jwt.accessSecret);
  } catch {
    return next(new AppError(401, "Invalid or expired token"));
  }

  User.findById(payload.sub)
    .then((user) => {
      if (!user) return next(new AppError(401, "User no longer exists"));
      if (user.status === "suspended") return next(new AppError(403, "Account suspended"));
      req.user = { id: user._id.toString(), role: user.role, doc: user };
      next();
    })
    .catch(next);
}

// requireRole('admin', 'teacher') -> 403 for anyone else. Must run after requireAuth.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError(401, "Not authenticated"));
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, "You don't have permission to do that"));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
