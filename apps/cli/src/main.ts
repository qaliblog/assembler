#!/usr/bin/env node
/**
 * Assembler CLI.
 *
 * Exit codes:
 *   0  success
 *   1  the operation ran but failed (build/test/verification failure)
 *   2  invalid usage, specification or unresolved plan blockers
 *   3  a required environment capability is unsatisfied
 *   4  the requested feature is not implemented
 */
import { AssemblerError, isAssemblerError } from '@assembler/core';
import { flagBoolean, parseArgs, type CommandSpec } from './args.js';
import {
  EXIT,
  adopt,
  analyze,
  buildProject,
  debug,
  doctor,
  history,
  inspect,
  planOnly,
  registry,
  runInit,
  runInterpret,
  testProject,
  unimplemented,
  type CommandContext,
} from './commands.js';
import { reportError } from './output.js';

interface CommandDefinition extends CommandSpec {
  readonly run: (context: CommandContext) => Promise<number>;
}

const COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'init',
    usage: 'assembler init [--root <dir>] [--json]',
    description: 'Create the workspace configuration and data directory.',
    valueFlags: ['root'],
    booleanFlags: ['json', 'help'],
    run: runInit,
  },
  {
    name: 'interpret',
    usage: 'assembler interpret "<request>" [--out <file>] [--json]',
    description: 'Convert a natural-language request into a validated project specification.',
    valueFlags: ['out', 'root'],
    booleanFlags: ['json', 'help'],
    run: runInterpret,
  },
  {
    name: 'plan',
    usage: 'assembler plan <spec.json> [--out <blueprint.json>] [--json]',
    description: 'Build a complete, inspectable blueprint without writing project files.',
    valueFlags: ['out', 'root'],
    booleanFlags: ['json', 'help'],
    run: planOnly,
  },
  {
    name: 'build',
    usage: 'assembler build <spec.json> [--target <dir>] [--overwrite deny|backup|replace] [--no-install] [--no-tests] [--json]',
    description: 'Assemble, install, typecheck, test, build and publish a project.',
    valueFlags: ['target', 'overwrite', 'root'],
    booleanFlags: ['json', 'no-install', 'no-tests', 'no-typecheck', 'no-build', 'help'],
    run: buildProject,
  },
  {
    name: 'analyze',
    usage: 'assembler analyze [<dir>] [--json]',
    description: 'Inventory an existing project: targets, dependencies, imports and tests.',
    valueFlags: [],
    booleanFlags: ['json', 'help'],
    run: analyze,
  },
  {
    name: 'inspect',
    usage: 'assembler inspect <dir> [--json]',
    description: 'Verify a generated project against its recorded manifest.',
    valueFlags: ['root'],
    booleanFlags: ['json', 'help'],
    run: inspect,
  },
  {
    name: 'doctor',
    usage: 'assembler doctor [--json]',
    description: 'Detect runtimes, package managers, SDKs and report capability status.',
    valueFlags: ['root'],
    booleanFlags: ['json', 'help'],
    run: doctor,
  },
  {
    name: 'registry',
    usage: 'assembler registry <search|inspect|add|verify|deprecate|list> [args]',
    description: 'Manage the verified component registry.',
    valueFlags: ['version', 'replaced-by', 'root'],
    booleanFlags: ['json', 'help'],
    run: registry,
  },
  {
    name: 'history',
    usage: 'assembler history [--limit <n>] [--json]',
    description: 'Show recorded assemblies and their outcomes.',
    valueFlags: ['limit', 'root'],
    booleanFlags: ['json', 'help'],
    run: history,
  },
  {
    name: 'test',
    usage: 'assembler test <dir> [--json]',
    description: "Run an existing project's test script with the detected package manager.",
    valueFlags: ['root'],
    booleanFlags: ['json', 'help'],
    run: testProject,
  },
  {
    name: 'debug',
    usage: 'assembler debug [<dir>] [--json]',
    description: 'Combine project analysis, environment status and recorded diagnostics.',
    valueFlags: ['root'],
    booleanFlags: ['json', 'help'],
    run: debug,
  },
  {
    name: 'adopt',
    usage: 'assembler adopt [<dir>] [--json]',
    description: 'Analysis-only in this milestone: adoption is not implemented.',
    valueFlags: [],
    booleanFlags: ['json', 'help'],
    run: adopt,
  },
  {
    name: 'repair',
    usage: 'assembler repair <dir> [--json]',
    description: 'Not implemented in this milestone.',
    valueFlags: [],
    booleanFlags: ['json', 'dry-run', 'help'],
    run: (context) =>
      unimplemented(
        context,
        'repair',
        'The repair engine is not implemented in this milestone. No files were modified. Diagnostics and root-cause analysis exist as data structures only.',
      ),
  },
  {
    name: 'docs',
    usage: 'assembler docs <query> [--json]',
    description: 'Not implemented in this milestone.',
    valueFlags: [],
    booleanFlags: ['json', 'help'],
    run: (context) =>
      unimplemented(
        context,
        'documentation-index',
        'The documentation index is not implemented in this milestone. Documentation is not cached or searched, and no network update is claimed.',
      ),
  },
];

function helpText(): string {
  const lines: string[] = [];
  lines.push('assembler — deterministic software assembly');
  lines.push('');
  lines.push('Usage: assembler <command> [options]');
  lines.push('');
  for (const command of COMMANDS) {
    lines.push(`  ${command.usage}`);
    lines.push(`      ${command.description}`);
  }
  lines.push('');
  lines.push('Global options: --json (structured output), --root <dir> (assets root)');
  lines.push('');
  lines.push('Exit codes: 0 ok, 1 operation failed, 2 usage/spec/blockers, 3 capability unsatisfied, 4 not implemented');
  return lines.join('\n');
}

async function main(argv: readonly string[]): Promise<number> {
  const [commandName] = argv;
  if (commandName === undefined || commandName === '--help' || commandName === '-h' || commandName === 'help') {
    process.stdout.write(`${helpText()}\n`);
    return EXIT.ok;
  }
  if (commandName === '--version' || commandName === 'version') {
    process.stdout.write('assembler 0.1.0\n');
    return EXIT.ok;
  }

  const definition = COMMANDS.find((command) => command.name === commandName);
  if (definition === undefined) {
    throw new AssemblerError({
      code: 'USAGE_ERROR',
      message: `Unknown command: ${commandName}`,
      hint: 'Run `assembler help` to list commands.',
    });
  }

  const args = parseArgs(argv, definition.valueFlags, definition.booleanFlags);
  if (flagBoolean(args.flags, 'help')) {
    process.stdout.write(`${definition.usage}\n\n${definition.description}\n`);
    return EXIT.ok;
  }
  return definition.run({ args: { ...args, command: definition.name }, cwd: process.cwd() });
}

/** Map an error's stable code onto the documented exit-code contract. */
function exitCodeFor(error: unknown): number {
  if (isAssemblerError(error)) {
    if (error.code === 'USAGE_ERROR' || error.code === 'SPEC_INVALID' || error.code === 'FILE_MISSING') {
      return EXIT.usage;
    }
    if (error.code === 'CAPABILITY_UNSATISFIED') return EXIT.capability;
  }
  return EXIT.failure;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const json = process.argv.includes('--json');
    reportError(error, json);
    process.exitCode = exitCodeFor(error);
  });
