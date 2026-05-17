# Workflow Node Executability Validation

This document defines executable workflow validation for node payloads, node
add-ons, and agent backend preflight.

## Overview

Workflow validation currently answers whether a bundle is structurally valid and
whether runtime requirements such as local binaries, environment variables, and
container runners are available. The requested feature extends that surface so
callers can also ask whether each node can actually run before a workflow is
started.

Executability validation is still workflow validation, not workflow execution.
It must not start real workflow sessions, write node artifacts, mutate workflow
state, or run add-on package lifecycle code.

## Goals

- return one `NodeValidationResult` per checked node or add-on validation domain
- include a stable `status` and human-readable `message` on every result
- let add-on descriptors and host add-on resolvers contribute a `validate`
  result without duplicating node validation logic
- validate `codex-agent`, `claude-code-agent`, and `cursor-cli-agent`
  executability through adapter-owned backend preflight
- keep Cursor-specific behavior inside the Cursor adapter and preserve Codex
  adapter semantics
- expose the same result model through CLI, GraphQL, and library validation
  paths
- keep loaded/catalog workflow validation consistent with bundle-submitted
  validation; add-on `validate` hook results must not disappear when a
  workflow is resolved from disk or the scoped catalog

## Non-Goals

- replacing existing structural `ValidationIssue` output
- executing workflow nodes or producing mailbox output during validation
- performing network package discovery for add-ons
- accepting backend-specific fields directly in generic workflow validation
  without adapter normalization
- changing `workflow run` start behavior

## Result Model

`NodeValidationResult` is a small class owned by the workflow validation surface.
It should be exported from the package-root library API and reused by CLI,
GraphQL, add-on descriptors, and backend adapters.

Required fields:

- `status`: `valid`, `warning`, `invalid`, or `unknown`
- `message`: non-empty human-readable summary

Recommended fields for machine consumers:

- `nodeId`
- `stepIds`
- `source`: `node`, `addon`, or `agent-backend`
- `path`
- `backend`
- `addonName`

Status semantics:

- `valid`: the node or add-on passed the selected validation level
- `warning`: the node is structurally valid, but a non-blocking preflight
  concern exists
- `invalid`: the node cannot execute with the current configuration or selected
  validation level
- `unknown`: executability cannot be proven because the backend has no stable
  local check, the check was skipped by policy, or the host did not provide a
  resolver

`invalid` results should become blocking validation failures only when the
caller requests executable validation. Passive structural validation may include
the results for display, but must preserve existing success/failure behavior
unless the executable preflight option is enabled.

## Validation Levels

Executable validation has two levels.

Passive validation:

- runs as part of normal workflow validation
- uses parsed workflow JSON, resolved node payloads, descriptor schema checks,
  known enum checks, and add-on manifest checks
- does not spawn agent CLIs or call model availability probes
- may return `unknown` for backend auth or model reachability

Active preflight:

- is requested explicitly with CLI, GraphQL, or library options
- may spawn bounded local commands such as backend version, auth-status, or
  model-reachability probes
- must use timeouts and structured error capture
- must never start a divedra workflow session or publish node artifacts

This split keeps ordinary validation fast and deterministic while still giving
operators a concrete executability check before a run.

## CLI and GraphQL Surface

CLI:

- `divedra workflow validate <name>` remains structural/passive by default
- `divedra workflow validate <name> --executable` enables active preflight
- `divedra workflow validate <name> --node-patch <json|@file|file>` applies a
  non-persistent node patch before both passive validation and active preflight
- `--output json` includes `nodeValidationResults`
- text output summarizes invalid and warning node results after existing
  validation issues
- direct-directory and scoped-catalog validation must report the same add-on
  `validate` hook `nodeValidationResults` that detailed bundle validation would
  report for the equivalent workflow bundle

GraphQL:

- `validateWorkflowDefinition(input: { ..., executablePreflight: Boolean })`
  should mirror the CLI behavior
- response payload includes `nodeValidationResults` with the same status values
  and messages
- named workflow validation with `workflowName` and no submitted bundle must
  include the same add-on hook `nodeValidationResults` as validation of an
  explicitly submitted bundle

Library:

- validation options add `executablePreflight?: boolean`
- returned detailed validation includes `nodeValidationResults`

Existing runtime readiness output remains available for inspection surfaces, but
implementation should share probe helpers rather than duplicate backend checks.

## Node and Add-on Validation Flow

The validation pipeline should use one shared collector:

1. load and normalize the workflow bundle
2. apply any invocation-scoped node patch overlay to the loaded in-memory node
   payload map
3. resolve add-on references into effective node payloads
4. run structural node payload validation
5. collect passive node executability results
6. invoke add-on `validate` hooks for add-on-backed nodes
7. group agent nodes by backend and model for backend preflight
8. run active backend checks only when requested
9. merge results into detailed validation output and runtime readiness surfaces

Node patch validation is part of the same pipeline, not a pre-parser side
channel. The patch parser may reject invalid JSON, non-object patch payloads,
unknown node ids, and disallowed fields early, but backend/model/effort
compatibility must be checked against the patched workflow state so validation,
runtime readiness, and execution agree on the same effective node settings.

Add-on hooks should be descriptor-owned:

- built-in `divedra/*` descriptors may provide a synchronous or asynchronous
  `validate` function
- host-provided resolvers may return add-on validation results along with an
  effective node payload
- local manifest/template add-ons remain data-only and may express validation
  through schema fields; they must not execute arbitrary code

The same hook result should feed CLI, GraphQL, library, and inspection paths.
Do not add separate validator implementations for each transport.

### Loaded Workflow Result Consistency

Loaded workflow validation has one canonical source of add-on hook results: the
detailed async bundle validation result produced while resolving add-ons. CLI,
GraphQL named workflow validation, GraphQL bundle validation, and library
detailed validation must all expose that same add-on contribution.

Rules:

- load paths may preserve detailed `nodeValidationResults` from validation or
  rerun `validateWorkflowBundleDetailedAsync` with the same workflow, add-on,
  and scoped-root options before formatting a response
- a loaded workflow path must not replace detailed validation results by calling
  only the node executability collector after load, because that loses add-on
  `validate` hook output already gathered during add-on resolution
- active backend preflight may append or merge backend-adapter results, but it
  must retain add-on `source: "addon"` records from detailed validation
- merge logic must avoid duplicate passive node results when a node appears in
  both the preserved detailed result set and the active preflight enrichment
- executable-preflight failure semantics remain based on the merged
  `nodeValidationResults`, so an invalid add-on hook result is visible to CLI,
  GraphQL, and library callers through the same response contract

## Agent Backend Preflight

Agent preflight belongs behind backend adapters. Workflow validation decides
which node payloads require checks; adapters decide how to check their own
tools, auth state, model reachability, mode, and effort.

Required checks for active preflight:

- local wrapper/tool availability
- authentication where the backend exposes a stable local auth check
- model reachability where the backend exposes a bounded local model probe
- valid execution mode for backend-specific node configuration
- valid reasoning effort or equivalent effort field when the backend supports
  one

Capability result rules:

- If a backend has no capability and the workflow did not author a related
  field, return `valid` with a `not applicable` message so Step 4 can treat the
  requirement as intentionally handled.
- If a workflow authors a backend-specific mode or effort field that the
  selected backend does not support, return `invalid`.
- If a backend supports a capability but has no stable local proof command,
  return `unknown` rather than silently accepting it.
- Adapter return types are converted into `NodeValidationResult` objects; they
  must not leak backend-specific response shapes into workflow validation.

Backend capability matrix:

| Backend | Authentication | Model reachability | Plan executability | Valid mode | Valid effort |
| ------- | -------------- | ------------------ | ------------------ | ---------- | ------------ |
| `codex-agent` | Active preflight uses `codex login status` through `/Users/taco/gits/tacogips/codex-agent/src/sdk/model-availability.ts`; unauthenticated is `invalid`. | Active preflight uses `codex-agent model check --model <model> --json` or the SDK `checkCodexModelAvailability`; unavailable model is `invalid`. | Codex reference has no dedicated plan mode. With no authored plan field, return `valid` and `not applicable`; if Divedra later exposes a Codex plan field, unsupported values are `invalid` until the Codex adapter maps them. | Validate Codex process options against `/Users/taco/gits/tacogips/codex-agent/src/process/types.ts`: sandbox `full`, `network-only`, `none`; approval mode `always`, `unless-allow-listed`, `never`, `on-failure`; stream granularity `event`, `char`. Unsupported authored values are `invalid`. | The inspected Codex reference exposes no reasoning-effort option on `CodexProcessOptions`. With no authored effort, return `valid` and `not applicable`; any authored Codex effort is `invalid` until a concrete Codex reference field exists. |
| `claude-code-agent` | Active preflight uses `/Users/taco/gits/tacogips/claude-code-agent/src/sdk/credentials/reader.ts` or `claude-code-agent auth status`; missing or expired credentials are `invalid`. | No inspected stable model reachability probe exists. Return `unknown` for model reachability while still reporting the authored model. | Plan executability maps to Claude `PermissionMode` value `plan` in `/Users/taco/gits/tacogips/claude-code-agent/src/sdk/session-runner.ts`; static mode validation can be `valid`, but live plan execution remains `unknown` unless a future bounded command is added. | Validate `PermissionMode`: `default`, `acceptEdits`, `plan`, `bypassPermissions`. Unsupported authored values are `invalid`. | The inspected Claude reference exposes budget and turn limits but no reasoning-effort enum. With no authored effort, return `valid` and `not applicable`; any authored Claude effort is `invalid` until a concrete Claude reference field exists. |
| `cursor-cli-agent` | Cursor has no stable local auth-status API in `/Users/taco/gits/tacogips/cursor-agent/src/cursor/model-availability.ts`; return `unknown` unless a bounded probe reports an auth-like failure, which is `invalid`. | Active preflight may run the Cursor model probe from `/Users/taco/gits/tacogips/cursor-agent/src/cursor/model-availability.ts`; unavailable model is `invalid`, unprobed passive validation is `unknown`. | Plan executability maps to Cursor mode `plan` in `/Users/taco/gits/tacogips/cursor-agent/src/sdk/agent-runner.ts`; the adapter validates the enum and reports live auth/model limitations separately. | Validate Cursor mode values `default`, `plan`, and `ask`. Unsupported authored values are `invalid`. | The inspected Cursor reference exposes no effort enum. With no authored effort, return `valid` and `not applicable`; any authored Cursor effort is `invalid` until a concrete Cursor reference field exists. |

Divedra implementation boundary:

- workflow validation owns grouping nodes by backend and formatting
  `NodeValidationResult`
- `src/workflow/runtime-readiness-agent-probes.ts` or backend adapter modules
  own bounded command execution and reference-specific interpretation
- backend-specific authored fields must remain normalized before adapter
  invocation; Cursor fields stay in the Cursor adapter and must not affect
  Codex or Claude validation
- unsupported authored capability fields should include the node id, step ids,
  backend, field path, and accepted values in the result message

## Cursor CLI Behavior Mapping

Cursor CLI validation intentionally diverges from Codex validation:

- Cursor auth cannot be proven from a stable local auth-status command, so auth
  status is `unknown` unless a bounded probe reports an auth-like failure.
- Cursor mode validation is restricted to the Cursor adapter's explicit
  `default`, `plan`, and `ask` modes.
- Cursor model reachability is optional and only active under executable
  preflight; passive validation reports `unknown`.
- Cursor effort validation is `not applicable` when no effort is authored and
  `invalid` for authored or patched effort until the Cursor reference exposes a
  concrete effort field.
- A node patch may switch an agent node from `codex-agent` to
  `cursor-cli-agent` by setting `executionBackend` and `model`; after the patch,
  Cursor validation is authoritative for that node and Codex-specific process
  options no longer apply.
- Cursor-specific messages must mention `cursor-cli-agent` or `cursor-agent`
  provenance and must not reuse Codex login wording.

## Data Flow

Executable validation data should flow as follows:

- `workflow.json` and node payload files provide authored node configuration
- add-on resolution materializes add-on-backed node payloads and add-on
  provenance
- the shared node executability collector evaluates each resolved node once
- add-on descriptor hooks receive only their own authored reference, resolved
  payload, environment mapping metadata, and validation options
- backend adapters receive grouped agent-node candidates with backend, model,
  relevant steps, and active/passive validation mode
- CLI and GraphQL format the shared result objects without rechecking nodes
- loaded workflow entry points carry detailed add-on validation results forward
  before adding transport-specific source metadata or active backend preflight
  results

Step ids remain the execution addresses in result attribution. Node ids remain
payload registry identifiers and may map to multiple steps.

## Rollout Constraints

- Keep existing `ValidationIssue` behavior stable for structural validation.
- Add executable results as an additive field before making active preflight a
  blocking default anywhere.
- Preserve existing runtime readiness requirement ids where possible; add node
  validation ids separately when one requirement maps to multiple node results.
- Time-bound every active external command.
- Redact secrets and do not print raw auth tokens, environment values, or full
  backend command payloads.
- Add-on validation must remain side-effect-free unless a trusted built-in
  descriptor explicitly performs a bounded local readiness check.

## Test Expectations

Implementation should cover:

- structural validation still passes existing valid workflows without
  `--executable`
- `--executable` returns invalid node results for missing backend tools
- codex-agent active preflight reports missing auth or unreachable model
- codex-agent reports plan and effort as `not applicable` when unauthored and
  rejects authored unsupported plan or effort fields
- claude-code-agent active preflight reports missing or expired credentials
- claude-code-agent validates `PermissionMode` values, treats `plan` as the
  supported static plan mode, and reports live plan reachability as `unknown`
  when no bounded proof command exists
- claude-code-agent reports effort as `not applicable` when unauthored and
  rejects authored unsupported effort fields
- cursor-cli-agent active preflight validates mode and reports auth as unknown
  when no stable auth signal exists
- cursor-cli-agent validates `default`, `plan`, and `ask`, reports effort as
  `not applicable` when unauthored, and rejects authored unsupported effort
  fields
- add-on `validate` hooks contribute node results exactly once
- local manifest add-ons remain schema-only and do not execute code
- CLI JSON, GraphQL payloads, and library detailed validation expose the same
  `nodeValidationResults`
- CLI JSON for disk/catalog-loaded workflows includes third-party add-on
  `validate` hook results
- GraphQL named workflow validation with `workflowName` and no submitted bundle
  includes the same third-party add-on hook result as submitted-bundle
  validation
- repeated node registry entries attributed to multiple steps retain step ids in
  validation output

## References

- `src/workflow/validate.ts`
- `src/workflow/runtime-readiness.ts`
- `src/workflow/runtime-readiness-agent-probes.ts`
- `packages/divedra-addons/src/node-addons/`
- `/Users/taco/gits/tacogips/codex-agent/src/sdk/model-availability.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/cli/index.ts`
- `/Users/taco/gits/tacogips/codex-agent/src/process/types.ts`
- `/Users/taco/gits/tacogips/claude-code-agent/src/sdk/credentials/reader.ts`
- `/Users/taco/gits/tacogips/claude-code-agent/src/cli/commands/auth/status.ts`
- `/Users/taco/gits/tacogips/claude-code-agent/src/sdk/session-runner.ts`
- `/Users/taco/gits/tacogips/cursor-agent/src/cursor/model-availability.ts`
- `/Users/taco/gits/tacogips/cursor-agent/src/sdk/agent-runner.ts`
