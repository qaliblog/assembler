import type { ReactNode } from 'react';
import styles from './Card.module.css';

export interface CardProps {
  readonly title?: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly headingLevel?: 2 | 3;
}

export function Card({ title, description, children, headingLevel = 2 }: CardProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section className={styles.card}>
      {title === undefined ? null : <Heading className={styles.title}>{title}</Heading>}
      {description === undefined ? null : <p className={styles.description}>{description}</p>}
      {children}
    </section>
  );
}
