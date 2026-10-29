import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Link, Router, matchRoute, navigate, type RouteEntry } from './router';

const entries: RouteEntry[] = [
  { path: '/', title: 'Home', requiresAuth: false, element: <p>home page</p> },
  { path: '/items/:id', title: 'Item', requiresAuth: false, element: <p>item page</p> },
];

describe('matchRoute', () => {
  it('matches static and parameterised routes', () => {
    expect(matchRoute(entries, '/')?.entry.title).toBe('Home');
    expect(matchRoute(entries, '/items/42')?.params['id']).toBe('42');
    expect(matchRoute(entries, '/items')).toBeNull();
  });

  it('ignores trailing slashes', () => {
    expect(matchRoute(entries, '/items/7/')?.params['id']).toBe('7');
  });
});

describe('Router', () => {
  it('renders the matched route and a not-found fallback', () => {
    window.history.replaceState({}, '', '/items/9');
    const { unmount } = render(<Router entries={entries} />);
    expect(screen.getByText('item page')).toBeInTheDocument();
    unmount();

    window.history.replaceState({}, '', '/missing');
    render(<Router entries={entries} />);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('Link and navigate', () => {
  it('changes the location without a full page load', async () => {
    const { findByText } = render(
      <div>
        <Link to="/items/1">go</Link>
        <Router entries={entries} />
      </div>,
    );
    window.history.replaceState({}, '', '/');
    navigate('/items/1');
    expect(window.location.pathname).toBe('/items/1');
    expect(await findByText('item page')).toBeInTheDocument();
  });
});
