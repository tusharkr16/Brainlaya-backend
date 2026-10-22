const express = require("express");
const { z } = require("zod");

const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const Lesson = require("../models/Lesson");
const LessonProgress = require("../models/LessonProgress");
const { requireAuth, requireRole } = require("../middleware/auth");
const validate = require("../middleware/validate");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { parsePagination, paginationMeta } = require("../utils/paginate");
const { notifyUser, emitToCourse } = require("../lib/realtime");

const router = express.Router();

async function broadcastCount(courseId) {
  const count = await Enrollment.countDocuments({ courseId, status: "enrolled" });
  emitToCourse(courseId, "course:enrollment-count", { courseId, count });
  return count;
}

// POST /api/enrollments — student enrolls (or re-enrolls after dropping).
router.post(
  "/",
  requireAuth,
  requireRole("student"),
  validate(z.object({ courseId: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.body.courseId, status: "approved", deletedAt: null });
    if (!course) throw new AppError(404, "Course not found or not open for enrollment");

    let enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId: course._id });
    if (enrollment && enrollment.status === "enrolled") throw new AppError(409, "Already enrolled");

    if (enrollment) {
      enrollment.status = "enrolled";
      enrollment.enrolledAt = new Date();
      await enrollment.save();
    } else {
      enrollment = await Enrollment.create({ studentId: req.user.id, courseId: course._id });
    }

    const count = await broadcastCount(course._id);
    await notifyUser(course.teacherId, {
      type: "new_enrollment",
      message: `${req.user.doc.name} enrolled in "${course.title}"`,
      relatedCourseId: course._id,
    });
    await notifyUser(req.user.id, {
      type: "enrollment_confirmed",
      message: `You're enrolled in "${course.title}"`,
      relatedCourseId: course._id,
    });

    res.status(201).json({ success: true, message: "Enrolled", data: { enrollment, enrollmentCount: count } });
  })
);

// DELETE /api/enrollments/:courseId — student unenrolls.
router.delete(
  "/:courseId",
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId: req.params.courseId, status: "enrolled" });
    if (!enrollment) throw new AppError(404, "Not enrolled in this course");

    enrollment.status = "dropped";
    await enrollment.save();

    const count = await broadcastCount(req.params.courseId);
    res.json({ success: true, message: "Unenrolled", data: { enrollmentCount: count } });
  })
);

// GET /api/enrollments/mine — student: own courses with computed progress.
router.get(
  "/mine",
  requireAuth,
  requireRole("student"),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { studentId: req.user.id, status: "enrolled" };

    const [enrollments, total] = await Promise.all([
      Enrollment.find(filter).sort({ enrolledAt: -1 }).skip(skip).limit(limit).populate("courseId"),
      Enrollment.countDocuments(filter),
    ]);

    const data = await Promise.all(
      enrollments
        .filter((e) => e.courseId)
        .map(async (e) => {
          const [totalLessons, completed] = await Promise.all([
            Lesson.countDocuments({ courseId: e.courseId._id }),
            LessonProgress.countDocuments({ studentId: req.user.id, courseId: e.courseId._id }),
          ]);
          return {
            enrollmentId: e._id,
            enrolledAt: e.enrolledAt,
            course: e.courseId,
            progress: totalLessons ? Math.round((completed / totalLessons) * 100) : 0,
          };
        })
    );

    res.json({ success: true, message: "OK", data, meta: paginationMeta(total, page, limit) });
  })
);

module.exports = router;
