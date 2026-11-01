# Verification report

What this repository claims, and the evidence behind each claim. Every command
below was run in this checkout on **2026-10-31** on `linux/aarch64`, Node
`18.19.1`, pnpm `9.15.4`. Where something was **not** verified, it says so.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm exec tsc -b tsconfig.build.json` | exit 0, no diagnostics, all 10 packages + CLI |
| `pnpm exec vitest run packages` | **17 files, 139 tests, all passing** |
| `pnpm exec vitest run tests/integration` | **4 files, 24 tests, all passing** (≈111 s) |
| `pnpm exec vitest run tests/e2e/assembly.test.ts tests/e2e/node-blog.test.ts` | **2 files, 11 tests, all passing** (≈191 s, real installs/builds) |
| `pnpm exec vitest run tests/e2e/cli.test.ts` | **1 file, 6 tests** — unchanged since 2026-10-30 |
| `pnpm exec vitest run tests/e2e/linked.test.ts` | **1 file, 8 tests, all passing** (≈355 s, includes `npm link` and a real build outside the repo) |
| `pnpm exec vitest run tests/tui/session.test.ts` | **1 file, 30 tests, all passing** (≈338 s) |
| direct template run in a temporary project | 38 rendered files + `package.json`/lockfile: typecheck exit 0, **48 generated tests passing**, `tsc -p tsconfig.build.json` exit 0 |
| `node apps/cli/dist/main.js interpret "Create a professional blog using Node.js …"` | exit 0; `StartupProject` primary, `DesignImprovement`/`TestProject` secondary, `node-typescript` web application |
| `curl` against the compiled generated server | `/`, `/posts`, article, category, tag, search, about, contact, feed, API, CSS all `200`; `/blog` `301`; unknown `404` |

Total: **26 test files, 221 tests** on this host. The 16 new tests are the three
new unit suites (14) and the incremental-assembly integration suite (2); the
linked and CLI suites were last run on 2026-10-30. The linked and TUI suites are
slow because they assemble real projects with a real package manager; the numbers
above are single samples, not a benchmark.

## Claims and evidence

### 1. A request becomes a validated specification, not a vibe

`packages/requirement-parser/src/interpreter.test.ts` (21 tests),
`intent.test.ts` (8 tests), `packages/project-spec/src/validation.test.ts`
(11 tests), `tests/integration/*` (22 tests).

- Every extracted fact carries provenance (`requested` / `derived` / `default` /
  `assumption`) in the requirement ledger.
- A deterministic multi-intent classifier records the matched cue text as
  evidence; it does not decide implementation. `Improve the design of my existing
  blog and fix its routes` → `UpdateProject` primary, `DesignImprovement` and
  `DebugProject` secondary, `requiresExistingProject: true`.
- Contradictions, unsupported capabilities and clarifications are first-class
  output; the specification is only `ready` when nothing blocking remains.
- The Node.js publication is recognised from either a specific phrase
  (`node.js blog`, `blog using node.js`) or the combination of a Node.js cue and a
  publication noun, so clause splitting cannot lose it.

### 2. Planning is deterministic

`tests/integration/planning.test.ts` and
`tests/integration/node-blog-planning.test.ts` plan the same specification twice
with different clocks. File paths, SHA-256 digests, component hashes, knowledge
hashes and blueprint route order are identical. Manifests are sorted by path.

### 3. The React target still compiles, tests and builds

`tests/e2e/assembly.test.ts` asserts the report's verification block is exactly
`install=true typecheck=true test=true build=true`, that all four commands exited
0, and that the published project contains `package.json`, `src/App.tsx`,
`src/pages/DashboardPage.tsx`, `index.html`, `README.md` and a real
`dist/index.html`. `tests/e2e/linked.test.ts` repeats this from a linked
installation outside the repository.

### 4. The Node.js publication is assembled and verified for real

`tests/e2e/node-blog.test.ts` runs `interpretRequirement` → `planProject` →
`assembleProject` for:

> Create a professional blog using Node.js with a dark theme, categories, search
> and tests

and checks `install`, `typecheck`, `test` and `build` all succeeded, that
`src/router/router.ts`, `src/router/routes.ts`, `src/views/styles.ts`,
`test/routes.test.ts`, `test/links.test.ts`, `README.md`, `dist/server.js`,
`dist/app.js` and `dist/router/router.js` exist, and that the published project
still matches its manifest (`{ ok: true, missing: [], unexpected: [], altered: [] }`).

The generated project itself has **no runtime dependencies**; only
`@types/node`, `typescript` and `vitest` are pinned in `devDependencies` by
`knowledge/versions.json`.

### 5. Generated routing is tested, not asserted

The publication template ships four test files (48 tests when the template was
run directly):

- `test/router.test.ts` — exact path matching (no prefix match), single-segment
  parameters, percent-decoding, malformed encoding → `400`, `HEAD` → `GET`,
  method-not-allowed with `Allow`, duplicate and structurally identical route
  registration rejected, canonical-path rules.
- `test/routes.test.ts` — every page, every article slug, unknown article,
  category index and detail, tag detail, search (match, empty, prompt, HTML
  escaping), JSON API (health/list/detail/404), unknown route → `404`,
  `POST /posts` → `405` + `Allow`, `OPTIONS` → `204`, `HEAD` → no body,
  `/posts/` → `308`, legacy `/blog` → `301`, `/category/:slug` → `301`,
  assets, RSS, security headers.
- `test/links.test.ts` — renders every page, extracts **every internal `href`**
  and fetches it; all resolve to `200`. Also asserts no `href=""`,
  `href="undefined"` or `/undefined` is ever emitted.
- `test/content.test.ts` — newest-first ordering, duplicate/empty content
  rejection, taxonomy counts, search, related posts, reading time.

The generated router is dependency-free and splits concerns: `src/router/`
(registration and matching), `src/routes/` (controllers), `src/services/`
(content), `src/views/` (HTML/RSS/CSS), `src/middleware/` (security, logging,
errors), `src/content/` (typed articles).

### 6. Publishing never destroys work

`tests/e2e/assembly.test.ts` and `tests/tui/session.test.ts`:

- non-empty target under the default policy → `OVERWRITE_DENIED`; the user's file
  remains byte-identical;
- a plan with blockers → `PLAN_INVALID`, and no target directory is created;
- target equal to the workspace root → `OVERWRITE_DENIED`;
- in-place publishing refuses conflicting files unless the user explicitly
  answers `yes`;
- non-interactive conflicts stop with `Re-run with --yes`;
- a change request against a workspace Assembler did not generate is refused with
  `NOT_GENERATED_PROJECT` and **nothing is written**.

### 7. Existing generated projects can be modified, not regenerated

`tests/integration/modification.test.ts` (5 tests), `tests/e2e/cli.test.ts`
(`modifies a generated project through the CLI …`), `tests/tui/session.test.ts`
(`applies a planned page addition …`) and
`packages/project-modifier/src/patch.test.ts` (5 tests) cover:

- **Recognition by metadata, not by directory shape.** The modifier requires
  `assembler.spec.json`, a valid specification and `assembler.manifest.json`
  declaring `src/app/routes.tsx`; an arbitrary directory with a `package.json` is
  refused with `NOT_GENERATED_PROJECT` and left byte-identical.
- **The route table is the source of truth.** Its SHA-256 is compared with the
  manifest before planning and again before applying. A file edited after planning
  stops with `MODIFICATION_CONFLICT`; the edit is preserved.
- **AST patching, not string replacement.** `patchRouteTable` parses the TSX with
  the TypeScript compiler, adds exactly one import and one entry, and keeps every
  existing route and its order. A file without a recognisable `routeEntries` array
  is refused instead of guessed at. `RequireAuth` is wrapped around sensitive
  pages only when the project already has that provider.
- **The plan is explicit.** It names the page, route, component, the three files
  to create, the two metadata files and the route table to edit, plus six tasks
  with dependencies (`inspect → create-page → create-test/update-routes →
  update-metadata → verify`), risks, acceptance criteria and blockers.
- **Unsupported changes are refused, not partially applied.** Authentication,
  databases, APIs, payments, file storage, realtime and email requests produce
  `MODIFICATION_UNSUPPORTED`; so does routing repair. Existing pages/routes are
  `PAGE_EXISTS`. The project is untouched in every one of these cases.
- **Applying is transactional.** Every touched file is copied to
  `.assembler/backups/<timestamp>/` first, the specification and manifest are
  updated, then the detected package manager runs typecheck and the project's
  `test` script. In the rollback test the test script exits 1; the report is
  `failed`, `rolledBack: true`, and the route table, specification and page files
  are byte-identical to before.
- **Verification is not skipped silently.** Passing `--no-typecheck` /
  `--no-tests` (or disabling both in the API) records
  `verification.skipped: true` and says so in the report. With verification
  requested and no `node_modules`, the modifier refuses with
  `DEPENDENCIES_MISSING` instead of claiming a verified change.
- **The result still reconciles.** After a real CLI modification, `assembler
  inspect` reports `{ ok: true, missing: [], unexpected: [], altered: [] }`.

### 8. The interactive interface exposes real operations only

`tests/tui/session.test.ts` (30 tests) drives the same interpreter, planner,
modifier and assembler the CLI uses. `/plan` writes nothing (including the
modification preview), `/debug` is read-only, `/test` runs the workspace's own
`test` script with the detected package manager, and `/help` lists exactly the
commands in `SLASH_COMMANDS`. Intent and its evidence are printed before planning.
A plain change prompt in a generated workspace switches to modification
automatically and reports the plan, the applied changes and the verification.

### 9. Unsupported requests fail loudly

- A Node.js publication request with a dashboard or authentication →
  `UNSUPPORTED_CAPABILITY` (`web.server-page`, `web.server-auth`) with a reason
  and an alternative; no `DashboardPage` is fabricated
  (`tests/integration/node-blog-planning.test.ts`).
- A FastAPI backend alongside the web app → `TARGET_NOT_IMPLEMENTED`; no
  `requirements.txt` is invented.
- End-to-end browser tests → `UNSUPPORTED_CAPABILITY`.
- `adopt`, `repair` and `docs` still exit `4` and say they are not implemented.

### 10. Design tokens are data, and the publication has its own direction

`tests/integration/node-blog-planning.test.ts` asserts the generated stylesheet
contains the editorial primary `#e2b457` and a serif stack, and that
`blueprint.design.style` is `editorial`. The editorial style is defined in
`knowledge/design.json`; the generated CSS adds a serif reading column,
responsive grids, a CSS scroll-driven reading indicator (with a reduced-motion
fallback), print styles and a strict CSP with `script-src 'none'`.

Modification reuses the project's existing tokens and components rather than
injecting a second design system: the generated page imports `PageHeader`,
`MetricCard`, `EmptyState` and its own CSS module, and the module is asserted to
exist by the integration tests.

This is **token and markup verification**, not a visual judgement. No screenshot
or visual-regression test is run.

### 11. Theming is resolved and templates are actually filled

`packages/requirement-parser/src/presets.test.ts` (5 tests),
`packages/project-planner/src/design.test.ts` (3 tests) and
`packages/template-engine/src/template-engine.test.ts` (6 tests).

- Ten named colour presets (`midnight`, `nord`, `dracula`, `solarized`, `sunset`,
  `forest`, `ocean`, `rose`, `mono`, `sand`) live in `knowledge/design.json` and
  are independent of the six styles and the dark/light/system theme. A request
  such as “a glassmorphism React dashboard with a dracula theme” keeps all three.
- A preset lands in `spec.design.preset`, is recorded in the requirement ledger,
  and owns the palette: the interpreter leaves `design.palette` empty and the
  design engine resolves the preset's palette for the active theme. Colours named
  explicitly in the request still override the preset; an unknown preset falls
  back to the style palette and is labelled `Default`.
- Two conflicting presets are a contradiction, not a silent choice.
- Templates are strict: `{{variable}}` slots are filled from planner values, and
  `{{> snippet}}` includes are composed from the template's `snippets/` directory
  before substitution. A slot that survives rendering fails the plan
  (`PLAN_INVALID`) instead of shipping `{{placeholder}}` text. Both React and
  Node.js templates compose their token block from a snippet.
- Generated code contains the resolved values: `tokens.css` / `styles.ts` record
  style, preset and theme, `index.html` carries `data-theme` and `data-preset`,
  the layout footer names the palette, and the generated README documents it.

### 12. Files are written incrementally and kept on failure

`tests/integration/incremental-assembly.test.ts` (2 tests) drives the real
planner and assembler:

- every planned file is written to the target workspace as it is generated, before
  installation or any verification command; `onFile` reports each one with its
  index and total, and the report's `filesWritten` is the real count;
- cancelling after two files leaves exactly those two files on disk, keeps the
  report status `cancelled`, `published: true` and adds a note that the generated
  files were kept. Nothing already generated is rolled back because a later step
  failed.

### 13. The registry does not overclaim

`packages/component-registry/src/registry.test.ts` (10 tests) and the CLI suite
cover indexing, search, deprecation and structural verification. Verification is
structural: manifest shape, source hashes, exports and declared dependencies. It
does not execute component tests.

`knowledge/versions.json` previously claimed verification by
`tests/e2e/web-assembly.test.ts` and `tests/e2e/backend-assembly.test.ts`, neither
of which exists. Those references are corrected: React points at
`tests/e2e/assembly.test.ts`; the pinned `backend-node` entry is marked
`unverified` because no backend target is implemented.

## Not verified (and therefore not claimed)

- **Modification is deliberately narrow.** Only `react-web` projects generated by
  Assembler can be modified, and only by adding one page. The Node.js publication
  cannot be modified. Authentication, databases, APIs, payments, storage,
  realtime, email and routing repair are refused with
  `MODIFICATION_UNSUPPORTED`. `adopt` and `repair` remain
  read-only/unimplemented.
- **The publication has no accounts, admin UI, database or contact form.** Those
  requests are reported as unsupported.
- **No browser-based visual verification.** Responsive behaviour is checked by
  CSS/media-query presence and HTTP-rendered markup, not by screenshots,
  layout overflow measurement, axe or Lighthouse. The page the modifier adds is
  not visually reviewed automatically.
- **No automated accessibility audit.** Semantic landmarks, skip links, labels,
  focus styles and reduced-motion support are generated, but no audit runs.
- **No React Native, Expo or Android target.** Only `react-web` and `node-blog`
  exist. Gradle/ADB/APK workflows and mobile project detection from the upgrade
  request are **not implemented**; mobile targets are still reported as
  `TARGET_NOT_IMPLEMENTED`.
- **No resume checkpoint yet.** Generated files survive a failure, but a re-run
  re-plans and rewrites the project rather than resuming from a task log.
- **Windows and macOS are untested.** Linux aarch64 was exercised; path handling
  and process spawning remain POSIX-oriented.
- **No network documentation index** and no automatic knowledge refresh; versions
  and design tokens are pinned by hand.
- **No LLM anywhere in the pipeline.**
- **No large-scale performance benchmark.** Timings above are single samples from
  this host. A modification plan is in-memory; applying it costs one typecheck and
  one test run of the target project.

## Reproduce it

```bash
pnpm install
pnpm exec tsc -b tsconfig.build.json
pnpm exec vitest run packages
pnpm exec vitest run tests/integration
pnpm exec vitest run tests/e2e/node-blog.test.ts
pnpm exec vitest run tests/tui/session.test.ts
```

For a manual publication build:

```bash
mkdir /tmp/blog && cd /tmp/blog
node /path/to/assembler/bin/assembler.js \
  "Create a professional blog using Node.js with categories, search and tests"
```

For a manual modification of a generated React project:

```bash
node /path/to/assembler/bin/assembler.js modify "Add an admin dashboard" --dry-run
node /path/to/assembler/bin/assembler.js modify "Add an admin dashboard"
```
