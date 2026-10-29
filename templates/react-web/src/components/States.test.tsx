import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EmptyState, ErrorState, Spinner } from './States';

describe('Spinner', () => {
  it('announces loading politely', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});

describe('EmptyState', () => {
  it('renders a title, description and action', () => {
    render(<EmptyState title="No records" description="Create one to get started" action={<a href="/new">New</a>} />);
    expect(screen.getByText('No records')).toBeInTheDocument();
    expect(screen.getByText('Create one to get started')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New' })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('is an alert and exposes retry', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Network down" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
