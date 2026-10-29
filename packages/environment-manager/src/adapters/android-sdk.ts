/**
 * Android SDK detection.
 *
 * An SDK is not a single executable: it is a directory tree whose usable parts
 * (platforms, build-tools, platform-tools, NDK, licences) matter individually. A
 * project that builds against `android-34` must not be told that `android-33`
 * satisfies it.
 */
import path from 'node:path';
import type {
  DetectionContext,
  InstallationPlan,
  ToolAdapter,
  ToolDetection,
  ToolRequirement,
} from '../types.js';

export interface AndroidSdkInventory {
  readonly root: string;
  readonly platforms: readonly string[];
  readonly buildTools: readonly string[];
  readonly ndkVersions: readonly string[];
  readonly cmakeVersions: readonly string[];
  readonly hasPlatformTools: boolean;
  readonly hasCmdlineTools: boolean;
  readonly hasLicenses: boolean;
  readonly sdkmanager: string | null;
}

function semanticSort(values: readonly string[]): string[] {
  return [...values].sort((a, b) => {
    const numeric = (value: string): number => {
      const digits = value.replace(/[^0-9.]/g, '.');
      const parts = digits.split('.').filter((part) => part !== '');
      return parts.reduce((acc, part) => acc * 1000 + Number(part), 0);
    };
    return numeric(a) - numeric(b);
  });
}

async function inspectRoot(context: DetectionContext, root: string): Promise<AndroidSdkInventory> {
  const list = async (sub: string): Promise<string[]> => {
    try {
      return semanticSort(await context.probes.listDirectory(path.join(root, sub)));
    } catch {
      return [];
    }
  };
  const exists = async (sub: string): Promise<boolean> =>
    context.probes.exists(path.join(root, sub));

  const candidateSdkmanager = path.join(
    root,
    'cmdline-tools',
    'latest',
    'bin',
    context.platform.os === 'win32' ? 'sdkmanager.bat' : 'sdkmanager',
  );

  return {
    root,
    platforms: await list('platforms'),
    buildTools: await list('build-tools'),
    ndkVersions: await list('ndk'),
    cmakeVersions: await list('cmake'),
    hasPlatformTools: await exists('platform-tools'),
    hasCmdlineTools: (await exists('cmdline-tools')) || (await exists('tools')),
    hasLicenses: await exists('licenses'),
    sdkmanager: (await context.probes.exists(candidateSdkmanager)) ? candidateSdkmanager : null,
  };
}

export class AndroidSdkAdapter implements ToolAdapter {
  readonly tool = 'android-sdk' as const;
  readonly displayName = 'Android SDK';

  private async candidateRoots(context: DetectionContext): Promise<Array<{ root: string; source: ToolDetection['source'] }>> {
    const roots: Array<{ root: string; source: ToolDetection['source'] }> = [];
    for (const envVar of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
      const value = context.env[envVar];
      if (value !== undefined && value !== '') roots.push({ root: value, source: 'environment-variable' });
    }
    const { homeDirectory, os } = context.platform;
    if (os === 'win32') {
      roots.push({ root: path.join(homeDirectory, 'AppData', 'Local', 'Android', 'Sdk'), source: 'known-location' });
    } else if (os === 'darwin') {
      roots.push({ root: path.join(homeDirectory, 'Library', 'Android', 'sdk'), source: 'known-location' });
    } else {
      roots.push({ root: path.join(homeDirectory, 'Android', 'Sdk'), source: 'known-location' });
      roots.push({ root: '/usr/local/lib/android/sdk', source: 'known-location' });
      roots.push({ root: '/opt/android-sdk', source: 'known-location' });
    }

    // Derive the root from `sdkmanager` or `adb` if they are on PATH.
    const sdkmanager = await context.probes.findOnPath(
      context.platform.os === 'win32' ? 'sdkmanager.bat' : 'sdkmanager',
    );
    if (sdkmanager !== null) {
      // <root>/cmdline-tools/<version>/bin/sdkmanager -> <root>
      roots.push({ root: path.resolve(path.dirname(sdkmanager), '..', '..', '..'), source: 'path' });
    }
    const adb = await context.probes.findOnPath(context.platform.os === 'win32' ? 'adb.exe' : 'adb');
    if (adb !== null) {
      roots.push({ root: path.resolve(path.dirname(adb), '..'), source: 'path' });
    }
    return roots;
  }

  async detect(context: DetectionContext): Promise<ToolDetection[]> {
    const results: ToolDetection[] = [];
    const seen = new Set<string>();

    for (const candidate of await this.candidateRoots(context)) {
      const root = path.resolve(candidate.root);
      const key = root.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!(await context.probes.exists(root))) continue;

      const inventory = await inspectRoot(context, root);
      const highestPlatform = inventory.platforms.at(-1) ?? null;
      const notes: string[] = [];
      if (inventory.platforms.length === 0) notes.push('no Android platform installed');
      if (inventory.buildTools.length === 0) notes.push('no build-tools installed');
      if (!inventory.hasPlatformTools) notes.push('platform-tools (adb) missing');
      if (!inventory.hasLicenses) notes.push('SDK licences have not been accepted');
      if (!inventory.hasCmdlineTools) notes.push('command-line tools missing');

      results.push({
        tool: 'android-sdk',
        found: true,
        location: root,
        version: highestPlatform,
        major: highestPlatform === null ? null : Number(highestPlatform.replace(/[^0-9]/g, '')),
        architecture: null,
        source: candidate.source,
        installationRoot: root,
        canExecute: inventory.hasCmdlineTools,
        notes,
        rawOutput: null,
        details: inventory as unknown as Record<string, unknown>,
      });
    }

    if (results.length === 0) {
      results.push({
        tool: 'android-sdk',
        found: false,
        location: null,
        version: null,
        major: null,
        architecture: null,
        source: null,
        installationRoot: null,
        canExecute: false,
        notes: ['Android SDK was not found (checked ANDROID_HOME, ANDROID_SDK_ROOT and known locations)'],
        rawOutput: null,
      });
    }
    return results;
  }

  async planInstallation(
    context: DetectionContext,
    requirements: readonly ToolRequirement[],
  ): Promise<InstallationPlan> {
    const existing = await this.detect(context);
    if (existing.some((entry) => entry.found)) {
      return {
        tool: 'android-sdk',
        method: 'existing',
        available: true,
        steps: [],
        requiresElevation: false,
        altersSystem: false,
        notes: ['An Android SDK installation was found. Missing components can be added with sdkmanager.'],
        source: null,
      };
    }
    return {
      tool: 'android-sdk',
      method: 'manual-download',
      available: true,
      steps: [
        {
          executable: 'sdkmanager',
          args: ['--install', '"platforms;android-34"', '"build-tools;34.0.0"', 'platform-tools'],
          description:
            'Install the Android command-line tools, then the platform and build-tools required by the project.',
          manual: true,
        },
        {
          executable: 'sdkmanager',
          args: ['--licenses'],
          description: 'Review and accept the SDK licences.',
          manual: true,
        },
      ],
      requiresElevation: false,
      altersSystem: true,
      notes: [
        `Requirements: ${requirements.map((r) => `${r.tool} ${r.version ?? 'any'}`).join(', ') || 'none specified'}.`,
        'Android SDK downloads are large; verify the download source before installing.',
      ],
      source: 'https://developer.android.com/studio#command-line-tools-only',
    };
  }
}

export function androidInventoryFrom(detection: ToolDetection | undefined): AndroidSdkInventory | null {
  const details = detection?.details;
  if (details === undefined) return null;
  const candidate = details as Partial<AndroidSdkInventory>;
  if (typeof candidate.root !== 'string') return null;
  return {
    root: candidate.root,
    platforms: Array.isArray(candidate.platforms) ? (candidate.platforms as string[]) : [],
    buildTools: Array.isArray(candidate.buildTools) ? (candidate.buildTools as string[]) : [],
    ndkVersions: Array.isArray(candidate.ndkVersions) ? (candidate.ndkVersions as string[]) : [],
    cmakeVersions: Array.isArray(candidate.cmakeVersions) ? (candidate.cmakeVersions as string[]) : [],
    hasPlatformTools: candidate.hasPlatformTools === true,
    hasCmdlineTools: candidate.hasCmdlineTools === true,
    hasLicenses: candidate.hasLicenses === true,
    sdkmanager: typeof candidate.sdkmanager === 'string' ? candidate.sdkmanager : null,
  };
}
