import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data with explicit loading/success/error states and cancels in-flight
 * work when the component unmounts or the dependency list changes.
 */
export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  readonly status: AsyncStatus;
  readonly data: T | null;
  readonly error: string | null;
  reload(): void;
}

export function useAsync<T>(
  task: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> {
  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const taskRef = useRef(task);
  taskRef.current = task;

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setStatus('loading');
    setError(null);

    taskRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
        setStatus('success');
      })
      .catch((cause: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Unknown error');
        setStatus('error');
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  return { status, data, error, reload };
}
