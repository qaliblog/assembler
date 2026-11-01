import { describe, expect, it } from 'vitest';
import { classifyIntent, describeIntent } from './intent.js';

function classify(text: string) {
  return classifyIntent(text);
}

describe('primary intent', () => {
  it('classifies a new publication as StartupProject with design and test intents', () => {
    const result = classify(
      'Create a professional blog using Node.js with a beautiful responsive design and tests',
    );
    expect(result.primary).toBe('StartupProject');
    expect(result.secondary).toContain('DesignImprovement');
    expect(result.secondary).toContain('TestProject');
    expect(result.requiresExistingProject).toBe(false);
  });

  it('classifies an existing-project change as UpdateProject, not a new project', () => {
    const result = classify('Improve the design of my existing blog and fix its routes');
    expect(result.primary).toBe('UpdateProject');
    expect(result.secondary).toContain('DesignImprovement');
    expect(result.secondary).toContain('DebugProject');
    expect(result.requiresExistingProject).toBe(true);
  });

  it('does not turn "build a dashboard" into BuildProject', () => {
    expect(classify('Build a React dashboard with a login page').primary).toBe('StartupProject');
  });

  it('recognises repair, migration, upgrade, deployment and audit requests', () => {
    expect(classify('Fix the broken routing system').primary).toBe('DebugProject');
    expect(classify('Migrate this project to TypeScript').primary).toBe('MigrateProject');
    expect(classify('Upgrade the dependencies to their latest versions').primary).toBe('UpgradeProject');
    expect(classify('Deploy the application to production').primary).toBe('DeployProject');
    expect(classify('Run a security audit and find vulnerabilities').primary).toBe('SecurityAudit');
    expect(classify('Improve performance and reduce bundle size').primary).toBe('PerformanceOptimization');
  });

  it('recognises analysis, documentation and research', () => {
    expect(classify('Analyze this repository and explain its architecture').primary).toBe('AnalyzeProject');
    expect(classify('Generate documentation and a README').primary).toBe('Documentation');
    expect(classify('Research the best database for this stack').primary).toBe('Research');
  });

  it('falls back to StartupProject when nothing is recognisable', () => {
    const result = classify('frobnicate the wizard');
    expect(result.primary).toBe('StartupProject');
    expect(result.requiresExistingProject).toBe(false);
  });
});

describe('multi-intent output', () => {
  it('records evidence for every matched intent', () => {
    const result = classify('Add authentication to my existing app and add tests');
    const update = result.intents.find((entry) => entry.intent === 'UpdateProject');
    expect(update?.evidence.length).toBeGreaterThan(0);
    expect(result.intents.map((entry) => entry.intent)).toContain('TestProject');
  });

  it('is deterministic and human-readable', () => {
    const first = classify('Improve the design of my existing blog and fix its routes');
    const second = classify('Improve the design of my existing blog and fix its routes');
    expect(first).toEqual(second);
    expect(describeIntent(first)).toContain('UpdateProject');
    expect(describeIntent(first)).toContain('DesignImprovement');
  });
});
