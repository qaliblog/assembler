import { describe, expect, it } from 'vitest';
import { patchRouteTable, RoutePatchError } from './patch.js';

const ROUTES = `import type { RouteEntry } from './router';
import { DashboardPage } from '../pages/DashboardPage';
import { RequireAuth } from './AuthProvider';

export const routeEntries: readonly RouteEntry[] = [
  { path: "/dashboard", title: "Dashboard", requiresAuth: true, element: <RequireAuth><DashboardPage /></RequireAuth> },
];
`;

describe('patchRouteTable', () => {
  it('adds the import and one entry while preserving every existing route', () => {
    const result = patchRouteTable({
      content: ROUTES,
      route: '/admin',
      title: 'Admin',
      componentName: 'AdminPage',
      requiresAuth: true,
    });
    expect(result.content).toContain("import { AdminPage } from '../pages/AdminPage';");
    expect(result.content).toContain('path: "/dashboard"');
    expect(result.content).toContain('path: "/admin", title: "Admin", requiresAuth: true');
    expect(result.content.indexOf('/dashboard')).toBeLessThan(result.content.indexOf('/admin'));
    // RequireAuth is already imported; a second import would be a duplicate.
    expect(result.content.match(/import \{ RequireAuth \}/g)).toHaveLength(1);
  });

  it('does not require an auth wrapper for a public page', () => {
    const result = patchRouteTable({
      content: ROUTES.replace("import { RequireAuth } from './AuthProvider';\n", ''),
      route: '/about',
      title: 'About',
      componentName: 'AboutPage',
      requiresAuth: false,
    });
    expect(result.entryLine).toBe(
      '{ path: "/about", title: "About", requiresAuth: false, element: <AboutPage /> }',
    );
    expect(result.content.match(/import \{ RequireAuth \}/g)).toBeNull();
  });

  it('adds RequireAuth when a protected page needs it and the file does not import it yet', () => {
    const result = patchRouteTable({
      content: ROUTES.replace("import { RequireAuth } from './AuthProvider';\n", ''),
      route: '/admin',
      title: 'Admin',
      componentName: 'AdminPage',
      requiresAuth: true,
    });
    expect(result.content).toContain("import { RequireAuth } from './AuthProvider';");
    expect(result.content).toContain('<RequireAuth><AdminPage /></RequireAuth>');
  });

  it('refuses a file without a route table instead of guessing', () => {
    expect(() =>
      patchRouteTable({
        content: 'export const routes = 1;\n',
        route: '/admin',
        title: 'Admin',
        componentName: 'AdminPage',
        requiresAuth: false,
      }),
    ).toThrow(RoutePatchError);
  });
});
