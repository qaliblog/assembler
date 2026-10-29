import { describe, expect, it } from 'vitest';
import { CAPABILITY, evaluateCapability, type CapabilityContext } from './capabilities.js';
import { detectPlatform } from './platform.js';
import type { ToolDetection } from './types.js';

const platform = detectPlatform({ platform: 'linux', arch: 'x64', nodeVersion: '18.19.1' });

function detection(overrides: Partial<ToolDetection> & { tool: ToolDetection['tool'] }): ToolDetection {
  return {
    found: true,
    location: `/usr/bin/${overrides.tool}`,
    version: null,
    major: null,
    architecture: null,
    source: 'path',
    installationRoot: '/usr/bin',
    canExecute: true,
    notes: [],
    rawOutput: null,
    ...overrides,
  };
}

function context(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  return {
    platform,
    policy: { minNodeVersion: '>=18.18.0', minPythonVersion: '>=3.10', minJdkMajor: 17 },
    detections: [],
    android: null,
    packageManager: null,
    filesystemWritable: true,
    network: { capability: CAPABILITY.networkHttps, status: 'unknown', reason: 'not probed', detected: {} },
    pythonPytest: { capability: CAPABILITY.pythonPytest, status: 'unknown', reason: 'not probed', detected: {} },
    ...overrides,
  };
}

describe('node runtime capability', () => {
  it('is unsatisfied when Node.js is absent', () => {
    const result = evaluateCapability(CAPABILITY.nodeRuntime, context());
    expect(result.status).toBe('unsatisfied');
    expect(result.reason).toMatch(/not installed/i);
  });

  it('rejects an old Node.js version with an explicit reason', () => {
    const result = evaluateCapability(
      CAPABILITY.nodeRuntime,
      context({ detections: [detection({ tool: 'node', version: '16.20.2', major: 16 })] }),
    );
    expect(result.status).toBe('unsatisfied');
    expect(result.reason).toContain('16.20.2');
    expect(result.reason).toContain('>=18.18.0');
  });

  it('reports unknown when a version cannot be parsed', () => {
    const result = evaluateCapability(
      CAPABILITY.nodeRuntime,
      context({ detections: [detection({ tool: 'node', version: null })] }),
    );
    expect(result.status).toBe('unknown');
  });
});

describe('package manager capability', () => {
  it('is unsatisfied with no manager and unknown when unhealthy', () => {
    expect(evaluateCapability(CAPABILITY.nodePackageManager, context()).status).toBe('unsatisfied');
    const unhealthy = evaluateCapability(
      CAPABILITY.nodePackageManager,
      context({
        packageManager: { name: 'npm', executable: '/usr/bin/npm', version: '9.2.0', healthy: false, notes: [] },
      }),
    );
    expect(unhealthy.status).toBe('unknown');
  });
});

describe('android capabilities', () => {
  const sdk = {
    root: '/opt/android-sdk',
    platforms: ['android-33'],
    buildTools: ['33.0.1'],
    ndkVersions: [],
    cmakeVersions: [],
    hasPlatformTools: true,
    hasCmdlineTools: true,
    hasLicenses: true,
    sdkmanager: '/opt/android-sdk/cmdline-tools/latest/bin/sdkmanager',
  };
  const java = detection({ tool: 'java', version: '17.0.20', major: 17 });

  it('reports the missing platform specifically', () => {
    const ctx = context({
      android: sdk,
      detections: [java],
      policy: { minNodeVersion: '>=18', minPythonVersion: '>=3.10', minJdkMajor: 17, androidPlatform: 'android-34' },
    });
    const result = evaluateCapability(CAPABILITY.androidPlatform, ctx);
    expect(result.status).toBe('unsatisfied');
    expect(result.reason).toContain('android-34');
    expect(result.reason).toContain('android-33');
  });

  it('blocks an APK build when the platform is missing', () => {
    const ctx = context({
      android: sdk,
      detections: [java, detection({ tool: 'gradle', version: '8.7', major: 8 })],
      policy: {
        minNodeVersion: '>=18',
        minPythonVersion: '>=3.10',
        minJdkMajor: 17,
        androidPlatform: 'android-34',
        androidBuildTools: '34.0.0',
      },
    });
    const result = evaluateCapability(CAPABILITY.androidApkBuild, ctx);
    expect(result.status).toBe('unsatisfied');
    expect(result.reason).toMatch(/blocked/i);
    expect(result.detected['platform']).toBe('unsatisfied');
  });

  it('does not claim success when Gradle availability is unknown', () => {
    const ctx = context({
      android: { ...sdk, platforms: ['android-34'], buildTools: ['34.0.0'] },
      detections: [java],
      policy: {
        minNodeVersion: '>=18',
        minPythonVersion: '>=3.10',
        minJdkMajor: 17,
        androidPlatform: 'android-34',
        androidBuildTools: '34.0.0',
        hasGradleWrapper: false,
      },
    });
    expect(evaluateCapability(CAPABILITY.androidApkBuild, ctx).status).toBe('unknown');
  });

  it('is satisfied with JDK, platform, build-tools and a wrapper', () => {
    const ctx = context({
      android: { ...sdk, platforms: ['android-34'], buildTools: ['34.0.0'] },
      detections: [java],
      policy: {
        minNodeVersion: '>=18',
        minPythonVersion: '>=3.10',
        minJdkMajor: 17,
        androidPlatform: 'android-34',
        androidBuildTools: '34.0.0',
        hasGradleWrapper: true,
      },
    });
    expect(evaluateCapability(CAPABILITY.androidApkBuild, ctx).status).toBe('satisfied');
  });

  it('fails when the JDK is too old', () => {
    const ctx = context({
      android: { ...sdk, platforms: ['android-34'], buildTools: ['34.0.0'] },
      detections: [detection({ tool: 'java', version: '11.0.2', major: 11 })],
      policy: {
        minNodeVersion: '>=18',
        minPythonVersion: '>=3.10',
        minJdkMajor: 17,
        androidPlatform: 'android-34',
        androidBuildTools: '34.0.0',
        hasGradleWrapper: true,
      },
    });
    expect(evaluateCapability(CAPABILITY.androidApkBuild, ctx).status).toBe('unsatisfied');
  });
});

describe('unknown capability names', () => {
  it('returns unknown rather than satisfied', () => {
    expect(evaluateCapability('some.future.capability', context()).status).toBe('unknown');
  });
});
