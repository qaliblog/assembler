/**
 * Declarative tool definitions.
 *
 * Adding a new executable tool means adding a definition here, not editing the
 * scanner. Android SDK is the one tool that needs bespoke inspection, and lives
 * in its own adapter.
 */
import path from 'node:path';
import type { DetectionContext, ToolRequirement } from '../types.js';
import { ExecutableToolAdapter, type ExecutableCandidate, type ExecutableToolConfig } from './executable-adapter.js';

/** Common installation locations for a Node.js-like binary per platform. */
function nodeLikeLocations(context: DetectionContext, binary: string): ExecutableCandidate[] {
  const { homeDirectory, os } = context.platform;
  if (os === 'win32') {
    return [
      { executable: path.join(homeDirectory, 'AppData', 'Roaming', 'npm', `${binary}.cmd`), source: 'known-location', absolute: true },
      { executable: path.join('C:', 'Program Files', 'nodejs', `${binary}.cmd`), source: 'known-location', absolute: true },
    ];
  }
  return [
    { executable: path.join('/usr/local/bin', binary), source: 'known-location', absolute: true },
    { executable: path.join('/usr/bin', binary), source: 'known-location', absolute: true },
    { executable: path.join(homeDirectory, '.volta', 'bin', binary), source: 'known-location', absolute: true },
    { executable: path.join(homeDirectory, '.local', 'share', 'pnpm', binary), source: 'known-location', absolute: true },
    { executable: path.join(homeDirectory, '.bun', 'bin', binary), source: 'known-location', absolute: true },
  ];
}

const pnpmInstallationNotes = [
  'Prefer `corepack` or a user-local install; do not modify system Node.js.',
];

export const nodeAdapter = new ExecutableToolAdapter({
  tool: 'node',
  displayName: 'Node.js',
  versionArgs: ['--version'],
  candidates: (context) => [
    // The running interpreter is a real installation and is listed first, but it
    // is still only used when it satisfies the version constraint.
    { executable: process.execPath, source: 'current-process', absolute: true, installationRoot: path.dirname(process.execPath) },
    ...['node'].flatMap((binary) =>
      nodeLikeLocations(context, binary).map((candidate) => ({ ...candidate, absolute: true })),
    ),
    { executable: 'node', source: 'path' },
  ],
  installation: {
    method: 'version-manager',
    requiresElevation: false,
    altersSystem: true,
    source: 'https://nodejs.org/en/download',
    steps: () => [
      {
        executable: 'nvm',
        args: ['install', '--lts'],
        description: 'Install a supported Node.js with a version manager (nvm/fnm/volta).',
        manual: true,
      },
    ],
    notes: ['Never upgrade the host Node.js automatically; use a version manager.'],
  },
});

function packageManagerConfig(
  tool: 'npm' | 'pnpm' | 'yarn',
  displayName: string,
  binary: string,
  installArgs: readonly string[],
): ExecutableToolConfig {
  return {
    tool,
    displayName,
    versionArgs: ['--version'],
    candidates: (context) => [
      ...nodeLikeLocations(context, binary),
      { executable: binary, source: 'path' },
    ],
    installation: {
      method: 'version-manager',
      requiresElevation: false,
      altersSystem: true,
      source: 'https://nodejs.org/en/download',
      steps: () => [
        {
          executable: 'corepack',
          args: installArgs,
          description: `Enable ${displayName} through corepack (bundled with Node.js).`,
          manual: true,
        },
      ],
      notes: [displayName === 'npm' ? 'npm ships with Node.js.' : pnpmInstallationNotes[0] ?? ''],
    },
  };
}

export const npmAdapter = new ExecutableToolAdapter(
  packageManagerConfig('npm', 'npm', 'npm', ['enable', 'npm']),
);
export const pnpmAdapter = new ExecutableToolAdapter(
  packageManagerConfig('pnpm', 'pnpm', 'pnpm', ['prepare', 'pnpm@latest', '--activate']),
);
export const yarnAdapter = new ExecutableToolAdapter(
  packageManagerConfig('yarn', 'Yarn', 'yarn', ['enable', 'yarn']),
);

export const pythonAdapter = new ExecutableToolAdapter({
  tool: 'python',
  displayName: 'Python',
  versionArgs: ['--version'],
  candidates: (context) => {
    const names =
      context.platform.os === 'win32' ? ['python.exe', 'python3.exe', 'py.exe'] : ['python3', 'python'];
    const known =
      context.platform.os === 'win32'
        ? []
        : [
            { executable: '/usr/bin/python3', source: 'known-location' as const, absolute: true },
            { executable: '/usr/local/bin/python3', source: 'known-location' as const, absolute: true },
          ];
    return [...names.map((name) => ({ executable: name, source: 'path' as const })), ...known];
  },
  installation: {
    method: 'manual-download',
    requiresElevation: false,
    altersSystem: true,
    source: 'https://www.python.org/downloads/',
    steps: () => [
      {
        executable: 'python3',
        args: ['-m', 'venv', '.venv'],
        description: 'Create a project-local virtual environment rather than installing globally.',
        manual: true,
      },
    ],
  },
});

export const pipAdapter = new ExecutableToolAdapter({
  tool: 'pip',
  displayName: 'pip',
  versionArgs: ['--version'],
  candidates: (context) => {
    const names = context.platform.os === 'win32' ? ['pip.exe', 'pip3.exe'] : ['pip3', 'pip'];
    return names.map((name) => ({ executable: name, source: 'path' as const }));
  },
  installation: {
    method: 'manual-download',
    requiresElevation: false,
    altersSystem: true,
    source: 'https://pip.pypa.io/en/stable/installation/',
    steps: () => [
      {
        executable: 'python3',
        args: ['-m', 'ensurepip', '--upgrade'],
        description: 'Install pip into the current Python interpreter.',
        manual: true,
      },
    ],
  },
});

export const gitAdapter = new ExecutableToolAdapter({
  tool: 'git',
  displayName: 'Git',
  versionArgs: ['--version'],
  candidates: () => [{ executable: 'git', source: 'path' }],
  installation: {
    method: 'manual-download',
    requiresElevation: false,
    altersSystem: true,
    source: 'https://git-scm.com/downloads',
    steps: () => [
      { executable: 'git', args: ['--version'], description: 'Install Git from the official package for this OS.', manual: true },
    ],
  },
});

export const javaAdapter = new ExecutableToolAdapter({
  tool: 'java',
  displayName: 'Java (JDK)',
  versionArgs: ['-version'],
  versionOnStderr: true,
  candidates: (context) => {
    const root = context.env['JAVA_HOME'];
    const candidates: ExecutableCandidate[] = [];
    if (root !== undefined && root !== '') {
      candidates.push({
        executable: path.join(root, 'bin', context.platform.os === 'win32' ? 'java.exe' : 'java'),
        source: 'environment-variable',
        absolute: true,
        installationRoot: root,
      });
    }
    if (context.platform.os === 'win32') {
      candidates.push({ executable: 'java.exe', source: 'path' });
    } else {
      candidates.push({ executable: '/usr/bin/java', source: 'known-location', absolute: true });
      candidates.push({ executable: 'java', source: 'path' });
    }
    return candidates;
  },
  installation: {
    method: 'manual-download',
    requiresElevation: true,
    altersSystem: true,
    source: 'https://adoptium.net/',
    steps: () => [
      {
        executable: 'java',
        args: ['-version'],
        description: 'Install a JDK 17+ (Temurin) using the system package manager.',
        manual: true,
      },
    ],
  },
});

export const gradleAdapter = new ExecutableToolAdapter({
  tool: 'gradle',
  displayName: 'Gradle',
  versionArgs: ['--version'],
  candidates: () => [{ executable: 'gradle', source: 'path' }],
  installation: {
    method: 'manual-download',
    requiresElevation: false,
    altersSystem: true,
    source: 'https://gradle.org/install/',
    steps: () => [
      {
        executable: 'gradle',
        args: ['wrapper'],
        description:
          'Prefer the project Gradle wrapper (gradlew) so the build is reproducible; do not install Gradle globally.',
        manual: true,
      },
    ],
  },
});

export const adbAdapter = new ExecutableToolAdapter({
  tool: 'adb',
  displayName: 'Android Debug Bridge',
  versionArgs: ['version'],
  candidates: (context) => {
    const root = context.env['ANDROID_HOME'] ?? context.env['ANDROID_SDK_ROOT'];
    const candidates: ExecutableCandidate[] = [];
    if (root !== undefined && root !== '') {
      candidates.push({
        executable: path.join(root, 'platform-tools', context.platform.os === 'win32' ? 'adb.exe' : 'adb'),
        source: 'environment-variable',
        absolute: true,
        installationRoot: root,
      });
    }
    candidates.push({ executable: 'adb', source: 'path' });
    return candidates;
  },
});

export const toolAdapters = [
  nodeAdapter,
  npmAdapter,
  pnpmAdapter,
  yarnAdapter,
  pythonAdapter,
  pipAdapter,
  gitAdapter,
  javaAdapter,
  gradleAdapter,
  adbAdapter,
] as const;

/** Requirements that only exist to describe a capability in reports. */
export function describeRequirement(requirement: ToolRequirement): string {
  return `${requirement.tool}${requirement.version === undefined ? '' : ` ${requirement.version}`}`;
}
