const express = require("express");
const { z } = require("zod");
const Assignment = require("../models/Assignment");
const Submission = require("../models/Submission");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const { requireAuth, requireRole } = require("../middleware/auth");
const validate = require("../middleware/validate");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

const router = express.Router();

const assignmentSchema = z.object({
  courseId:    z.string().min(1),
  title:       z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
  dueDate:     z.string().datetime().nullable().optional(),
  maxScore:    z.number().int().min(1).max(1000).default(100),
});

async function ownsAssignment(assignmentId, teacherId) {
  const a = await Assignment.findById(assignmentId).populate("courseId", "teacherId");
  if (!a) return null;
  if (a.courseId.teacherId.toString() !== teacherId.toString()) return null;
  return a;
}

// GET /api/assignments/course/:courseId — list (teacher owns | student enrolled)
router.get(
  "/course/:courseId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.params.courseId);
    if (!course) throw new AppError(404, "Course not found");

    const isOwner = course.teacherId.toString() === req.user.id;
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      const enrollment = await Enrollment.findOne({ courseId: course._id, studentId: req.user.id, status: "enrolled" });
      if (!enrollment) throw new AppError(403, "Not enrolled in this course");
    }

    const assignments = await Assignment.find({ courseId: req.params.courseId }).sort({ createdAt: -1 });
    res.json({ success: true, data: assignments });
  })
);

// POST /api/assignments — teacher creates
router.post(
  "/",
  requireAuth,
  requireRole("teacher", "admin"),
  validate(assignmentSchema),
  asyncHandler(async (req, res) => {
    const course = await Course.findById(req.body.courseId);
    if (!course) throw new AppError(404, "Course not found");
    if (req.user.role === "teacher" && course.teacherId.toString() !== req.user.id)
      throw new AppError(403, "Not your course");

    const assignment = await Assignment.create({ ...req.body, createdBy: req.user.id });
    res.status(201).json({ success: true, data: assignment });
  })
);

// PATCH /api/assignments/:id — teacher updates
router.patch(
  "/:id",
  requireAuth,
  requireRole("teacher", "admin"),
  asyncHandler(async (req, res) => {
    const a = await ownsAssignment(req.params.id, req.user.id);
    if (!a && req.user.role !== "admin") throw new AppError(403, "Not your assignment");
    const target = a || await Assignment.findById(req.params.id);
    if (!target) throw new AppError(404, "Assignment not found");

    const allowed = ["title", "description", "dueDate", "maxScore"];
    allowed.forEach((k) => { if (req.body[k] !== undefined) target[k] = req.body[k]; });
    await target.save();
    res.json({ success: true, data: target });
  })
);

// DELETE /api/assignments/:id — teacher deletes
router.delete(
  "/:id",
  requireAuth,
  requireRole("teacher", "admin"),
  asyncHandler(async (req, res) => {
    const a = await ownsAssignment(req.params.id, req.user.id);
    if (!a && req.user.role !== "admin") throw new AppError(403, "Not your assignment");
    await Assignment.deleteOne({ _id: req.params.id });
    await Submission.deleteMany({ assignmentId: req.params.id });
    res.json({ success: true, message: "Assignment deleted" });
  })
);

// POST /api/assignments/:id/submit — student submits
router.post(
  "/:id/submit",
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) throw new AppError(404, "Assignment not found");

    const enrollment = await Enrollment.findOne({
      courseId: assignment.courseId,
      studentId: req.user.id,
      status: "enrolled",
    });
    if (!enrollment) throw new AppError(403, "Not enrolled in this course");

    const { body } = z.object({ body: z.string().trim().min(1).max(20000) }).parse(req.body);
    const submission = await Submission.findOneAndUpdate(
      { assignmentId: assignment._id, studentId: req.user.id },
      { body, gradedAt: null, score: null, feedback: "" },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: submission });
  })
);

// GET /api/assignments/:id/submission — student gets own submission
router.get(
  "/:id/submission",
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    const submission = await Submission.findOne({ assignmentId: req.params.id, studentId: req.user.id });
    res.json({ success: true, data: submission || null });
  })
);

// GET /api/assignments/:id/submissions — teacher views all submissions
router.get(
  "/:id/submissions",
  requireAuth,
  requireRole("teacher", "admin"),
  asyncHandler(async (req, res) => {
    const a = await ownsAssignment(req.params.id, req.user.id);
    if (!a && req.user.role !== "admin") throw new AppError(403, "Not your assignment");

    const submissions = await Submission.find({ assignmentId: req.params.id })
      .populate("studentId", "name email avatar")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: submissions });
  })
);

// PATCH /api/assignments/:id/submissions/:sid/grade — teacher grades
router.patch(
  "/:id/submissions/:sid/grade",
  requireAuth,
  requireRole("teacher", "admin"),
  asyncHandler(async (req, res) => {
    const a = await ownsAssignment(req.params.id, req.user.id);
    if (!a && req.user.role !== "admin") throw new AppError(403, "Not your assignment");

    const { score, feedback } = z.object({
      score:    z.number().min(0).max(1000),
      feedback: z.string().trim().max(2000).default(""),
    }).parse(req.body);

    const sub = await Submission.findByIdAndUpdate(
      req.params.sid,
      { score, feedback, gradedAt: new Date(), gradedBy: req.user.id },
      { new: true }
    );
    if (!sub) throw new AppError(404, "Submission not found");
    res.json({ success: true, data: sub });
  })
);

module.exports = router;
