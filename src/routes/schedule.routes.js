const express = require("express");
const { z } = require("zod");

const Course = require("../models/Course");
const ClassSchedule = require("../models/ClassSchedule");
const { requireAuth, requireRole } = require("../middleware/auth");
const validate = require("../middleware/validate");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

const router = express.Router();

const scheduleSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().trim().min(2).max(140),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  color: z.string().trim().max(20).optional(),
});

function isOwnerOrAdmin(course, user) {
  return user.role === "admin" || course.teacherId.toString() === user.id;
}

// GET /api/schedule — the week's classes. Teachers see their own, admins see every class.
router.get(
  "/",
  requireAuth,
  requireRole("teacher", "admin"),
  asyncHandler(async (req, res) => {
    const filter = req.user.role === "admin" ? {} : { teacherId: req.user.id };
    const classes = await ClassSchedule.find(filter)
      .sort({ dayOfWeek: 1, startTime: 1 })
      .populate("courseId", "title")
      .populate("teacherId", "name");

    res.json({ success: true, message: "OK", data: classes });
  })
);

// POST /api/schedule — teacher schedules a weekly slot for their own approved course.
router.post(
  "/",
  requireAuth,
  requireRole("teacher", "admin"),
  validate(scheduleSchema),
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.body.courseId, deletedAt: null });
    if (!course) throw new AppError(404, "Course not found");
    if (!isOwnerOrAdmin(course, req.user)) throw new AppError(403, "You don't own this course");
    if (req.body.endTime <= req.body.startTime) throw new AppError(400, "endTime must be after startTime");

    const entry = await ClassSchedule.create({
      courseId: course._id,
      teacherId: course.teacherId,
      title: req.body.title,
      dayOfWeek: req.body.dayOfWeek,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      color: req.body.color,
    });

    res.status(201).json({ success: true, message: "Class scheduled", data: entry });
  })
);

// DELETE /api/schedule/:id — owner or admin removes a scheduled slot.
router.delete(
  "/:id",
  requireAuth,
  requireRole("teacher", "admin"),
  asyncHandler(async (req, res) => {
    const entry = await ClassSchedule.findById(req.params.id);
    if (!entry) throw new AppError(404, "Scheduled class not found");
    if (req.user.role !== "admin" && entry.teacherId.toString() !== req.user.id) {
      throw new AppError(403, "You don't own this scheduled class");
    }

    await entry.deleteOne();
    res.json({ success: true, message: "Scheduled class removed", data: null });
  })
);

module.exports = router;
