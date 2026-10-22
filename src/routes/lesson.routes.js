const express = require("express");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const env = require("../config/env");

const Lesson = require("../models/Lesson");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const LessonProgress = require("../models/LessonProgress");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");
const validate = require("../middleware/validate");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { notifyUser, emitToCourse } = require("../lib/realtime");

const router = express.Router();

const lessonSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1),
  attachments: z.array(z.string()).default([]),
  order: z.number().int().min(0).default(0),
  scheduledAt: z.string().datetime().nullable().optional(),
  meetingLink: z.string().trim().url().max(500).nullable().optional(),
});

async function canSeeFullContent(course, user) {
  if (!user) return false;
  if (user.role === "admin" || course.teacherId.toString() === user.id) return true;
  const enrollment = await Enrollment.findOne({ courseId: course._id, studentId: user.id, status: "enrolled" });
  return Boolean(enrollment);
}

async function optionalViewer(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  try {
    const payload = jwt.verify(authHeader.replace("Bearer ", ""), env.jwt.accessSecret);
    const doc = await User.findById(payload.sub);
    if (!doc || doc.status === "suspended") return null;
    return { id: doc._id.toString(), role: doc.role };
  } catch {
    return null;
  }
}

// GET /api/lessons/course/:courseId — public: title/schedule/meeting link only.
// Owner, admin, or an enrolled student also gets full content.
router.get(
  "/course/:courseId",
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.courseId, deletedAt: null });
    if (!course) throw new AppError(404, "Course not found");

    const viewer = await optionalViewer(req);
    const fullAccess = await canSeeFullContent(course, viewer);
    if (course.status !== "approved" && !fullAccess) throw new AppError(404, "Course not found");

    const lessons = await Lesson.find({ courseId: course._id }).sort({ order: 1, createdAt: 1 });

    let completedIds = new Set();
    if (viewer?.role === "student") {
      const progress = await LessonProgress.find({ studentId: viewer.id, courseId: course._id }).select("lessonId");
      completedIds = new Set(progress.map((p) => p.lessonId.toString()));
    }

    const data = lessons.map((l) => {
      const base = {
        _id: l._id,
        courseId: l.courseId,
        title: l.title,
        order: l.order,
        scheduledAt: l.scheduledAt,
        meetingLink: l.meetingLink,
        completed: completedIds.has(l._id.toString()),
      };
      return fullAccess ? { ...l.toObject(), completed: base.completed } : base;
    });

    res.json({ success: true, message: "OK", data });
  })
);

// POST /api/lessons/course/:courseId — owner teacher or admin adds a lesson.
router.post(
  "/course/:courseId",
  requireAuth,
  requireRole("teacher", "admin"),
  validate(lessonSchema),
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.courseId, deletedAt: null });
    if (!course) throw new AppError(404, "Course not found");
    if (req.user.role !== "admin" && course.teacherId.toString() !== req.user.id) {
      throw new AppError(403, "Not your course");
    }

    const lesson = await Lesson.create({ ...req.body, courseId: course._id });

    if (course.status === "approved") {
      const students = await Enrollment.find({ courseId: course._id, status: "enrolled" }).select("studentId");
      await Promise.all(
        students.map((e) =>
          notifyUser(e.studentId, {
            type: "new_lesson",
            message: `New lesson posted in "${course.title}": ${lesson.title}`,
            relatedCourseId: course._id,
          })
        )
      );
      emitToCourse(course._id, "lesson:new", { courseId: course._id, lesson });
    }

    res.status(201).json({ success: true, message: "Lesson added", data: lesson });
  })
);

// PATCH /api/lessons/:id
router.patch(
  "/:id",
  requireAuth,
  requireRole("teacher", "admin"),
  validate(lessonSchema.partial()),
  asyncHandler(async (req, res) => {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) throw new AppError(404, "Lesson not found");
    const course = await Course.findById(lesson.courseId);
    if (req.user.role !== "admin" && course.teacherId.toString() !== req.user.id) {
      throw new AppError(403, "Not your course");
    }

    Object.assign(lesson, req.body);
    await lesson.save();
    res.json({ success: true, message: "Lesson updated", data: lesson });
  })
);

// DELETE /api/lessons/:id
router.delete(
  "/:id",
  requireAuth,
  requireRole("teacher", "admin"),
  asyncHandler(async (req, res) => {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) throw new AppError(404, "Lesson not found");
    const course = await Course.findById(lesson.courseId);
    if (req.user.role !== "admin" && course.teacherId.toString() !== req.user.id) {
      throw new AppError(403, "Not your course");
    }

    await Promise.all([Lesson.deleteOne({ _id: lesson._id }), LessonProgress.deleteMany({ lessonId: lesson._id })]);
    res.json({ success: true, message: "Lesson deleted", data: null });
  })
);

// POST /api/lessons/:id/complete — student marks a lesson complete.
router.post(
  "/:id/complete",
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) throw new AppError(404, "Lesson not found");

    const enrollment = await Enrollment.findOne({ courseId: lesson.courseId, studentId: req.user.id, status: "enrolled" });
    if (!enrollment) throw new AppError(403, "Enroll in this course first");

    await LessonProgress.updateOne(
      { studentId: req.user.id, lessonId: lesson._id },
      { $setOnInsert: { studentId: req.user.id, lessonId: lesson._id, courseId: lesson.courseId } },
      { upsert: true }
    );

    const [total, completed] = await Promise.all([
      Lesson.countDocuments({ courseId: lesson.courseId }),
      LessonProgress.countDocuments({ studentId: req.user.id, courseId: lesson.courseId }),
    ]);

    res.json({ success: true, message: "Lesson marked complete", data: { progress: total ? Math.round((completed / total) * 100) : 0 } });
  })
);

module.exports = router;
