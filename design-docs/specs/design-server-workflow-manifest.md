# Server Workflow Manifest

This document defines the server workflow manifest used by `divedra serve` to
publish an explicit workflow catalog for one server process.

## Overview

`divedra serve` can run with a workflow manifest JSON file. When a manifest is
present, the server catalog is an allowlist: only enabled workflows listed in
the manifest are visible through the browser overview, GraphQL catalog queries,
and server-backed workflow start paths.

The manifest is a server startup contract, not a replacement for workflow
bundle authoring. Workflow bundles still live in directories containing
`workflow.json`, prompt files, and `nodes/node-*.json`; the manifest selects
which bundles this server exposes and supplies server-local defaults.

## Manifest Shape

Manifest version `1` is the initial supported format.

```json
{
  "manifestVersion": 1,
  "workflows": [
    {
      "id": "design-loop",
      "enabled": true,
      "workflowDirectory": {
        "relative": "./examples/design-and-implement-review-loop"
      },
      "cwd": {
        "relative": "."
      },
      "autoImprove": {
        "mode": "active"
      },
      "defaultVariables": {},
      "metadata": {
        "title": "Design and implementation loop"
      }
    }
  ]
}
```

Top-level fields:

- `manifestVersion`: required integer. Version `1` is supported; other values
  are startup validation errors.
- `workflows`: required non-empty array of manifest entries.

Workflow entry fields:

- `id`: required stable server workflow id. This is the name clients use in
  server-backed GraphQL and browser start actions.
- `enabled`: optional boolean, default `true`. Disabled entries are validated
  but are hidden from startable catalog output and cannot be started.
- `workflowDirectory`: required path object containing exactly one of
  `absolute` or `relative`.
- `cwd`: optional path object containing exactly one of `absolute` or
  `relative`. When omitted, the resolved workflow directory is the execution
  working directory.
- `autoImprove`: optional per-workflow server default. `mode: "active"` enables
  remediation policy by default; `mode: "disabled"` keeps deterministic
  lifecycle supervision but sets workflow patching to zero by default.
- `defaultVariables`: optional JSON object merged into workflow runtime
  variables before request variables.
- `metadata`: optional JSON object for catalog display and server-local labels.
  It does not alter workflow execution semantics.

Path object rules:

- `absolute` must be an absolute filesystem path.
- `relative` must be a relative path and resolves from the current directory by
  default. `DIVEDRA_WORKFLOW_MANIFEST_ROOT` overrides that base directory for
  manifest `workflowDirectory` and `cwd` relative paths.
- A path object must not contain both `absolute` and `relative`.
- Resolved workflow directories must contain `workflow.json`.
- Resolved paths are normalized for validation and duplicate detection, but the
  authored `absolute` or `relative` field is preserved in manifest reporting.

## Identity and Catalog Semantics

The manifest entry `id` is the served workflow identity. A request to start,
inspect, or view status through a manifest-backed server resolves by manifest
`id`, not by the authored `workflow.json.workflowId`.

The authored workflow id remains source metadata and is reported separately as
`authoredWorkflowId` where catalog detail is available. Runtime artifacts for a
manifest-backed server should use the manifest `id` as the primary workflow id
so two manifest entries can point at the same authored bundle without colliding
in session and artifact storage.

Duplicate detection must reject:

- duplicate manifest `id` values
- manifest `id` values that fail the safe workflow-name rule
- duplicate enabled entries with the same resolved workflow directory and cwd
  unless their `metadata.allowDuplicateSource` is explicitly `true`
- an entry whose authored workflow id conflicts with another manifest id in a
  way that would make error messages ambiguous

Disabled entries are not startable and are omitted from `workflowCatalogOverview`
by default. Startup validation still checks disabled entries so a disabled row
does not become a latent broken deployment when re-enabled.

## Startup Precedence

`divedra serve` accepts `--workflow-manifest <path>`. The environment fallback is
`DIVEDRA_WORKFLOW_MANIFEST`. Relative path fields inside the manifest resolve
from the current directory unless `DIVEDRA_WORKFLOW_MANIFEST_ROOT` is set.

Startup resolution order for server workflow catalog selection:

1. `--workflow-manifest`
2. `DIVEDRA_WORKFLOW_MANIFEST`
3. existing `serve [workflow-name]` plus `--workflow-definition-dir` /
   `DIVEDRA_WORKFLOW_DEFINITION_DIR`
4. existing scoped project/user catalog lookup

When a manifest is present, it is authoritative for that server. The server must
not expose additional workflows from `--workflow-definition-dir`, scoped project
catalogs, or user catalogs. Supplying both `--workflow-manifest` and
`--workflow-definition-dir` is valid only for backward-compatible command lines;
the manifest controls the served catalog and a warning should state that the
direct definition directory was ignored for catalog selection.

`serve [workflow-name]` remains a narrowing operation. With a manifest, the name
must match an enabled manifest `id`; the server then exposes only that manifest
entry.

## Execution Defaults and Overrides

Manifest defaults are server-side defaults applied after catalog resolution and
before request-specific execution options.

Variable precedence:

1. manifest entry `defaultVariables`
2. request variables from GraphQL or endpoint-backed CLI

Request variables override matching manifest keys. Both layers must be JSON
objects.

Auto-improve precedence:

1. explicit request policy from GraphQL or endpoint-backed CLI
2. manifest entry `autoImprove`
3. workflow-authored `workflow.defaults.supervision`
4. runtime fallback policy

`autoImprove.mode: "disabled"` maps to lifecycle-only supervision with workflow
patching disabled. It must not disable the deterministic server supervisor or
hide normal status/progress tracking. `autoImprove.mode: "active"` enables the
same remediation policy as an explicit server-side default `--auto-improve`.

The manifest `cwd` supplies the default execution working directory for starts
through the manifest-backed server. A request-level working-directory override,
when supported by the transport, takes precedence and is validated under the
same absolute/relative path rules.

## Server and GraphQL Boundaries

Manifest enforcement must happen at the server catalog resolver and every
server-backed execution entry point. Hiding a workflow from the overview is not
sufficient; direct GraphQL mutations that name a workflow id must reject ids
outside the enabled manifest allowlist.

GraphQL catalog rows for manifest-backed servers should include:

- `workflowName` / public id: manifest entry `id`
- `sourceScope`: `manifest`
- `workflowDirectory`: resolved workflow directory
- `authoredWorkflowId`: value from `workflow.json`
- `manifestPath`: resolved manifest file path
- `manifestEntryId`: same value as manifest `id`
- `metadata`: manifest entry metadata

Existing local CLI commands that do not target a server endpoint continue to use
the current scoped and direct-directory lookup rules unless they explicitly use
the manifest validation surface. `workflow manifest validate` is a local
preflight command; it validates the manifest and referenced workflow bundles
without making manifest entries visible to ordinary local workflow lookup.

## Validation and Errors

The server must validate the manifest before binding the HTTP listener. Startup
fails with actionable errors for:

- unreadable or malformed JSON
- unsupported `manifestVersion`
- missing or non-array `workflows`
- missing, duplicate, or unsafe entry `id`
- invalid path objects, including both `absolute` and `relative`, neither field,
  absolute values in `relative`, or relative values in `absolute`
- missing workflow directory or missing `workflow.json`
- invalid `enabled`, `defaultVariables`, `metadata`, or `autoImprove.mode`
- duplicate source/cwd combinations that are not explicitly allowed

Errors should identify the manifest path and workflow entry index or id. They
must not expose environment secrets or redactable runtime variables.

`workflow manifest validate <manifest-path>` uses the same manifest loader and
workflow bundle validation rules as server startup, but runs without opening an
HTTP listener. The command should accept the manifest path positionally, through
`--workflow-manifest`, or through `DIVEDRA_WORKFLOW_MANIFEST`. The validation
report must include the resolved manifest path, the relative path root, each
entry id, resolved workflow directory, enabled state, authored workflow id when
available, and per-entry validation errors. `--executable` extends each
referenced workflow bundle check with active node executability preflight.

## Rollout Constraints

The manifest loader should be a shared workflow module so CLI parsing, server
startup, GraphQL context construction, browser overview, and tests consume the
same resolved catalog model. Adapter-specific behavior, including any
Cursor-related readiness checks, remains behind backend adapter modules and is
not part of the manifest contract.

Tests should cover:

- valid manifest resolution with absolute and relative path fields
- `DIVEDRA_WORKFLOW_MANIFEST_ROOT` overriding the relative path root
- disabled entries hidden and not startable
- manifest allowlist enforced by GraphQL start paths
- precedence against `--workflow-definition-dir`
- `workflow manifest validate` success and referenced workflow bundle failure
- default variable merge order
- auto-improve `active` and `disabled` policy mapping
- duplicate id and duplicate source validation errors
