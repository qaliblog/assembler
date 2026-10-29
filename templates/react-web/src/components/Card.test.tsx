import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('renders a heading and description', () => {
    render(<Card title="Revenue" description="Last 30 days" />);
    expect(screen.getByRole('heading', { name: 'Revenue' })).toBeInTheDocument();
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  it('supports a lower heading level for nested cards', () => {
    render(
      <Card title="Detail" headingLevel={3}>
        <p>body</p>
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Detail' })).toBeInTheDocument();
  });
});
