import { useId, type InputHTMLAttributes } from 'react';
import styles from './TextField.module.css';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly label: string;
  readonly error?: string;
  readonly hint?: string;
}

export function TextField({ label, error, hint, ...rest }: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error === undefined ? null : errorId, hint === undefined ? null : hintId].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {rest.required === true ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={id}
        className={error === undefined ? styles.input : `${styles.input} ${styles.invalid}`}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy}
        {...rest}
      />
      {hint === undefined ? null : (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
