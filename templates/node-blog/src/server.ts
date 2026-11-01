/**
 * Executable entry point. `npm run build && npm start` runs this file.
 */
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { readServerConfig } from './config.js';
import { createLogger } from './lib/logger.js';

const config = readServerConfig(process.env);
const logger = createLogger({ level: config.logLevel });
const server = createServer(createApp({ logger }));

server.listen(config.port, config.host, () => {
  logger.info('server listening', { host: config.host, port: config.port });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });

  server.close((error) => {
    if (error !== undefined) {
      logger.error('shutdown failed', { error: error.message });
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  });

  // Do not let a hanging keep-alive connection block the process forever.
  const timer = setTimeout(() => {
    logger.warn('forcing shutdown after timeout');
    process.exit(1);
  }, 5_000);
  timer.unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.on('error', (error: Error) => {
  logger.error('server error', { error: error.message });
  process.exitCode = 1;
});
