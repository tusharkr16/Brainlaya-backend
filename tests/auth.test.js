const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const setup = require("./setup");
const { app, signupAndLogin } = require("./helpers");

before(setup.start);
after(setup.stop);
beforeEach(setup.reset);

test("signup creates a user and returns an access token", async () => {
  const res = await request(app())
    .post("/api/auth/signup")
    .send({ name: "Jane Doe", email: "jane@test.dev", password: "Password123!", role: "student" });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.user.email, "jane@test.dev");
  assert.ok(res.body.data.accessToken);
  assert.equal(res.body.data.user.passwordHash, undefined, "password hash must never be returned");
});

test("signup rejects a duplicate email with 409", async () => {
  await signupAndLogin("student", { email: "dup@test.dev" });
  const res = await request(app())
    .post("/api/auth/signup")
    .send({ name: "Someone Else", email: "dup@test.dev", password: "Password123!", role: "student" });
  assert.equal(res.status, 409);
});

test("signup rejects a weak password with 400", async () => {
  const res = await request(app())
    .post("/api/auth/signup")
    .send({ name: "Weak Pw", email: "weak@test.dev", password: "123", role: "student" });
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test("signup cannot be used to create an admin", async () => {
  const res = await request(app())
    .post("/api/auth/signup")
    .send({ name: "Sneaky", email: "sneaky@test.dev", password: "Password123!", role: "admin" });
  assert.equal(res.status, 400, "role must be restricted to teacher|student at signup");
});

test("login with correct credentials succeeds", async () => {
  await request(app())
    .post("/api/auth/signup")
    .send({ name: "Login Test", email: "login@test.dev", password: "Password123!", role: "student" });

  const res = await request(app())
    .post("/api/auth/login")
    .send({ email: "login@test.dev", password: "Password123!" });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.accessToken);
});

test("login with wrong password returns 401", async () => {
  await request(app())
    .post("/api/auth/signup")
    .send({ name: "Login Test", email: "wrongpw@test.dev", password: "Password123!", role: "student" });

  const res = await request(app())
    .post("/api/auth/login")
    .send({ email: "wrongpw@test.dev", password: "WrongPassword!" });
  assert.equal(res.status, 401);
});

test("GET /api/auth/me requires a valid token", async () => {
  const noToken = await request(app()).get("/api/auth/me");
  assert.equal(noToken.status, 401);

  const { token } = await signupAndLogin("student");
  const withToken = await request(app()).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
  assert.equal(withToken.status, 200);
});

test("refresh + logout revoke the session so a stale refresh cookie is rejected", async () => {
  const agent = request.agent(app());
  await agent.post("/api/auth/signup").send({ name: "Sess", email: "sess@test.dev", password: "Password123!", role: "student" });

  const refreshed = await agent.post("/api/auth/refresh");
  assert.equal(refreshed.status, 200);

  await agent.post("/api/auth/logout");
  const afterLogout = await agent.post("/api/auth/refresh");
  assert.equal(afterLogout.status, 401);
});
