const { Schema, model } = require("mongoose");

const lessonProgressSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  lessonId: { type: Schema.Types.ObjectId, ref: "Lesson", required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
  completedAt: { type: Date, default: Date.now },
});

lessonProgressSchema.index({ studentId: 1, lessonId: 1 }, { unique: true });

module.exports = model("LessonProgress", lessonProgressSchema);
