import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Tests import workspace packages through source aliases so that a test run does
 * not require a prior build. Production code always resolves through package
 * `exports` (dist), which the build graph produces.
 */
const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = (name: string): string => `${root}packages/${name}/src/index.ts`;

export default defineConfig({
  resolve: {
    alias: {
      '@assembler/core': pkg('core'),
      '@assembler/environment-manager': pkg('environment-manager'),
      '@assembler/project-spec': pkg('project-spec'),
      '@assembler/requirement-parser': pkg('requirement-parser'),
      '@assembler/component-registry': pkg('component-registry'),
      '@assembler/template-engine': pkg('template-engine'),
      '@assembler/project-planner': pkg('project-planner'),
      '@assembler/project-assembler': pkg('project-assembler'),
      '@assembler/project-modifier': pkg('project-modifier'),
      '@assembler/diagnostic-engine': pkg('diagnostic-engine'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
