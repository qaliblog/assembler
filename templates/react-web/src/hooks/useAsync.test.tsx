import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useAsync } from './useAsync';

function Success(): React.JSX.Element {
  const state = useAsync(async () => 'loaded', []);
  return <p>{state.status === 'success' ? state.data : state.status}</p>;
}

function Failure(): React.JSX.Element {
  const state = useAsync(async () => {
    throw new Error('boom');
  }, []);
  return <p>{state.status === 'error' ? state.error : state.status}</p>;
}

describe('useAsync', () => {
  it('exposes loading then success', async () => {
    render(<Success />);
    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('loaded')).toBeInTheDocument());
  });

  it('exposes the error message on failure', async () => {
    render(<Failure />);
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });
});
