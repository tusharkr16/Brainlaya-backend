const { Schema, model } = require("mongoose");

const enrollmentSchema = new Schema({
  studentId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
  status: { type: String, enum: ["enrolled", "dropped"], default: "enrolled" },
  enrolledAt: { type: Date, default: Date.now },
});

enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

module.exports = model("Enrollment", enrollmentSchema);
