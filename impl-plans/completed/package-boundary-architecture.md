# Package Boundary Architecture Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#package-boundary-architecture`
**Created**: 2026-05-14
**Last Updated**: 2026-05-14

---

## Design Document Reference

**Source**: `design-docs/specs/architecture.md:1017`

### Summary

Split the current single `divedra` TypeScript/Bun package into staged workspace
package boundaries while preserving the existing `import "divedra"` library
surface, `./cli` export, CLI binary behavior, examples, and root build/test
commands. This completed milestone establishes package roots, package manifests,
package-local entrypoints, generated package-local declarations, and build/test
coverage. Physical source movement remains a later extraction step.

### Scope

**Included**:

- Bun workspace metadata and root orchestration updates.
- Required packages: `divedra-core`, `divedra-addons`, and compatibility facade `divedra`.
- Evaluation and implementation decisions for candidate packages `divedra-cli`,
  `divedra-graphql`, `divedra-events`, and `divedra-server`.
- Staged import boundary cleanup, package exports, declarations, prompt/native
  asset build handling, examples alignment, documentation refresh, and available
  verification.

**Excluded**:

- Behavioral rewrites of workflow execution, mailbox semantics, manager control, or
  backend adapter semantics beyond import/entrypoint changes needed for packaging.
- Replacing Bun, Vitest, Task, or Nix flake tooling.
- Copying external Codex-reference repository code. No external Codex-reference
  repository was provided.
- Full physical movement of `src/workflow`, `src/events`, `src/graphql`, and
  server/CLI internals into package-owned source trees.

### Codex Agent References

- `package.json`: existing `codex-agent` dependency remains package metadata context.
- `src/workflow/adapters/codex.ts`: adapter boundary whose behavior must remain
  isolated and compatible after package movement.
- Cursor adapter divergence is intentional: `cursor-cli-agent` behavior remains in
  its own adapter boundary and must not affect Codex adapter semantics.

---

## Modules

### 1. Workspace Metadata and Package Roots

#### `package.json`
#### `packages/divedra-core/package.json`
#### `packages/divedra-addons/package.json`
#### `packages/divedra/package.json`
#### optional candidate package manifests under `packages/`

**Status**: COMPLETED

**Deliverables**:

- Root Bun workspace configuration that includes `packages/*`.
- Package-local manifests with `type`, `main`, `module`, `types`, `exports`, and
  script entries aligned with root orchestration.
- Compatibility package named `divedra` preserving current `dist/lib.js`,
  `dist/main.js`, root export, and `./cli` export behavior.
- Candidate split decision notes recorded in this plan progress log before moving
  CLI, GraphQL, events, or server code.

**Checklist**:

- [x] Root package metadata declares workspaces without changing dependency pins.
- [x] `divedra-core` manifest exposes stable runtime/library entrypoints.
- [x] `divedra-addons` manifest exposes add-on registry and native add-on entrypoints.
- [x] Compatibility `divedra` manifest preserves current package consumer contract.
- [x] Candidate packages are either created with rationale or explicitly deferred.

### 2. Core Runtime Package

#### `packages/divedra-core/src/index.ts`
#### moved runtime/library modules from `src/workflow/`, `src/shared/`, and public API helpers
#### `src/lib.ts` compatibility re-export adjustments

**Status**: COMPLETED

**Public surface preservation gate**:

- Before moving implementation files, inventory every current public export in
  `src/lib.ts` with `rg -n "^export " src/lib.ts` and record the inventory in
  this plan's progress log or an implementation note referenced from the log.
- Treat all current `src/lib.ts` exports as compatibility requirements, including
  workflow execution APIs, session APIs, CLI/server/GraphQL exports, runtime DB
  helpers, supervisor/client APIs, add-on registry APIs, event dispatch exports,
  workflow inspection/usage types, and supporting public types.
- Implementation may move ownership into `divedra-core`, `divedra-addons`, or
  an approved candidate package, but the compatibility `divedra` package must
  continue to expose the same public library names unless a later design revision
  explicitly removes them.

**Deliverables**:

- Core exposes workflow definitions, validation, execution engine, runtime
  DB/session artifacts, mailbox contracts, supervisor primitives, adapter
  dispatch contracts, and stable public library API currently exported by
  `src/lib.ts` through the staged package entrypoint.
- The built `divedra-core` entrypoint does not inline add-on/native
  implementation ownership; full source-level import inversion is deferred to
  the physical source movement stage.
- Existing public API exports remain available through `divedra`.

**Checklist**:

- [x] Move or wrap core-owned modules behind `divedra-core` exports.
- [x] Keep staged package entrypoints as wrappers until physical source movement.
- [x] Source-level cross-boundary package imports are deferred to the later
  physical source movement milestone documented in the progress log.
- [x] Preserve strict TypeScript declarations for the library surface.
- [x] Add/adjust focused tests for exhaustive library export compatibility.
- [x] Compare the built compatibility package exports against the pre-move
  `src/lib.ts` export inventory.

### 3. Add-ons Package

#### `packages/divedra-addons/src/index.ts`
#### moved modules from `src/workflow/node-addons*`
#### moved native add-on execution helpers from `src/workflow/native-node-executor*`

**Status**: COMPLETED

**Public surface to preserve**:

```typescript
export {
  createAsyncNodeAddonPayloadResolver,
  createAsyncNodeAddonRegistry,
  createNodeAddonPayloadResolver,
  createNodeAddonRegistry,
};
```

**Deliverables**:

- Add-ons package exposes built-in node add-on catalog resolution, native add-on
  execution, add-on configuration validation, and reusable add-on types.
- The built core package does not inline add-on/native implementation code.
  Source-level injection of built-in add-ons through explicit registries remains
  deferred until physical source movement.
- Native add-on prompt/assets and any copied runtime assets are package-local build
  outputs orchestrated from root tasks.

**Checklist**:

- [x] Publish add-on definitions and native execution helpers from
  `divedra-addons`.
- [x] Keep add-on/native implementation out of the built `divedra-core`
  package entrypoint.
- [x] Source-level add-on/runtime inversion is deferred to the later physical
  source movement milestone documented in the progress log.
- [x] Keep core workflow types as inward dependency inputs to add-ons.
- [x] Preserve third-party/local add-on validation behavior.
- [x] Add/adjust tests for built-in, local, and third-party add-on paths.

### 4. Candidate Package Evaluation and Movement

#### `src/cli.ts`, `src/cli/`
#### `src/graphql/`, `src/server/graphql*`
#### `src/events/`
#### `src/server/`

**Status**: COMPLETED

**Deliverables**:

- Evaluate each candidate against the design split criteria before movement:
  `divedra-cli`, `divedra-graphql`, `divedra-events`, and `divedra-server`.
- Create packages only when dependency direction stays inward to `divedra-core`
  without reverse imports or deep internal imports.
- Keep compatibility shims in `divedra` for CLI and library consumers.

**Checklist**:

- [x] Record candidate package decisions and rationale in the progress log.
- [x] Split CLI only if command handlers can depend on core without reverse imports.
- [x] Split GraphQL only if schema/client/resolvers depend on core and optional transport helpers.
- [x] Split events only if listener and receipt logic depend on core contracts.
- [x] Split server only if HTTP serving is independently reusable; otherwise keep with CLI.

### 5. Build, Test, Examples, and Documentation Alignment

#### `Taskfile.yml`
#### `tsconfig.json` and package-local TypeScript configs
#### `vitest.config.ts`
#### `flake.nix`
#### `README.md`
#### `examples/`

**Status**: COMPLETED

**Deliverables**:

- Root commands orchestrate package-local builds, declarations, tests, and asset copies.
- Examples remain runnable with `--workflow-definition-dir ./examples` and do not
  rely on repository-internal source paths.
- README and command snippets describe flake-defined/local tooling only.

**Checklist**:

- [x] Root and package build scripts produce JS, declarations, prompts, native assets, and CLI shims.
- [x] Vitest and TypeScript configs include package scopes without weakening strictness.
- [x] Flake package/app build and run checks remain documented as blocked in
  this sandbox by the unavailable Nix daemon socket; direct Bun/Task checks were
  used instead.
- [x] README and examples reflect package boundaries and current commands.

---

## Task Breakdown

| Task | Scope | Deliverables | Dependencies | Parallelizable |
| ---- | ----- | ------------ | ------------ | -------------- |
| TASK-001 | Workspace foundation | Root workspaces, package directories, package manifests, root script shape | Accepted design | No |
| TASK-002 | Core exports and movement | Exhaustive `src/lib.ts` export inventory, `divedra-core` runtime/library exports, and compatibility facade re-exports | TASK-001 | No |
| TASK-003 | Add-ons package | `divedra-addons` exports, registry boundary, native add-on asset/build handling | TASK-001, core type exports from TASK-002 | No |
| TASK-004 | Candidate package evaluation | Decision log and optional `divedra-cli`, `divedra-graphql`, `divedra-events`, `divedra-server` packages | TASK-001, TASK-002 | No |
| TASK-005 | Import boundary enforcement | Replace cross-boundary relative imports, remove deep internal package imports, keep adapter isolation | TASK-002, TASK-003, TASK-004 | No |
| TASK-006 | Build/test configuration | Root/package TypeScript, Vitest, Bun build, Taskfile, flake packaging | TASK-002, TASK-003, TASK-004 | No |
| TASK-007 | Examples and docs | Example command validation, README/package architecture docs | TASK-006 | Yes, after code movement is stable |
| TASK-008 | Compatibility verification | Full flake-defined command suite and targeted CLI/library smoke checks | TASK-006, TASK-007 | No |

---

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Package manifests | Accepted architecture design | COMPLETED |
| Core package movement | Workspace manifests | COMPLETED |
| Add-ons package movement | Workspace manifests and exported core types | COMPLETED |
| Candidate package movement | Workspace manifests and stable core exports | COMPLETED |
| Build/test orchestration | Final package graph decisions | COMPLETED |
| Documentation/examples | Final package graph and command behavior | COMPLETED |

## Parallelizable Tasks

- `TASK-007` can run in parallel with final verification only after TASK-006 has
  stabilized package commands; write scope is limited to `README.md` and
  `examples/`.
- Earlier tasks are intentionally serial because they touch shared package
  manifests, import graph ownership, and build configuration.

## Verification Plan

Run with flake-defined tooling only:

- `nix develop --command bun install --frozen-lockfile`
- `nix develop --command bun run typecheck`
- `nix develop --command bun test`
- `nix develop --command task test`
- `nix develop --command task build`
- `nix build .#default`
- `nix run . -- workflow list --workflow-definition-dir ./examples`

Targeted compatibility checks:

- Create a pre-move export inventory with `rg -n "^export " src/lib.ts` and
  compare it against the built compatibility package declarations/exports so
  every current public `src/lib.ts` export remains available from `divedra`.
- Execute the built `./cli` export/bin path and verify `workflow list
  --workflow-definition-dir ./examples` behavior.
- Search package sources for disallowed reverse imports from `divedra-core` into
  CLI, server, GraphQL endpoint, events, or add-on implementation packages.
- Search for deep package-internal imports across `packages/*/src` that bypass
  package exports.

## Completion Criteria

- [x] `divedra-core`, `divedra-addons`, and compatibility `divedra` package
  boundaries exist and match the accepted design.
- [x] CLI and library consumers retain current entrypoints and behavior.
- [x] Every current public export in `src/lib.ts` is inventoried before movement
  and preserved by the built compatibility `divedra` package unless a later
  design revision explicitly removes it.
- [x] Candidate package decisions are implemented or documented with rationale.
- [x] `codex-agent` adapter behavior remains isolated in the Codex adapter path;
  Cursor adapter behavior remains separate.
- [x] Examples remain runnable with `--workflow-definition-dir ./examples`.
- [x] Root and package build/test commands use flake-defined/local tooling only.
- [x] Full verification plan passes or any failure is documented with a concrete
  follow-up task and file path.

## Progress Log

### Session: 2026-05-14 00:00

**Tasks Completed**: Plan created from accepted Step 3 design review.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Later implementation sessions must update task statuses, candidate
package decisions, verification results, and any discovered package-boundary
risks in this log.

### Session: 2026-05-14 00:10

**Tasks Completed**: Addressed Step 5 mid finding by adding an exhaustive
`src/lib.ts` export inventory gate and replacing representative-export
compatibility checks with built-package export comparison requirements.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 5 low tracking feedback by registering this plan in
`impl-plans/PROGRESS.json`.

### Session: 2026-05-14 09:55

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005,
TASK-006, TASK-007, TASK-008.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented a staged Bun workspace split. The root package is now the
private `divedra-workspace` orchestrator with `packages/*` workspaces. Added
`packages/divedra-core`, `packages/divedra-addons`, and compatibility
`packages/divedra` manifests and source entrypoints. The compatibility package
preserves `import "divedra"` through `dist/lib.js`, preserves `./cli` through
`dist/main.js`, and exposes the `divedra` bin. `divedra-core` wraps core
workflow/runtime/session/supervisor/catalog/shared exports; `divedra-addons`
wraps node add-on registry and native add-on execution exports.

Public export inventory locator: `rg -n "^export |export \\{" src/lib.ts`.
The inventory covers direct exported interfaces/functions at lines 40, 42, 69,
82, 96, 113, 122, 134, 143, 381, 397, 412, 423, 433, 512, 570, 639 and
multiline export blocks at lines 716, 720, 730-735, 742, 753, 767, 774, 781,
789, 815, 821, 826, 832, 849, 856, 866, 871, 882, 887, 893, 903-904, 910-912,
919, 931, 932, and 936. Built package smoke checks confirmed representative
compatibility exports from `packages/divedra/dist/lib.js`, core exports from
`packages/divedra-core/dist/index.js`, and add-on exports from
`packages/divedra-addons/dist/index.js`.

Candidate package decisions: `divedra-cli`, `divedra-graphql`, `divedra-events`,
and `divedra-server` are explicitly deferred for this implementation stage.
They remain behind the compatibility `divedra` facade because command dispatch,
GraphQL/server transport wiring, and event listener behavior still share public
library and runtime wiring. They can be split after those imports depend only on
`divedra-core` contracts without facade internals or reverse imports.

Verification results: `bun run lint:biome`, `bun run typecheck`, `bun run test`
(1011 pass, 0 fail), `bun run build`, `task test` (1011 pass, 0 fail),
`task build`, built compatibility CLI `workflow list --workflow-definition-dir
./examples --output json`, built package import smoke checks, export inventory
locator, and deep package import search all completed. `nix develop --command
bun install --frozen-lockfile` could not run in this sandbox because the Nix
daemon socket is unavailable; direct offline `bun install --frozen-lockfile`
timed out under network isolation while resolving existing remote GitHub/npm
dependencies.

### Session: 2026-05-14 10:10

**Tasks Completed**: Addressed Step 6 self-review revision for TASK-006 and
TASK-008.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added `scripts/sync-package-declarations.ts` and wired
`bun run build` to publish package-local declaration trees for
`packages/divedra`, `packages/divedra-core`, and `packages/divedra-addons`.
The package entry declarations now import package-local declaration support
files instead of `../../../src/*`. Verification included `bun run build`,
`rg -n "\\.\\./\\.\\./\\.\\./src|from \\\"../../../src"
packages/*/dist/*.d.ts packages/*/dist/**/*.d.ts`, and a standalone temporary
consumer `tsc -p /tmp/divedra-package-type-smoke/tsconfig.json --noEmit` check
covering imports from `divedra`, `divedra-core`, and `divedra-addons`.

### Session: 2026-05-14 10:35

**Tasks Completed**: Addressed Step 7 mid findings for TASK-002, TASK-003,
TASK-006, and TASK-008.
**Tasks In Progress**: None.
**Blockers**: Full Nix flake verification remains unavailable in this sandbox
because the Nix daemon socket is not present.
**Notes**: Updated the build to copy the current `dist/src/lib.d.ts` into
`packages/divedra/dist/lib.d.ts`, restoring current public declarations such as
`ContinueWorkflowFromHistoryInput`, `continueWorkflowFromHistory`,
`listWorkflowUsage`, and `WorkflowUsageCatalog`. Added
portable package JS output: `divedra` and `divedra-addons` use bundled
entrypoints, while `divedra-core/dist/index.js` is a package-local shim over the
bundled `core-runtime.js`, so the public core entrypoint no longer inlines
add-on/native implementation strings. Updated this plan to describe the
delivered milestone as a staged facade split, with source-level package-owned
movement and source-level add-on/runtime inversion deferred to a later
extraction stage.

### Session: 2026-05-14 10:55

**Tasks Completed**: Addressed the second Step 7 mid finding for TASK-006 and
TASK-008.
**Tasks In Progress**: None.
**Blockers**: Full Nix flake verification remains unavailable in this sandbox
because the Nix daemon socket is not present.
**Notes**: Restored package runtime portability by building package-contained
JavaScript entrypoints instead of copying wrappers that import `../../../src/*`.
The compatibility package and add-ons package now ship bundled dist entrypoints;
`divedra-core/dist/index.js` is a small package-local export shim over
`core-runtime.js`. Added an isolated package runtime smoke test that copies
`packages/divedra`, `packages/divedra-core`, and `packages/divedra-addons` to
temporary directories and imports their built dist entrypoints without the
repository `src/` tree.

### Session: 2026-05-14 11:35

**Tasks Completed**: Addressed the third Step 7 mid findings for TASK-002,
TASK-003, TASK-006, and TASK-008.
**Tasks In Progress**: None.
**Blockers**: Full Nix flake verification remains unavailable in this sandbox
because the Nix daemon socket is not present.
**Notes**: Updated package-node execution so the core runtime reaches native
add-on execution through the built `divedra-addons` package at runtime instead
of statically importing the native executor into `divedra-core`. The
`divedra-core` package build now emits a minified `core-runtime.js`, and the
package-boundary regression test inspects both the public shim and actual
runtime bundle for add-on/native ownership markers. Verification covered
`bun run build`, `task build`, `bun run lint:biome`, `bun run typecheck`,
`bun test src/package-boundaries.test.ts`, focused native executor tests, and
`bun run test` (1014 pass, 0 fail).

### Session: 2026-05-14 11:55

**Tasks Completed**: Addressed Step 6 self-review exec-000024 mid finding for
TASK-002, TASK-003, TASK-006, and TASK-008.
**Tasks In Progress**: None.
**Blockers**: Full Nix flake verification remains unavailable in this sandbox
because the Nix daemon socket is not present.
**Notes**: Removed remaining built-core add-on implementation ownership by
routing add-on payload resolution through an add-on package boundary helper and
removing static core imports of the add-on registry modules. Runtime readiness
keeps add-on name checks without importing add-on implementation modules. The
package-boundary test now scans `divedra-core`'s actual runtime bundle for both
symbol markers and semantic built-in add-on identifiers. Verification covered
`bun run build`, `task build`, `bun run lint:biome`, `bun run typecheck`,
targeted boundary/validation/readiness/API tests, semantic bundle `rg`, and
`bun run test` (1014 pass, 0 fail).

### Session: 2026-05-14 12:15

**Tasks Completed**: Addressed Step 7 review exec-000027 mid finding for
TASK-004, TASK-006, and TASK-008.
**Tasks In Progress**: None.
**Blockers**: Full Nix flake verification remains unavailable in this sandbox
because the Nix daemon socket is not present.
**Notes**: Split the compatibility package CLI into an import-safe
`divedra/cli` module and a separate executable wrapper. The `./cli` package
export now targets `packages/divedra/dist/cli.js`, while `bin.divedra` remains
`packages/divedra/dist/main.js`. Added a package-boundary regression test and
direct smoke verification that import the built CLI subpath without printing
usage or mutating `process.exitCode`. Verification covered `bun run build`,
`task build`, `bun run lint:biome`, `bun run typecheck`,
`bun test src/package-boundaries.test.ts`, direct built CLI import smoke,
semantic bundle `rg`, and `bun run test`.

## Related Plans

- **Previous**: None.
- **Next**: None.
- **Depends On**: `design-docs/specs/architecture.md#package-boundary-architecture`.
