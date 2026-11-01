import { describe, expect, it } from 'vitest';
import { interpretRequirement } from './interpreter.js';

function interpret(text: string) {
  return interpretRequirement(text, { source: 'test', interpretedAt: '2026-01-01T00:00:00.000Z' });
}

describe('named colour presets', () => {
  it('places a requested preset in the specification with its theme palette', () => {
    const outcome = interpret('Create a React dashboard with a nord theme and tests');
    expect(outcome.spec?.design.preset).toBe('nord');
    expect(outcome.spec?.design.theme).toBe('dark');
    // The planner resolves the palette from knowledge/design.json; the
    // specification records that the preset owns the colours.
    expect(outcome.spec?.design.palette).toEqual([]);
    expect(
      outcome.spec?.requirements.some(
        (entry) => entry.category === 'design.color' && entry.rule === 'design.palette-from-preset',
      ),
    ).toBe(true);
    expect(outcome.spec?.requirements.some((entry) => entry.category === 'design.preset' && entry.value === 'nord')).toBe(
      true,
    );
  });

  it('composes a preset with an explicit light theme', () => {
    const outcome = interpret('Create a React app with a solarized light theme');
    expect(outcome.spec?.design.preset).toBe('solarized');
    expect(outcome.spec?.design.theme).toBe('light');
    expect(outcome.spec?.design.palette).toEqual([]);
  });

  it('keeps preset and style independent', () => {
    const outcome = interpret('Create a glassmorphism React dashboard with a dracula theme');
    expect(outcome.spec?.design.style).toBe('glassmorphism');
    expect(outcome.spec?.design.preset).toBe('dracula');
  });

  it('records a default preset when none was requested', () => {
    const outcome = interpret('Create a React dashboard with tests');
    expect(outcome.spec?.design.preset).toBe('default');
    expect(
      outcome.spec?.requirements.some((entry) => entry.category === 'design.preset' && entry.status === 'default'),
    ).toBe(true);
  });

  it('reports two conflicting presets as a contradiction instead of picking one', () => {
    const outcome = interpret('Create a React dashboard with a nord theme and a dracula theme');
    expect(outcome.contradictions.some((entry) => entry.fields.includes('design.preset'))).toBe(true);
  });
});
