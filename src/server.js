const http = require("http");
const app = require("./app");
const env = require("./config/env");
const logger = require("./lib/logger");
const { connectDB } = require("./lib/db");
const { initSocket } = require("./sockets");

async function main() {
  await connectDB();

  const server = http.createServer(app);
  initSocket(server);

  server.listen(env.port, () => {
    logger.info(`Server running on port ${env.port}`);
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
