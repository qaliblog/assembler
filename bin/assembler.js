#!/usr/bin/env node
/**
 * Global entry point.
 *
 * Resolves the compiled CLI relative to *this file*, not the caller's directory,
 * so `assembler` works from any project folder after `npm link`. It checks the
 * build and runtime dependencies first and explains how to fix them, instead of
 * failing with an opaque ERR_MODULE_NOT_FOUND.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(packageRoot, 'apps', 'cli', 'dist', 'main.js');
const coreDist = path.join(packageRoot, 'packages', 'core', 'dist', 'index.js');
const assets = path.join(packageRoot, 'templates', 'react-web', 'template.json');

function fail(message, hint) {
  process.stderr.write(`assembler: ${message}\n`);
  if (hint) process.stderr.write(`${hint}\n`);
  process.exit(1);
}

if (!existsSync(entry) || !existsSync(coreDist)) {
  fail(
    `the build is missing (looked for ${entry}).`,
    `Build it first:\n  cd ${packageRoot}\n  pnpm install\n  pnpm run build`,
  );
}

if (!existsSync(path.join(packageRoot, 'node_modules'))) {
  fail(
    'runtime dependencies are not installed.',
    `Install them first:\n  cd ${packageRoot}\n  pnpm install\n  pnpm run build`,
  );
}

if (!existsSync(assets)) {
  fail(
    `the templates are missing from ${packageRoot}/templates.`,
    'Reinstall Assembler, or run it from a complete checkout with --root <dir>.',
  );
}

await import(pathToFileURL(entry).href);
