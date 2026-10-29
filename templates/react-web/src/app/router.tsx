import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

/**
 * A deliberately small router: history-based navigation, static route table,
 * typed path parameters. It has no dependency on a routing library, so the
 * generated application has one fewer package to audit and upgrade.
 */
export interface RouteEntry {
  readonly path: string;
  readonly title: string;
  readonly requiresAuth: boolean;
  readonly element: ReactNode;
}

export interface RouteMatch {
  readonly entry: RouteEntry;
  readonly params: Readonly<Record<string, string>>;
}

const RouteParamsContext = createContext<Readonly<Record<string, string>>>({});

export function useRouteParams(): Readonly<Record<string, string>> {
  return useContext(RouteParamsContext);
}

const NAVIGATION_EVENT = 'assembler:navigate';

function compilePath(template: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  const pattern = template
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${pattern === '' ? '/' : pattern}$`), names };
}

export function matchRoute(entries: readonly RouteEntry[], pathname: string): RouteMatch | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  for (const entry of entries) {
    const { regex, names } = compilePath(entry.path);
    const result = regex.exec(normalized);
    if (result === null) continue;
    const params: Record<string, string> = {};
    for (const [index, name] of names.entries()) {
      const value = result[index + 1];
      if (value !== undefined) params[name] = decodeURIComponent(value);
    }
    return { entry, params };
  }
  return null;
}

export function navigate(to: string): void {
  if (window.location.pathname === to) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATION_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATION_EVENT, onChange);
  };
}

export function useLocationPath(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => '/',
  );
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  readonly to: string;
  readonly children: ReactNode;
}

export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      navigate(to);
    },
    [onClick, to],
  );
  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

export function NotFound({ pathname }: { pathname: string }) {
  return (
    <section>
      <h1>Page not found</h1>
      <p>
        No route matches <code>{pathname}</code>.
      </p>
      <Link to="/">Go to the home page</Link>
    </section>
  );
}

export function Router({ entries }: { entries: readonly RouteEntry[] }) {
  const pathname = useLocationPath();
  const match = matchRoute(entries, pathname);
  if (match === null) return <NotFound pathname={pathname} />;
  return (
    <RouteParamsContext.Provider value={match.params}>
      {match.entry.element}
    </RouteParamsContext.Provider>
  );
}
