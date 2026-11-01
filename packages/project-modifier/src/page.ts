/**
 * Source generation for a single added page.
 *
 * The page uses the project's existing typography, spacing, surface and shadow
 * tokens, so it inherits whatever design direction the project was generated
 * with instead of introducing a second visual language. Data is explicitly
 * labelled sample data: adding a route must not pretend to have connected a
 * backend.
 */
import type { PlannedPage } from './types.js';

interface PageInput {
  readonly id: string;
  readonly title: string;
  readonly route: string;
  readonly componentName: string;
  readonly description: string;
  readonly requiresAuth: boolean;
  readonly archetype: PlannedPage['archetype'];
}

function metricMarkup(): string {
  return `      <div className={styles.metrics} aria-label="Key metrics">
        {metrics.map((metric) => (
          <article key={metric.label} className={styles.metric}>
            <p className={styles.metricLabel}>{metric.label}</p>
            <p className={styles.metricValue}>{metric.value}</p>
            <p className={styles.metricHint}>{metric.hint}</p>
          </article>
        ))}
      </div>`;
}

function activityMarkup(): string {
  return `      <div className={styles.panels}>
        <Card title="Recent activity" description="Sample rows, shaped like the data this page will read.">
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <caption className="visually-hidden">Recent activity</caption>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={row.event}>
                    <td>{row.event}</td>
                    <td>{row.owner}</td>
                    <td>
                      <span className={styles.status}>{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Next steps" description="Replace the sample values with a real data source.">
          <ul className={styles.checklist}>
            <li>Declare the data model or endpoint this page should read.</li>
            <li>Replace the sample rows with a loader and render loading and error states.</li>
            <li>Keep the existing navigation, typography and spacing scale.</li>
          </ul>
        </Card>
      </div>`;
}

function listMarkup(): string {
  return `      <Card title="Items" description="Sample rows, shaped like the data this page will read.">
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <caption className="visually-hidden">Items on this page</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Owner</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.owner}</td>
                  <td>
                    <span className={styles.status}>{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>`;
}

function panelMarkup(): string {
  return `      <div className={styles.panels}>
        <Card title="About this page" description="Added by a planned modification, not by regenerating the project.">
          <p className={styles.muted}>
            This page reuses the project's existing layout, components and design tokens. Its content is
            deliberately explicit about what is not connected yet.
          </p>
        </Card>
        <Card title="Next steps" description="Turn the scaffold into the page you need.">
          <ul className={styles.checklist}>
            <li>Add the data model or endpoint this page should read.</li>
            <li>Add loading, empty and error states before calling a real service.</li>
            <li>Keep the existing navigation, typography and spacing scale.</li>
          </ul>
        </Card>
      </div>`;
}

function dataDeclarations(archetype: PlannedPage['archetype']): string {
  if (archetype === 'dashboard') {
    return `const metrics = [
  { label: 'Active projects', value: '24', hint: 'Sample data' },
  { label: 'Open tasks', value: '7', hint: 'Sample data' },
  { label: 'Completion', value: '98.2%', hint: 'Sample data' },
  { label: 'Attention needed', value: '3', hint: 'Sample data' },
] as const;

const activity = [
  { event: 'Design review completed', owner: 'Mira Chen', status: 'Done' },
  { event: 'Route table updated', owner: 'Assembler', status: 'Verified' },
  { event: 'Content import prepared', owner: 'Sam Patel', status: 'In review' },
] as const;
`;
  }
  if (archetype === 'list') {
    return `const rows = [
  { name: 'First item', owner: 'Mira Chen', status: 'Active' },
  { name: 'Second item', owner: 'Sam Patel', status: 'In review' },
  { name: 'Third item', owner: 'Assembler', status: 'Archived' },
] as const;
`;
  }
  return '';
}

function bodyMarkup(archetype: PlannedPage['archetype']): string {
  if (archetype === 'dashboard') return `${metricMarkup()}\n${activityMarkup()}`;
  if (archetype === 'list') return listMarkup();
  return panelMarkup();
}

export function renderPage(input: PageInput): Pick<PlannedPage, 'source' | 'test' | 'style'> {
  const title = JSON.stringify(input.title);
  const description = JSON.stringify(input.description);
  const source = `import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import styles from './${input.componentName}.module.css';

${dataDeclarations(input.archetype)}
export function ${input.componentName}() {
  return (
    <section className={styles.page}>
      <PageHeader title={${title}} description={${description}} />
${bodyMarkup(input.archetype)}
    </section>
  );
}
`;

  const expectation =
    input.archetype === 'dashboard'
      ? `expect(screen.getByText('Active projects')).toBeInTheDocument();`
      : input.archetype === 'list'
        ? `expect(screen.getByRole('table')).toBeInTheDocument();`
        : `expect(screen.getByText('Next steps')).toBeInTheDocument();`;
  const test = `import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ${input.componentName} } from './${input.componentName}';

describe('${input.componentName}', () => {
  it('renders its heading and its generated content', () => {
    render(<${input.componentName} />);
    expect(screen.getByRole('heading', { name: ${title} })).toBeInTheDocument();
    ${expectation}
  });
});
`;

  const style = `.page {
  display: grid;
  gap: var(--space-lg);
}

.metrics {
  display: grid;
  gap: var(--space-md);
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
}

.metric {
  display: grid;
  gap: var(--space-xs);
  padding: var(--space-md);
  border: var(--border-strength) var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.metricLabel {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.metricValue {
  margin: 0;
  font-size: var(--font-xl);
  font-weight: 700;
  letter-spacing: -0.02em;
}

.metricHint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-xs);
}

.panels {
  display: grid;
  gap: var(--space-md);
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.tableWrapper {
  overflow-x: auto;
  border: var(--border-strength) var(--color-border);
  border-radius: var(--radius-sm);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-sm);
}

.table th,
.table td {
  padding: var(--space-sm) var(--space-md);
  text-align: start;
  border-bottom: var(--border-strength) var(--color-border);
}

.table th {
  color: var(--color-text-muted);
  font-weight: 600;
}

.table tr:last-child td {
  border-bottom: none;
}

.status {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--color-hover);
  color: var(--color-text-muted);
  font-size: var(--font-xs);
  font-weight: 600;
  white-space: nowrap;
}

.checklist {
  display: grid;
  gap: var(--space-xs);
  margin: 0;
  padding-inline-start: 1.1rem;
  color: var(--color-text-muted);
}

.muted {
  margin: 0;
  color: var(--color-text-muted);
}

@media (prefers-reduced-motion: reduce) {
  .metric {
    transition: none;
  }
}
`;

  return { source, test, style };
}
