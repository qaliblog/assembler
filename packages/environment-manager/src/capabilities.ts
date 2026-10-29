/**
 * Capability evaluation.
 *
 * A capability is an explicitly named thing the engine may need ("build an APK",
 * "run a TypeScript compiler"). States are `satisfied`, `unsatisfied` and
 * `unknown`; unknown is never treated as satisfied, and every result carries the
 * evidence used to reach it.
 */
import { satisfies, parseVersion } from './version.js';
import type { AndroidSdkInventory } from './adapters/android-sdk.js';
import type { CapabilityResult, CapabilityStatus, ToolDetection, ToolId } from './types.js';
import type { PlatformInfo } from './platform.js';

export const CAPABILITY = {
  filesystemWrite: 'filesystem.write',
  networkHttps: 'network.https',
  nodeRuntime: 'node.runtime',
  nodePackageManager: 'node.package-manager',
  javascriptWebBuild: 'javascript.web.build',
  pythonRuntime: 'python.runtime',
  pythonPytest: 'python.pytest',
  gitRepository: 'git.repository',
  androidJdk: 'android.jdk',
  androidSdk: 'android.sdk',
  androidPlatform: 'android.platform',
  androidBuildTools: 'android.build-tools',
  androidGradle: 'android.gradle',
  androidApkBuild: 'android.apk.build',
  androidAdb: 'android.adb',
} as const;

export type CapabilityName = (typeof CAPABILITY)[keyof typeof CAPABILITY] | (string & {});

export interface EnvironmentPolicy {
  /** Node.js version expression, e.g. `>=18.18.0`. */
  readonly minNodeVersion: string;
  /** Python version expression, e.g. `>=3.10`. */
  readonly minPythonVersion: string;
  /** Minimum JDK major version for Android builds. */
  readonly minJdkMajor: number;
  /** Android platform the project targets, e.g. `android-34`. */
  readonly androidPlatform?: string;
  /** Build-tools version prefix the project targets, e.g. `34.0.0`. */
  readonly androidBuildTools?: string;
  /** Whether the project provides a Gradle wrapper (gradlew). */
  readonly hasGradleWrapper?: boolean;
  /** NDK version required by native modules, if any. */
  readonly ndkVersion?: string;
  /** Whether the build must be able to download dependencies. */
  readonly requiresNetwork?: boolean;
}

export const DEFAULT_ENVIRONMENT_POLICY: EnvironmentPolicy = {
  minNodeVersion: '>=18.18.0',
  minPythonVersion: '>=3.10',
  minJdkMajor: 17,
};

export interface PackageManagerSelection {
  readonly name: 'npm' | 'pnpm' | 'yarn';
  readonly executable: string;
  readonly version: string | null;
  readonly healthy: boolean;
  readonly notes: readonly string[];
}

export interface CapabilityContext {
  readonly platform: PlatformInfo;
  readonly policy: EnvironmentPolicy;
  readonly detections: readonly ToolDetection[];
  readonly android: AndroidSdkInventory | null;
  readonly packageManager: PackageManagerSelection | null;
  readonly filesystemWritable: boolean;
  /** Result of an actual HTTPS probe, or unknown when probing was not requested. */
  readonly network: CapabilityResult;
  readonly pythonPytest: CapabilityResult;
}

export function bestDetection(context: CapabilityContext, tool: ToolId): ToolDetection | undefined {
  return context.detections
    .filter((detection) => detection.tool === tool && detection.found && detection.canExecute)
    .at(0);
}

/**
 * A detected installation that cannot be executed is *unknown*, never missing and
 * never satisfied: the tool is there, but nothing can be concluded about it.
 */
function unusableDetection(context: CapabilityContext, tool: ToolId): ToolDetection | undefined {
  return context.detections.find((detection) => detection.tool === tool && detection.found && !detection.canExecute);
}

function result(
  capability: string,
  status: CapabilityStatus,
  reason: string,
  detected: Record<string, string | number | boolean>,
  requirements?: readonly string[],
): CapabilityResult {
  return { capability, status, reason, detected, ...(requirements === undefined ? {} : { requirements }) };
}

export function evaluateCapability(name: string, context: CapabilityContext): CapabilityResult {
  switch (name) {
    case CAPABILITY.filesystemWrite:
      return result(
        name,
        context.filesystemWritable ? 'satisfied' : 'unsatisfied',
        context.filesystemWritable
          ? 'The workspace data directory is writable'
          : 'The workspace data directory is not writable',
        { writable: context.filesystemWritable },
      );

    case CAPABILITY.networkHttps:
      return { ...context.network, capability: name };

    case CAPABILITY.nodeRuntime: {
      const node = bestDetection(context, 'node');
      if (node === undefined) {
        const unusable = unusableDetection(context, 'node');
        if (unusable !== undefined) {
          return result(
            name,
            'unknown',
            `Node.js was found at ${unusable.location ?? '(unknown)'} but could not be executed`,
            { found: true, executable: false, location: unusable.location ?? '' },
            [context.policy.minNodeVersion],
          );
        }
        return result(name, 'unsatisfied', 'Node.js is not installed', { found: false }, [context.policy.minNodeVersion]);
      }
      const parsed = node.version === null ? null : parseVersion(node.version);
      if (parsed === null) {
        return result(name, 'unknown', 'Node.js was found but its version could not be determined', {
          found: true,
          location: node.location ?? '',
          rawVersion: node.version ?? '',
        });
      }
      const ok = satisfies(parsed, context.policy.minNodeVersion);
      if (ok === null) {
        return result(name, 'unknown', `Unparseable Node.js requirement: ${context.policy.minNodeVersion}`, {
          found: true,
          version: node.version ?? '',
        });
      }
      return result(
        name,
        ok ? 'satisfied' : 'unsatisfied',
        ok
          ? `Node.js ${node.version} at ${node.location ?? '(unknown)'} satisfies ${context.policy.minNodeVersion}`
          : `Node.js ${node.version} does not satisfy ${context.policy.minNodeVersion}`,
        { found: true, version: node.version ?? '', location: node.location ?? '', required: context.policy.minNodeVersion },
        [context.policy.minNodeVersion],
      );
    }

    case CAPABILITY.nodePackageManager: {
      const selection = context.packageManager;
      if (selection === null) {
        return result(name, 'unsatisfied', 'No supported Node.js package manager is available', { found: false });
      }
      return result(
        name,
        selection.healthy ? 'satisfied' : 'unknown',
        selection.healthy
          ? `${selection.name} ${selection.version ?? ''} at ${selection.executable}`.trim()
          : `${selection.name} is installed but its health check failed`,
        { found: true, packageManager: selection.name, executable: selection.executable, version: selection.version ?? '' },
      );
    }

    case CAPABILITY.javascriptWebBuild: {
      const node = evaluateCapability(CAPABILITY.nodeRuntime, context);
      const manager = evaluateCapability(CAPABILITY.nodePackageManager, context);
      const blocked = [node, manager].find((entry) => entry.status === 'unsatisfied');
      if (blocked !== undefined) {
        return result(name, 'unsatisfied', blocked.reason, { node: node.status, packageManager: manager.status });
      }
      const unknown = [node, manager].find((entry) => entry.status === 'unknown');
      return result(
        name,
        unknown === undefined ? 'satisfied' : 'unknown',
        unknown === undefined
          ? 'Node.js and a healthy package manager are available for JavaScript builds'
          : unknown.reason,
        { node: node.status, packageManager: manager.status },
      );
    }

    case CAPABILITY.pythonRuntime: {
      const python = bestDetection(context, 'python');
      if (python === undefined) {
        const unusable = unusableDetection(context, 'python');
        if (unusable !== undefined) {
          return result(name, 'unknown', 'Python was found but could not be executed', {
            found: true,
            executable: false,
            location: unusable.location ?? '',
          });
        }
        return result(name, 'unsatisfied', 'Python is not installed', { found: false }, [context.policy.minPythonVersion]);
      }
      const parsed = python.version === null ? null : parseVersion(python.version);
      if (parsed === null) {
        return result(name, 'unknown', 'Python was found but its version could not be determined', {
          found: true,
          location: python.location ?? '',
        });
      }
      const ok = satisfies(parsed, context.policy.minPythonVersion);
      if (ok === null) {
        return result(name, 'unknown', `Unparseable Python requirement: ${context.policy.minPythonVersion}`, {});
      }
      return result(
        name,
        ok ? 'satisfied' : 'unsatisfied',
        ok
          ? `Python ${python.version} satisfies ${context.policy.minPythonVersion}`
          : `Python ${python.version} does not satisfy ${context.policy.minPythonVersion}`,
        { found: true, version: python.version ?? '', location: python.location ?? '' },
        [context.policy.minPythonVersion],
      );
    }

    case CAPABILITY.pythonPytest:
      return { ...context.pythonPytest, capability: name };

    case CAPABILITY.gitRepository:
      return bestDetection(context, 'git') === undefined
        ? result(name, 'unsatisfied', 'Git is not installed', { found: false })
        : result(name, 'satisfied', 'Git is available', {
            found: true,
            version: bestDetection(context, 'git')?.version ?? '',
          });

    case CAPABILITY.androidJdk: {
      const java = bestDetection(context, 'java');
      if (java === undefined) {
        const unusable = unusableDetection(context, 'java');
        if (unusable !== undefined) {
          return result(name, 'unknown', 'A JDK was found but could not be executed', {
            found: true,
            executable: false,
            location: unusable.location ?? '',
          });
        }
        return result(name, 'unsatisfied', 'No JDK was detected', { found: false }, [`>=${context.policy.minJdkMajor}`]);
      }
      const parsed = java.version === null ? null : parseVersion(java.version);
      if (parsed === null) {
        return result(name, 'unknown', 'A JDK was found but its version could not be determined', {
          found: true,
          location: java.location ?? '',
        });
      }
      const ok = parsed.major >= context.policy.minJdkMajor;
      return result(
        name,
        ok ? 'satisfied' : 'unsatisfied',
        ok
          ? `JDK ${java.version} satisfies >=${context.policy.minJdkMajor}`
          : `JDK ${java.version} is older than ${context.policy.minJdkMajor}`,
        { found: true, version: java.version ?? '', location: java.location ?? '' },
      );
    }

    case CAPABILITY.androidSdk: {
      const sdk = context.android;
      if (sdk === null) {
        return result(name, 'unsatisfied', 'No Android SDK installation was found', { found: false });
      }
      if (sdk.platforms.length === 0) {
        return result(name, 'unsatisfied', 'The Android SDK has no installed platform', {
          found: true,
          root: sdk.root,
        });
      }
      return result(name, 'satisfied', `Android SDK at ${sdk.root}`, {
        found: true,
        root: sdk.root,
        platforms: sdk.platforms.join(','),
      });
    }

    case CAPABILITY.androidPlatform: {
      const sdk = context.android;
      const required = context.policy.androidPlatform;
      if (sdk === null) {
        return result(name, 'unsatisfied', 'No Android SDK installation was found', { found: false });
      }
      if (required === undefined) {
        return result(name, 'unknown', 'No Android platform requirement was specified', {
          installed: sdk.platforms.join(','),
        });
      }
      const present = sdk.platforms.includes(required);
      return result(
        name,
        present ? 'satisfied' : 'unsatisfied',
        present
          ? `${required} is installed`
          : `Required Android platform ${required} is missing (installed: ${sdk.platforms.join(', ') || 'none'})`,
        { required, installed: sdk.platforms.join(',') },
        [required],
      );
    }

    case CAPABILITY.androidBuildTools: {
      const sdk = context.android;
      if (sdk === null) {
        return result(name, 'unsatisfied', 'No Android SDK installation was found', { found: false });
      }
      const required = context.policy.androidBuildTools;
      if (required === undefined) {
        return sdk.buildTools.length === 0
          ? result(name, 'unsatisfied', 'No Android build-tools are installed', { installed: '' })
          : result(name, 'unknown', 'No build-tools version requirement was specified', {
              installed: sdk.buildTools.join(','),
            });
      }
      const present = sdk.buildTools.some((version) => version === required || version.startsWith(required));
      return result(
        name,
        present ? 'satisfied' : 'unsatisfied',
        present
          ? `build-tools ${required} is installed`
          : `Required build-tools ${required} are missing (installed: ${sdk.buildTools.join(', ') || 'none'})`,
        { required, installed: sdk.buildTools.join(',') },
      );
    }

    case CAPABILITY.androidGradle: {
      const gradle = bestDetection(context, 'gradle');
      if (context.policy.hasGradleWrapper === true) {
        return result(name, 'satisfied', 'The project provides a Gradle wrapper', { wrapper: true });
      }
      if (gradle !== undefined) {
        return result(name, 'satisfied', `Gradle ${gradle.version ?? ''} is available`, {
          wrapper: false,
          version: gradle.version ?? '',
        });
      }
      return result(
        name,
        'unknown',
        'No Gradle installation was found and the project has no wrapper; a wrapper would make Gradle available',
        { wrapper: false },
      );
    }

    case CAPABILITY.androidAdb:
      return bestDetection(context, 'adb') === undefined
        ? result(name, 'unsatisfied', 'adb is not available', { found: false })
        : result(name, 'satisfied', 'adb is available', { found: true });

    case CAPABILITY.androidApkBuild: {
      const java = evaluateCapability(CAPABILITY.androidJdk, context);
      const sdk = evaluateCapability(CAPABILITY.androidSdk, context);
      const platform = evaluateCapability(CAPABILITY.androidPlatform, context);
      const buildTools = evaluateCapability(CAPABILITY.androidBuildTools, context);
      const gradle = evaluateCapability(CAPABILITY.androidGradle, context);
      const ndk =
        context.policy.ndkVersion === undefined
          ? null
          : context.android?.ndkVersions.includes(context.policy.ndkVersion) === true
            ? 'satisfied'
            : 'unsatisfied';

      const parts: Array<[string, CapabilityStatus]> = [
        ['jdk', java.status],
        ['sdk', sdk.status],
        ['platform', platform.status],
        ['buildTools', buildTools.status],
        ['gradle', gradle.status],
      ];
      if (ndk !== null) parts.push(['ndk', ndk]);
      const detected = Object.fromEntries(parts) as Record<string, string>;

      if (parts.some(([, status]) => status === 'unsatisfied')) {
        const first = parts.find(([, status]) => status === 'unsatisfied');
        return result(
          name,
          'unsatisfied',
          `Android APK build is blocked: ${first?.[0] ?? 'toolchain'} is unsatisfied`,
          detected,
          [context.policy.androidPlatform ?? 'unspecified platform'],
        );
      }
      if (parts.some(([, status]) => status === 'unknown')) {
        return result(name, 'unknown', 'Android APK build cannot be verified: some toolchain facts are unknown', detected);
      }
      return result(name, 'satisfied', 'The Android toolchain satisfies the project requirements', detected);
    }

    default:
      return result(name, 'unknown', `No evaluator exists for capability "${name}"`, {});
  }
}

export const CORE_CAPABILITIES: readonly string[] = [
  CAPABILITY.filesystemWrite,
  CAPABILITY.networkHttps,
  CAPABILITY.nodeRuntime,
  CAPABILITY.nodePackageManager,
  CAPABILITY.javascriptWebBuild,
  CAPABILITY.pythonRuntime,
  CAPABILITY.pythonPytest,
  CAPABILITY.gitRepository,
  CAPABILITY.androidJdk,
  CAPABILITY.androidSdk,
  CAPABILITY.androidPlatform,
  CAPABILITY.androidBuildTools,
  CAPABILITY.androidGradle,
  CAPABILITY.androidApkBuild,
];

export function evaluateCapabilities(context: CapabilityContext, names: readonly string[] = CORE_CAPABILITIES): CapabilityResult[] {
  return names.map((name) => evaluateCapability(name, context));
}
