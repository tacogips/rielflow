# Web Workflow Viewer Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#local-http-server-divedra-serve`
**Created**: 2026-04-17
**Last Updated**: 2026-04-17

## Design Document Reference

**Source**: `design-docs/specs/architecture.md`

### Summary

Restore a browser-facing, read-only workflow viewer served by the local Bun HTTP server. The viewer uses Solid in the browser and GraphQL-backed data already exposed by `divedra serve` to show workflow node graphs and execution logs.

### Scope

**Included**:

- read-only Solid browser application for workflow graph inspection
- workflow execution run list and selected run log display
- server routes for the viewer HTML and bundled browser asset
- `divedra web serve` alias for the existing serve backend
- targeted server and CLI regression coverage

**Excluded**:

- workflow editing
- execution controls
- websocket/live push updates

## Modules

### 1. Server Viewer Routes

#### `src/server/web-viewer.ts`, `src/server/api.ts`

**Status**: COMPLETED

```typescript
interface WorkflowViewerConfig {
  readonly fixedWorkflowName: string | null;
  readonly readOnly: boolean;
  readonly noExec: boolean;
}

export function renderWorkflowViewerHtml(context: ApiContext): Response;
export async function renderWorkflowViewerScript(): Promise<Response>;
```

**Checklist**:

- [x] Serve viewer HTML at `/`, `/web`, and `/ui`
- [x] Serve bundled Solid client script at `/assets/workflow-viewer.js`
- [x] Preserve `/graphql` and `/healthz` behavior

### 2. Solid Browser Viewer

#### `src/web/workflow-viewer.tsx`

**Status**: COMPLETED

```typescript
interface ViewerState {
  readonly workflows: readonly string[];
  readonly workflowName: string | null;
  readonly selectedExecutionId: string | null;
}
```

**Checklist**:

- [x] Load workflow definitions through GraphQL
- [x] Render nodes and edges as a read-only SVG graph
- [x] List workflow executions
- [x] Show logs for the selected execution

### 3. CLI and Build Integration

#### `src/cli.ts`, `package.json`, `scripts/build-web.mjs`, `src/server/web-viewer-build.ts`

**Status**: COMPLETED

```typescript
// `divedra web serve [workflow-name]` maps to the existing serve command.
```

**Checklist**:

- [x] Add `web serve` alias without breaking `serve`
- [x] Build the browser asset with Bun for packaged output
- [x] Transform Solid TSX with the Solid DOM JSX transform instead of Bun's default React JSX output

### 4. Review Hardening

#### `src/server/web-viewer.ts`, `src/web/workflow-viewer.tsx`, `design-docs/specs/*.md`

**Status**: COMPLETED

```typescript
export const WORKFLOW_VIEWER_DOCUMENT_PATHS: readonly string[];
export const WORKFLOW_VIEWER_SCRIPT_PATH: string;
export function isWorkflowViewerDocumentPath(pathname: string): boolean;
```

**Checklist**:

- [x] Align architecture and command design docs with restored browser asset serving
- [x] Centralize viewer document/script paths for server routing and tests
- [x] Replace message-based ENOENT handling with typed file-error detection
- [x] Reuse existing TypeScript API contract types in the browser viewer
- [x] Add regression coverage for all viewer document paths
- [x] Reject React-style browser bundle output in regression coverage
- [x] Reset viewer loading state when no workflows are available
- [x] Support trailing slash viewer document paths such as `/web/`

## Module Status

| Module                | File Path                                       | Status    | Tests                            |
| --------------------- | ----------------------------------------------- | --------- | -------------------------------- |
| Server viewer routes  | `src/server/web-viewer.ts`, `src/server/api.ts` | COMPLETED | Targeted server tests            |
| Solid browser viewer  | `src/web/workflow-viewer.tsx`                   | COMPLETED | Typecheck and bundled route test |
| CLI/build integration | `src/cli.ts`, `package.json`                    | COMPLETED | CLI alias test                   |
| Review hardening      | server/client/docs/tests                        | COMPLETED | Targeted server tests            |

## Dependencies

| Feature        | Depends On                                                  | Status    |
| -------------- | ----------------------------------------------------------- | --------- |
| Browser viewer | GraphQL workflow definition and execution overview surfaces | Available |
| Asset serving  | Bun build/runtime                                           | Available |
| Hardening pass | Viewer route implementation                                 | Completed |

## Completion Criteria

- [x] `divedra serve` serves the read-only workflow viewer
- [x] `divedra web serve` starts the same viewer
- [x] Workflow node graph is visible
- [x] Execution log list is visible
- [x] Type checking passes
- [x] Targeted regression tests pass
- [x] Architecture and command design docs match the served viewer behavior

## Progress Log

### Session: 2026-04-17 13:38 JST

**Tasks Completed**: TASK-004 review hardening follow-up
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Fixed the browser build so Solid TSX is transformed to Solid DOM operations instead of `React.createElement`, reused the same transform for the server development fallback, hardened the asset regression test, and fixed a viewer loading-state edge case for empty workflow lists.

### Session: 2026-04-17 12:35 JST

**Tasks Completed**: TASK-004 review hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Updated stale design text, centralized viewer route constants, tightened file-error handling, reused existing shared TypeScript types in the browser viewer, and extended server route coverage.

### Session: 2026-04-17 12:00 JST

**Tasks Completed**: Viewer routes, Solid browser implementation, CLI alias, package build integration, targeted tests
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The viewer is intentionally read-only and reuses existing GraphQL queries rather than adding a new REST surface.
