const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const setup = require("./setup");
const { app, signupAndLogin, createAdmin } = require("./helpers");

before(setup.start);
after(setup.stop);
beforeEach(setup.reset);

const courseBody = {
  title: "Astrophysics 101",
  description: "A course used purely to exercise schedule role checks end to end.",
  category: "Science",
  price: 0,
};

const entryBody = {
  title: "Welcome to the Cosmos",
  dayOfWeek: 1,
  startTime: "09:00",
  endTime: "10:00",
};

test("POST /api/schedule is teacher/admin-only and requires ownership", async () => {
  const owner = await signupAndLogin("teacher");
  const intruder = await signupAndLogin("teacher");
  const student = await signupAndLogin("student");
  const admin = await createAdmin();

  const created = await request(app()).post("/api/courses").set("Authorization", `Bearer ${owner.token}`).send(courseBody);
  const courseId = created.body.data._id;

  const asStudent = await request(app())
    .post("/api/schedule")
    .set("Authorization", `Bearer ${student.token}`)
    .send({ ...entryBody, courseId });
  assert.equal(asStudent.status, 403);

  const anon = await request(app()).post("/api/schedule").send({ ...entryBody, courseId });
  assert.equal(anon.status, 401);

  const asIntruder = await request(app())
    .post("/api/schedule")
    .set("Authorization", `Bearer ${intruder.token}`)
    .send({ ...entryBody, courseId });
  assert.equal(asIntruder.status, 403, "a teacher who does not own the course must not schedule classes for it");

  const asOwner = await request(app())
    .post("/api/schedule")
    .set("Authorization", `Bearer ${owner.token}`)
    .send({ ...entryBody, courseId });
  assert.equal(asOwner.status, 201);
  assert.equal(asOwner.body.data.dayOfWeek, 1);

  const asAdmin = await request(app())
    .post("/api/schedule")
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ ...entryBody, courseId, title: "Admin-scheduled session" });
  assert.equal(asAdmin.status, 201, "admin can schedule a class for any course");
});

test("endTime must be after startTime", async () => {
  const owner = await signupAndLogin("teacher");
  const created = await request(app()).post("/api/courses").set("Authorization", `Bearer ${owner.token}`).send(courseBody);
  const courseId = created.body.data._id;

  const res = await request(app())
    .post("/api/schedule")
    .set("Authorization", `Bearer ${owner.token}`)
    .send({ ...entryBody, courseId, startTime: "10:00", endTime: "09:00" });
  assert.equal(res.status, 400);
});

test("GET /api/schedule scopes to the teacher's own classes, admin sees everything, and DELETE respects ownership", async () => {
  const owner = await signupAndLogin("teacher");
  const otherTeacher = await signupAndLogin("teacher");
  const admin = await createAdmin();

  const ownerCourse = await request(app()).post("/api/courses").set("Authorization", `Bearer ${owner.token}`).send(courseBody);
  const otherCourse = await request(app())
    .post("/api/courses")
    .set("Authorization", `Bearer ${otherTeacher.token}`)
    .send({ ...courseBody, title: "Other Course" });

  const ownerEntry = await request(app())
    .post("/api/schedule")
    .set("Authorization", `Bearer ${owner.token}`)
    .send({ ...entryBody, courseId: ownerCourse.body.data._id });
  await request(app())
    .post("/api/schedule")
    .set("Authorization", `Bearer ${otherTeacher.token}`)
    .send({ ...entryBody, courseId: otherCourse.body.data._id, title: "Other class" });

  const ownerView = await request(app()).get("/api/schedule").set("Authorization", `Bearer ${owner.token}`);
  assert.equal(ownerView.status, 200);
  assert.equal(ownerView.body.data.length, 1, "a teacher only sees their own scheduled classes");
  assert.equal(ownerView.body.data[0].title, entryBody.title);

  const adminView = await request(app()).get("/api/schedule").set("Authorization", `Bearer ${admin.token}`);
  assert.equal(adminView.body.data.length, 2, "admin sees every scheduled class");

  const deleteByIntruder = await request(app())
    .delete(`/api/schedule/${ownerEntry.body.data._id}`)
    .set("Authorization", `Bearer ${otherTeacher.token}`);
  assert.equal(deleteByIntruder.status, 403);

  const deleteByAdmin = await request(app())
    .delete(`/api/schedule/${ownerEntry.body.data._id}`)
    .set("Authorization", `Bearer ${admin.token}`);
  assert.equal(deleteByAdmin.status, 200);
});
