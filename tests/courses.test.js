const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const setup = require("./setup");
const { app, signupAndLogin, createAdmin } = require("./helpers");

before(setup.start);
after(setup.stop);
beforeEach(setup.reset);

const courseBody = {
  title: "Course Lifecycle Test",
  description: "Exercises draft -> submit -> approve/reject -> pending-changes.",
  category: "Design",
  price: 25,
};

async function createApprovedCourse(teacherToken, adminToken) {
  const created = await request(app()).post("/api/courses").set("Authorization", `Bearer ${teacherToken}`).send(courseBody);
  const courseId = created.body.data._id;
  await request(app()).post(`/api/courses/${courseId}/submit`).set("Authorization", `Bearer ${teacherToken}`);
  await request(app()).post(`/api/admin/courses/${courseId}/approve`).set("Authorization", `Bearer ${adminToken}`);
  return courseId;
}

test("draft course is not visible in the public listing", async () => {
  const teacher = await signupAndLogin("teacher");
  await request(app()).post("/api/courses").set("Authorization", `Bearer ${teacher.token}`).send(courseBody);

  const list = await request(app()).get("/api/courses");
  assert.equal(list.body.data.length, 0);
});

test("approve makes a course visible publicly and notifies the teacher", async () => {
  const teacher = await signupAndLogin("teacher");
  const admin = await createAdmin();
  const courseId = await createApprovedCourse(teacher.token, admin.token);

  const list = await request(app()).get("/api/courses");
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0]._id, courseId);

  const notifications = await request(app()).get("/api/notifications").set("Authorization", `Bearer ${teacher.token}`);
  assert.ok(notifications.body.data.some((n) => n.type === "course_approved"));
});

test("reject sets a rejection reason and the course stays hidden", async () => {
  const teacher = await signupAndLogin("teacher");
  const admin = await createAdmin();

  const created = await request(app()).post("/api/courses").set("Authorization", `Bearer ${teacher.token}`).send(courseBody);
  const courseId = created.body.data._id;
  await request(app()).post(`/api/courses/${courseId}/submit`).set("Authorization", `Bearer ${teacher.token}`);

  const rejectNoReason = await request(app()).post(`/api/admin/courses/${courseId}/reject`).set("Authorization", `Bearer ${admin.token}`).send({});
  assert.equal(rejectNoReason.status, 400, "reason must be mandatory");

  const reject = await request(app())
    .post(`/api/admin/courses/${courseId}/reject`)
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ reason: "Thumbnail missing and description too short" });
  assert.equal(reject.status, 200);
  assert.equal(reject.body.data.status, "rejected");
  assert.ok(reject.body.data.rejectionReason.length > 0);

  const list = await request(app()).get("/api/courses");
  assert.equal(list.body.data.length, 0);
});

test("editing an approved course stages pending changes instead of mutating it live", async () => {
  const teacher = await signupAndLogin("teacher");
  const admin = await createAdmin();
  const courseId = await createApprovedCourse(teacher.token, admin.token);

  const patch = await request(app())
    .patch(`/api/courses/${courseId}`)
    .set("Authorization", `Bearer ${teacher.token}`)
    .send({ title: "Renamed While Live" });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.data.pendingChanges.title, "Renamed While Live");
  assert.equal(patch.body.data.title, "Course Lifecycle Test", "live title must not change yet");

  const publicView = await request(app()).get(`/api/courses/${courseId}`);
  assert.equal(publicView.body.data.title, "Course Lifecycle Test", "students must still see the last-approved title");

  const approveChanges = await request(app()).post(`/api/admin/courses/${courseId}/approve`).set("Authorization", `Bearer ${admin.token}`);
  assert.equal(approveChanges.body.data.title, "Renamed While Live");
  assert.equal(approveChanges.body.data.pendingChanges, null);
});

test("a course can be created with outcomes and requirements, and they travel through pending-changes", async () => {
  const teacher = await signupAndLogin("teacher");
  const admin = await createAdmin();

  const created = await request(app())
    .post("/api/courses")
    .set("Authorization", `Bearer ${teacher.token}`)
    .send({ ...courseBody, outcomes: ["Build a portfolio project", "Understand core design systems"], requirements: ["No prior experience needed"] });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.data.outcomes, ["Build a portfolio project", "Understand core design systems"]);
  assert.deepEqual(created.body.data.requirements, ["No prior experience needed"]);

  const courseId = created.body.data._id;
  await request(app()).post(`/api/courses/${courseId}/submit`).set("Authorization", `Bearer ${teacher.token}`);
  await request(app()).post(`/api/admin/courses/${courseId}/approve`).set("Authorization", `Bearer ${admin.token}`);

  const patch = await request(app())
    .patch(`/api/courses/${courseId}`)
    .set("Authorization", `Bearer ${teacher.token}`)
    .send({ outcomes: ["Updated outcome"] });
  assert.equal(patch.status, 200);
  assert.deepEqual(patch.body.data.pendingChanges.outcomes, ["Updated outcome"]);

  const publicView = await request(app()).get(`/api/courses/${courseId}`);
  assert.deepEqual(publicView.body.data.outcomes, ["Build a portfolio project", "Understand core design systems"], "live course must not change until approved");
});

test("delete is blocked for a teacher when the course has active enrollments", async () => {
  const teacher = await signupAndLogin("teacher");
  const student = await signupAndLogin("student");
  const admin = await createAdmin();
  const courseId = await createApprovedCourse(teacher.token, admin.token);

  await request(app()).post("/api/enrollments").set("Authorization", `Bearer ${student.token}`).send({ courseId });

  const blocked = await request(app()).delete(`/api/courses/${courseId}`).set("Authorization", `Bearer ${teacher.token}`);
  assert.equal(blocked.status, 409);

  const forced = await request(app()).delete(`/api/courses/${courseId}?force=true`).set("Authorization", `Bearer ${admin.token}`);
  assert.equal(forced.status, 200);

  const list = await request(app()).get("/api/courses");
  assert.equal(list.body.data.length, 0);
});
