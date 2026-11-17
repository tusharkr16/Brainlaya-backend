const express = require("express");
const { z } = require("zod");
const Note = require("../models/Note");
const Lesson = require("../models/Lesson");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

const router = express.Router();

const noteSchema = z.object({ body: z.string().max(50000).default("") });

// GET /api/notes/:lessonId — get own note for a lesson
router.get(
  "/:lessonId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const note = await Note.findOne({ userId: req.user.id, lessonId: req.params.lessonId });
    res.json({ success: true, data: note || { body: "" } });
  })
);

// PUT /api/notes/:lessonId — upsert own note
router.put(
  "/:lessonId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { body } = noteSchema.parse(req.body);
    const lesson = await Lesson.findById(req.params.lessonId);
    if (!lesson) throw new AppError(404, "Lesson not found");

    const note = await Note.findOneAndUpdate(
      { userId: req.user.id, lessonId: req.params.lessonId },
      { body, courseId: lesson.courseId },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: note });
  })
);

module.exports = router;
