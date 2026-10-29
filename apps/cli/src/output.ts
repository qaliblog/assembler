import { AssemblerError, isAssemblerError } from '@assembler/core';

export interface Output {
  json: boolean;
  print(message: string): void;
  printError(message: string): void;
  result(payload: unknown, humanLines: readonly string[]): void;
}

export function createOutput(json: boolean): Output {
  return {
    json,
    print(message: string) {
      process.stdout.write(`${message}\n`);
    },
    printError(message: string) {
      process.stderr.write(`${message}\n`);
    },
    result(payload: unknown, humanLines: readonly string[]) {
      if (json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else {
        for (const line of humanLines) process.stdout.write(`${line}\n`);
      }
    },
  };
}

/** Print a failure with its stable code and optional hint. */
export function reportError(error: unknown, json: boolean): void {
  if (json) {
    const payload = isAssemblerError(error)
      ? error.toJSON()
      : { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };
    process.stderr.write(`${JSON.stringify({ error: payload }, null, 2)}\n`);
    return;
  }
  if (isAssemblerError(error)) {
    process.stderr.write(`error [${error.code}]: ${error.message}\n`);
    if (error.hint !== undefined) process.stderr.write(`hint: ${error.hint}\n`);
    const details = Object.entries(error.details);
    if (details.length > 0) {
      process.stderr.write(`details: ${JSON.stringify(error.details)}\n`);
    }
    return;
  }
  const fallback =
    error instanceof AssemblerError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(`error: ${fallback}\n`);
}
