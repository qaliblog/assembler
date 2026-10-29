import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, type Workspace } from '@assembler/core';
import { CAPABILITY, type CapabilityResult } from './capabilities.js';
import { loadCachedInventory, persistScan, scanEnvironment, type EnvironmentScan } from './scanner.js';
import { createFakeProbe, type FakeEnvironment } from './testing/fake-environment.js';

let root: string;
let workspace: Workspace;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'assembler-env-test-'));
  workspace = createWorkspace({ root, env: { ASSEMBLER_LOG_LEVEL: 'silent' } });
});

afterEach(async () => {
  workspace.close();
  await fs.rm(root, { recursive: true, force: true });
});

const developerMachine: FakeEnvironment = {
  path: {
    node: { path: '/opt/node/bin/node', versionOutput: 'v20.11.1' },
    npm: { path: '/opt/node/bin/npm', versionOutput: '10.2.4' },
    pnpm: { path: '/opt/pnpm/bin/pnpm', versionOutput: '9.15.4' },
    python3: { path: '/usr/bin/python3', versionOutput: 'Python 3.12.3' },
    git: { path: '/usr/bin/git', versionOutput: 'git version 2.43.0' },
    java: { path: '/usr/lib/jvm/java-17/bin/java', versionOutput: 'openjdk version "17.0.20" 2026-07-21' },
    gradle: { path: '/opt/gradle/bin/gradle', versionOutput: 'Gradle 8.7' },
  },
  files: ['/opt/node/bin/npm', '/opt/android-sdk', '/opt/android-sdk/platform-tools', '/opt/android-sdk/licenses', '/opt/android-sdk/cmdline-tools'],
  directories: {
    '/opt/android-sdk/platforms': ['android-33', 'android-34'],
    '/opt/android-sdk/build-tools': ['33.0.1', '34.0.0'],
    '/opt/android-sdk/ndk': [],
    '/opt/android-sdk/cmake': [],
  },
};

function capability(scan: EnvironmentScan, name: string): CapabilityResult {
  const found = scan.capabilities.find((entry) => entry.capability === name);
  if (found === undefined) throw new Error(`capability ${name} was not evaluated`);
  return found;
}

const androidPolicy = {
  androidPlatform: 'android-34',
  androidBuildTools: '34.0.0',
  hasGradleWrapper: true,
} as const;

describe('scanEnvironment', () => {
  it('detects a complete JavaScript toolchain', async () => {
    const scan = await scanEnvironment({
      workspace,
      probes: createFakeProbe(developerMachine),
      policy: androidPolicy,
      env: { ANDROID_HOME: '/opt/android-sdk' },
      platform: undefined,
    });
    expect(capability(scan, CAPABILITY.nodeRuntime)).toMatchObject({ status: 'satisfied' });
    expect(capability(scan, CAPABILITY.nodePackageManager)).toMatchObject({ status: 'satisfied' });
    expect(capability(scan, CAPABILITY.javascriptWebBuild)).toMatchObject({ status: 'satisfied' });
    expect(capability(scan, CAPABILITY.androidApkBuild)).toMatchObject({ status: 'satisfied' });
    expect(scan.packageManager?.name).toBe('pnpm');
    expect(scan.android?.platforms).toEqual(['android-33', 'android-34']);
  });

  it('reports every missing capability when nothing is installed', async () => {
    const scan = await scanEnvironment({
      workspace,
      probes: createFakeProbe({}),
      env: {},
    });
    expect(capability(scan, CAPABILITY.nodeRuntime).status).toBe('unsatisfied');
    expect(capability(scan, CAPABILITY.javascriptWebBuild).status).toBe('unsatisfied');
    expect(capability(scan, CAPABILITY.pythonRuntime).status).toBe('unsatisfied');
    expect(capability(scan, CAPABILITY.androidApkBuild).status).toBe('unsatisfied');
    expect(scan.packageManager).toBeNull();
  });

  it('does not accept an incompatible Node.js version', async () => {
    const fake: FakeEnvironment = {
      path: { node: { path: '/usr/bin/node', versionOutput: 'v16.20.2' } },
    };
    const scan = await scanEnvironment({ workspace, probes: createFakeProbe(fake), env: {} });
    const node = capability(scan, CAPABILITY.nodeRuntime);
    expect(node.status).toBe('unsatisfied');
    expect(node.reason).toContain('16.20.2');
  });

  it('does not treat a present-but-not-executable tool as available', async () => {
    const fake: FakeEnvironment = {
      path: { node: { path: '/usr/bin/node', executable: false, versionOutput: 'v20.0.0' } },
    };
    const scan = await scanEnvironment({ workspace, probes: createFakeProbe(fake), env: {} });
    // Present but unusable is "unknown" — not satisfied, and not "not installed".
    const nodeCapability = capability(scan, CAPABILITY.nodeRuntime);
    expect(nodeCapability.status).toBe('unknown');
    expect(nodeCapability.reason).toMatch(/could not be executed/i);
    const node = scan.tools.find((tool) => tool.tool === 'node');
    expect(node?.canExecute).toBe(false);
  });

  it('reports unknown for a tool whose version probe hangs', async () => {
    const fake: FakeEnvironment = {
      path: { node: { path: '/usr/bin/node', versionOutput: 'v20.0.0' } },
      hanging: ['/usr/bin/node'],
    };
    const scan = await scanEnvironment({ workspace, probes: createFakeProbe(fake), env: {} });
    expect(capability(scan, CAPABILITY.nodeRuntime).status).toBe('unknown');
  });

  it('selects a healthy manager further down the preference list', async () => {
    const fake: FakeEnvironment = {
      path: {
        npm: { path: '/usr/bin/npm', versionOutput: '9.2.0' },
        pnpm: { path: '/usr/local/bin/pnpm', versionOutput: '9.15.4' },
      },
    };
    const probe = createFakeProbe(fake);
    // Simulate a broken npm: its config probe fails.
    const patched = {
      ...probe,
      run: async (executable: string, args: readonly string[], timeoutMs?: number) => {
        if (executable === '/usr/bin/npm' && args[0] === 'config') {
          return { exitCode: 1, stdout: '', stderr: 'boom', timedOut: false, error: null };
        }
        return probe.run(executable, args, timeoutMs);
      },
    };
    const scan = await scanEnvironment({
      workspace,
      probes: patched,
      env: {},
      packageManagerPreference: ['npm', 'pnpm'],
    });
    expect(scan.packageManagerCandidates[0]?.name).toBe('npm');
    expect(scan.packageManagerCandidates[0]?.healthy).toBe(false);
    expect(scan.packageManager?.name).toBe('pnpm');
  });

  it('discovers an Android SDK from an unusual installation path', async () => {
    const fake: FakeEnvironment = {
      path: { node: { path: '/usr/bin/node', versionOutput: 'v20.0.0' } },
      files: ['/srv/toolchains/android'],
      directories: {
        '/srv/toolchains/android/platforms': ['android-36'],
        '/srv/toolchains/android/build-tools': ['36.0.0'],
        '/srv/toolchains/android/ndk': [],
        '/srv/toolchains/android/cmake': [],
      },
    };
    const scan = await scanEnvironment({
      workspace,
      probes: createFakeProbe(fake),
      env: { ANDROID_HOME: '/srv/toolchains/android' },
      policy: { androidPlatform: 'android-36', androidBuildTools: '36.0.0', hasGradleWrapper: false },
    });
    expect(scan.android?.root).toBe('/srv/toolchains/android');
    expect(capability(scan, CAPABILITY.androidPlatform).status).toBe('satisfied');
    expect(capability(scan, CAPABILITY.androidApkBuild).status).not.toBe('satisfied');
  });

  it('produces a stable environment signature for identical hosts', async () => {
    const first = await scanEnvironment({ workspace, probes: createFakeProbe(developerMachine), env: {} });
    const second = await scanEnvironment({ workspace, probes: createFakeProbe(developerMachine), env: {} });
    expect(first.signature).toBe(second.signature);
  });
});

describe('inventory persistence', () => {
  it('round-trips a scan through SQLite', async () => {
    const scan = await scanEnvironment({ workspace, probes: createFakeProbe(developerMachine), env: {} });
    persistScan(workspace, scan);
    const cached = loadCachedInventory(workspace);
    expect(cached?.signature).toBe(scan.signature);
    expect(cached?.tools.some((tool) => tool.tool === 'node')).toBe(true);
    expect(cached?.capabilities.length).toBe(scan.capabilities.length);
  });

  it('returns null when nothing has been scanned', () => {
    expect(loadCachedInventory(workspace)).toBeNull();
  });
});
