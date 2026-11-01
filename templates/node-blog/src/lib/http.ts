/**
 * Response helpers.
 *
 * Status codes, content types and HEAD semantics live here so no controller has
 * to remember them. A HEAD request gets exactly the headers of its GET
 * counterpart and no body.
 */
import { STATUS_CODES } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/rss+xml; charset=utf-8',
  svg: 'image/svg+xml; charset=utf-8',
  text: 'text/plain; charset=utf-8',
} as const;

export interface SendOptions {
  readonly headers?: Readonly<Record<string, string>>;
}

export function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  options: SendOptions = {},
): void {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    res.setHeader(name, value);
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

export function sendHtml(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
  status = 200,
  options: SendOptions = {},
): void {
  send(req, res, status, body, CONTENT_TYPES.html, options);
}

export function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  payload: unknown,
  status = 200,
  options: SendOptions = {},
): void {
  send(req, res, status, `${JSON.stringify(payload, null, 2)}\n`, CONTENT_TYPES.json, options);
}

export function sendCss(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
  options: SendOptions = {},
): void {
  send(req, res, 200, body, CONTENT_TYPES.css, {
    headers: { 'Cache-Control': 'public, max-age=3600', ...(options.headers ?? {}) },
  });
}

export function sendXml(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
  options: SendOptions = {},
): void {
  send(req, res, 200, body, CONTENT_TYPES.xml, options);
}

export function sendSvg(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
  options: SendOptions = {},
): void {
  send(req, res, 200, body, CONTENT_TYPES.svg, {
    headers: { 'Cache-Control': 'public, max-age=86400', ...(options.headers ?? {}) },
  });
}

export function sendText(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
  status = 200,
  options: SendOptions = {},
): void {
  send(req, res, status, body, CONTENT_TYPES.text, options);
}

/**
 * Redirect with a body that a human and a crawler can both follow. 308 keeps the
 * method (used for canonical trailing-slash corrections); 301 is used for the
 * legacy paths that only ever served GET.
 */
export function redirect(
  req: IncomingMessage,
  res: ServerResponse,
  location: string,
  status: 301 | 302 | 303 | 307 | 308 = 308,
): void {
  const safeStatus = status >= 300 && status < 400 ? status : 302;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved</title><link rel="canonical" href="${location}"></head><body><p>This page moved to <a href="${location}">${location}</a>.</p></body></html>`;
  send(req, res, safeStatus, body, CONTENT_TYPES.html, { headers: { Location: location } });
}

export function statusText(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}
