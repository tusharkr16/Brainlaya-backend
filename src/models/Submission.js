const { Schema, model } = require("mongoose");

const submissionSchema = new Schema(
  {
    assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true },
    studentId:    { type: Schema.Types.ObjectId, ref: "User",       required: true },
    body:         { type: String, default: "" },
    score:        { type: Number, default: null },
    feedback:     { type: String, default: "" },
    gradedAt:     { type: Date,   default: null },
    gradedBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

submissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });

module.exports = model("Submission", submissionSchema);
