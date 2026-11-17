const { Schema, model } = require("mongoose");

const assignmentSchema = new Schema(
  {
    courseId:    { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    title:       { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "" },
    dueDate:     { type: Date, default: null },
    maxScore:    { type: Number, default: 100 },
    createdBy:   { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = model("Assignment", assignmentSchema);
