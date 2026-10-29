/**
 * Project specification, schema version 1.0.
 *
 * The specification is the single source of truth for planning. It records not
 * only *what* was requested but *why* the engine believes it: every extracted
 * fact carries provenance (`requested`, `derived`, `default`, `assumption`), and
 * contradictions, unsupported capabilities and open questions are first-class
 * fields rather than being silently resolved.
 */
import { z } from 'zod';

export const SPEC_SCHEMA_VERSION = '1.0';

export const provenanceStatusSchema = z.enum(['requested', 'derived', 'default', 'assumption']);
export type ProvenanceStatus = z.infer<typeof provenanceStatusSchema>;

export const requirementCategorySchema = z.enum([
  'project.kind',
  'project.name',
  'platform',
  'framework',
  'build-system',
  'page',
  'route',
  'component',
  'design.style',
  'design.theme',
  'design.color',
  'design.layout',
  'state-management',
  'data-model',
  'api.endpoint',
  'auth',
  'database',
  'offline',
  'integration',
  'native.capability',
  'deployment',
  'testing',
  'accessibility',
  'constraint',
  'capability',
]);
export type RequirementCategory = z.infer<typeof requirementCategorySchema>;

export const requirementLedgerEntrySchema = z.object({
  id: z.string().min(1),
  category: requirementCategorySchema,
  /** Normalised value, e.g. `react`, `dashboard`, `sqlite`. */
  value: z.string().min(1),
  status: provenanceStatusSchema,
  /** Which application the requirement applies to, when scoped. */
  applicationId: z.string().min(1).optional(),
  /** Verbatim fragment of the user request that produced this entry. */
  evidence: z.string().default(''),
  /** Rule that produced it, for auditability. */
  rule: z.string().min(1),
  confidence: z.enum(['certain', 'likely']).default('certain'),
  notes: z.string().optional(),
});
export type RequirementLedgerEntry = z.infer<typeof requirementLedgerEntrySchema>;

export const pageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Route for web applications, screen name for mobile. */
  route: z.string().optional(),
  /** Recognised archetype; drives which verified components are selected. */
  archetype: z.enum([
    'landing',
    'login',
    'register',
    'dashboard',
    'settings',
    'profile',
    'list',
    'detail',
    'generic',
  ]),
  title: z.string().min(1),
  requiresAuth: z.boolean().default(false),
});
export type PageSpec = z.infer<typeof pageSchema>;

export const fieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'datetime', 'json', 'text']),
  required: z.boolean().default(true),
  description: z.string().optional(),
});

export const dataModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  applicationId: z.string().min(1),
  fields: z.array(fieldSchema).min(1),
  /** Optional persistence table name; defaults to the snake_case model name. */
  table: z.string().optional(),
});
export type DataModelSpec = z.infer<typeof dataModelSchema>;

export const apiEndpointSchema = z.object({
  id: z.string().min(1),
  applicationId: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().startsWith('/'),
  operation: z.string().min(1),
  requestModel: z.string().optional(),
  responseModel: z.string().optional(),
  requiresAuth: z.boolean().default(false),
  /** Page or service that consumes this endpoint, when known. */
  consumedBy: z.array(z.string()).default([]),
});
export type ApiEndpointSpec = z.infer<typeof apiEndpointSchema>;

export const applicationKindSchema = z.enum(['web', 'mobile', 'backend']);
export type ApplicationKind = z.infer<typeof applicationKindSchema>;

export const frameworkSchema = z.enum(['react', 'react-native', 'expo', 'node-typescript', 'fastapi']);
export type Framework = z.infer<typeof frameworkSchema>;

export const applicationSchema = z.object({
  id: z.string().min(1),
  kind: applicationKindSchema,
  framework: frameworkSchema,
  language: z.enum(['typescript', 'python']),
  buildSystem: z.enum(['vite', 'react-native-cli', 'expo', 'tsc', 'uvicorn']),
  deployment: z.enum(['static', 'android-apk', 'node-server', 'python-server', 'unspecified']),
  description: z.string().default(''),
  pages: z.array(pageSchema).default([]),
  apiEndpoints: z.array(apiEndpointSchema).default([]),
  database: z
    .object({
      engine: z.enum(['sqlite']),
      /** Path or DSN relative to the application root. */
      location: z.string().min(1),
    })
    .optional(),
  auth: z
    .object({
      required: z.boolean(),
      strategy: z.enum(['jwt', 'none']),
    })
    .optional(),
  offlineSupport: z.boolean().default(false),
  stateManagement: z.enum(['none', 'react-context']).default('none'),
});
export type ApplicationSpec = z.infer<typeof applicationSchema>;

export const designSchema = z.object({
  style: z.enum(['glassmorphism', 'neumorphism', 'minimal', 'material', 'default']),
  theme: z.enum(['dark', 'light', 'system']),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).default([]),
  layout: z.enum(['dashboard', 'landing', 'mobile-tabs', 'default']),
  responsive: z.boolean().default(true),
  accessibility: z
    .object({
      semanticHtml: z.boolean().default(true),
      keyboardNavigation: z.boolean().default(true),
      reducedMotion: z.boolean().default(true),
      contrastChecks: z.boolean().default(true),
    })
    .default({}),
});
export type DesignSpec = z.infer<typeof designSchema>;

export const testingSchema = z.object({
  unit: z.boolean().default(true),
  integration: z.boolean().default(false),
  e2e: z.boolean().default(false),
  accessibility: z.boolean().default(false),
  /** Test runner per application kind; resolved by the planner. */
  runners: z.array(z.string()).default([]),
});
export type TestingSpec = z.infer<typeof testingSchema>;

export const clarificationSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  /** Field path in the specification that the answer unblocks. */
  field: z.string().min(1),
  severity: z.enum(['blocking', 'advisory']),
  options: z.array(z.string()).default([]),
  context: z.string().optional(),
});
export type Clarification = z.infer<typeof clarificationSchema>;

export const contradictionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  fields: z.array(z.string()).min(1),
  /** Requested values that conflict. */
  values: z.array(z.string()).min(1),
});
export type Contradiction = z.infer<typeof contradictionSchema>;

export const unsupportedCapabilitySchema = z.object({
  id: z.string().min(1),
  capability: z.string().min(1),
  description: z.string().min(1),
  reason: z.string().min(1),
  /** What the user could do instead, when there is a verified alternative. */
  alternative: z.string().optional(),
});
export type UnsupportedCapability = z.infer<typeof unsupportedCapabilitySchema>;

export const assumptionSchema = z.object({
  id: z.string().min(1),
  field: z.string().min(1),
  value: z.string().min(1),
  rationale: z.string().min(1),
});
export type Assumption = z.infer<typeof assumptionSchema>;

export const projectSpecSchema = z.object({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  description: z.string().default(''),
  applications: z.array(applicationSchema).min(1),
  design: designSchema,
  dataModels: z.array(dataModelSchema).default([]),
  testing: testingSchema,
  /** Free-form constraints the user stated explicitly. */
  constraints: z.array(z.string()).default([]),
  requirements: z.array(requirementLedgerEntrySchema).default([]),
  clarifications: z.array(clarificationSchema).default([]),
  contradictions: z.array(contradictionSchema).default([]),
  unsupported: z.array(unsupportedCapabilitySchema).default([]),
  assumptions: z.array(assumptionSchema).default([]),
  provenance: z.object({
    sourceTextHash: z.string().min(16),
    interpretedAt: z.string().min(1),
    interpreterVersion: z.string().min(1),
    /** Artificial input is flagged so a plan can never claim a user confirmed it. */
    source: z.enum(['user-request', 'fixture', 'test']).default('user-request'),
  }),
});

export type ProjectSpec = z.infer<typeof projectSpecSchema>;

export function parseProjectSpec(input: unknown): { spec: ProjectSpec } | { issues: string[] } {
  const parsed = projectSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }
  return { spec: parsed.data };
}
