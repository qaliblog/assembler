import type { ReactNode } from 'react';
import styles from './States.module.css';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className={styles.centered} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.panel}>
      <p className={styles.title}>{title}</p>
      {description === undefined ? null : <p className={styles.description}>{description}</p>}
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className={`${styles.panel} ${styles.errorPanel}`} role="alert">
      <p className={styles.title}>Something went wrong</p>
      <p className={styles.description}>{message}</p>
      {onRetry === undefined ? null : (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
