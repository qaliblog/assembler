# Verification report

What this repository claims, and the evidence behind each claim. Every command
below was run in this checkout on 2026-10-29 on `linux/arm64`, Node `18.19.1`,
pnpm `9.15.4`. Where something was **not** verified, it says so.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm run typecheck` (`tsc -b tsconfig.build.json`) | exit 0, no diagnostics, all 9 packages + CLI |
| `pnpm test` (`vitest run`) | **15 files, 136 tests, all passing**, 219 s |
| `node apps/cli/dist/main.js doctor` | exit 0; capabilities listed below |
| `pnpm exec vitest run tests/e2e/assembly.test.ts` | 8/8 passing; builds a real project |
| `pnpm exec vitest run tests/e2e/cli.test.ts` | 8/8 passing; drives the CLI as a user would |

## Claims and evidence

### 1. A request becomes a validated specification, not a vibe

`tests/integration/planning.test.ts`, `packages/requirement-parser/src/interpreter.test.ts`
(17 tests), `packages/project-spec/src/validation.test.ts` (11 tests).

- Every extracted fact carries provenance (`requested` / `derived` / `default` /
  `assumption`), recorded in the requirement ledger.
- Contradictions, unsupported capabilities and clarifications are first-class
  output; the specification is only `ready` when nothing blocking remains.
- Schema and semantic validation reject incoherent specs (`SPEC_INVALID`) rather
  than repairing them silently.

### 2. Planning is deterministic

`tests/integration/planning.test.ts` → "produces identical file content on repeated
planning": two plans of the same spec, with different clocks, yield identical
`(path, sha256)` digests and identical knowledge hashes. File order in the manifest
is sorted, so plans diff cleanly.

### 3. Generated files actually compile, pass their tests and build

`tests/e2e/assembly.test.ts` runs `assembleProject` against a temporary workspace.
It asserts the report's verification block is exactly:

```
install=true typecheck=true test=true build=true
```

and that all four commands exited 0. The published project is then checked for
`package.json`, `src/App.tsx`, `src/pages/DashboardPage.tsx`, `index.html`,
`README.md` and a real `dist/index.html` containing the mount point.

This is the honest end of the pipeline: the generated project is not merely written,
it is installed from `knowledge/versions.json` pins, typechecked, tested with
Vitest and bundled with Vite.

### 4. Publishing is all-or-nothing and refuses to destroy work

`tests/e2e/assembly.test.ts` (safety block):

- non-empty target with the default `deny` policy → `OVERWRITE_DENIED`, and the
  user's file is still present, byte-identical;
- a plan carrying blockers → `PLAN_INVALID`, and no target directory is created;
- target equal to the workspace root → `OVERWRITE_DENIED`;
- `--no-install` writes and publishes files without inventing `node_modules`, and
  the assembly says which steps it skipped instead of reporting a false failure.

Staging is reconciled against the manifest **before** any command runs, so a
generated file that does not match its declared hash stops the build.

### 5. Unsupported requests fail loudly

`tests/integration/planning.test.ts`:

- "…and a separate FastAPI backend" → blocker `TARGET_NOT_IMPLEMENTED`, the
  unresolved target is listed, and no `requirements.txt` is fabricated;
- "end-to-end tests" → blocker `UNSUPPORTED_CAPABILITY`.

`adopt`, `repair` and `docs` exit `4` and say they are not implemented
(`tests/e2e/cli.test.ts`). `adopt` performs analysis only and modifies nothing.

### 6. The CLI is usable and its exit codes mean something

`tests/e2e/cli.test.ts` spawns the built binary and checks: help, interpret →
plan → build → inspect round trip, refusal of a non-empty target, `2` for unknown
commands/flags and a missing specification, `4` for unimplemented features,
registry sync/search/verify, and `history` showing the recorded build.

### 7. The registry does not overclaim

`packages/component-registry/src/registry.test.ts` (10 tests) and
`tests/e2e/cli.test.ts` cover indexing, search, deprecation and verification.
Verification is **structural**: manifest shape, source hashes, exports, declared
dependencies. It does not run the component's tests, and the report exposes
`claimsTested` and a verification level so a caller can tell the difference.

## Environment as measured by `doctor`

```
Host: linux/arm64 node 18.19.1
satisfied: filesystem.write, network.https, node.runtime, node.package-manager,
           javascript.web.build, python.runtime, git.repository,
           android.jdk, android.sdk
unknown:   python.pytest, android.platform, android.build-tools,
           android.gradle, android.apk.build
missing:   yarn, gradle
```

Host facts are reported as detected; `unknown` is used where the toolchain cannot
be confirmed, and no Android or Python build is claimed on the strength of it.

## Not verified (and therefore not claimed)

- **No non-web target exists.** Only the `react-web` template is implemented.
  There is no backend, mobile or desktop generator in this codebase.
- **No modification of existing projects.** `adopt` and `repair` are unimplemented;
  only analysis (`analyze`, `debug`) runs against existing code.
- **No execution-level component verification.** `registry verify` is static, and
  no separate component test harness is run.
- **No LLM in the loop.** Interpretation is lexicon- and rule-based.
- **Windows is untested.** Only Linux was exercised.
- **No network documentation index** and no automatic knowledge refresh; versions
  are pinned in `knowledge/versions.json` and updated by hand.
- **No large-scale performance claims.** The e2e build takes ~110 s end-to-end on
  this host (install dominates); this is a single sample, not a benchmark.

## Reproduce it

```bash
pnpm install
pnpm run typecheck
pnpm test
node apps/cli/dist/main.js doctor
```
