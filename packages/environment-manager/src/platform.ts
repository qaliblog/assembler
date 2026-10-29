/**
 * Host detection.
 *
 * Nothing here assumes a particular runtime: the values come from the Node.js
 * process, and the detection functions accept overrides so behaviour can be
 * tested for platforms that are not the current host.
 */
import os from 'node:os';
import { parseVersion } from './version.js';

export type NormalizedOs = 'linux' | 'darwin' | 'win32' | 'other';
export type NormalizedArch = 'x64' | 'arm64' | 'ia32' | 'arm' | 'other';

export interface PlatformInfo {
  readonly os: NormalizedOs;
  readonly rawPlatform: NodeJS.Platform;
  readonly arch: NormalizedArch;
  readonly rawArch: string;
  readonly release: string;
  readonly nodeVersion: string;
  readonly nodeMajor: number;
  readonly pathSeparator: string;
  readonly homeDirectory: string;
  readonly tempDirectory: string;
  readonly cpuCount: number;
  readonly totalMemoryMb: number;
  /** Node >= 18 provides global fetch, which the HTTP service depends on. */
  readonly hasBuiltinFetch: boolean;
  readonly hasSqliteBuiltin: boolean;
}

export function normalizeOs(platform: string): NormalizedOs {
  if (platform === 'linux' || platform === 'darwin' || platform === 'win32') return platform;
  if (platform.startsWith('win')) return 'win32';
  return 'other';
}

export function normalizeArch(arch: string): NormalizedArch {
  switch (arch) {
    case 'x64':
    case 'amd64':
      return 'x64';
    case 'arm64':
    case 'aarch64':
      return 'arm64';
    case 'ia32':
    case 'x86':
      return 'ia32';
    case 'arm':
    case 'armv7l':
      return 'arm';
    default:
      return 'other';
  }
}

export interface DetectPlatformOptions {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly release?: string;
  readonly nodeVersion?: string;
  readonly homeDirectory?: string;
  readonly tempDirectory?: string;
}

export function detectPlatform(options: DetectPlatformOptions = {}): PlatformInfo {
  const rawPlatform = options.platform ?? process.platform;
  const rawArch = options.arch ?? process.arch;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const parsed = parseVersion(nodeVersion);
  const nodeMajor = parsed?.major ?? 0;
  return {
    os: normalizeOs(rawPlatform),
    rawPlatform,
    arch: normalizeArch(rawArch),
    rawArch,
    release: options.release ?? os.release(),
    nodeVersion,
    nodeMajor,
    pathSeparator: rawPlatform === 'win32' ? ';' : ':',
    homeDirectory: options.homeDirectory ?? os.homedir(),
    tempDirectory: options.tempDirectory ?? os.tmpdir(),
    cpuCount: os.cpus().length,
    totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    hasBuiltinFetch: typeof globalThis.fetch === 'function',
    // node:sqlite exists from Node 22.5; the engine does not rely on it.
    hasSqliteBuiltin: nodeMajor > 22 || (nodeMajor === 22 && (parsed?.minor ?? 0) >= 5),
  };
}

/** Human-readable build environment summary for reports. */
export function describePlatform(platform: PlatformInfo): string {
  return `${platform.os}/${platform.arch} node ${platform.nodeVersion} (${platform.cpuCount} cpus)`;
}
