# User Scope Workflows

This document defines the scope model for workflows that are reusable across
projects while preserving project-local workflows.

## Overview

`divedra` should support two authored workflow scopes:

- project scope: workflows owned by the current project
- user scope: workflows owned by the operator and callable from any project

The canonical user scope root is `~/.divedra`. User workflows live below
`~/.divedra/workflows`. Project scopes use the same subdirectory names below the
project `.divedra` directory, so layout-dependent tooling does not need separate
project/user path rules.

Canonical layout:

```text
<scope-root>/
  config.json
  workflows/
    <workflow-name>/
      workflow.json
      nodes/
        node-<id>.json
      prompts/
        <prompt>.md
  addons/
    <namespace>/
      <addon-name>/
        <version>/
          addon.json
          templates/
  artifacts/
    sessions/
    workflow/
    files/
    divedra.db
  logs/
```

Examples:

```text
~/.divedra/workflows/review-pr/workflow.json
~/.divedra/addons/acme/reviewer/1/addon.json
~/.divedra/logs/
~/.divedra/artifacts/sessions/

<project>/.divedra/workflows/release-check/workflow.json
<project>/.divedra/addons/team/release-note/1/addon.json
<project>/.divedra/logs/
<project>/.divedra/artifacts/sessions/
```

## Goals

- make a user-authored workflow or add-on available regardless of the caller's
  current project directory
- keep project-authored workflows and add-ons isolated from user-authored
  workflows and add-ons
- make project and user scope subdirectories identical
- keep existing direct `--workflow-definition-dir <path>` behavior for examples and
  automation
- allow `~/.divedra` and project `.divedra` paths to be changed through CLI
  arguments, environment variables, and config
- keep runtime artifacts and logs scoped with the workflow definition by
  default

## Non-Goals

- adding remote workflow registries
- merging workflow definitions from multiple users
- changing the authored workflow bundle format inside a workflow directory
- making `workflowId` globally unique across all scopes
- replacing explicit artifact/session root overrides

## Terminology

### Scope Root

A scope root is the directory that owns the shared subdirectory layout:

- user scope root: defaults to `~/.divedra`
- project scope root: defaults to the nearest ancestor `.divedra`

### Workflow Root

A workflow root is the directory containing workflow bundle directories. In the
scoped model it is:

```text
<scope-root>/workflows
```

Existing code and commands use `workflowRoot` to mean this direct parent of
workflow bundles. That meaning should stay intact.

### Add-on Root

An add-on root is the directory containing local add-on definitions. In the
scoped model it is:

```text
<scope-root>/addons
```

Add-on scope follows the workflow catalog model: project add-ons are visible to
project workflows first, then user add-ons. User add-ons are portable and
callable from any project unless shadowed by a project add-on with the same
name and version.

### Runtime Data Root

The runtime data root is:

```text
<scope-root>/artifacts
```

It contains the existing runtime subtrees:

- `sessions/`
- `workflow/`
- `files/`
- `divedra.db`

### Log Root

The log root is:

```text
<scope-root>/logs
```

It is for operator-facing process logs and exported text/jsonl runtime logs.
Structured session state, communications, attachments, and the runtime index
remain under the runtime data root.

## Scope Resolution

### Project Scope Discovery

Project scope discovery starts from the command invocation `cwd` and walks
upward until it finds a `.divedra` directory.

When found:

```text
projectScopeRoot = <nearest-project>/.divedra
projectWorkflowRoot = <nearest-project>/.divedra/workflows
```

When not found, project scope is absent by default. Commands that explicitly
create a project workflow may create `<cwd>/.divedra/workflows`.

This differs from the current fallback that treats `<cwd>/.divedra` as a
workflow root for all commands. The new behavior avoids accidentally creating a
project scope while still letting `workflow create --scope project` create one
intentionally.

### User Scope Discovery

User scope root resolution order:

1. `--user-root <path>`
2. `DIVEDRA_USER_ROOT`
3. bootstrap config `userRoot`
4. `~/.divedra`

The user workflow root is always `<userScopeRoot>/workflows` unless the caller
uses the lower-level direct workflow definition directory override.

The user add-on root is always `<userScopeRoot>/addons` unless the caller uses
an explicit add-on-root override.

### Direct Workflow Definition Directory

`--workflow-definition-dir` and `DIVEDRA_WORKFLOW_DEFINITION_DIR` mean "the
direct directory containing workflow bundle directories." They bypass
project/user scope catalog lookup and support usage such as:

```bash
divedra workflow validate demo --workflow-definition-dir ./examples
```

Direct workflow definition directory mode should use explicit artifact/session
overrides when supplied. Without explicit runtime roots, it uses the standard
runtime data root defaults.

## Workflow Lookup

Commands that read or run a workflow should use a workflow catalog unless a
direct workflow root is supplied.

Default lookup order:

1. project scope workflow root, when a project scope exists
2. user scope workflow root

If the same workflow name exists in both scopes, project scope wins for bare
workflow names. Output should include the resolved scope and path when a command
loads a workflow so shadowing is visible.

Examples:

```bash
# Runs <project>/.divedra/workflows/review/workflow.json when present,
# otherwise ~/.divedra/workflows/review/workflow.json.
divedra workflow run review

# Forces the reusable user workflow.
divedra workflow run review --scope user

# Forces the project workflow.
divedra workflow run review --scope project
```

The TUI should group workflow names by scope. Duplicate names should be shown as
distinct entries such as `review (project)` and `review (user)`, while keyboard
or command shortcuts that accept a bare name should follow the same project then
user resolution rule.

## Add-on Lookup

Local add-ons are stored under each scope root:

```text
<scope-root>/addons/<namespace>/<addon-name>/<version>/addon.json
```

The path segments are derived from authored add-on names:

- `team/release-note` version `1` resolves to
  `addons/team/release-note/1/addon.json`
- add-on names must be safe namespace paths with exactly one `/`
- add-on versions must be safe path tokens
- the `divedra/` namespace remains reserved for built-in runtime add-ons and is
  not loaded from scoped add-on roots

Default local add-on lookup order:

1. built-in runtime catalog for `divedra/*`
2. explicit direct add-on root override, when supplied
3. project scope add-on root, when present
4. user scope add-on root
5. host-provided resolver functions

This order allows project-local add-ons to specialize shared user workflows by
exact `(name, version)` while preserving existing host resolver integration as
the final extension point. During scoped catalog loading, an explicit direct
add-on root override is a prepended candidate, not an exclusive source. Direct
direct workflow definition directory mode does not infer scoped add-on roots; callers
must supply an explicit add-on root override or host resolver functions when
direct workflow bundles reference local add-ons.

For bare CLI workflow lookup, project workflow shadowing user workflow is
intentional. For add-ons, shadowing should require both the same add-on name and
same version. If the name matches but the requested version does not exist in
the higher-priority scope, lookup continues to lower-priority scopes.

## Write Commands

Commands that create or modify workflow definitions must avoid ambiguous writes.

Rules:

- `workflow create <name>` writes to project scope when a project scope already
  exists.
- outside a discovered project scope, `workflow create <name>` writes to user
  scope.
- `workflow create <name> --scope project` creates
  `<cwd>/.divedra/workflows/<name>` when no project scope exists.
- `workflow create <name> --scope user` writes to
  `<userScopeRoot>/workflows/<name>`.
- save/edit APIs must carry the resolved workflow source scope from load time
  and write back to the same scope unless the caller explicitly requests a
  different destination.
- `workflow checkout <url>` is a command-specific scoped write path. Unlike
  `workflow create`, checkout defaults to project scope even when no project
  scope is discovered, creating `<cwd>/.divedra/workflows/<name>` as needed.
  `--user-scope` selects `<userScopeRoot>/workflows/<name>`.
- `workflow checkout` rejects `--workflow-definition-dir` as a destination and
  records checkout provenance under
  `<userScopeRoot>/workflow-registry/checkouts/<scope>-<workflow-name>.json`.

`--workflow-definition-dir` keeps its existing exact behavior for writes and bypasses
scope selection.

### Checkout Registry

The checkout registry records where externally sourced workflows came from. It
is not a remote workflow registry and does not participate in workflow lookup.
Workflow lookup still reads project and user workflow roots directly.

Registry record path:

```text
<userScopeRoot>/workflow-registry/checkouts/<scope>-<workflow-name>.json
```

Minimum record shape:

```json
{
  "workflowName": "review-pr",
  "sourceUrl": "https://github.com/org/repo/tree/main/.divedra/workflows/review-pr",
  "scope": "project",
  "checkedOutAt": "2026-05-17T00:00:00.000Z",
  "destinationDirectory": "/workspace/.divedra/workflows/review-pr"
}
```

The registry is written for both project and user checkouts so an operator can
audit installed remote workflows from the user scope root. Duplicate checkout is
defined as either an existing destination workflow directory or an existing
registry record for the same `(scope, workflowName)`. `--overwrite` replaces the
destination and registry record only after the newly staged remote workflow has
validated successfully.

## Runtime Root Defaults

When a workflow is loaded through project/user catalog lookup, runtime defaults
come from the resolved workflow's owning scope:

```text
artifact root: <scope-root>/artifacts/workflow
session root:  <scope-root>/artifacts/sessions
file root:     <scope-root>/artifacts/files
db path:       <scope-root>/artifacts/divedra.db
log root:      <scope-root>/logs
```

Therefore a user workflow run from any project records its default history under
the user scope root. A project workflow records its default history under the
project scope root.

Project-scoped catalog entrypoints default runtime data to a project namespace
under the user root:

```text
root data:     <user-root>/projects/<project-basename>-<project-root-hash>/artifacts
artifact root: <user-root>/projects/<project-basename>-<project-root-hash>/artifacts/workflow
session root:  <user-root>/projects/<project-basename>-<project-root-hash>/artifacts/sessions
file root:     <user-root>/projects/<project-basename>-<project-root-hash>/artifacts/files
db path:       <user-root>/projects/<project-basename>-<project-root-hash>/artifacts/divedra.db
```

Direct `--workflow-definition-dir` and other non-scoped runtime entrypoints do not have an
owning project workflow scope. They should default to the user runtime data
root:

```text
artifact root: <user-root>/artifacts/workflow
session root:  <user-root>/artifacts/sessions
file root:     <user-root>/artifacts/files
db path:       <user-root>/artifacts/divedra.db
```

Explicit runtime roots remain higher precedence:

1. command argument
2. environment variable
3. config
4. owning scope default

Existing `DIVEDRA_ARTIFACT_DIR`, `DIVEDRA_ARTIFACT_ROOT`, and
`DIVEDRA_SESSION_STORE` remain supported as compatibility overrides. New scoped
defaults should map onto the same internal root types instead of creating a
second persistence model.

Catalog-aware entrypoints must apply this co-location rule below the CLI layer.
When `artifactRoot`/`DIVEDRA_ARTIFACT_ROOT` or
`sessionStoreRoot`/`DIVEDRA_SESSION_STORE` are supplied without an explicit
`rootDataDir`/`DIVEDRA_ARTIFACT_DIR`, `rootDataDir` is inferred from the
explicit storage-root parent when possible before falling back to the owning
scope default. This keeps library, GraphQL, event, and CLI execution aligned.

## Config Model

There are two config layers.

### Bootstrap Config

Bootstrap config exists outside the user scope root so it can change the user
scope root itself.

Default path:

```text
$XDG_CONFIG_HOME/divedra/config.json
```

Fallback path when `XDG_CONFIG_HOME` is unset:

```text
~/.config/divedra/config.json
```

Initial fields:

```json
{
  "userRoot": "~/.divedra",
  "projectRootName": ".divedra"
}
```

`projectRootName` changes the directory name searched during project scope
discovery. It defaults to `.divedra`.

### Scope Config

Each scope may contain `<scope-root>/config.json`.

Initial fields:

```json
{
  "workflowSubdir": "workflows",
  "addonSubdir": "addons",
  "artifactSubdir": "artifacts",
  "logSubdir": "logs"
}
```

Subdirectory overrides are resolved relative to the scope root unless they are
absolute. The default project and user configs should not be required; missing
config means the canonical subdirectory names above.

## CLI And Environment Additions

New CLI options:

| Option                  | Description                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `--scope <scope>`       | Selects workflow scope behavior for read/write commands: `auto`, `project`, or `user`. |
| `--user-root <path>`    | Overrides the user scope root.                                                         |
| `--project-root <path>` | Overrides the project scope root for the current command.                              |
| `--addon-root <path>`   | Direct add-on root override; searched before scoped add-on roots during scoped loads.  |
| `--log-root <path>`     | Overrides the log root.                                                                |
| `--config <path>`       | Overrides the bootstrap config path.                                                   |

New environment variables:

| Variable                 | Description                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `DIVEDRA_WORKFLOW_SCOPE` | Default scope selector: `project`, `user`, or `auto`.                                 |
| `DIVEDRA_USER_ROOT`      | Overrides the user scope root.                                                        |
| `DIVEDRA_PROJECT_ROOT`   | Overrides the project scope root.                                                     |
| `DIVEDRA_ADDON_ROOT`     | Direct add-on root override; searched before scoped add-on roots during scoped loads. |
| `DIVEDRA_LOG_ROOT`       | Overrides the log root.                                                               |
| `DIVEDRA_CONFIG`         | Overrides the bootstrap config path.                                                  |

Existing variables keep their current meaning. In particular,
`DIVEDRA_WORKFLOW_DEFINITION_DIR` remains a direct workflow root override and should not
be reinterpreted as a scope root.

Invalid `--scope` or `DIVEDRA_WORKFLOW_SCOPE` values are command errors. They
must not silently fall back to `auto`, because a typo could execute or validate
a shadowed workflow from the wrong scope.

The catalog resolver itself owns this validation. CLI parsing may fail earlier
for better usage messages, but lower-level library, GraphQL, event, and create
paths must also return or throw an explicit invalid-scope error instead of
enumerating another scope.

`DIVEDRA_ADDON_ROOT` is intentionally a direct root override, parallel to
`DIVEDRA_WORKFLOW_DEFINITION_DIR`. It should point at a directory containing
`<namespace>/<addon-name>/<version>/addon.json`, not at a scope root. During
scoped catalog loading it is prepended to add-on candidates and does not
suppress project/user fallback on a miss. When the host resolves workflows via
a direct `DIVEDRA_WORKFLOW_DEFINITION_DIR` (bypassing scoped catalog roots), that same
override is the only filesystem add-on root unless the host also supplies
resolver functions.

## Cross-workflow references across scopes

A cross-workflow step transition names the callee with `toWorkflowId` (and
optional `resumeStepId`) on `steps[].transitions` (`design-workflow-json.md`).
That `toWorkflowId` names another workflow under the configured workflow root.
Under catalog lookup it should resolve through the same catalog as CLI workflow
lookup.

Default callee resolution order:

1. caller workflow's owning scope
2. project scope, when different from the caller scope and present
3. user scope, when different from the caller scope

This keeps same-scope calls stable while allowing project workflows to call
shared user workflows by name.

Future explicit scope on a transition (not authored today) could disambiguate
shadowed workflow names; the same ordered catalog remains the default when
`scope` is omitted.

Example shape (illustrative; real bundles use full step-addressed `workflow.json`):

```json
{
  "id": "draft-write",
  "nodeId": "writer-node",
  "transitions": [
    {
      "toStepId": "entry",
      "toWorkflowId": "review-pr",
      "resumeStepId": "summarize"
    }
  ]
}
```

## Project Layout Migration

The existing project layout places workflow bundles directly under `.divedra/`.
The new canonical project layout places them under `.divedra/workflows/`.

Migration rules:

- `--workflow-definition-dir <path>` continues to load `<path>/<name>/workflow.json`.
- when a discovered project `.divedra/workflows` exists, it is the project
  workflow root.
- when `.divedra/workflows` is absent but `.divedra/<name>/workflow.json`
  exists, the loader may treat `.divedra` as a legacy direct project workflow
  root and emit a migration warning.
- new `workflow create` writes only the canonical scoped layout unless
  `--workflow-definition-dir` is supplied.
- examples remain supported through `--workflow-definition-dir ./examples` and do not
  need to adopt the scoped layout.

## Security And Safety

- Workflow names keep the existing safe token rule.
- Local add-on names must be safe two-part namespace paths such as
  `vendor/name`; versions must be safe path tokens.
- Scope roots and subdirectory overrides must be normalized before use.
- Workflow lookup must never let a workflow name escape the selected workflow
  root.
- Add-on lookup must never let an add-on name, version, manifest path, or
  template file escape the selected add-on version directory.
- The `divedra/` namespace remains reserved for runtime built-ins and must not
  be loaded from `.divedra/addons`.
- Config path expansion should support `~` only at the start of a path.
- Project scope shadowing user scope is intentional, but commands should expose
  the resolved path in human-readable output.
- User workflows are portable definitions; they should not assume the project
  directory is the workflow definition directory. Project-specific filesystem
  work should use the workflow execution working directory, not workflow-local
  paths.

## Implementation Notes

Recommended internal additions:

- `WorkflowScope = "project" | "user" | "direct"`
- `ResolvedWorkflowSource` with `scope`, `scopeRoot`, `workflowRoot`,
  `workflowName`, and `workflowDirectory`
- `resolveWorkflowCatalog(options)` to produce ordered workflow roots
- `resolveAddonCatalog(options, workflowSource)` to produce ordered add-on
  roots for one workflow load
- `loadWorkflowFromCatalog(name, options)` for CLI/TUI/server surfaces that
  want project/user lookup
- keep `loadWorkflowFromDisk(name, { workflowRoot })` for direct-root callers
  and tests
- extend `EffectiveRoots` with optional `scopeRoot`, `addonRoot`, and `logRoot`

This keeps the current loader usable while adding a higher-level resolver that
knows about scope ordering and defaults.

First implementation boundary:

- keep `loadWorkflowFromDisk(name, { workflowRoot })` as the direct workflow-definition-dir
  API used by compatibility paths and focused tests
- add a catalog-aware load path for CLI/TUI/server surfaces that want
  project/user lookup
- GraphQL schema operations used by `serve` and browser editor views should
  resolve the same catalog source for workflow listing, inspection, validation,
  saving existing definitions, and execution
- public library execution/inspection wrappers and local event dispatch paths
  should use catalog lookup before delegating to the direct-root runtime, so
  reusable user-scope workflows remain executable outside a project
- event binding validation should enumerate workflows from the same catalog used
  by execution instead of only reading a single direct workflow root
- route scoped runtime defaults through existing `rootDataDir`, `artifactRoot`,
  and `sessionStoreRoot` options rather than adding a second persistence model
- reject invalid workflow scope selector environment values in shared catalog
  resolution, not only in command-line parsing
- defer local add-on manifest loading, bootstrap config files, scope config
  files, and operator log routing to follow-up implementation plans

## Migration Plan

1. Add scoped path resolution and tests for `--workflow-definition-dir`.
2. Change CLI/TUI default workflow lookup to catalog lookup.
3. Change `workflow create` to write scoped canonical layout.
4. Add scoped add-on root resolution and manifest-based local add-on loading.
5. Add compatibility detection for legacy `.divedra/<workflow>` project
   bundles.
6. Add log-root resolution and route exported/session logs through it where
   applicable.
7. Update README examples only after the CLI behavior is implemented.

## Open Decisions

- Whether user-origin workflow calls should be allowed to resolve project
  workflows by default. The design allows it through the catalog order after
  same-scope lookup, but an implementation may restrict user-origin calls to
  user scope only if portability is more important than convenience.
- Whether `DIVEDRA_HOME` should be accepted as an alias for
  `DIVEDRA_USER_ROOT`. The design uses the more explicit name to avoid
  confusion with the existing artifact/data roots.
