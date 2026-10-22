const { Schema, model } = require("mongoose");

const courseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    thumbnail: { type: String, default: null },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: { type: String, required: true },
    price: { type: Number, default: null, min: 0 },
    outcomes: { type: [String], default: [] },
    requirements: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["draft", "pending_approval", "approved", "rejected", "archived"],
      default: "draft",
      index: true,
    },
    rejectionReason: { type: String, default: null },
    // JSON snapshot of proposed edits while the live version keeps serving students.
    pendingChanges: { type: Schema.Types.Mixed, default: null },
    views: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

courseSchema.index({ title: "text", description: "text" });

module.exports = model("Course", courseSchema);
