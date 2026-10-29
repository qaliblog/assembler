export {
  assertSafeTarget,
  componentFileSchema,
  componentId,
  componentLifecycleSchema,
  componentManifestSchema,
  hashComponentDirectory,
  parseComponentManifest,
  verificationLevelSchema,
  type ComponentFile,
  type ComponentLifecycle,
  type ComponentManifest,
  type ComponentRecord,
  type VerificationLevel,
} from './manifest.js';
export {
  findComponent,
  loadCatalog,
  matchesQuery,
  selectComponents,
  type ComponentQuery,
  type LoadCatalogOptions,
} from './catalog.js';
export {
  verifyComponentStructure,
  type VerificationFinding,
  type VerificationReport,
} from './verification.js';
export { ComponentRegistry, type RegistryRecord, type SyncResult } from './registry.js';
