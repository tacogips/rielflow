# Scoped Local Add-ons Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#scoped-local-add-on-roots
**Created**: 2026-04-21
**Last Updated**: 2026-04-21

---

## Design Document Reference

**Source**:

- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `design-docs/specs/design-user-scope-workflows.md`

### Summary

Implement manifest/template add-ons installed under project and user scope
`addons/` directories. Local add-ons should resolve after built-in
`divedra/*` add-ons, before host-provided resolver functions, and must
materialize ordinary node payloads without executing add-on package code during
workflow load or validation.

### Scope

**Included**: add-on root resolution, safe `(name, version)` path lookup,
`addon.json` manifest parsing, manifest schema validation, payload-template
materialization, loader/validator integration, CLI/env forwarding, and tests.

**Excluded**: executable local add-on packages, package downloads, add-on
lockfiles, registry discovery, full scope config file support, and trusted
third-party native `nodeType: "addon"` executor registration.

---

## Modules

### 1. Add-on Catalog Types And Roots

#### src/workflow/types.ts

#### src/workflow/catalog.ts

**Status**: COMPLETED

```typescript
export interface LoadOptions {
  readonly addonRoot?: string;
}

export type AddonSourceScope = "direct" | "project" | "user";

export interface ResolvedAddonSource {
  readonly scope: AddonSourceScope;
  readonly addonRoot: string;
  readonly addonName: string;
  readonly version: string;
  readonly addonDirectory: string;
  readonly manifestPath: string;
  readonly scopeRoot?: string;
}

export interface AddonCatalogFailure {
  readonly code:
    | "INVALID_ADDON_NAME"
    | "INVALID_ADDON_VERSION"
    | "NOT_FOUND"
    | "IO";
  readonly message: string;
}

export function isSafeAddonName(name: string): boolean;
export function isSafeAddonVersion(version: string): boolean;

export async function resolveAddonSource(input: {
  readonly addon: WorkflowNodeAddonRef;
  readonly workflowSource?: ResolvedWorkflowSource;
  readonly options?: LoadOptions;
}): Promise<Result<ResolvedAddonSource, AddonCatalogFailure>>;
```

**Checklist**:

- [x] Add `addonRoot` to shared load/options surfaces
- [x] Add safe add-on name and version validation helpers
- [x] Resolve direct add-on root from `--addon-root` / `DIVEDRA_ADDON_ROOT`
- [x] Resolve owning-scope, project-scope, and user-scope add-on candidates
- [x] Preserve `divedra/` built-in namespace behavior without filesystem lookup
- [x] Unit tests for lookup order, shadowing, and unsafe path rejection

### 2. Local Add-on Manifest Loader

#### src/workflow/local-node-addons.ts

**Status**: COMPLETED

```typescript
export interface LocalNodeAddonManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly allowedRoles: readonly ["worker"];
  readonly resolution: LocalNodeAddonResolutionTemplate;
  readonly configSchema?: JsonObject;
  readonly envSchema?: JsonObject;
  readonly inputSchema?: JsonObject;
}

export interface LocalNodeAddonResolutionTemplate
  extends Readonly<Record<string, unknown>> {
  readonly kind: "node-payload-template";
  readonly nodeType?: "agent" | "command" | "container" | "user-action";
}

export async function loadLocalNodeAddonManifest(
  source: ResolvedAddonSource,
): Promise<Result<LocalNodeAddonManifest, LoadFailure>>;

export async function resolveLocalNodeAddonPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
  readonly source: ResolvedAddonSource;
}): Promise<NodeAddonResolveResult>;
```

**Checklist**:

- [x] Parse `addon.json` as a manifest object
- [x] Verify manifest `name` and `version` match the resolved path
- [x] Validate manifest schemas with existing JSON schema helpers
- [x] Validate `addon.config`, `addon.inputs`, and `addon.env`
- [x] Resolve `*TemplateFile` fields relative to the add-on version directory
- [x] Reject template paths escaping the add-on version directory
- [x] Produce ordinary node payloads only

### 3. Resolver Composition Integration

#### src/workflow/node-addons.ts

#### src/workflow/validate.ts

#### src/workflow/load.ts

**Status**: COMPLETED

```typescript
export async function resolveNodeAddonPayloadAsync(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
  readonly workflowSource?: ResolvedWorkflowSource;
  readonly options?: LoadOptions;
  readonly thirdPartyResolvers?: readonly AsyncNodeAddonPayloadResolver[];
}): Promise<NodeAddonResolveResult>;
```

**Checklist**:

- [x] Keep built-in `divedra/*` resolution first
- [x] Try scoped local add-on manifests before host-provided resolvers
- [x] Keep sync validation behavior explicit when local manifest resolution needs async loading
- [x] Normalize local payloads through ordinary node payload validation
- [x] Reject local payloads with runtime-owned `nodeType: "addon"` or `addon`
- [x] Preserve host-provided resolver behavior and error messages

### 4. CLI, Library, GraphQL, And Event Wiring

#### src/cli.ts

#### src/lib.ts

#### src/graphql/schema.ts

#### src/events/trigger-runner.ts

**Status**: COMPLETED

```typescript
interface ParsedOptions {
  readonly addonRoot?: string;
}

interface WorkflowSourceJson {
  readonly scope: WorkflowSourceScope;
  readonly workflowDirectory: string;
}

interface AddonSourceJson {
  readonly scope: AddonSourceScope;
  readonly manifestPath: string;
  readonly name: string;
  readonly version: string;
}
```

**Checklist**:

- [x] Parse `--addon-root`
- [x] Forward `DIVEDRA_ADDON_ROOT` through shared load options
- [x] Forward add-on root options through library execution and inspection
- [x] Forward add-on root options through GraphQL validation/save/execution
- [x] Forward add-on root options through local event dispatch
- [x] Include local add-on source metadata in inspect/validation output where available

### 5. Regression Coverage

#### src/workflow/load.test.ts

#### src/cli.test.ts

#### src/graphql/schema.test.ts

#### src/lib.test.ts

**Status**: COMPLETED

```typescript
test("resolves user-scope local add-on manifests", async () => {
  // Loads a workflow whose non-divedra add-on resolves from ~/.divedra/addons.
});

test("project-scope local add-on shadows user-scope add-on by exact version", async () => {
  // Verifies (name, version) lookup precedence and fallback behavior.
});
```

**Checklist**:

- [x] User-scope local add-on load test
- [x] Project-scope local add-on shadowing test
- [x] Direct `--addon-root` compatibility test
- [x] Unsafe add-on name/version/path tests
- [x] CLI validation/inspection tests
- [x] GraphQL validation test
- [x] Library execution or inspection test

---

## Module Status

| Module                           | File Path                                                                                       | Status    | Tests                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| Add-on catalog types and roots   | `src/workflow/types.ts`, `src/workflow/catalog.ts`                                              | COMPLETED | `src/workflow/load.test.ts`                                                                     |
| Local add-on manifest loader     | `src/workflow/local-node-addons.ts`                                                             | COMPLETED | `src/workflow/load.test.ts`                                                                     |
| Resolver composition integration | `src/workflow/node-addons.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`               | COMPLETED | `src/workflow/load.test.ts`                                                                     |
| CLI/library/GraphQL/event wiring | `src/cli.ts`, `src/lib.ts`, `src/graphql/schema.ts`, `src/events/trigger-runner.ts`             | COMPLETED | `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/lib.test.ts`                              |
| Regression coverage              | `src/workflow/load.test.ts`, `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/lib.test.ts` | COMPLETED | `src/workflow/load.test.ts`, `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/lib.test.ts` |

## Dependencies

| Feature                    | Depends On                                             | Status    |
| -------------------------- | ------------------------------------------------------ | --------- |
| Scoped local add-ons       | `scoped-workflow-catalog-safety-follow-up`             | Available |
| Add-on source display      | Scoped local add-ons                                   | BLOCKED   |
| Executable add-on packages | Scoped local add-ons plus future trust/lockfile design | BLOCKED   |

## Completion Criteria

- [x] Non-`divedra/` add-ons can resolve from project and user `.divedra/addons`
- [x] Built-in `divedra/*` add-ons never resolve from filesystem roots
- [x] Project add-ons shadow user add-ons by exact `(name, version)`
- [x] `--addon-root` and `DIVEDRA_ADDON_ROOT` work as direct add-on-root overrides
- [x] Local manifests materialize ordinary node payloads only
- [x] Manifest and template paths cannot escape the add-on version directory
- [x] Type checking passes
- [x] Focused tests pass

## Progress Log

### Session: 2026-04-21 10:40

**Tasks Completed**: Plan created.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Existing scoped-workflow plans cover workflow catalog behavior and
explicitly exclude local add-on manifests. This plan covers the add-on portion
of the scoped design.

### Session: 2026-04-21 14:10

**Tasks Completed**: TASK-001, TASK-002, TASK-003; TASK-004 mostly complete;
TASK-005 partially complete.
**Tasks In Progress**: TASK-004 source metadata output; TASK-005 GraphQL and
library-specific coverage.
**Blockers**: None.
**Notes**: Implemented scoped add-on root resolution, local manifest loading,
payload-template materialization, async validation integration, CLI
`--addon-root`, and regression coverage for user scope, project shadowing,
direct add-on root override, unsafe names, and unsafe template paths.

### Session: 2026-04-21 14:45

**Tasks Completed**: TASK-004 and TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added local add-on source metadata to inspection and validation
surfaces, including CLI JSON/text output, GraphQL validation/inspection, and
library inspection. Added focused CLI, GraphQL, and library regression tests.

### Session: 2026-04-21 15:33

**Tasks Completed**: Review follow-up for TASK-001, TASK-003, and TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Fixed direct workflow-definition-dir compatibility so scoped local add-on roots
are not inferred unless a direct add-on root override is supplied. Preserved
explicit `required: true` add-on env bindings, deduplicated built-in gateway
add-on config normalization, and added regression coverage for the direct-root
add-on isolation path.

### Session: 2026-04-21 15:37

**Tasks Completed**: Review follow-up for TASK-001 and TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Aligned implementation with the documented add-on lookup order by
making direct add-on root overrides prepend scoped candidates during catalog
loads instead of replacing them. Kept direct workflow-definition-dir compatibility
isolated to explicit add-on roots or host resolvers, removed a gateway
normalization type assertion, and added regression coverage for direct-root
fallback and direct-mode isolation.

### Session: 2026-04-21 15:44

**Tasks Completed**: Review follow-up for TASK-001, TASK-003, and design
alignment.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Updated stale command and scoped-workflow design wording so direct
add-on root overrides are documented as prepended scoped candidates rather than
exclusive bypasses. Further deduplicated built-in x-gateway and mail-gateway
payload resolution through a shared descriptor-driven resolver while preserving
the existing validation and output contracts.

## Related Plans

- **Previous**: `impl-plans/scoped-workflow-catalog-safety-follow-up.md`
- **Next**: add-on source display or trusted executable add-on package loading
- **Depends On**: `scoped-workflow-catalog-safety-follow-up`
