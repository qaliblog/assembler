import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { DesignSpec } from '@assembler/project-spec';
import { computeDesign } from './design.js';
import type { DesignKnowledge } from './knowledge.js';

const knowledge = JSON.parse(
  await fs.readFile(new URL('../../../knowledge/design.json', import.meta.url), 'utf8'),
) as DesignKnowledge;

function design(overrides: Partial<DesignSpec> = {}): DesignSpec {
  return {
    style: 'minimal',
    theme: 'dark',
    preset: 'default',
    palette: [],
    layout: 'default',
    responsive: true,
    accessibility: { semanticHtml: true, keyboardNavigation: true, reducedMotion: true, contrastChecks: true },
    ...overrides,
  };
}

describe('computeDesign presets', () => {
  it('applies the named preset palette for the active theme', () => {
    const computed = computeDesign(design({ preset: 'nord' }), knowledge);
    expect(computed.tokens.presetName).toBe('nord');
    expect(computed.tokens.presetLabel).toBe('Nord');
    expect(computed.palette).toEqual(['#2e3440', '#88c0d0', '#a3be8c']);
    expect(computed.tokens.colorPrimary).toBe('#88c0d0');
    expect(computed.tokens.colorBgGradient).toContain('#2e3440');
    expect(computed.tokens.colorBgGradient).not.toBe(knowledge.themes.dark?.colorBgGradient);
  });

  it('keeps an explicitly requested palette above the preset', () => {
    const computed = computeDesign(design({ preset: 'dracula', palette: ['#101010', '#ff8800'] }), knowledge);
    expect(computed.palette).toEqual(['#101010', '#ff8800']);
    expect(computed.tokens.colorPrimary).toBe('#ff8800');
    expect(computed.tokens.presetName).toBe('dracula');
  });

  it('falls back to the style palette for an unknown or default preset', () => {
    const computed = computeDesign(design({ preset: 'does-not-exist' }), knowledge);
    expect(computed.tokens.presetName).toBe('default');
    expect(computed.tokens.presetLabel).toBe('Default');
    expect(computed.palette).toEqual(['#0f172a', '#e2e8f0', '#60a5fa']);
  });
});
