/**
 * Typed HTTP client.
 *
 * Network failures, timeouts and non-2xx responses are normalised into `ApiError`
 * so pages can render the same error state for every failure mode.
 */
export interface ApiRequestOptions {
  readonly token?: string | null;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ApiClient {
  get<T>(path: string, options?: ApiRequestOptions): Promise<T>;
  post<T>(path: string, body: unknown, options?: ApiRequestOptions): Promise<T>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = `http_${status}`) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface ErrorPayload {
  readonly detail?: string;
  readonly error?: string;
  readonly message?: string;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/api';
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    requestOptions: ApiRequestOptions = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    requestOptions.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        ...(requestOptions.headers ?? {}),
      };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (requestOptions.token !== undefined && requestOptions.token !== null) {
        headers.authorization = `Bearer ${requestOptions.token}`;
      }

      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let message = `Request failed with status ${response.status}`;
        try {
          const payload = (await response.json()) as ErrorPayload;
          message = payload.detail ?? payload.error ?? payload.message ?? message;
        } catch {
          // Non-JSON error bodies are expected for proxies and gateways.
        }
        throw new ApiError(message, response.status);
      }

      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) {
        throw new ApiError('The request timed out', 0, 'timeout');
      }
      throw new ApiError(
        error instanceof Error ? error.message : 'The network request failed',
        0,
        'network',
      );
    } finally {
      clearTimeout(timer);
      requestOptions.signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    get: <T>(path: string, requestOptions?: ApiRequestOptions) =>
      request<T>('GET', path, undefined, requestOptions),
    post: <T>(path: string, body: unknown, requestOptions?: ApiRequestOptions) =>
      request<T>('POST', path, body, requestOptions),
  };
}
