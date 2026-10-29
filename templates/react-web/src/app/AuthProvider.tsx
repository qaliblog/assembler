import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createApiClient, type ApiClient } from '../lib/api';
import { navigate } from './router';

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name?: string;
}

export interface AuthSession {
  readonly token: string;
  readonly user: AuthUser;
}

export interface AuthContextValue {
  readonly user: AuthUser | null;
  readonly token: string | null;
  readonly status: 'anonymous' | 'authenticated';
  login(email: string, password: string): Promise<void>;
  logout(): void;
}

const TOKEN_STORAGE_KEY = 'assembler.auth.token';

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    // Private browsing or disabled storage must not break the application.
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    else window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage failures; the in-memory session still works.
  }
}

export interface AuthProviderProps {
  readonly children: ReactNode;
  /** Injected in tests so no network is required. */
  readonly client?: ApiClient;
}

export function AuthProvider({ children, client }: AuthProviderProps) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (token === null) {
      setUser(null);
      return;
    }
    const controller = new AbortController();
    api
      .get<{ user: AuthUser }>('/auth/me', { token, signal: controller.signal })
      .then((response) => setUser(response.user))
      .catch(() => {
        // An expired or rejected token is cleared rather than retried forever.
        setToken(null);
        setUser(null);
        storeToken(null);
      });
    return () => controller.abort();
  }, [api, token]);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api.post<AuthSession>('/auth/login', { email, password });
      storeToken(session.token);
      setToken(session.token);
      setUser(session.user);
    },
    [api],
  );

  const logout = useCallback(() => {
    storeToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      status: user === null ? 'anonymous' : 'authenticated',
      login,
      logout,
    }),
    [user, token, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Client-side guard for authenticated routes. It is a convenience, not a security
 * boundary: the backend enforces authorisation on every protected endpoint.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  useEffect(() => {
    if (user === null) navigate('/login');
  }, [user]);

  if (user === null) {
    return <p role="status">Redirecting to sign in…</p>;
  }
  return <>{children}</>;
}
