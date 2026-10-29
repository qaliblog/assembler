import type { AssemblerError } from '@assembler/core';

export type ToolId =
  | 'node'
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'python'
  | 'pip'
  | 'git'
  | 'java'
  | 'gradle'
  | 'android-sdk'
  | 'adb'
  | 'docker';

export type ToolSource = 'path' | 'environment-variable' | 'known-location' | 'current-process';

export interface ToolDetection {
  readonly tool: ToolId;
  readonly found: boolean;
  /** Absolute path of the executable or installation root when found. */
  readonly location: string | null;
  readonly version: string | null;
  readonly major: number | null;
  /** Architecture reported by the tool when it exposes one. */
  readonly architecture: string | null;
  readonly source: ToolSource | null;
  readonly installationRoot: string | null;
  readonly canExecute: boolean;
  readonly notes: readonly string[];
  /** Raw version output, kept for diagnostics. */
  readonly rawOutput: string | null;
  /** Tool-specific structured findings (e.g. Android SDK components). */
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ToolRequirement {
  readonly tool: ToolId;
  /** Version expression: `>=18.18.0`, `^5.4.0`, `18.x`. */
  readonly version?: string;
  readonly reason: string;
  readonly optional?: boolean;
}

export type CapabilityStatus = 'satisfied' | 'unsatisfied' | 'unknown';

export interface CapabilityResult {
  readonly capability: string;
  readonly status: CapabilityStatus;
  readonly reason: string;
  readonly detected: Readonly<Record<string, string | number | boolean>>;
  /** Requirement(s) that produced this result, for auditability. */
  readonly requirements?: readonly string[];
}

export interface InstallationStep {
  readonly executable: string;
  readonly args: readonly string[];
  readonly description: string;
  /** True when the step is informational and must not be executed automatically. */
  readonly manual: boolean;
}

export interface InstallationPlan {
  readonly tool: ToolId;
  /** How the tool would be obtained. */
  readonly method: 'existing' | 'package-manager' | 'version-manager' | 'manual-download' | 'unknown';
  readonly available: boolean;
  readonly steps: readonly InstallationStep[];
  readonly requiresElevation: boolean;
  readonly altersSystem: boolean;
  readonly notes: readonly string[];
  /** Documentation or download source, when known and trusted. */
  readonly source: string | null;
}

export interface CommandOutcome {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly error: AssemblerError | null;
}

/**
 * Narrow interface over process execution so adapters can be tested with fakes,
 * including simulated missing tools and unusual installation paths.
 */
export interface CommandProbe {
  run(executable: string, args: readonly string[], timeoutMs?: number): Promise<CommandOutcome>;
  findOnPath(executable: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  listDirectory(path: string): Promise<string[]>;
}

export interface DetectionContext {
  readonly platform: PlatformInfoLike;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly probes: CommandProbe;
}

export interface PlatformInfoLike {
  readonly os: 'linux' | 'darwin' | 'win32' | 'other';
  readonly arch: string;
  readonly nodeVersion: string;
  readonly homeDirectory: string;
  readonly tempDirectory: string;
  readonly hasBuiltinFetch: boolean;
}

export interface ToolAdapter {
  readonly tool: ToolId;
  readonly displayName: string;
  /** Find every plausible installation, best first. */
  detect(context: DetectionContext): Promise<ToolDetection[]>;
  planInstallation(
    context: DetectionContext,
    requirements: readonly ToolRequirement[],
  ): Promise<InstallationPlan>;
}
