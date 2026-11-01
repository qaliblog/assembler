import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Workspace } from '@assembler/core';
import { assembleProject, inspectTarget, verifyGeneratedProject } from '@assembler/project-assembler';
import { planProject } from '@assembler/project-planner';
import { EXIT } from '../../apps/cli/src/commands.js';
import { decodeKeys } from '../../apps/cli/src/tui/keys.js';
import { PlainView } from '../../apps/cli/src/tui/plain.js';
import { TerminalScreen } from '../../apps/cli/src/tui/screen.js';
import { SLASH_COMMANDS, runPrompt, runTui } from '../../apps/cli/src/tui/index.js';
import { TuiSession, type SessionState } from '../../apps/cli/src/tui/session.js';
import { cleanup, createTestWorkspace, interpretWebRequest, requireSpec } from '../integration/helpers.js';

const NO_VERIFICATION = { install: false, typecheck: false, tests: false, build: false } as const;

let workspace: Workspace;
let root: string;
let session: TuiSession;

beforeEach(async () => {
  ({ workspace, root } = await createTestWorkspace('assembler-tui-'));
  session = new TuiSession(workspace, { ...NO_VERIFICATION, autoConfirm: true });
});

afterEach(async () => {
  session.dispose();
  workspace.close();
  await cleanup(root);
});

async function waitFor(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function entryTexts(state: SessionState): string[] {
  return state.entries.map((entry) => entry.text);
}

function request(): string {
  return 'Create a glassmorphism React dashboard called Tui Fixture with a dashboard page';
}

describe('session startup and slash commands', () => {
  it('shows the absolute workspace path, not the installation directory', () => {
    expect(session.state.workspaceDir).toBe(path.resolve(root));
    expect(session.projectDir).toBe(path.resolve(root));
  });

  it('advertises only commands it implements', async () => {
    await session.submit('/help');
    const help = entryTexts(session.state).filter((text) => text.startsWith('/'));
    expect(help.length).toBeGreaterThan(0);
    for (const command of help) {
      expect(SLASH_COMMANDS as readonly string[]).toContain(command.trim().split(/\s+/)[0]);
    }
    for (const command of SLASH_COMMANDS) expect(help.join(' ')).toContain(command);
    expect(help.join(' ')).not.toContain('/repair');
    expect(help.join(' ')).not.toContain('/docs');
  });

  it('reports the workspace and its contents', async () => {
    await session.submit('/workspace');
    const texts = entryTexts(session.state);
    expect(texts.join('\n')).toContain(`Workspace: ${path.resolve(root)}`);
    expect(texts.join('\n')).toContain('empty');
  });

  it('rejects an unknown command with a useful hint', async () => {
    await session.submit('/teleport');
    const texts = entryTexts(session.state);
    expect(texts.join('\n')).toContain('Unknown command: /teleport');
    expect(texts.join('\n')).toContain('/help');
  });

  it('previews a plan without writing files', async () => {
    await session.submit(`/plan ${request()}`);
    const texts = entryTexts(session.state);
    expect(texts.join('\n')).toContain('Plan:');
    expect(texts.join('\n')).toContain('Preview only: no files were written.');
    const entries = await fs.readdir(root);
    expect(entries.filter((name) => name !== '.assembler')).toEqual([]);
  });

  it('refuses to plan before a request exists', async () => {
    await session.submit('/plan');
    expect(entryTexts(session.state).join('\n')).toContain('Nothing to plan yet');
    const entries = await fs.readdir(root);
    expect(entries.filter((name) => name !== '.assembler')).toEqual([]);
  });

  it('reports history before anything was built', async () => {
    await session.submit('/history');
    expect(entryTexts(session.state).join('\n')).toContain('No assemblies have been recorded');
  });

  it('reports project diagnostics on /debug without writing files', async () => {
    await session.submit('/debug');
    const texts = entryTexts(session.state).join('\n');
    expect(texts).toContain('capabilities satisfied');
    expect(texts).toContain('No diagnostics have been recorded');
    const entries = (await fs.readdir(root)).filter((name) => name !== '.assembler');
    expect(entries).toEqual([]);
  });

  it('explains that there is no test script in an empty workspace', async () => {
    await session.submit('/test');
    expect(entryTexts(session.state).join('\n')).toContain('No package.json');
  });

  it('clears the log on /clear', async () => {
    await session.submit('/help');
    await session.submit('/clear');
    expect(session.state.entries).toEqual([]);
  });

  it('requests quit without pretending anything was built', async () => {
    await session.submit('/quit');
    expect(session.state.quit).toBe(true);
    expect(session.state.outcome).toBe('idle');
  });
});

describe('prompt submission reaches the real pipeline', () => {
  it('generates, records and verifies a project in the workspace', async () => {
    await session.submit(request());
    expect(session.state.outcome).toBe('built');
    expect(session.state.phase).toBe('done');

    for (const file of ['package.json', 'src/App.tsx', 'src/pages/DashboardPage.tsx', 'assembler.spec.json']) {
      await expect(fs.access(path.join(root, file)), file).resolves.toBeUndefined();
    }
    const verification = await verifyGeneratedProject(workspace, root);
    expect(verification).toEqual({ ok: true, missing: [], unexpected: [], altered: [] });

    const rows = workspace
      .database()
      .all<{ status: string }>('SELECT status FROM assemblies');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('built');
  });

  it('emits phases in order and never claims success before verification', async () => {
    await session.submit(request());
    const texts = entryTexts(session.state);
    const phaseIndex = (label: string): number => texts.findIndex((text) => text.includes(label));
    expect(phaseIndex('[1/6] Interpreting')).toBeGreaterThanOrEqual(0);
    expect(phaseIndex('[2/6] Creating project specification')).toBeGreaterThan(phaseIndex('[1/6] Interpreting'));
    expect(phaseIndex('[3/6] Checking environment')).toBeGreaterThan(phaseIndex('[2/6] Creating'));
    expect(phaseIndex('[4/6] Generating blueprint')).toBeGreaterThan(phaseIndex('[3/6] Checking'));
    expect(phaseIndex('[5/6] Assembling')).toBeGreaterThan(phaseIndex('[4/6] Generating'));
    expect(phaseIndex('[6/6] Validating')).toBeGreaterThan(phaseIndex('[5/6] Assembling'));
    const success = texts.indexOf('Project generated successfully.');
    const verification = texts.findIndex((text) => text.includes('Verification: install='));
    expect(success).toBeGreaterThan(verification);
  });

  it('names the project after the workspace directory when the request has no name', async () => {
    await session.submit('Create a responsive personal blog using React, TypeScript, and Vite');
    expect(session.state.outcome).toBe('built');
    const spec = JSON.parse(await fs.readFile(path.join(root, 'assembler.spec.json'), 'utf8')) as {
      name: string;
      slug: string;
    };
    const base = path.basename(root);
    expect(spec.slug).toBe(base.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    expect(spec.name).not.toBe('React App');
    expect(spec.name.toLowerCase()).toBe(base.toLowerCase().replace(/[-_]+/g, ' '));
  });

  it('reports blocked requests as errors without writing anything', async () => {
    await session.submit('frobnicate the wizard');
    expect(session.state.outcome).toBe('blocked');
    const texts = entryTexts(session.state);
    expect(texts.join('\n')).toContain('could not be turned into a specification');
    const entries = await fs.readdir(root);
    expect(entries.filter((name) => name !== '.assembler')).toEqual([]);
  });
});

describe('existing projects are not regenerated blindly', () => {
  it('refuses a change to a project it did not generate, and writes nothing', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"existing-project"}\n');
    await session.submit('Improve the design of my existing blog and fix its routes');

    expect(session.state.outcome).toBe('blocked');
    expect(session.lastErrorCode).toBe('NOT_GENERATED_PROJECT');
    const texts = entryTexts(session.state).join('\n');
    expect(texts).toContain('Modification supports projects generated by Assembler');
    expect(texts).toContain('Nothing was written');
    expect(await fs.readFile(path.join(root, 'package.json'), 'utf8')).toBe('{"name":"existing-project"}\n');
    const entries = (await fs.readdir(root)).filter((name) => name !== '.assembler');
    expect(entries).toEqual(['package.json']);
  });

  it('applies a planned page addition to a generated project without regenerating it', async () => {
    await session.submit(request());
    expect(session.state.outcome).toBe('built');
    const dashboard = await fs.readFile(path.join(root, 'src/pages/DashboardPage.tsx'), 'utf8');

    await session.submit('Add a beautiful modern admin dashboard to this application');
    expect(session.state.outcome).toBe('modified');
    expect(session.state.phase).toBe('done');
    const texts = entryTexts(session.state).join('\n');
    expect(texts).toContain('Modification plan:');
    expect(texts).toContain('Project modified successfully.');

    const routes = await fs.readFile(path.join(root, 'src/app/routes.tsx'), 'utf8');
    expect(routes).toContain('AdminPage');
    expect(routes).toContain('/dashboard');
    await expect(fs.access(path.join(root, 'src/pages/AdminPage.tsx'))).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(root, 'src/pages/DashboardPage.tsx'), 'utf8')).toBe(dashboard);
    expect(await verifyGeneratedProject(workspace, root)).toEqual({
      ok: true,
      missing: [],
      unexpected: [],
      altered: [],
    });
  });

  it('still generates a new project in an empty workspace', async () => {
    await session.submit('Create a professional blog using Node.js with tests');
    expect(session.state.outcome).toBe('built');
    const spec = JSON.parse(await fs.readFile(path.join(root, 'assembler.spec.json'), 'utf8')) as {
      applications: Array<{ framework: string }>;
    };
    expect(spec.applications[0]?.framework).toBe('node-typescript');
    await expect(fs.access(path.join(root, 'src/router/router.ts'))).resolves.toBeUndefined();
  }, 60_000);
});

describe('existing files are never silently overwritten', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'App.tsx'), '// hand-written, do not lose\n');
  });

  it('asks before overwriting and keeps the file when the user declines', async () => {
    const careful = new TuiSession(workspace, { ...NO_VERIFICATION });
    const pending = careful.submit(request());
    await waitFor(() => careful.state.confirmation !== null);
    expect(careful.state.confirmation?.question).toContain('already contains 1 file(s)');

    await careful.submit('no');
    await pending;

    expect(careful.state.outcome).toBe('declined');
    expect(await fs.readFile(path.join(root, 'src', 'App.tsx'), 'utf8')).toBe('// hand-written, do not lose\n');
    // The refusal happened before assembly: nothing else was written either.
    const entries = await fs.readdir(root);
    expect(entries.filter((name) => name !== '.assembler')).toEqual(['src']);
    careful.dispose();
  });

  it('overwrites only after an explicit yes', async () => {
    const careful = new TuiSession(workspace, { ...NO_VERIFICATION });
    const pending = careful.submit(request());
    await waitFor(() => careful.state.confirmation !== null);
    await careful.submit('yes');
    await pending;

    expect(careful.state.outcome).toBe('built');
    const content = await fs.readFile(path.join(root, 'src', 'App.tsx'), 'utf8');
    expect(content).not.toContain('do not lose');
    expect(content).toContain('AuthProvider');
    careful.dispose();
  });

  it('leaves the conflict untouched in non-interactive mode and explains --yes', async () => {
    const automatic = new TuiSession(workspace, { ...NO_VERIFICATION, nonInteractive: true });
    await automatic.submit(request());
    expect(automatic.state.confirmation).toBeNull();
    expect(automatic.state.outcome).toBe('declined');
    expect(automatic.lastErrorCode).toBe('OVERWRITE_DENIED');
    const texts = entryTexts(automatic.state);
    expect(texts.join('\n')).toContain('Re-run with --yes');
    expect(await fs.readFile(path.join(root, 'src', 'App.tsx'), 'utf8')).toBe('// hand-written, do not lose\n');
    automatic.dispose();
  });

  it('answers a confirmation on ctrl+c instead of overwriting', async () => {
    const careful = new TuiSession(workspace, { ...NO_VERIFICATION });
    const pending = careful.submit(request());
    await waitFor(() => careful.state.confirmation !== null);
    careful.interrupt();
    await pending;
    expect(careful.state.outcome).toBe('declined');
    expect(await fs.readFile(path.join(root, 'src', 'App.tsx'), 'utf8')).toBe('// hand-written, do not lose\n');
    careful.dispose();
  });

  it('refuses to assemble outside the workspace boundary', async () => {
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace, spec });
    await expect(
      assembleProject({
        workspace,
        spec,
        plan,
        targetDir: path.dirname(root),
        publish: 'in-place',
        installDependencies: false,
        runTypecheck: false,
        runTests: false,
        runBuild: false,
      }),
    ).rejects.toMatchObject({ code: 'OVERWRITE_DENIED' });
    // The workspace's own files are still exactly what the user wrote.
    expect(await fs.readFile(path.join(root, 'src', 'App.tsx'), 'utf8')).toBe('// hand-written, do not lose\n');
  });
});

describe('planning reports what an in-place build would touch', () => {
  it('separates new, conflicting and unrelated entries', async () => {
    await fs.mkdir(path.join(root, 'docs'), { recursive: true });
    await fs.writeFile(path.join(root, 'docs', 'notes.md'), '# mine\n');
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"mine"}\n');
    const spec = requireSpec(interpretWebRequest());
    const plan = await planProject({ workspace, spec });
    const inspection = await inspectTarget(workspace, root, plan.manifest);
    expect(inspection.exists).toBe(true);
    expect(inspection.conflicts).toEqual(['package.json']);
    expect(inspection.create.length).toBeGreaterThan(30);
    // A file the plan does not know about is reported as untouched, never as a
    // file to overwrite.
    expect(inspection.untouched).toContain('docs/notes.md');
    expect(inspection.untouched).not.toContain('package.json');
  });
});

describe('non-interactive invocation', () => {
  it('prints phases and exits 0 for a successful build', async () => {
    let printed = '';
    const output = { write: (chunk: string) => ((printed += chunk), true) };
    const code = await runPrompt(workspace, request(), { ...NO_VERIFICATION, output });
    expect(code).toBe(EXIT.ok);
    expect(printed).toContain('[1/6] Interpreting request…');
    expect(printed).toContain('Project generated successfully.');
    expect(printed).toContain('Verification: install=false');
  }, 60_000);

  it('exits 2 when the request cannot be specified', async () => {
    const other = await createTestWorkspace('assembler-tui-prompt-');
    try {
      let printed = '';
      const code = await runPrompt(other.workspace, 'frobnicate the wizard', {
        ...NO_VERIFICATION,
        output: { write: (chunk: string) => ((printed += chunk), true) },
      });
      expect(code).toBe(EXIT.usage);
      expect(printed).toContain('Nothing was written');
      const entries = await fs.readdir(other.root);
      expect(entries.filter((name) => name !== '.assembler')).toEqual([]);
    } finally {
      other.workspace.close();
      await cleanup(other.root);
    }
  }, 60_000);

  it('refuses to open the interactive interface without a TTY and says what to do', async () => {
    let printed = '';
    const input = Object.assign(
      (async function* () {
        /* never yields */
      })(),
      { setRawMode: () => undefined, isTTY: false, on: () => undefined, off: () => undefined, pause: () => true, resume: () => undefined },
    );
    const code = await runTui(workspace, {
      input: input as never,
      output: { write: (chunk: string) => ((printed += chunk), true), isTTY: false } as never,
    });
    expect(code).toBe(EXIT.usage);
    expect(printed).toContain('needs a terminal');
    expect(printed).toContain('--prompt');
  });
});

describe('terminal rendering and keys', () => {
  it('restores the terminal when stopped', () => {
    let written = '';
    const screen = new TerminalScreen({ write: (chunk: string) => ((written += chunk), true) }, { columns: 80, rows: 24 });
    screen.start();
    expect(written).toContain('\x1b[?1049h');
    screen.render(session.state);
    expect(written).toContain('ASSEMBLER');
    expect(written).toContain(path.resolve(root));
    screen.resize(60, 20);
    screen.scrollBy(3);
    screen.stop();
    expect(written).toContain('\x1b[?1049l');
    expect(written).toContain('\x1b[?25h');
  });

  it('prints line-oriented output for scripts', () => {
    let printed = '';
    const view = new PlainView({ write: (chunk: string) => ((printed += chunk), true) });
    view.render({
      ...session.state,
      entries: [
        { id: 1, kind: 'phase', text: '[1/6] Interpreting request…' },
        { id: 2, kind: 'success', text: 'Project generated successfully.' },
      ],
      busy: false,
    });
    expect(printed).toContain('[1/6] Interpreting request…');
    expect(printed).toContain('ok: Project generated successfully.');
    // Re-rendering the same state must not duplicate anything.
    const again = printed.length;
    view.render({ ...session.state, entries: session.state.entries.slice(0, 0) });
    expect(printed.length).toBe(again);
  });

  it('decodes control keys, escapes and bracketed pastes', () => {
    expect(decodeKeys('abc')).toEqual([{ type: 'text', text: 'abc' }]);
    expect(decodeKeys('\r')).toEqual([{ type: 'enter' }]);
    expect(decodeKeys('\x7f')).toEqual([{ type: 'backspace' }]);
    expect(decodeKeys('\x03')).toEqual([{ type: 'ctrl-c' }]);
    expect(decodeKeys('\x1b[A')).toEqual([{ type: 'up' }]);
    expect(decodeKeys('\x1b[6~')).toEqual([{ type: 'pagedown' }]);
    expect(decodeKeys('\x1b[200~multi\nline\x1b[201~')).toEqual([{ type: 'text', text: 'multi line' }]);
    expect(decodeKeys('a\x1b[Ab').map((key) => key.type)).toEqual(['text', 'up', 'text']);
  });
});
