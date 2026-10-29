import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('sends JSON and returns parsed data', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'ok' }));
    const client = createApiClient({ baseUrl: '/api', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.get<{ status: string }>('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/health', expect.objectContaining({ method: 'GET' }));
  });

  it('adds the bearer token when one is provided', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: { id: 'u1', email: 'a@b.c' } }));
    const client = createApiClient({ baseUrl: '/api', fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.get('/auth/me', { token: 'token-123' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer token-123');
  });

  it('normalises API errors to ApiError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ detail: 'invalid credentials' }, 401));
    const client = createApiClient({ baseUrl: '/api', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.post('/auth/login', { email: 'x', password: 'y' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'invalid credentials',
    });
  });

  it('reports network failures as ApiError with code "network"', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const client = createApiClient({ baseUrl: '/api', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.get('/health')).rejects.toBeInstanceOf(ApiError);
    await expect(client.get('/health')).rejects.toMatchObject({ code: 'network' });
  });

  it('returns undefined for 204 responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: '/api', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.post('/logout', {})).resolves.toBeUndefined();
  });
});
