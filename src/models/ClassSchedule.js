const { Schema, model } = require("mongoose");

// A recurring weekly class slot for an approved course. Rendered as one chip
// in the dashboard's week-view calendar. dayOfWeek: 0=Sun .. 6=Sat.
const classScheduleSchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    color: { type: String, default: "#7fa8ff" },
  },
  { timestamps: true }
);

module.exports = model("ClassSchedule", classScheduleSchema);
