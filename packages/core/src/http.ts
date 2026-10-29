/**
 * HTTP service built on the runtime's built-in `fetch` (Node >= 18).
 *
 * curl/wget are never required. Requests have a timeout, a byte cap, a redirect
 * policy and an optional retry policy for idempotent GETs. Hostnames that resolve
 * to loopback or private ranges are refused unless explicitly allowed, so that
 * untrusted documentation URLs cannot be abused to probe the local network.
 */
import { AssemblerError } from './errors.js';
import type { Logger } from './logger.js';

export interface HttpRequestOptions {
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
  readonly retries?: number;
  /** Allow loopback/private destinations. Only for user-supplied local services. */
  readonly allowPrivateHosts?: boolean;
  readonly signal?: AbortSignal;
}

export interface HttpResponse {
  readonly url: string;
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly contentType: string | null;
  readonly attempts: number;
  readonly durationMs: number;
}

const PRIVATE_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^\[::1\]$/,
  /\.local$/i,
  /\.internal$/i,
];

export function assertPublicUrl(rawUrl: string, allowPrivateHosts = false): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new AssemblerError({ code: 'USAGE_ERROR', message: `Invalid URL: ${rawUrl}`, cause: error });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AssemblerError({
      code: 'USAGE_ERROR',
      message: `Unsupported URL protocol: ${url.protocol}`,
      hint: 'Only http and https are supported.',
    });
  }
  if (!allowPrivateHosts) {
    if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) {
      throw new AssemblerError({
        code: 'USAGE_ERROR',
        message: `Refusing to fetch a private/loopback address: ${url.hostname}`,
        hint: 'Pass allowPrivateHosts only when fetching a service you control.',
      });
    }
  }
  return url;
}

export class HttpClient {
  private readonly logger?: Logger;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxBytes: number;
  private readonly networkEnabled: boolean;

  constructor(options: { logger?: Logger; timeoutMs?: number; maxBytes?: number; enabled?: boolean } = {}) {
    this.logger = options.logger;
    this.defaultTimeoutMs = options.timeoutMs ?? 20_000;
    this.defaultMaxBytes = options.maxBytes ?? 8_000_000;
    this.networkEnabled = options.enabled ?? true;
  }

  get(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    return this.request(url, { ...options, method: 'GET' });
  }

  private async request(url: string, options: HttpRequestOptions & { method: 'GET' }): Promise<HttpResponse> {
    if (!this.networkEnabled) {
      throw new AssemblerError({
        code: 'CAPABILITY_UNSATISFIED',
        message: 'Network access is disabled by configuration',
        hint: 'Enable network access or work from cached data.',
      });
    }
    assertPublicUrl(url, options.allowPrivateHosts ?? false);
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxBytes = options.maxBytes ?? this.defaultMaxBytes;
    const maxRedirects = options.maxRedirects ?? 3;
    const retries = Math.max(0, options.retries ?? 2);

    let lastError: unknown;
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = (): void => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const startedAt = Date.now();
      try {
        let currentUrl = url;
        let response: Response | null = null;
        for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
          response = await fetch(currentUrl, {
            method: options.method,
            headers: options.headers,
            redirect: 'manual',
            signal: controller.signal,
          });
          const location = response.headers.get('location');
          if (response.status >= 300 && response.status < 400 && location !== null) {
            currentUrl = new URL(location, currentUrl).toString();
            assertPublicUrl(currentUrl, options.allowPrivateHosts ?? false);
            continue;
          }
          break;
        }
        if (response === null) {
          throw new AssemblerError({ code: 'USAGE_ERROR', message: `No response for ${url}` });
        }

        const { text, truncated, bytes } = await readCapped(response, maxBytes);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        const result: HttpResponse = {
          url: currentUrl,
          status: response.status,
          ok: response.status >= 200 && response.status < 300,
          headers,
          body: text,
          bytes,
          truncated,
          contentType: response.headers.get('content-type'),
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        };
        this.logger?.debug('http', { url: currentUrl, status: response.status, bytes, attempt });
        // Retry server errors and rate limiting only; client errors are final.
        const retryableStatus = response.status === 429 || (response.status >= 500 && response.status < 600);
        if (retryableStatus && attempt <= retries) {
          lastError = new AssemblerError({
            code: 'CAPABILITY_UNSATISFIED',
            message: `HTTP ${response.status} from ${currentUrl}`,
            retryable: true,
          });
          await delay(200 * attempt);
          continue;
        }
        return result;
      } catch (error) {
        lastError = error;
        const aborted = controller.signal.aborted;
        this.logger?.warn('http request failed', { url, attempt, aborted });
        if (attempt > retries) break;
        await delay(200 * attempt);
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
    throw new AssemblerError({
      code: 'CAPABILITY_UNSATISFIED',
      message: `Network request failed after ${retries + 1} attempt(s): ${url}`,
      cause: lastError,
      retryable: true,
      hint: 'Check network access. Cached data is used when available.',
    });
  }
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean; bytes: number }> {
  if (response.body === null) return { text: '', truncated: false, bytes: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    if (bytes + value.byteLength > maxBytes) {
      const remaining = maxBytes - bytes;
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      bytes = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    bytes += value.byteLength;
  }
  const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { text: merged.toString('utf8'), truncated, bytes };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
