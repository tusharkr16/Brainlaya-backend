const { Schema, model } = require("mongoose");

const auditLogSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, required: true },
  targetType: { type: String, required: true },
  targetId: { type: Schema.Types.ObjectId, required: true },
  meta: { type: Schema.Types.Mixed, default: null },
  timestamp: { type: Date, default: Date.now },
});

module.exports = model("AuditLog", auditLogSchema);
