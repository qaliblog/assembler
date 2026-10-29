/**
 * Generic adapter for tools that are a single executable reporting a version.
 *
 * Multiple installations are discovered (PATH, environment variables, known
 * locations, and for Node.js the currently running interpreter). The first
 * executable found on PATH is *not* assumed to be correct: callers verify a
 * version constraint against every detected installation.
 */
import path from 'node:path';
import { parseVersion } from '../version.js';
import type {
  CommandOutcome,
  DetectionContext,
  InstallationPlan,
  InstallationStep,
  ToolAdapter,
  ToolDetection,
  ToolId,
  ToolRequirement,
  ToolSource,
} from '../types.js';

export interface ExecutableCandidate {
  readonly executable: string;
  readonly source: ToolSource;
  readonly absolute?: boolean;
  /** Known installations discovered dynamically (e.g. nvm versions). */
  readonly installationRoot?: string;
  readonly extraNotes?: readonly string[];
}

export interface ExecutableToolConfig {
  readonly tool: ToolId;
  readonly displayName: string;
  /** Candidate executables, in preference order. */
  readonly candidates: (context: DetectionContext) => readonly ExecutableCandidate[];
  /** Arguments that make the tool print its version. */
  readonly versionArgs: readonly string[];
  /** Some tools print their version to stderr (e.g. `java -version`). */
  readonly versionOnStderr?: boolean;
  readonly installation?: {
    readonly method: InstallationPlan['method'];
    readonly requiresElevation: boolean;
    readonly altersSystem: boolean;
    readonly source: string | null;
    readonly steps: (context: DetectionContext) => readonly InstallationStep[];
    readonly notes?: readonly string[];
  };
  /** Optional extra inspection, e.g. listing runtime capabilities. */
  readonly inspect?: (context: DetectionContext, location: string) => Promise<Partial<ToolDetection>>;
}

export function parseVersionFromOutcome(
  outcome: CommandOutcome,
  preferStderr = false,
): string | null {
  const primary = preferStderr ? outcome.stderr || outcome.stdout : outcome.stdout || outcome.stderr;
  const parsed = parseVersion(primary);
  return parsed === null ? null : parsed.raw;
}

export class ExecutableToolAdapter implements ToolAdapter {
  readonly tool: ToolId;
  readonly displayName: string;
  private readonly config: ExecutableToolConfig;

  constructor(config: ExecutableToolConfig) {
    this.config = config;
    this.tool = config.tool;
    this.displayName = config.displayName;
  }

  async detect(context: DetectionContext): Promise<ToolDetection[]> {
    const detections: ToolDetection[] = [];
    const seen = new Set<string>();

    for (const candidate of this.config.candidates(context)) {
      const resolved = candidate.absolute
        ? (await context.probes.exists(candidate.executable))
          ? candidate.executable
          : null
        : await context.probes.findOnPath(candidate.executable);
      if (resolved === null) continue;
      const key = resolved.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const outcome = await context.probes.run(resolved, this.config.versionArgs, 20_000);
      const notes: string[] = [...(candidate.extraNotes ?? [])];
      if (outcome.error !== null) {
        notes.push(`version probe failed: ${outcome.error.message}`);
      }
      if (outcome.timedOut) notes.push('version probe timed out');
      if (outcome.exitCode !== 0 && outcome.exitCode !== null) {
        notes.push(`version probe exited with ${outcome.exitCode}`);
      }

      const version = parseVersionFromOutcome(outcome, this.config.versionOnStderr ?? false);
      const parsed = version === null ? null : parseVersion(version);
      const extra =
        this.config.inspect === undefined ? {} : await this.config.inspect(context, resolved);

      detections.push({
        tool: this.config.tool,
        found: true,
        location: resolved,
        version,
        major: parsed?.major ?? null,
        architecture: null,
        source: candidate.source,
        installationRoot: candidate.installationRoot ?? path.dirname(resolved),
        canExecute: outcome.error === null && !outcome.timedOut,
        notes,
        rawOutput: `${outcome.stdout}${outcome.stderr}`.trim().slice(0, 4_000) || null,
        ...extra,
      });
    }

    if (detections.length === 0) {
      detections.push({
        tool: this.config.tool,
        found: false,
        location: null,
        version: null,
        major: null,
        architecture: null,
        source: null,
        installationRoot: null,
        canExecute: false,
        notes: [`${this.displayName} was not found on PATH or in known locations`],
        rawOutput: null,
      });
    }
    return detections;
  }

  async planInstallation(
    context: DetectionContext,
    requirements: readonly ToolRequirement[],
  ): Promise<InstallationPlan> {
    const installation = this.config.installation;
    const existing = await this.detect(context);
    const usable = existing.find((entry) => entry.found && entry.canExecute);
    if (usable !== undefined) {
      return {
        tool: this.config.tool,
        method: 'existing',
        available: true,
        steps: [],
        requiresElevation: false,
        altersSystem: false,
        notes: [
          `${this.displayName} is already available at ${usable.location ?? '(unknown)'}` +
            (usable.version === null ? '' : ` (version ${usable.version})`),
          ...(requirements.length === 0
            ? []
            : [`Requirements: ${requirements.map((r) => `${r.tool} ${r.version ?? 'any'}`).join(', ')}`]),
        ],
        source: null,
      };
    }
    if (installation === undefined) {
      return {
        tool: this.config.tool,
        method: 'unknown',
        available: false,
        steps: [],
        requiresElevation: false,
        altersSystem: false,
        notes: [`No verified installation method is known for ${this.displayName}.`],
        source: null,
      };
    }
    return {
      tool: this.config.tool,
      method: installation.method,
      available: true,
      steps: installation.steps(context),
      requiresElevation: installation.requiresElevation,
      altersSystem: installation.altersSystem,
      notes: [
        'Installation is never performed automatically.',
        'Review the steps, then run them yourself or authorise them explicitly.',
        ...(installation.notes ?? []),
      ],
      source: installation.source,
    };
  }
}
