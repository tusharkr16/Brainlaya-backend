const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../src/app");
const User = require("../src/models/User");
const { signAccessToken } = require("../src/lib/tokens");

async function signupAndLogin(role, overrides = {}) {
  const email = overrides.email || `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  const res = await request(app)
    .post("/api/auth/signup")
    .send({ name: overrides.name || `Test ${role}`, email, password: "Password123!", role });
  return { token: res.body.data.accessToken, user: res.body.data.user, email };
}

// signup can't create admins (by design), so admins are seeded directly for tests.
async function createAdmin(overrides = {}) {
  const email = overrides.email || `admin-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await User.create({ name: "Test Admin", email, passwordHash, role: "admin" });
  return { token: signAccessToken(user), user: user.toSafeJSON(), email };
}

module.exports = { signupAndLogin, createAdmin, app: () => app };
