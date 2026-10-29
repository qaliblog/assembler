/**
 * Component verification.
 *
 * Structural verification proves the component is internally consistent with what
 * its manifest claims: files exist, target paths are safe, declared exports appear
 * in the declared sources, tests are present, and the recorded hash still matches
 * the files on disk. It does **not** prove the component compiles or works.
 *
 * Execution-level verification (`level: "tested"`) is only credible when a real
 * build and test run is recorded for the project containing the component; the
 * end-to-end assembly test in this repository is what backs the built-in
 * components' `tested` claim.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { isWithin } from '@assembler/core';
import { assertSafeTarget, hashComponentDirectory, type ComponentRecord } from './manifest.js';

export interface VerificationFinding {
  readonly code: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export interface VerificationReport {
  readonly component: string;
  readonly version: string;
  readonly passed: boolean;
  readonly level: 'structural';
  readonly claimsTested: boolean;
  readonly sourceHash: string;
  readonly findings: readonly VerificationFinding[];
  readonly checkedAt: string;
}

export async function verifyComponentStructure(
  record: ComponentRecord,
  options: { now?: () => Date } = {},
): Promise<VerificationReport> {
  const findings: VerificationFinding[] = [];
  const { manifest, directory } = record;

  const add = (code: string, message: string, severity: VerificationFinding['severity'] = 'error'): void => {
    findings.push({ code, message, severity });
  };

  if (record.relativePath.startsWith('..') || !record.relativePath.startsWith('.')) {
    if (path.isAbsolute(record.relativePath)) {
      add('VERIFY_PATH', 'Component lives outside the libraries directory');
    }
  }

  for (const file of manifest.files) {
    try {
      assertSafeTarget(file.target);
    } catch {
      add('VERIFY_TARGET_ESCAPE', `Target path escapes the project: ${file.target}`);
    }
    const sourcePath = path.join(directory, file.source);
    if (!isWithin(directory, sourcePath)) {
      add('VERIFY_SOURCE_ESCAPE', `Source path escapes the component directory: ${file.source}`);
      continue;
    }
    try {
      await fs.access(sourcePath);
    } catch {
      add('VERIFY_MISSING_FILE', `Declared file is missing: ${file.source}`);
    }
  }

  for (const test of manifest.tests) {
    try {
      assertSafeTarget(test.target);
    } catch {
      add('VERIFY_TARGET_ESCAPE', `Test target path escapes the project: ${test.target}`);
    }
    try {
      await fs.access(path.join(directory, test.source));
    } catch {
      add('VERIFY_MISSING_TEST', `Declared test is missing: ${test.source}`);
    }
  }

  if (manifest.exports.length === 0 && manifest.category === 'ui') {
    add('VERIFY_NO_EXPORTS', 'A UI component must declare its exports', 'warning');
  }

  for (const exported of manifest.exports) {
    const sourcePath = path.join(directory, exported.from);
    try {
      const contents = await fs.readFile(sourcePath, 'utf8');
      const pattern = new RegExp(
        `export\\s+(?:const|function|class|type|interface|default)\\s+(?:.*\\b)?${exported.name}\\b|export\\s*\\{[^}]*\\b${exported.name}\\b`,
      );
      if (!pattern.test(contents)) {
        add(
          'VERIFY_EXPORT_MISSING',
          `Export "${exported.name}" is not declared in ${exported.from}`,
        );
      }
    } catch {
      add('VERIFY_EXPORT_SOURCE_MISSING', `Export source file is missing: ${exported.from}`);
    }
  }

  if (manifest.dependencies.length > 0 && manifest.framework === 'react') {
    add(
      'VERIFY_DEPENDENCIES_DECLARED',
      `Component declares runtime dependencies (${manifest.dependencies.map((dep) => dep.name).join(', ')}); the planner merges them into package.json`,
      'warning',
    );
  }

  const computedHash = await hashComponentDirectory(directory, manifest, (file) => fs.readFile(file, 'utf8'));
  if (computedHash !== record.sourceHash) {
    add('VERIFY_HASH_MISMATCH', 'Component source changed after it was catalogued');
  }

  if (manifest.verification.level === 'tested' && manifest.lifecycle === 'verified') {
    findings.push({
      code: 'VERIFY_TESTED_CLAIM',
      message:
        'The manifest claims execution-level verification. Confirm that the recorded test run exists before trusting it.',
      severity: 'warning',
    });
  }

  return {
    component: manifest.name,
    version: manifest.version,
    passed: findings.every((finding) => finding.severity !== 'error'),
    level: 'structural',
    claimsTested: manifest.verification.level === 'tested',
    sourceHash: computedHash,
    findings,
    checkedAt: (options.now?.() ?? new Date()).toISOString(),
  };
}
