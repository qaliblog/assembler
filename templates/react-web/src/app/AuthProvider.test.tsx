import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider';
import type { ApiClient } from '../lib/api';

function Probe(): React.JSX.Element {
  const { user, status } = useAuth();
  return (
    <p>
      {status}:{user?.email ?? 'nobody'}
    </p>
  );
}

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    async get<T>(): Promise<T> {
      return { user: { id: 'u1', email: 'user@example.com' } } as unknown as T;
    },
    async post<T>(): Promise<T> {
      return { token: 'token-1', user: { id: 'u1', email: 'user@example.com' } } as unknown as T;
    },
    ...overrides,
  };
}

describe('AuthProvider', () => {
  it('starts anonymous without a stored token', async () => {
    render(
      <AuthProvider client={client()}>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('anonymous:nobody')).toBeInTheDocument();
  });

  it('restores a session when a token validates', async () => {
    window.localStorage.setItem('assembler.auth.token', 'stored-token');
    render(
      <AuthProvider client={client()}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('authenticated:user@example.com')).toBeInTheDocument());
    window.localStorage.clear();
  });

  it('clears an invalid stored token instead of looping', async () => {
    window.localStorage.setItem('assembler.auth.token', 'bad-token');
    const failing: ApiClient = {
      async get<T>(): Promise<T> {
        throw new Error('unauthorised');
      },
      async post<T>(): Promise<T> {
        throw new Error('unauthorised');
      },
    };
    render(
      <AuthProvider client={failing}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('anonymous:nobody')).toBeInTheDocument());
    expect(window.localStorage.getItem('assembler.auth.token')).toBeNull();
  });
});
