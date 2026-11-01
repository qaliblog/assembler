import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../lib/logger.js';

/** Log when the response is actually finished, so the status is the real one. */
export function attachRequestLogging(req: IncomingMessage, res: ServerResponse, logger: Logger): void {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    logger.info('request', {
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  });
}
