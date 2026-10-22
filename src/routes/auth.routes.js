const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");

const env = require("../config/env");
const User = require("../models/User");
const validate = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
} = require("../lib/tokens");
const RefreshToken = require("../models/RefreshToken");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.nodeEnv === "test",
  message: { success: false, message: "Too many attempts, try again later", errors: null },
});

const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
  role: z.enum(["teacher", "student"]).default("student"),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

async function issueSession(res, user) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken } = await issueRefreshToken(user);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  return accessToken;
}

router.post(
  "/signup",
  authLimiter,
  validate(signupSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.body;
    const existing = await User.findOne({ email });
    if (existing) throw new AppError(409, "Email already registered");

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash, role });
    const accessToken = await issueSession(res, user);

    res.status(201).json({ success: true, message: "Account created", data: { user: user.toSafeJSON(), accessToken } });
  })
);

router.post(
  "/login",
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) throw new AppError(401, "Invalid email or password");

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) throw new AppError(401, "Invalid email or password");
    if (user.status === "suspended") throw new AppError(403, "Account suspended");

    const accessToken = await issueSession(res, user);
    res.json({ success: true, message: "Logged in", data: { user: user.toSafeJSON(), accessToken } });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const oldToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!oldToken) throw new AppError(401, "No refresh token");

    const record = await rotateRefreshToken(oldToken);
    if (!record) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
      throw new AppError(401, "Refresh token invalid or expired");
    }

    const user = await User.findById(record.userId);
    if (!user || user.status === "suspended") {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
      throw new AppError(401, "Account no longer active");
    }

    const accessToken = await issueSession(res, user);
    res.json({ success: true, message: "Token refreshed", data: { user: user.toSafeJSON(), accessToken } });
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (token) await RefreshToken.updateOne({ token }, { revoked: true });
    res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
    res.json({ success: true, message: "Logged out", data: null });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ success: true, message: "OK", data: { user: req.user.doc.toSafeJSON() } });
  })
);

module.exports = router;
