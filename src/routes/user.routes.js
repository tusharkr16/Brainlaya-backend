const express = require("express");
const { z } = require("zod");

const User = require("../models/User");
const Course = require("../models/Course");
const { requireAuth } = require("../middleware/auth");
const validate = require("../middleware/validate");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { parsePagination, paginationMeta } = require("../utils/paginate");

const router = express.Router();

const experienceEntrySchema = z.object({
  title: z.string().trim().min(1).max(140),
  place: z.string().trim().min(1).max(140),
  period: z.string().trim().min(1).max(60),
  description: z.string().trim().max(1000).optional().default(""),
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  avatar: z.string().trim().max(500).nullable().optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  headline: z.string().trim().max(140).nullable().optional(),
  subjects: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  languages: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  location: z.string().trim().max(140).nullable().optional(),
  sessionRate: z.number().min(0).nullable().optional(),
  availability: z.string().trim().max(2000).nullable().optional(),
  teachingExperience: z.array(experienceEntrySchema).max(20).optional(),
});

router.patch(
  "/me",
  requireAuth,
  validate(profileSchema),
  asyncHandler(async (req, res) => {
    Object.assign(req.user.doc, req.body);
    await req.user.doc.save();
    res.json({ success: true, message: "Profile updated", data: req.user.doc.toSafeJSON() });
  })
);

// GET /api/users?role=teacher — public mentor directory. Only active teachers who have
// set up a mentor profile (headline or bio) show up, so empty accounts don't appear as mentors.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    if (req.query.role !== "teacher") throw new AppError(400, "Only role=teacher is supported");

    const { page, limit, skip } = parsePagination(req.query);
    const filter = {
      role: "teacher",
      status: "active",
      $or: [{ headline: { $ne: null } }, { bio: { $ne: null } }],
    };
    if (req.query.subject) filter.subjects = new RegExp(String(req.query.subject), "i");
    if (req.query.q) {
      filter.$and = [
        { $or: filter.$or },
        { $or: [{ name: new RegExp(String(req.query.q), "i") }, { headline: new RegExp(String(req.query.q), "i") }] },
      ];
      delete filter.$or;
    }

    const [teachers, total] = await Promise.all([
      User.find(filter).select("-passwordHash").sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    res.json({ success: true, message: "OK", data: teachers.map((t) => t.toSafeJSON()), meta: paginationMeta(total, page, limit) });
  })
);

// GET /api/users/:id — public profile (used by teacher profile pages), teachers only.
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, role: "teacher", status: "active" }).select("-passwordHash");
    if (!user) throw new AppError(404, "Teacher not found");

    const courses = await Course.find({ teacherId: user._id, status: "approved", deletedAt: null }).select(
      "title thumbnail category price"
    );

    res.json({ success: true, message: "OK", data: { ...user.toSafeJSON(), courses } });
  })
);

module.exports = router;
