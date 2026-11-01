/**
 * Types for deterministic, in-place modification of generated projects.
 *
 * A modification is always expressed as a plan first: what will be created,
 * what will be edited, which tasks depend on each other, and how the result is
 * verified. Applying a plan is transactional: files are backed up, verification
 * runs, and a failed verification restores the previous state.
 */
import type { ProjectSpec } from '@assembler/project-spec';

export interface RecordedFile {
  readonly path: string;
  readonly owner: string;
  readonly kind: string;
  readonly sha256: string;
  readonly verified: boolean;
  readonly provenance: Record<string, unknown>;
}

export interface RecordedManifest {
  readonly schemaVersion: string;
  readonly project?: string;
  readonly specHash?: string;
  readonly files: readonly RecordedFile[];
}

export interface ExistingRoute {
  readonly path: string;
  readonly title: string;
}

export interface GeneratedProjectContext {
  readonly root: string;
  readonly spec: ProjectSpec;
  readonly specFile: string;
  readonly specContent: string;
  readonly manifest: RecordedManifest;
  readonly manifestFile: string;
  readonly manifestContent: string;
  /** Template that produced the route table; only react-web-vite is handled. */
  readonly templateId: string;
  readonly routesFile: string;
  readonly routesContent: string;
  readonly routesSha256: string;
  readonly existingRoutes: readonly ExistingRoute[];
  readonly hasAuth: boolean;
  readonly hasMetricCard: boolean;
}

export type ContextLoadResult =
  | { readonly ok: true; readonly context: GeneratedProjectContext }
  | {
      readonly ok: false;
      readonly code:
        | 'NOT_GENERATED_PROJECT'
        | 'PROJECT_INVALID'
        | 'MODIFICATION_CONFLICT'
        | 'MODIFICATION_UNSUPPORTED';
      readonly message: string;
    };

export type ModifierBlockerCode =
  | 'NOT_GENERATED_PROJECT'
  | 'PROJECT_INVALID'
  | 'MODIFICATION_UNSUPPORTED'
  | 'MODIFICATION_CONFLICT'
  | 'PAGE_EXISTS'
  | 'DEPENDENCIES_MISSING'
  | 'CAPABILITY_UNSATISFIED';

export interface ModifierBlocker {
  readonly code: ModifierBlockerCode;
  readonly message: string;
  readonly hint?: string;
}

export type ModificationChangeAction = 'create' | 'modify';

export interface ModificationChange {
  readonly path: string;
  readonly action: ModificationChangeAction;
  readonly kind: 'source' | 'test' | 'style' | 'metadata';
  readonly description: string;
}

export type ModificationTaskId =
  | 'inspect'
  | 'create-page'
  | 'create-test'
  | 'update-routes'
  | 'update-metadata'
  | 'verify';

export interface ModificationTask {
  readonly id: ModificationTaskId;
  readonly name: string;
  readonly description: string;
  readonly dependsOn: readonly ModificationTaskId[];
  readonly verification: string;
}

export interface PlannedPage {
  readonly id: string;
  readonly title: string;
  readonly route: string;
  readonly componentName: string;
  readonly description: string;
  readonly requiresAuth: boolean;
  readonly archetype: 'dashboard' | 'list' | 'settings' | 'profile' | 'generic';
  readonly sourceFile: string;
  readonly testFile: string;
  readonly styleFile: string;
  readonly source: string;
  readonly test: string;
  readonly style: string;
}

export interface ModificationPlan {
  readonly request: string;
  readonly kind: 'add-page';
  readonly summary: string;
  readonly rationale: string;
  readonly project: {
    readonly name: string;
    readonly slug: string;
    readonly templateId: string;
    readonly routeCount: number;
  };
  readonly page: PlannedPage;
  readonly changes: readonly ModificationChange[];
  readonly tasks: readonly ModificationTask[];
  readonly risks: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  /** Facts the user should know before applying, e.g. a public admin route. */
  readonly notes: readonly string[];
  readonly blockers: readonly ModifierBlocker[];
  /** Route table that the plan was computed from; re-checked before applying. */
  readonly baseRoutesSha256: string;
}

export interface ModificationCommandResult {
  readonly commandLine: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

export interface ModificationVerification {
  readonly typechecked: boolean;
  readonly tested: boolean;
  /** True when the caller explicitly disabled verification. */
  readonly skipped: boolean;
}

export interface ModificationReport {
  readonly status: 'modified' | 'failed';
  readonly project: string;
  readonly summary: string;
  readonly page: {
    readonly title: string;
    readonly route: string;
    readonly component: string;
  };
  readonly changes: readonly ModificationChange[];
  readonly verification: ModificationVerification;
  readonly commands: readonly ModificationCommandResult[];
  readonly backupDir: string | null;
  readonly rolledBack: boolean;
  readonly notes: readonly string[];
  readonly startedAt: string;
  readonly finishedAt: string;
}
