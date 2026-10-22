const pino = require("pino");
const env = require("../config/env");

const logger = pino({
  level: env.nodeEnv === "test" ? "silent" : "info",
});

module.exports = logger;
