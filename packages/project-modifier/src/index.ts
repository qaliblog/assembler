export { loadGeneratedProject, extractRoutes } from './context.js';
export { planModification } from './plan.js';
export { applyModification, type ApplyModificationOptions } from './apply.js';
export { patchRouteTable, RoutePatchError, type RoutePatchInput, type RoutePatchResult } from './patch.js';
export { renderPage } from './page.js';
export type {
  ContextLoadResult,
  ExistingRoute,
  GeneratedProjectContext,
  ModificationChange,
  ModificationCommandResult,
  ModificationPlan,
  ModificationReport,
  ModificationTask,
  ModificationTaskId,
  ModificationVerification,
  ModifierBlocker,
  ModifierBlockerCode,
  PlannedPage,
  RecordedFile,
  RecordedManifest,
} from './types.js';
