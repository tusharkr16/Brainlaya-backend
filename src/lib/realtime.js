const Notification = require("../models/Notification");
const { getIO } = require("../sockets");

// Persists a notification and pushes it over the socket in one call, so
// route handlers never have to remember to do both.
async function notifyUser(userId, { type, message, relatedCourseId = null }) {
  const notification = await Notification.create({ userId, type, message, relatedCourseId });
  try {
    getIO().to(`user:${userId}`).emit("notification:new", notification);
  } catch {
    // Socket.IO not initialized (e.g. running under tests) — notification is still persisted.
  }
  return notification;
}

async function notifyRole(role, { type, message, relatedCourseId = null }, userIds) {
  const notifications = await Notification.insertMany(
    userIds.map((userId) => ({ userId, type, message, relatedCourseId }))
  );
  try {
    getIO().to(`role:${role}`).emit("notification:new", notifications[0] ?? { type, message, relatedCourseId });
  } catch {
    // no-op outside a running server
  }
  return notifications;
}

function emitToCourse(courseId, event, payload) {
  try {
    getIO().to(`course:${courseId}`).emit(event, payload);
  } catch {
    // no-op outside a running server
  }
}

module.exports = { notifyUser, notifyRole, emitToCourse };
