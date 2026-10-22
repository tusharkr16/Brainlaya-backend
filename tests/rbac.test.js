const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const setup = require("./setup");
const { app, signupAndLogin, createAdmin } = require("./helpers");

before(setup.start);
after(setup.stop);
beforeEach(setup.reset);

const courseBody = {
  title: "RBAC Test Course",
  description: "A course used purely to exercise role checks end to end.",
  category: "Technology",
  price: 0,
};

// Matrix: for each role-gated route, every OTHER role must get 403, and an
// unauthenticated caller must get 401. This is the thing the checklist asks
// for explicitly ("RBAC middleware tested for all three roles").
test("POST /api/courses is teacher-only", async () => {
  const teacher = await signupAndLogin("teacher");
  const student = await signupAndLogin("student");
  const admin = await createAdmin();

  const asTeacher = await request(app()).post("/api/courses").set("Authorization", `Bearer ${teacher.token}`).send(courseBody);
  assert.equal(asTeacher.status, 201);

  const asStudent = await request(app()).post("/api/courses").set("Authorization", `Bearer ${student.token}`).send(courseBody);
  assert.equal(asStudent.status, 403);

  const asAdmin = await request(app()).post("/api/courses").set("Authorization", `Bearer ${admin.token}`).send(courseBody);
  assert.equal(asAdmin.status, 403);

  const anon = await request(app()).post("/api/courses").send(courseBody);
  assert.equal(anon.status, 401);
});

test("POST /api/enrollments is student-only", async () => {
  const teacher = await signupAndLogin("teacher");
  const student = await signupAndLogin("student");
  const admin = await createAdmin();

  const created = await request(app()).post("/api/courses").set("Authorization", `Bearer ${teacher.token}`).send(courseBody);
  const courseId = created.body.data._id;
  await request(app()).post(`/api/courses/${courseId}/submit`).set("Authorization", `Bearer ${teacher.token}`);
  await request(app()).post(`/api/admin/courses/${courseId}/approve`).set("Authorization", `Bearer ${admin.token}`);

  const asTeacher = await request(app()).post("/api/enrollments").set("Authorization", `Bearer ${teacher.token}`).send({ courseId });
  assert.equal(asTeacher.status, 403);

  const asAdmin = await request(app()).post("/api/enrollments").set("Authorization", `Bearer ${admin.token}`).send({ courseId });
  assert.equal(asAdmin.status, 403);

  const asStudent = await request(app()).post("/api/enrollments").set("Authorization", `Bearer ${student.token}`).send({ courseId });
  assert.equal(asStudent.status, 201);
});

test("/api/admin/* is admin-only for every role", async () => {
  const teacher = await signupAndLogin("teacher");
  const student = await signupAndLogin("student");
  const admin = await createAdmin();

  const asTeacher = await request(app()).get("/api/admin/users").set("Authorization", `Bearer ${teacher.token}`);
  assert.equal(asTeacher.status, 403);

  const asStudent = await request(app()).get("/api/admin/users").set("Authorization", `Bearer ${student.token}`);
  assert.equal(asStudent.status, 403);

  const anon = await request(app()).get("/api/admin/users");
  assert.equal(anon.status, 401);

  const asAdmin = await request(app()).get("/api/admin/users").set("Authorization", `Bearer ${admin.token}`);
  assert.equal(asAdmin.status, 200);
});

test("a suspended user is rejected even with a still-valid access token", async () => {
  const student = await signupAndLogin("student");
  const admin = await createAdmin();

  const studentId = student.user.id;
  const suspend = await request(app()).patch(`/api/admin/users/${studentId}/suspend`).set("Authorization", `Bearer ${admin.token}`);
  assert.equal(suspend.status, 200);

  const res = await request(app()).get("/api/auth/me").set("Authorization", `Bearer ${student.token}`);
  assert.equal(res.status, 403);
});

test("teacher cannot edit or delete another teacher's course", async () => {
  const owner = await signupAndLogin("teacher");
  const intruder = await signupAndLogin("teacher");

  const created = await request(app()).post("/api/courses").set("Authorization", `Bearer ${owner.token}`).send(courseBody);
  const courseId = created.body.data._id;

  const patch = await request(app())
    .patch(`/api/courses/${courseId}`)
    .set("Authorization", `Bearer ${intruder.token}`)
    .send({ title: "Hijacked" });
  assert.equal(patch.status, 403);

  const del = await request(app()).delete(`/api/courses/${courseId}`).set("Authorization", `Bearer ${intruder.token}`);
  assert.equal(del.status, 403);
});

test("POST /api/lessons/course/:courseId is teacher(owner)/admin-only", async () => {
  const owner = await signupAndLogin("teacher");
  const intruder = await signupAndLogin("teacher");
  const student = await signupAndLogin("student");
  const admin = await createAdmin();

  const created = await request(app()).post("/api/courses").set("Authorization", `Bearer ${owner.token}`).send(courseBody);
  const courseId = created.body.data._id;
  const lessonBody = { title: "Lesson 1", content: "Some content" };

  const asStudent = await request(app()).post(`/api/lessons/course/${courseId}`).set("Authorization", `Bearer ${student.token}`).send(lessonBody);
  assert.equal(asStudent.status, 403);

  const asIntruder = await request(app()).post(`/api/lessons/course/${courseId}`).set("Authorization", `Bearer ${intruder.token}`).send(lessonBody);
  assert.equal(asIntruder.status, 403, "a teacher who does not own the course must not add lessons to it");

  const anon = await request(app()).post(`/api/lessons/course/${courseId}`).send(lessonBody);
  assert.equal(anon.status, 401);

  const asAdmin = await request(app()).post(`/api/lessons/course/${courseId}`).set("Authorization", `Bearer ${admin.token}`).send(lessonBody);
  assert.equal(asAdmin.status, 201);

  const asOwner = await request(app()).post(`/api/lessons/course/${courseId}`).set("Authorization", `Bearer ${owner.token}`).send(lessonBody);
  assert.equal(asOwner.status, 201);
});

test("a draft course's lessons are hidden from non-owners (404), including anonymous visitors", async () => {
  const owner = await signupAndLogin("teacher");
  const student = await signupAndLogin("student");

  const created = await request(app()).post("/api/courses").set("Authorization", `Bearer ${owner.token}`).send(courseBody);
  const courseId = created.body.data._id;
  await request(app()).post(`/api/lessons/course/${courseId}`).set("Authorization", `Bearer ${owner.token}`).send({ title: "L1", content: "c" });

  const asStudent = await request(app()).get(`/api/lessons/course/${courseId}`).set("Authorization", `Bearer ${student.token}`);
  assert.equal(asStudent.status, 404);

  const anon = await request(app()).get(`/api/lessons/course/${courseId}`);
  assert.equal(anon.status, 404);
});

test("an approved course's lessons are publicly visible with title/schedule/link only, full content stays gated to enrolled/owner/admin", async () => {
  const owner = await signupAndLogin("teacher");
  const student = await signupAndLogin("student");
  const admin = await createAdmin();

  const created = await request(app()).post("/api/courses").set("Authorization", `Bearer ${owner.token}`).send(courseBody);
  const courseId = created.body.data._id;
  await request(app()).post(`/api/courses/${courseId}/submit`).set("Authorization", `Bearer ${owner.token}`);
  await request(app()).post(`/api/admin/courses/${courseId}/approve`).set("Authorization", `Bearer ${admin.token}`);

  await request(app())
    .post(`/api/lessons/course/${courseId}`)
    .set("Authorization", `Bearer ${owner.token}`)
    .send({ title: "Live Kickoff", content: "Secret lesson content", scheduledAt: "2026-11-01T15:00:00.000Z", meetingLink: "https://zoom.us/j/123" });

  const anon = await request(app()).get(`/api/lessons/course/${courseId}`);
  assert.equal(anon.status, 200);
  assert.equal(anon.body.data[0].title, "Live Kickoff");
  assert.equal(anon.body.data[0].meetingLink, "https://zoom.us/j/123");
  assert.ok(anon.body.data[0].scheduledAt);
  assert.equal(anon.body.data[0].content, undefined, "anonymous visitors must not see full lesson content");

  const asNonEnrolledStudent = await request(app()).get(`/api/lessons/course/${courseId}`).set("Authorization", `Bearer ${student.token}`);
  assert.equal(asNonEnrolledStudent.body.data[0].content, undefined, "a non-enrolled student must not see full lesson content");

  const asOwner = await request(app()).get(`/api/lessons/course/${courseId}`).set("Authorization", `Bearer ${owner.token}`);
  assert.equal(asOwner.body.data[0].content, "Secret lesson content");
});

test("admin user-management actions (suspend/reactivate/role/reset/update/password/delete) are admin-only", async () => {
  const teacher = await signupAndLogin("teacher");
  const student = await signupAndLogin("student");
  const admin = await createAdmin();
  const targetId = student.user.id;

  for (const [method, path, body] of [
    ["patch", `/api/admin/users/${targetId}/suspend`, undefined],
    ["patch", `/api/admin/users/${targetId}/reactivate`, undefined],
    ["patch", `/api/admin/users/${targetId}/role`, { role: "teacher" }],
    ["post", `/api/admin/users/${targetId}/reset`, { confirmEmail: student.email }],
    ["patch", `/api/admin/users/${targetId}`, { name: "Hijacked" }],
    ["patch", `/api/admin/users/${targetId}/password`, { password: "NewPassword123!" }],
    ["post", `/api/admin/users`, { name: "New Person", email: "new-person@test.dev", password: "Password123!" }],
    ["delete", `/api/admin/users/${targetId}`, undefined],
  ]) {
    const asTeacher = await request(app())[method](path).set("Authorization", `Bearer ${teacher.token}`).send(body);
    assert.equal(asTeacher.status, 403, `${method.toUpperCase()} ${path} must reject a teacher`);

    const anon = await request(app())[method](path).send(body);
    assert.equal(anon.status, 401, `${method.toUpperCase()} ${path} must reject an anonymous caller`);
  }

  const asAdmin = await request(app()).patch(`/api/admin/users/${targetId}/suspend`).set("Authorization", `Bearer ${admin.token}`);
  assert.equal(asAdmin.status, 200);
});

test("admin can create a user with a role, edit their details, set an exact password, and delete them", async () => {
  const admin = await createAdmin();

  const created = await request(app())
    .post("/api/admin/users")
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ name: "Nina Teacher", email: "nina@test.dev", password: "Password123!", role: "teacher" });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.role, "teacher");
  const userId = created.body.data.id;

  const duplicate = await request(app())
    .post("/api/admin/users")
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ name: "Dup", email: "nina@test.dev", password: "Password123!" });
  assert.equal(duplicate.status, 409);

  const updated = await request(app())
    .patch(`/api/admin/users/${userId}`)
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ name: "Nina Updated", email: "nina-updated@test.dev" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.name, "Nina Updated");
  assert.equal(updated.body.data.email, "nina-updated@test.dev");

  const passwordChange = await request(app())
    .patch(`/api/admin/users/${userId}/password`)
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ password: "BrandNewPassword1!" });
  assert.equal(passwordChange.status, 200);

  const loginWithNewPassword = await request(app())
    .post("/api/auth/login")
    .send({ email: "nina-updated@test.dev", password: "BrandNewPassword1!" });
  assert.equal(loginWithNewPassword.status, 200);

  const del = await request(app()).delete(`/api/admin/users/${userId}`).set("Authorization", `Bearer ${admin.token}`);
  assert.equal(del.status, 200);

  const loginAfterDelete = await request(app())
    .post("/api/auth/login")
    .send({ email: "nina-updated@test.dev", password: "BrandNewPassword1!" });
  assert.equal(loginAfterDelete.status, 401);
});

test("admin cannot delete their own account", async () => {
  const admin = await createAdmin();
  const res = await request(app()).delete(`/api/admin/users/${admin.user.id}`).set("Authorization", `Bearer ${admin.token}`);
  assert.equal(res.status, 400);
});

test("reset requires the confirmation email to match, and rotates the password", async () => {
  const student = await signupAndLogin("student");
  const admin = await createAdmin();

  const wrongEmail = await request(app())
    .post(`/api/admin/users/${student.user.id}/reset`)
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ confirmEmail: "not-the-right-email@test.dev" });
  assert.equal(wrongEmail.status, 400);

  const reset = await request(app())
    .post(`/api/admin/users/${student.user.id}/reset`)
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ confirmEmail: student.email });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.data.tempPassword);

  const oldPasswordLogin = await request(app()).post("/api/auth/login").send({ email: student.email, password: "Password123!" });
  assert.equal(oldPasswordLogin.status, 401, "the old password must no longer work after a reset");

  const newPasswordLogin = await request(app()).post("/api/auth/login").send({ email: student.email, password: reset.body.data.tempPassword });
  assert.equal(newPasswordLogin.status, 200);
});
