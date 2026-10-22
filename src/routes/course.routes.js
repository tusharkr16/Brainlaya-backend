const express = require("express");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const env = require("../config/env");

const Course = require("../models/Course");
const User = require("../models/User");
const Enrollment = require("../models/Enrollment");
const { requireAuth, requireRole } = require("../middleware/auth");
const validate = require("../middleware/validate");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { parsePagination, paginationMeta } = require("../utils/paginate");
const { notifyUser, notifyRole, emitToCourse } = require("../lib/realtime");

const router = express.Router();

const courseCreateSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(5000),
  category: z.string().trim().min(1).max(60),
  price: z.number().min(0).nullable().optional(),
  thumbnail: z.string().trim().max(500).nullable().optional(),
  outcomes: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  requirements: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});

const courseUpdateSchema = courseCreateSchema.partial();

async function notifyAdmins(payload) {
  const admins = await User.find({ role: "admin", status: "active" }).select("_id");
  if (admins.length === 0) return;
  await notifyRole("admin", payload, admins.map((a) => a._id));
}

function isOwnerOrAdmin(course, user) {
  return user.role === "admin" || course.teacherId.toString() === user.id;
}

// GET /api/courses — public browse: approved, non-deleted courses only.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { status: "approved", deletedAt: null };

    if (req.query.category) filter.category = String(req.query.category);
    if (req.query.q) filter.$text = { $search: String(req.query.q) };
    if (req.query.free === "true") filter.price = null;
    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = { ...filter.price };
      if (req.query.minPrice) filter.price.$gte = Number(req.query.minPrice);
      if (req.query.maxPrice) filter.price.$lte = Number(req.query.maxPrice);
    }

    const [courses, total] = await Promise.all([
      Course.find(filter).sort({ publishedAt: -1 }).skip(skip).limit(limit).populate("teacherId", "name avatar"),
      Course.countDocuments(filter),
    ]);

    const withCounts = await Promise.all(
      courses.map(async (c) => {
        const enrollmentCount = await Enrollment.countDocuments({ courseId: c._id, status: "enrolled" });
        return { ...c.toObject(), enrollmentCount };
      })
    );

    res.json({ success: true, message: "OK", data: withCounts, meta: paginationMeta(total, page, limit) });
  })
);

// GET /api/courses/mine — teacher: all of their own courses, any status.
router.get(
  "/mine",
  requireAuth,
  requireRole("teacher"),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { teacherId: req.user.id, deletedAt: null };
    if (req.query.status) filter.status = String(req.query.status);

    const [courses, total] = await Promise.all([
      Course.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
      Course.countDocuments(filter),
    ]);

    const withCounts = await Promise.all(
      courses.map(async (c) => {
        const enrollmentCount = await Enrollment.countDocuments({ courseId: c._id, status: "enrolled" });
        return { ...c.toObject(), enrollmentCount };
      })
    );

    res.json({ success: true, message: "OK", data: withCounts, meta: paginationMeta(total, page, limit) });
  })
);

// GET /api/courses/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.id, deletedAt: null }).populate("teacherId", "name avatar");
    if (!course) throw new AppError(404, "Course not found");

    // Non-owners/non-admins can only see approved courses.
    const authHeader = req.headers.authorization;
    let viewer = null;
    if (authHeader) {
      try {
        const payload = jwt.verify(authHeader.replace("Bearer ", ""), env.jwt.accessSecret);
        viewer = { id: payload.sub, role: payload.role };
      } catch {
        viewer = null;
      }
    }

    const canSeeUnapproved = viewer && (viewer.role === "admin" || course.teacherId._id.toString() === viewer.id);
    if (course.status !== "approved" && !canSeeUnapproved) {
      throw new AppError(404, "Course not found");
    }

    if (!canSeeUnapproved) {
      course.views += 1;
      await course.save();
    }

    const enrollmentCount = await Enrollment.countDocuments({ courseId: course._id, status: "enrolled" });
    res.json({ success: true, message: "OK", data: { ...course.toObject(), enrollmentCount } });
  })
);

// POST /api/courses — teacher creates a draft.
router.post(
  "/",
  requireAuth,
  requireRole("teacher"),
  validate(courseCreateSchema),
  asyncHandler(async (req, res) => {
    const course = await Course.create({ ...req.body, teacherId: req.user.id, status: "draft" });
    res.status(201).json({ success: true, message: "Course created as draft", data: course });
  })
);

// POST /api/courses/:id/submit — teacher submits draft/rejected course for admin review.
router.post(
  "/:id/submit",
  requireAuth,
  requireRole("teacher"),
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.id, deletedAt: null });
    if (!course) throw new AppError(404, "Course not found");
    if (course.teacherId.toString() !== req.user.id) throw new AppError(403, "Not your course");
    if (!["draft", "rejected"].includes(course.status)) {
      throw new AppError(409, `Cannot submit a course with status "${course.status}"`);
    }

    course.status = "pending_approval";
    course.rejectionReason = null;
    await course.save();

    await notifyAdmins({
      type: "course_submitted",
      message: `${req.user.doc.name} submitted "${course.title}" for approval`,
      relatedCourseId: course._id,
    });

    res.json({ success: true, message: "Submitted for approval", data: course });
  })
);

// PATCH /api/courses/:id — owner teacher (draft/rejected: direct edit, approved: staged as pending changes) or admin (always direct).
router.patch(
  "/:id",
  requireAuth,
  requireRole("teacher", "admin"),
  validate(courseUpdateSchema),
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.id, deletedAt: null });
    if (!course) throw new AppError(404, "Course not found");
    if (!isOwnerOrAdmin(course, req.user)) throw new AppError(403, "Not your course");

    if (req.user.role === "admin") {
      Object.assign(course, req.body);
      await course.save();
      return res.json({ success: true, message: "Course updated", data: course });
    }

    if (course.status === "pending_approval") {
      throw new AppError(409, "Course is awaiting admin review, cannot edit yet");
    }
    if (course.status === "archived") {
      throw new AppError(409, "Course is archived, cannot edit");
    }

    if (course.status === "approved") {
      course.pendingChanges = { ...(course.pendingChanges || {}), ...req.body };
      await course.save();
      await notifyAdmins({
        type: "course_changes_submitted",
        message: `${req.user.doc.name} submitted edits to "${course.title}" for review`,
        relatedCourseId: course._id,
      });
      return res.json({ success: true, message: "Changes submitted for review", data: course });
    }

    // draft or rejected: edit directly
    Object.assign(course, req.body);
    await course.save();
    res.json({ success: true, message: "Course updated", data: course });
  })
);

// DELETE /api/courses/:id — soft delete. Teachers are blocked if the course has active enrollments; admins can force.
router.delete(
  "/:id",
  requireAuth,
  requireRole("teacher", "admin"),
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.id, deletedAt: null });
    if (!course) throw new AppError(404, "Course not found");
    if (!isOwnerOrAdmin(course, req.user)) throw new AppError(403, "Not your course");

    const activeEnrollments = await Enrollment.countDocuments({ courseId: course._id, status: "enrolled" });
    const force = req.query.force === "true" && req.user.role === "admin";
    if (activeEnrollments > 0 && !force) {
      throw new AppError(409, `Course has ${activeEnrollments} active enrollment(s); archive it instead or pass force=true as admin`);
    }

    course.deletedAt = new Date();
    course.status = "archived";
    await course.save();
    res.json({ success: true, message: "Course deleted", data: null });
  })
);

// GET /api/courses/:id/students — owner teacher or admin: roster for analytics.
router.get(
  "/:id/students",
  requireAuth,
  requireRole("teacher", "admin"),
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.id, deletedAt: null });
    if (!course) throw new AppError(404, "Course not found");
    if (!isOwnerOrAdmin(course, req.user)) throw new AppError(403, "Not your course");

    const enrollments = await Enrollment.find({ courseId: course._id, status: "enrolled" })
      .populate("studentId", "name email avatar")
      .sort({ enrolledAt: -1 });

    res.json({ success: true, message: "OK", data: enrollments });
  })
);

// POST /api/courses/:id/announcements — owner teacher posts an update to enrolled students.
router.post(
  "/:id/announcements",
  requireAuth,
  requireRole("teacher"),
  validate(z.object({ message: z.string().trim().min(1).max(2000) })),
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.id, deletedAt: null });
    if (!course) throw new AppError(404, "Course not found");
    if (course.teacherId.toString() !== req.user.id) throw new AppError(403, "Not your course");

    const students = await Enrollment.find({ courseId: course._id, status: "enrolled" }).select("studentId");
    await Promise.all(
      students.map((e) =>
        notifyUser(e.studentId, {
          type: "course_update",
          message: `${course.title}: ${req.body.message}`,
          relatedCourseId: course._id,
        })
      )
    );
    emitToCourse(course._id, "course:announcement", { courseId: course._id, message: req.body.message });

    res.status(201).json({ success: true, message: "Announcement sent", data: null });
  })
);

module.exports = router;
