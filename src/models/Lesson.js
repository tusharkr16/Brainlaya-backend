const { Schema, model } = require("mongoose");

const lessonSchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    title: { type: String, required: true, trim: true },
    content: { type: String, default: '' },
    videoLink: { type: String, default: null, maxlength: 1000 },
    attachments: [{ type: String }],
    order: { type: Number, default: 0 },
    // Optional live session info — scheduledAt/meetingLink are shown publicly
    scheduledAt: { type: Date, default: null },
    meetingLink: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true }
);

module.exports = model("Lesson", lessonSchema);
