const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const setup = require("./setup");
const { app, signupAndLogin } = require("./helpers");

before(setup.start);
after(setup.stop);
beforeEach(setup.reset);

test("a teacher can set mentor-profile fields via PATCH /api/users/me and they round-trip", async () => {
  const teacher = await signupAndLogin("teacher");

  const body = {
    headline: "Advanced Mathematics & Physics",
    bio: "I believe higher-level math doesn't have to be intimidating.",
    subjects: ["Calculus (I-III)", "Linear Algebra"],
    languages: ["English", "French"],
    location: "Boston, MA (Online)",
    sessionRate: 85,
    availability: "Weekday evenings (ET)",
    teachingExperience: [{ title: "Senior Lecturer", place: "University of Massachusetts", period: "2018 - Present", description: "Leading undergrad courses." }],
  };

  const res = await request(app()).patch("/api/users/me").set("Authorization", `Bearer ${teacher.token}`).send(body);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.headline, body.headline);
  assert.deepEqual(res.body.data.subjects, body.subjects);
  assert.equal(res.body.data.teachingExperience[0].title, "Senior Lecturer");

  const publicView = await request(app()).get(`/api/users/${teacher.user.id}`);
  assert.equal(publicView.status, 200);
  assert.equal(publicView.body.data.headline, body.headline);
  assert.equal(publicView.body.data.sessionRate, 85);
});

test("GET /api/users?role=teacher only lists teachers who set up a mentor profile", async () => {
  const configured = await signupAndLogin("teacher");
  await signupAndLogin("teacher"); // no profile set — must not appear
  await signupAndLogin("student"); // wrong role — must not appear

  await request(app())
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${configured.token}`)
    .send({ headline: "Advanced Mathematics & Physics" });

  const res = await request(app()).get("/api/users?role=teacher");
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].id, configured.user.id);
});

test("GET /api/users requires role=teacher", async () => {
  const res = await request(app()).get("/api/users");
  assert.equal(res.status, 400);
});

test("GET /api/users/:id 404s for a non-teacher id", async () => {
  const student = await signupAndLogin("student");
  const res = await request(app()).get(`/api/users/${student.user.id}`);
  assert.equal(res.status, 404);
});
