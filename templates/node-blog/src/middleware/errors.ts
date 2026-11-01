import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendHtml } from '../lib/http.js';
import type { Logger } from '../lib/logger.js';

/**
 * Last line of the request pipeline.
 *
 * Internal error messages never reach the browser: they are logged with the
 * method and path, and the client receives the generic error page. If headers
 * were already sent there is no honest way to change the response, so the
 * connection is closed instead of appending a second body.
 */
export function handleRequestError(
  error: unknown,
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  renderError: () => string,
): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('request failed', {
    method: req.method ?? 'GET',
    path: req.url ?? '/',
    error: message,
  });

  if (res.headersSent) {
    res.destroy();
    return;
  }

  sendHtml(req, res, renderError(), 500);
}
