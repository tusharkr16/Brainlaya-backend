const mongoose = require("mongoose");
const env = require("../config/env");
const logger = require("./logger");

async function connectDB(uri = env.mongoUri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  logger.info(`MongoDB connected: ${mongoose.connection.name}`);
  return mongoose.connection;
}

module.exports = { connectDB, mongoose };
