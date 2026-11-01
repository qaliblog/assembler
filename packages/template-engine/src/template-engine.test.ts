import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  expandSnippets,
  extractVariables,
  findUnfilledSlots,
  renderTemplate,
  renderTemplateSet,
  type TemplateManifest,
} from './index.js';

const temporaryDirectories: string[] = [];

async function makeTemplateDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'assembler-template-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('renderTemplate', () => {
  it('fills every variable and reports which names a template uses', () => {
    const template = '# {{appTitle}}\n\nPreset: {{presetLabel}} ({{theme}})\n';
    expect(extractVariables(template)).toEqual(['appTitle', 'presetLabel', 'theme']);
    expect(renderTemplate(template, { appTitle: 'Demo', presetLabel: 'Nord', theme: 'dark' })).toBe(
      '# Demo\n\nPreset: Nord (dark)\n',
    );
  });

  it('refuses to emit a template with an unfilled variable', () => {
    expect(() => renderTemplate('# {{appTitle}}\n', {})).toThrow(/undefined variable/i);
  });

  it('rejects a value that would itself leave a slot marker in the output', () => {
    expect(() => renderTemplate('{{title}}', { title: '{{stillOpen}}' })).toThrow(/unfilled slot/i);
  });
});

describe('code snippets', () => {
  it('expands snippet includes before variable substitution, recursively', () => {
    const snippets = {
      'tokens.css': ':root {\n{{> colors.css}}\n}',
      'colors.css': '  --color-primary: {{colorPrimary}};',
    };
    expect(expandSnippets('a\n{{> tokens.css}}\nb', snippets)).toBe(
      'a\n:root {\n  --color-primary: {{colorPrimary}};\n}\nb',
    );
    expect(renderTemplate('{{> tokens.css}}', { colorPrimary: '#88c0d0' }, { snippets })).toBe(
      ':root {\n  --color-primary: #88c0d0;\n}',
    );
  });

  it('flags an include whose snippet does not exist', () => {
    expect(() => renderTemplate('{{> missing.css}}', {})).toThrow(/unfilled slot/i);
    expect(findUnfilledSlots('a {{> missing.css}} b')).toEqual(['> missing.css']);
  });

  it('loads snippets from snippets/ and produces identical output twice', async () => {
    const directory = await makeTemplateDirectory();
    await fs.mkdir(path.join(directory, 'snippets'), { recursive: true });
    await fs.writeFile(path.join(directory, 'snippets', 'theme.css.tmpl'), '  --color-primary: {{colorPrimary}};\n');
    await fs.writeFile(path.join(directory, 'tokens.css.tmpl'), ':root {\n{{> theme.css}}\n}\n');
    const manifest: TemplateManifest = {
      id: 'test-template',
      version: '1.0.0',
      description: 'snippet composition',
      framework: 'react',
      buildSystem: 'vite',
      variables: [],
      files: [{ source: 'tokens.css.tmpl', target: 'src/styles/tokens.css', mode: 'render', kind: 'style' }],
    };
    const variables = { colorPrimary: '#e2b457' };
    const first = await renderTemplateSet(directory, manifest, variables);
    const second = await renderTemplateSet(directory, manifest, variables);
    expect(first[0]?.content).toBe(':root {\n  --color-primary: #e2b457;\n}\n');
    expect(second[0]?.content).toBe(first[0]?.content);
    expect(second[0]?.sha256).toBe(first[0]?.sha256);
  });
});
