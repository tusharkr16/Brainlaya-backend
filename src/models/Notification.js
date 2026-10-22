const { Schema, model } = require("mongoose");

const notificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, required: true },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
  relatedCourseId: { type: Schema.Types.ObjectId, ref: "Course", default: null },
  createdAt: { type: Date, default: Date.now },
});

module.exports = model("Notification", notificationSchema);
