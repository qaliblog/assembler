export {
  detectPlatform,
  describePlatform,
  normalizeArch,
  normalizeOs,
  type DetectPlatformOptions,
  type NormalizedArch,
  type NormalizedOs,
  type PlatformInfo,
} from './platform.js';
export {
  compareVersions,
  formatVersion,
  parseConstraint,
  parseVersion,
  satisfies,
  versionMatchesRange,
  type ParsedVersion,
  type VersionConstraint,
} from './version.js';
export type {
  CapabilityResult,
  CapabilityStatus,
  CommandOutcome,
  CommandProbe,
  DetectionContext,
  InstallationPlan,
  InstallationStep,
  PlatformInfoLike,
  ToolAdapter,
  ToolDetection,
  ToolId,
  ToolRequirement,
  ToolSource,
} from './types.js';
export {
  CAPABILITY,
  CORE_CAPABILITIES,
  DEFAULT_ENVIRONMENT_POLICY,
  evaluateCapabilities,
  evaluateCapability,
  type CapabilityContext,
  type CapabilityName,
  type EnvironmentPolicy,
  type PackageManagerSelection,
} from './capabilities.js';
export { AndroidSdkAdapter, androidInventoryFrom, type AndroidSdkInventory } from './adapters/android-sdk.js';
export { ExecutableToolAdapter } from './adapters/executable-adapter.js';
export {
  adbAdapter,
  gitAdapter,
  gradleAdapter,
  javaAdapter,
  nodeAdapter,
  npmAdapter,
  pipAdapter,
  pnpmAdapter,
  pythonAdapter,
  toolAdapters,
  yarnAdapter,
} from './adapters/tool-definitions.js';
export {
  createCommandProbe,
  loadCachedInventory,
  persistScan,
  scanEnvironment,
  selectPackageManager,
  summarizeScan,
  TOOL_IDS,
  type CachedEnvironmentInventory,
  type EnvironmentScan,
  type EnvironmentScanOptions,
} from './scanner.js';
