const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const logger = require("../lib/logger");

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
  });

  // Auth handshake: client passes the access token, we resolve it to
  // user id + role and drop the socket into its rooms. No DB round-trip
  // needed here — the JWT already carries what we need.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Missing auth token"));
    try {
      const payload = jwt.verify(token, env.jwt.accessSecret);
      socket.userId = payload.sub;
      socket.role = payload.role;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.userId}`);
    socket.join(`role:${socket.role}`);
    logger.info(`Socket connected: user:${socket.userId} (${socket.role})`);

    socket.on("course:watch", (courseId) => {
      if (typeof courseId === "string") socket.join(`course:${courseId}`);
    });
    socket.on("course:unwatch", (courseId) => {
      if (typeof courseId === "string") socket.leave(`course:${courseId}`);
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error("Socket.IO not initialized yet");
  return io;
}

module.exports = { initSocket, getIO };
