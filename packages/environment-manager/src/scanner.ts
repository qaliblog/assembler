/**
 * Environment scan.
 *
 * Composes tool adapters, evaluates capabilities, selects a package manager and
 * persists the result as a cache. The cache is never the source of truth: callers
 * may re-scan before a build, and a stale cache must not authorise a capability.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  contentHash,
  nowIso,
  randomId,
  type PackageManagerName,
  type SqlDatabase,
  type Workspace,
} from '@assembler/core';
import { AndroidSdkAdapter, androidInventoryFrom, type AndroidSdkInventory } from './adapters/android-sdk.js';
import { toolAdapters } from './adapters/tool-definitions.js';
import {
  CAPABILITY,
  CORE_CAPABILITIES,
  DEFAULT_ENVIRONMENT_POLICY,
  evaluateCapabilities,
  type CapabilityContext,
  type EnvironmentPolicy,
  type PackageManagerSelection,
} from './capabilities.js';
import { detectPlatform, describePlatform, type PlatformInfo } from './platform.js';
import type {
  CapabilityResult,
  CommandOutcome,
  CommandProbe,
  DetectionContext,
  ToolAdapter,
  ToolDetection,
  ToolId,
} from './types.js';
import { parseVersion } from './version.js';

export interface EnvironmentScanOptions {
  readonly workspace: Workspace;
  readonly policy?: Partial<EnvironmentPolicy>;
  readonly packageManagerPreference?: readonly PackageManagerName[];
  /** Perform a real HTTPS request to confirm network access. */
  readonly probeNetwork?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly adapters?: readonly ToolAdapter[];
  /** Inject a probe in tests to simulate missing tools. */
  readonly probes?: CommandProbe;
  readonly platform?: PlatformInfo;
  readonly requiredCapabilities?: readonly string[];
}

export interface EnvironmentScan {
  readonly platform: PlatformInfo;
  readonly policy: EnvironmentPolicy;
  readonly tools: readonly ToolDetection[];
  readonly android: AndroidSdkInventory | null;
  readonly packageManager: PackageManagerSelection | null;
  readonly packageManagerCandidates: readonly PackageManagerSelection[];
  readonly capabilities: readonly CapabilityResult[];
  readonly signature: string;
  readonly scannedAt: string;
  readonly limitations: readonly string[];
}

/** Real probe implementation backed by ProcessRunner and the filesystem. */
export function createCommandProbe(workspace: Workspace): CommandProbe {
  return {
    async run(executable: string, args: readonly string[], timeoutMs = 20_000): Promise<CommandOutcome> {
      const result = await workspace.processes.run({ executable, args: [...args], timeoutMs });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        error: result.spawnError,
      };
    },
    findOnPath(executable: string): Promise<string | null> {
      return workspace.processes.which(executable);
    },
    async exists(candidate: string): Promise<boolean> {
      try {
        await fs.access(candidate);
        return true;
      } catch {
        return false;
      }
    },
    async listDirectory(candidate: string): Promise<string[]> {
      const entries = await fs.readdir(candidate, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    },
  };
}

function normalizePolicy(policy: Partial<EnvironmentPolicy> | undefined): EnvironmentPolicy {
  return { ...DEFAULT_ENVIRONMENT_POLICY, ...(policy ?? {}) };
}

/**
 * Pick the first healthy package manager according to the configured preference.
 * A manager is only selected when it is actually executable and reports a version.
 */
export async function selectPackageManager(
  detections: readonly ToolDetection[],
  preference: readonly PackageManagerName[],
  probe: CommandProbe,
): Promise<{ selected: PackageManagerSelection | null; candidates: PackageManagerSelection[] }> {
  const candidates: PackageManagerSelection[] = [];
  for (const name of preference) {
    const detection = detections.find((entry) => entry.tool === name && entry.found && entry.canExecute);
    if (detection === undefined) continue;
    const notes: string[] = [];
    let healthy = detection.canExecute && detection.version !== null;
    if (!healthy) notes.push('version probe did not report a version');
    if (name === 'npm') {
      // A cheap, offline health check: npm must be able to read its own config.
      const outcome = await probe.run(detection.location ?? 'npm', ['config', 'get', 'registry']);
      const ok = outcome.error === null && outcome.exitCode === 0 && outcome.stdout.trim() !== '';
      if (!ok) {
        healthy = false;
        notes.push('npm config probe failed');
      }
    }
    candidates.push({
      name,
      executable: detection.location ?? name,
      version: detection.version,
      healthy,
      notes,
    });
  }
  return { selected: candidates.find((candidate) => candidate.healthy) ?? null, candidates };
}

async function probeNetwork(workspace: Workspace, enabled: boolean): Promise<CapabilityResult> {
  if (!enabled) {
    return {
      capability: CAPABILITY.networkHttps,
      status: 'unknown',
      reason: 'Network probing was not requested',
      detected: { probed: false },
    };
  }
  if (!workspace.config.network.enabled) {
    return {
      capability: CAPABILITY.networkHttps,
      status: 'unsatisfied',
      reason: 'Network access is disabled in the configuration',
      detected: { enabled: false },
    };
  }
  try {
    const response = await workspace.http.get('https://registry.npmjs.org/-/ping?write=true', {
      timeoutMs: 8_000,
      retries: 0,
      maxBytes: 4_096,
    });
    return {
      capability: CAPABILITY.networkHttps,
      status: response.ok ? 'satisfied' : 'unsatisfied',
      reason: response.ok ? `HTTPS reachable (HTTP ${response.status})` : `HTTPS probe returned HTTP ${response.status}`,
      detected: { probed: true, status: response.status },
    };
  } catch (error) {
    return {
      capability: CAPABILITY.networkHttps,
      status: 'unsatisfied',
      reason: `HTTPS probe failed: ${error instanceof Error ? error.message : String(error)}`,
      detected: { probed: true },
    };
  }
}

async function probePytest(
  workspace: Workspace,
  probe: CommandProbe,
  python: ToolDetection | undefined,
): Promise<CapabilityResult> {
  if (python === undefined || python.location === null) {
    return {
      capability: CAPABILITY.pythonPytest,
      status: 'unsatisfied',
      reason: 'Python is not available, so pytest cannot run',
      detected: { python: false },
    };
  }
  const outcome = await probe.run(python.location, ['-m', 'pytest', '--version']);
  const ok = outcome.error === null && outcome.exitCode === 0;
  return {
    capability: CAPABILITY.pythonPytest,
    status: ok ? 'satisfied' : 'unknown',
    reason: ok
      ? `pytest is available: ${outcome.stdout.trim().split('\n')[0] ?? ''}`
      : 'pytest is not installed for the detected Python interpreter (a virtual environment may provide it)',
    detected: { python: true, pytest: ok, workspace: path.basename(workspace.root) },
  };
}

async function filesystemWritable(workspace: Workspace): Promise<boolean> {
  const probe = path.join(workspace.paths.dataDir, `.probe-${randomId('fs')}`);
  try {
    await fs.mkdir(workspace.paths.dataDir, { recursive: true });
    await fs.writeFile(probe, 'probe');
    await fs.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function scanEnvironment(options: EnvironmentScanOptions): Promise<EnvironmentScan> {
  const workspace = options.workspace;
  const platform = options.platform ?? detectPlatform();
  const env = options.env ?? process.env;
  const probe = options.probes ?? createCommandProbe(workspace);
  const policy = normalizePolicy(options.policy);
  const adapters: readonly ToolAdapter[] = options.adapters ?? [...toolAdapters, new AndroidSdkAdapter()];

  const context: DetectionContext = {
    platform: {
      os: platform.os,
      arch: platform.arch,
      nodeVersion: platform.nodeVersion,
      homeDirectory: platform.homeDirectory,
      tempDirectory: platform.tempDirectory,
      hasBuiltinFetch: platform.hasBuiltinFetch,
    },
    env,
    probes: probe,
  };

  const tools: ToolDetection[] = [];
  for (const adapter of adapters) {
    const detections = await adapter.detect(context);
    tools.push(...detections);
  }

  const preference = options.packageManagerPreference ?? workspace.config.packageManagers.preference;
  const { selected, candidates } = await selectPackageManager(tools, preference, probe);
  const android = androidInventoryFrom(tools.find((entry) => entry.tool === 'android-sdk' && entry.found));

  const network = await probeNetwork(workspace, options.probeNetwork === true);
  const pytest = await probePytest(workspace, probe, tools.find((entry) => entry.tool === 'python' && entry.found));

  const capabilityContext: CapabilityContext = {
    platform,
    policy,
    detections: tools,
    android,
    packageManager: selected,
    filesystemWritable: await filesystemWritable(workspace),
    network,
    pythonPytest: pytest,
  };

  const capabilities = evaluateCapabilities(capabilityContext, options.requiredCapabilities ?? CORE_CAPABILITIES);
  // Only the current host can be exercised; say so rather than implying more.
  const limitations: string[] = [
    `Capabilities were verified on the current host only (${describePlatform(platform)}).`,
  ];
  if (!platform.hasBuiltinFetch) {
    limitations.push('This Node.js version has no built-in fetch(); the HTTP service cannot run.');
  }

  const signature = contentHash({
    platform: { os: platform.os, arch: platform.arch, node: platform.nodeVersion },
    tools: tools
      .map((entry) => `${entry.tool}|${entry.location ?? ''}|${entry.version ?? ''}`)
      .sort(),
    android: android === null ? null : { root: android.root, platforms: android.platforms, buildTools: android.buildTools },
    packageManager: selected === null ? null : `${selected.name}@${selected.version ?? ''}`,
  }).slice(0, 32);

  return {
    platform,
    policy,
    tools,
    android,
    packageManager: selected,
    packageManagerCandidates: candidates,
    capabilities,
    signature,
    scannedAt: nowIso(),
    limitations,
  };
}

/* -------------------------------------------------------------- persistence */

export function persistScan(workspace: Workspace, scan: EnvironmentScan): void {
  const db: SqlDatabase = workspace.database();
  db.transaction(() => {
    db.exec('DELETE FROM environment_tools');
    db.exec('DELETE FROM environment_capabilities');
    for (const tool of scan.tools) {
      db.run(
        `INSERT INTO environment_tools
          (id, tool_id, executable, version, major, architecture, source, installation_root, status, verified_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          contentHash([scan.signature, tool.tool, tool.location ?? '', tool.version ?? '']).slice(0, 32),
          tool.tool,
          tool.location ?? '',
          tool.version,
          tool.major,
          tool.architecture,
          tool.source,
          tool.installationRoot,
          tool.found ? (tool.canExecute ? 'available' : 'present-not-executable') : 'missing',
          scan.scannedAt,
          JSON.stringify({ notes: tool.notes, details: tool.details ?? null }),
        ],
      );
    }
    for (const capability of scan.capabilities) {
      db.run(
        `INSERT INTO environment_capabilities (capability, status, reason, evidence, environment_signature, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          capability.capability,
          capability.status,
          capability.reason,
          JSON.stringify(capability.detected),
          scan.signature,
          scan.scannedAt,
        ],
      );
    }
    db.run(
      `INSERT INTO environment_scans (id, signature, platform, created_at, payload) VALUES (?, ?, ?, ?, ?)`,
      [
        randomId('scan'),
        scan.signature,
        describePlatform(scan.platform),
        scan.scannedAt,
        JSON.stringify({
          tools: scan.tools,
          capabilities: scan.capabilities,
          packageManager: scan.packageManager,
          packageManagerCandidates: scan.packageManagerCandidates,
          android: scan.android,
          limitations: scan.limitations,
          policy: scan.policy,
        }),
      ],
    );
  });
}

export interface CachedEnvironmentInventory {
  readonly signature: string;
  readonly tools: ReadonlyArray<Pick<ToolDetection, 'tool' | 'location' | 'version' | 'canExecute' | 'notes'>>;
  readonly capabilities: ReadonlyArray<Pick<CapabilityResult, 'capability' | 'status' | 'reason'>>;
  readonly scannedAt: string;
}

export function loadCachedInventory(workspace: Workspace): CachedEnvironmentInventory | null {
  const db = workspace.database();
  const scan = db.get<{ signature: string; created_at: string; payload: string }>(
    'SELECT signature, created_at, payload FROM environment_scans ORDER BY created_at DESC LIMIT 1',
  );
  if (scan === undefined) return null;
  const payload = JSON.parse(scan.payload) as {
    tools?: ToolDetection[];
    capabilities?: CapabilityResult[];
  };
  return {
    signature: scan.signature,
    scannedAt: scan.created_at,
    tools: (payload.tools ?? []).map((tool) => ({
      tool: tool.tool,
      location: tool.location,
      version: tool.version,
      canExecute: tool.canExecute,
      notes: tool.notes,
    })),
    capabilities: (payload.capabilities ?? []).map((capability) => ({
      capability: capability.capability,
      status: capability.status,
      reason: capability.reason,
    })),
  };
}

/** Human-readable summary used by `assembler doctor`. */
export function summarizeScan(scan: EnvironmentScan): string[] {
  const lines: string[] = [];
  const detected = scan.tools.filter((tool) => tool.found);
  lines.push(`Host: ${describePlatform(scan.platform)}`);
  lines.push(
    `Tools: ${
      detected.length === 0
        ? 'none detected'
        : detected
            .map((tool) => `${tool.tool}${tool.version === null ? '' : `@${tool.version}`}`)
            .join(', ')
    }`,
  );
  const missing = scan.tools.filter((tool) => !tool.found).map((tool) => tool.tool);
  if (missing.length > 0) lines.push(`Missing: ${[...new Set(missing)].join(', ')}`);
  lines.push(
    `Package manager: ${scan.packageManager === null ? 'none healthy' : `${scan.packageManager.name}@${scan.packageManager.version ?? '?'}`}`,
  );
  for (const capability of scan.capabilities) {
    lines.push(`  [${capability.status}] ${capability.capability}: ${capability.reason}`);
  }
  return lines;
}

export const TOOL_IDS: readonly ToolId[] = [
  'node',
  'npm',
  'pnpm',
  'yarn',
  'python',
  'pip',
  'git',
  'java',
  'gradle',
  'android-sdk',
  'adb',
  'docker',
];

export { parseVersion };
