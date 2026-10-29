import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from './MetricCard';

describe('MetricCard', () => {
  it('renders label, value and hint', () => {
    render(<MetricCard label="Open tickets" value="12" hint="Last 7 days" />);
    expect(screen.getByLabelText('Open tickets')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
  });
});
