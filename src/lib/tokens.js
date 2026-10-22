const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("../config/env");
const RefreshToken = require("../models/RefreshToken");

function signAccessToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpires,
  });
}

async function issueRefreshToken(user) {
  const token = crypto.randomBytes(40).toString("hex");
  const expiresAt = new Date(Date.now() + env.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000);
  await RefreshToken.create({ token, userId: user._id, expiresAt });
  return { token, expiresAt };
}

async function rotateRefreshToken(oldToken) {
  const record = await RefreshToken.findOne({ token: oldToken, revoked: false });
  if (!record || record.expiresAt < new Date()) return null;
  record.revoked = true;
  await record.save();
  return record;
}

async function revokeAllForUser(userId) {
  await RefreshToken.updateMany({ userId, revoked: false }, { revoked: true });
}

const REFRESH_COOKIE_NAME = "brainlaya_refresh";

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    maxAge: env.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000,
    path: "/api/auth",
  };
}

module.exports = {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeAllForUser,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
};
