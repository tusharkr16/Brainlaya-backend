const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { z } = require("zod");

const User = require("../models/User");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const LessonProgress = require("../models/LessonProgress");
const AuditLog = require("../models/AuditLog");
const { requireAuth, requireRole } = require("../middleware/auth");
const validate = require("../middleware/validate");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { parsePagination, paginationMeta } = require("../utils/paginate");
const { notifyUser } = require("../lib/realtime");
const { revokeAllForUser } = require("../lib/tokens");

const router = express.Router();

router.use(requireAuth, requireRole("admin"));

async function logAction(actorId, action, targetType, targetId, meta = null) {
  await AuditLog.create({ actorId, action, targetType, targetId, meta });
}

// ---------- Course approval queue ----------

// GET /api/admin/courses/pending — new submissions + staged edits on live courses.
router.get(
  "/courses/pending",
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {
      deletedAt: null,
      $or: [{ status: "pending_approval" }, { pendingChanges: { $ne: null } }],
    };

    const [courses, total] = await Promise.all([
      Course.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).populate("teacherId", "name email"),
      Course.countDocuments(filter),
    ]);

    res.json({ success: true, message: "OK", data: courses, meta: paginationMeta(total, page, limit) });
  })
);

// GET /api/admin/courses — every course regardless of status.
router.get(
  "/courses",
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.includeDeleted !== "true") filter.deletedAt = null;

    const [courses, total] = await Promise.all([
      Course.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).populate("teacherId", "name email"),
      Course.countDocuments(filter),
    ]);

    res.json({ success: true, message: "OK", data: courses, meta: paginationMeta(total, page, limit) });
  })
);

router.post(
  "/courses/:id/approve",
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.id, deletedAt: null });
    if (!course) throw new AppError(404, "Course not found");

    if (course.status === "pending_approval") {
      course.status = "approved";
      course.publishedAt = course.publishedAt || new Date();
      course.rejectionReason = null;
    } else if (course.pendingChanges) {
      Object.assign(course, course.pendingChanges);
      course.pendingChanges = null;
    } else {
      throw new AppError(400, "Nothing pending approval for this course");
    }

    await course.save();
    await logAction(req.user.id, "course.approve", "Course", course._id);
    await notifyUser(course.teacherId, {
      type: "course_approved",
      message: `"${course.title}" was approved and is now live`,
      relatedCourseId: course._id,
    });

    res.json({ success: true, message: "Course approved", data: course });
  })
);

router.post(
  "/courses/:id/reject",
  validate(z.object({ reason: z.string().trim().min(3).max(1000) })),
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.id, deletedAt: null });
    if (!course) throw new AppError(404, "Course not found");

    let message;
    if (course.status === "pending_approval") {
      course.status = "rejected";
      course.rejectionReason = req.body.reason;
      message = `"${course.title}" was rejected: ${req.body.reason}`;
    } else if (course.pendingChanges) {
      course.pendingChanges = null;
      message = `Your edits to "${course.title}" were rejected: ${req.body.reason}`;
    } else {
      throw new AppError(400, "Nothing pending rejection for this course");
    }

    await course.save();
    await logAction(req.user.id, "course.reject", "Course", course._id, { reason: req.body.reason });
    await notifyUser(course.teacherId, { type: "course_rejected", message, relatedCourseId: course._id });

    res.json({ success: true, message: "Course rejected", data: course });
  })
);

router.post(
  "/courses/:id/archive",
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({ _id: req.params.id, deletedAt: null });
    if (!course) throw new AppError(404, "Course not found");

    course.status = "archived";
    await course.save();
    await logAction(req.user.id, "course.archive", "Course", course._id);

    res.json({ success: true, message: "Course archived", data: course });
  })
);

// ---------- User management ----------

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
  role: z.enum(["admin", "teacher", "student"]).default("student"),
});

router.post(
  "/users",
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.body;
    const existing = await User.findOne({ email });
    if (existing) throw new AppError(409, "Email already registered");

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash, role });
    await logAction(req.user.id, "user.create", "User", user._id, { role });

    res.status(201).json({ success: true, message: "User created", data: user.toSafeJSON() });
  })
);

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.role) filter.role = String(req.query.role);
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.q) filter.$or = [{ name: new RegExp(String(req.query.q), "i") }, { email: new RegExp(String(req.query.q), "i") }];

    const [users, total] = await Promise.all([
      User.find(filter).select("-passwordHash").sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    res.json({ success: true, message: "OK", data: users, meta: paginationMeta(total, page, limit) });
  })
);

router.patch(
  "/users/:id/suspend",
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError(404, "User not found");
    user.status = "suspended";
    await user.save();
    await revokeAllForUser(user._id);
    await logAction(req.user.id, "user.suspend", "User", user._id);
    res.json({ success: true, message: "User suspended", data: user.toSafeJSON() });
  })
);

router.patch(
  "/users/:id/reactivate",
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError(404, "User not found");
    user.status = "active";
    await user.save();
    await logAction(req.user.id, "user.reactivate", "User", user._id);
    res.json({ success: true, message: "User reactivated", data: user.toSafeJSON() });
  })
);

router.patch(
  "/users/:id/role",
  validate(z.object({ role: z.enum(["admin", "teacher", "student"]) })),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) throw new AppError(400, "Cannot change your own role");
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError(404, "User not found");

    const previousRole = user.role;
    user.role = req.body.role;
    await user.save();
    await logAction(req.user.id, "user.role_change", "User", user._id, { from: previousRole, to: user.role });

    res.json({ success: true, message: "Role updated", data: user.toSafeJSON() });
  })
);

router.patch(
  "/users/:id",
  validate(
    z.object({
      name: z.string().trim().min(2).max(80).optional(),
      email: z.string().trim().toLowerCase().email().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError(404, "User not found");

    if (req.body.email && req.body.email !== user.email) {
      const existing = await User.findOne({ email: req.body.email });
      if (existing) throw new AppError(409, "Email already registered");
      user.email = req.body.email;
    }
    if (req.body.name) user.name = req.body.name;

    await user.save();
    await logAction(req.user.id, "user.update", "User", user._id, { name: user.name, email: user.email });

    res.json({ success: true, message: "User updated", data: user.toSafeJSON() });
  })
);

// PATCH /api/admin/users/:id/password — admin sets an exact password (vs. /reset, which generates a random one).
router.patch(
  "/users/:id/password",
  validate(z.object({ password: z.string().min(8).max(72) })),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError(404, "User not found");

    user.passwordHash = await bcrypt.hash(req.body.password, 10);
    await user.save();
    await revokeAllForUser(user._id);
    await logAction(req.user.id, "user.password_change", "User", user._id);

    res.json({ success: true, message: "Password updated and all sessions revoked", data: user.toSafeJSON() });
  })
);

router.delete(
  "/users/:id",
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) throw new AppError(400, "Cannot delete your own account");
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError(404, "User not found");

    await user.deleteOne();
    await revokeAllForUser(user._id);
    await logAction(req.user.id, "user.delete", "User", user._id, { name: user.name, email: user.email });

    res.json({ success: true, message: "User deleted", data: null });
  })
);

// POST /api/admin/users/:id/reset — scoped reset: new temp password + force logout everywhere.
// Requires the admin to type the target's exact email as confirmation.
router.post(
  "/users/:id/reset",
  validate(z.object({ confirmEmail: z.string().trim().toLowerCase().email() })),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw new AppError(404, "User not found");
    if (user.email !== req.body.confirmEmail) {
      throw new AppError(400, "Confirmation email doesn't match this user");
    }

    const tempPassword = crypto.randomBytes(9).toString("base64url");
    user.passwordHash = await bcrypt.hash(tempPassword, 10);
    await user.save();
    await revokeAllForUser(user._id);
    await logAction(req.user.id, "user.reset", "User", user._id);

    res.json({
      success: true,
      message: "User reset: password changed and all sessions revoked",
      data: { tempPassword },
    });
  })
);

// ---------- Audit log ----------

router.get(
  "/audit-log",
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const [entries, total] = await Promise.all([
      AuditLog.find().sort({ timestamp: -1 }).skip(skip).limit(limit).populate("actorId", "name email role"),
      AuditLog.countDocuments(),
    ]);
    res.json({ success: true, message: "OK", data: entries, meta: paginationMeta(total, page, limit) });
  })
);

// ---------- Stats ----------

router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = new Date(Date.now() - 182 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalTeachers,
      totalStudents,
      coursesByStatus,
      totalEnrollments,
      trend,
      enrollmentsByStatus,
      coursesByCategory,
      topTeachers,
      revenueByCategory,
      engagementTrend,
      monthlyRevenue,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "teacher" }),
      User.countDocuments({ role: "student" }),
      Course.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      Enrollment.countDocuments({ status: "enrolled" }),
      Enrollment.aggregate([
        { $match: { enrolledAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$enrolledAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),

      // Student analytics: enrolled vs dropped.
      Enrollment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),

      // Teacher analytics: what categories are live courses spread across.
      Course.aggregate([
        { $match: { deletedAt: null, status: "approved" } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Teacher analytics: top 5 teachers by total active enrollments across their courses.
      Course.aggregate([
        { $match: { deletedAt: null, status: "approved" } },
        { $lookup: { from: "enrollments", localField: "_id", foreignField: "courseId", as: "enrollments" } },
        {
          $addFields: {
            enrollmentCount: { $size: { $filter: { input: "$enrollments", cond: { $eq: ["$$this.status", "enrolled"] } } } },
          },
        },
        { $group: { _id: "$teacherId", courseCount: { $sum: 1 }, totalEnrollments: { $sum: "$enrollmentCount" } } },
        { $sort: { totalEnrollments: -1 } },
        { $limit: 5 },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "teacher" } },
        { $unwind: "$teacher" },
        { $project: { _id: 0, name: "$teacher.name", courseCount: 1, totalEnrollments: 1 } },
      ]),

      // Revenue analytics: no payment gateway exists yet, so this is an estimate
      // (price * active enrollments), not real transaction records.
      Course.aggregate([
        { $match: { deletedAt: null, status: "approved" } },
        { $lookup: { from: "enrollments", localField: "_id", foreignField: "courseId", as: "enrollments" } },
        {
          $addFields: {
            enrollmentCount: { $size: { $filter: { input: "$enrollments", cond: { $eq: ["$$this.status", "enrolled"] } } } },
          },
        },
        { $project: { category: 1, revenue: { $multiply: [{ $ifNull: ["$price", 0] }, "$enrollmentCount"] } } },
        { $group: { _id: "$category", revenue: { $sum: "$revenue" } } },
        { $sort: { revenue: -1 } },
      ]),

      // Student analytics: lesson completions per day — a distinct activity
      // signal from "new enrollments" (are enrolled students actually learning).
      LessonProgress.aggregate([
        { $match: { completedAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$completedAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),

      // Revenue analytics: monthly view (last ~6 months) rather than daily —
      // daily buckets over a real window are too many bars to read at a glance.
      Enrollment.aggregate([
        { $match: { status: "enrolled", enrolledAt: { $gte: sixMonthsAgo } } },
        { $lookup: { from: "courses", localField: "courseId", foreignField: "_id", as: "course" } },
        { $unwind: "$course" },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$enrolledAt" } },
            revenue: { $sum: { $ifNull: ["$course.price", 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const statusCounts = coursesByStatus.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {});
    const totalRevenue = revenueByCategory.reduce((sum, c) => sum + c.revenue, 0);

    res.json({
      success: true,
      message: "OK",
      data: {
        totalUsers,
        totalTeachers,
        totalStudents,
        totalEnrollments,
        coursesByStatus: statusCounts,
        enrollmentTrend: trend.map((t) => ({ date: t._id, count: t.count })),
        engagementTrend: engagementTrend.map((t) => ({ date: t._id, count: t.count })),
        enrollmentsByStatus: enrollmentsByStatus.map((e) => ({ status: e._id, count: e.count })),
        coursesByCategory: coursesByCategory.map((c) => ({ category: c._id, count: c.count })),
        topTeachers,
        revenue: {
          total: totalRevenue,
          byCategory: revenueByCategory.map((c) => ({ category: c._id, revenue: c.revenue })),
          monthly: monthlyRevenue.map((m) => ({ month: m._id, revenue: m.revenue })),
        },
      },
    });
  })
);

module.exports = router;
