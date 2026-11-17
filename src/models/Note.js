const { Schema, model } = require("mongoose");

const noteSchema = new Schema(
  {
    userId:   { type: Schema.Types.ObjectId, ref: "User",   required: true },
    lessonId: { type: Schema.Types.ObjectId, ref: "Lesson", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    body:     { type: String, default: "" },
  },
  { timestamps: true }
);

noteSchema.index({ userId: 1, lessonId: 1 }, { unique: true });

module.exports = model("Note", noteSchema);
