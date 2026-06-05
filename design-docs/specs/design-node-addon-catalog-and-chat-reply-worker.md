# Node Add-on Catalog and Built-in Workers

This document defines an authored workflow add-on mechanism and the current
built-in worker add-ons: chat reply, agent worker, workflow package sandbox
review, x-gateway worker nodes, mail-gateway worker nodes, and MP4 audio
extraction.

## Overview

Workflow authors often need common nodes whose behavior is operational rather
than business-specific. Examples include replying to a triggering chat event,
running a standard agent-backed implementation worker, querying/posting through
x-gateway, reading/sending mail through mail-gateway, or extracting audio from
MP4 media without copying subprocess plumbing into every workflow bundle.

Authors should be able to reference these nodes as built-in add-ons from
`workflow.json` without writing a `nodes/node-*.json` payload or maintaining
provider-specific operational code in each workflow.

The add-on mechanism is an authoring and resolution layer. It does not replace
node roles, `nodeType`, output contracts, or the runtime-owned mailbox model.

## Goals

- let `workflow.json.nodes[]` reference reusable built-in and third-party
  worker nodes
- keep add-on resolution deterministic, inspectable, and validation-friendly
- ship a small deterministic built-in catalog under the `rielflow/` namespace
- keep `rielflow/` reserved for runtime-provided add-ons while allowing
  non-`rielflow/` add-ons to be resolved by host-provided extension code
- allow non-`rielflow/` add-ons to be installed in project and user scope
  add-on roots under `<scope-root>/addons`
- keep provider SDKs and credentials outside workflow bundles
- make chat replies runtime-owned and idempotent
- provide a built-in native worker that extracts MP4 audio with `ffmpeg`
- preserve authored workflow round-trips; save/edit surfaces should keep the
  add-on reference rather than expanding it into generated node JSON
- allow future external add-on distribution without designing network fetching
  into workflow load or validation

## Non-Goals

- turning workflow bundles into package manifests
- downloading third-party add-ons at workflow load time
- allowing arbitrary add-on code execution from a workflow definition
- loading arbitrary executable add-on packages directly from a workflow bundle
- adding Slack, Discord, Telegram, or web-chat fields to `workflow.json`
- providing a general media transcoding framework
- replacing `user-action` nodes, which remain the mechanism for mid-run human
  replies and approvals
- replacing ordinary `nodeFile` payloads for custom business workers

## Authoring Model

`workflow.json.nodes[]` gains an alternative to `nodeFile`: `addon`.

```json
{
  "workflowId": "chat-answer",
  "description": "Answer a chat message and post the answer back to the thread.",
  "defaults": {
    "maxLoopIterations": 3,
    "nodeTimeoutMs": 120000
  },
  "entryStepId": "step-answer",
  "nodes": [
    {
      "id": "answer",
      "role": "worker",
      "nodeFile": "nodes/node-answer.json"
    },
    {
      "id": "reply",
      "role": "worker",
      "addon": {
        "name": "rielflow/chat-reply-worker",
        "version": "1",
        "config": {
          "textTemplate": "{{inbox.latest.output.payload.text}}",
          "visibility": "public"
        },
        "inputs": {
          "replyPrefix": "Answer"
        }
      }
    }
  ],
  "steps": [
    {
      "id": "step-answer",
      "nodeId": "answer",
      "role": "worker",
      "transitions": [{ "toStepId": "step-reply" }]
    },
    {
      "id": "step-reply",
      "nodeId": "reply",
      "role": "worker",
      "transitions": []
    }
  ]
}
```

Rules:

- a node reference must provide exactly one of `nodeFile` or `addon`
- `addon` may be a string shorthand for the latest compatible built-in major
  version, but saved workflows should use the object form with an explicit
  `version`
- add-on nodes still participate in normal node ordering, step transitions,
  repeat metadata on registry nodes, completion rules, and role validation
- add-on nodes must declare `role: "worker"` unless a future add-on descriptor
  explicitly allows manager resolution; inferred worker role from `kind`,
  `control`, or `repeat` is not sufficient for add-on authoring
- `nodeType: "addon"` is a resolved runtime payload type produced by add-on
  resolution; workflow-local `nodes/node-*.json` files must not author it
- manager nodes must not use add-ons in the first iteration
- an add-on reference is part of authored workflow JSON; it is not copied into a
  `nodes/node-*.json` file during normal save/edit round-trips
- `addon.env` is an optional explicit mapping from add-on environment variable
  names to rielflow runtime environment variable names; ambient host environment
  variables are not forwarded implicitly
- `addon.inputs` is an optional invocation-specific variable map; resolved
  add-on inputs become the effective node payload `variables`
- `rielflow/` is a reserved namespace for built-ins; third-party references
  should use a distinct namespace such as `vendor/addon-name`

## Scoped Local Add-on Roots

Local add-ons can be installed under the same project/user scope model used for
workflows:

```text
<scope-root>/
  addons/
    <namespace>/
      <addon-name>/
        <version>/
          addon.json
          templates/
```

Examples:

```text
~/.rielflow/addons/acme/reviewer/1/addon.json
<project>/.rielflow/addons/team/release-note/1/addon.json
```

Rules:

- user-scope add-ons live under `~/.rielflow/addons` by default
- project-scope add-ons live under `<project>/.rielflow/addons` by default
- scope roots, including `addons`, are configurable through the scoped root
  resolver described in `design-docs/specs/design-user-scope-workflows.md`
- `RIEL_ADDON_ROOT` and `--addon-root` are direct add-on-root overrides,
  parallel to `RIEL_WORKFLOW_DEFINITION_DIR`; they point at the directory containing
  `<namespace>/<addon-name>/<version>/addon.json`
- `rielflow/` remains reserved for built-in runtime add-ons and must not be
  loaded from the filesystem add-on roots
- local filesystem add-ons are manifest/template add-ons in the first
  iteration; they must not execute arbitrary JavaScript, TypeScript, shell, or
  package lifecycle code during workflow load or validation

### Local Add-on Manifest

Each local add-on version has an `addon.json` manifest:

```json
{
  "name": "team/release-note",
  "version": "1",
  "description": "Generate a release note from upstream workflow output.",
  "allowedRoles": ["worker"],
  "resolution": {
    "kind": "node-payload-template",
    "nodeType": "agent",
    "executionBackend": "codex-agent",
    "model": "gpt-5-nano",
    "promptTemplateFile": "templates/prompt.md"
  },
  "inputSchema": {
    "type": "object"
  },
  "configSchema": {
    "type": "object"
  }
}
```

First-iteration local manifest fields:

- `name`: must match the path-derived add-on name
- `version`: must match the path-derived version
- `description`: non-empty human-readable summary
- `allowedRoles`: only `["worker"]` initially
- `resolution.kind`: `node-payload-template`
- `resolution.nodeType`: one ordinary node execution type such as `agent`,
  `command`, `container`, or `user-action`
- template fields such as `promptTemplateFile` are resolved relative to the
  add-on version directory, not the workflow directory
- `configSchema`, `envSchema`, and `inputSchema` validate authored
  `addon.config`, `addon.env`, and `addon.inputs`

`resolution` is a node payload template, not executable code. Resolution rules:

- overlay the authored workflow node id onto the resolved payload id
- render string template fields with a small context containing `addon.config`,
  `addon.inputs`, and the authored `nodeId`
- resolve `*TemplateFile` paths from the add-on version directory
- merge `addon.inputs` into the resolved payload `variables` after manifest
  defaults, so workflow-authored inputs can override add-on defaults
- never copy `addon.env` into the payload except through descriptor-approved
  explicit environment binding fields

The resolved payload must be an ordinary node payload after template expansion.
Local manifests cannot produce runtime-owned native `nodeType: "addon"` payloads
or internal executor bindings. Those remain reserved for built-in runtime
descriptors until a separate trusted executor-registration design exists.

### Local Add-on Resolution

For a workflow loaded from the scoped workflow catalog, add-on lookup order is:

1. built-in runtime catalog for `rielflow/*`
2. explicit direct add-on root override, when supplied
3. project scope add-on root, when present
4. user scope add-on root
5. host-provided resolver functions

For direct workflow definition directory mode, scoped add-on roots are not
inferred from the direct workflow definition directory. The host may still pass explicit
resolver functions, or the caller may supply `--addon-root` /
`RIEL_ADDON_ROOT`.

When scoped catalog loading receives an explicit direct add-on root override,
that root is prepended to the scoped candidates. It does not suppress project or
user fallback when the direct root does not contain the requested
`(name, version)`.

Shadowing rules:

- add-on lookup is by `(name, version)`, not only by name
- if a higher-priority scope has the requested name but not the requested
  version, lookup continues to lower-priority scopes
- if more than one candidate exists for the exact `(name, version)`, the
  highest-priority scope wins and inspection output must show the resolved
  source path
- omitted versions may resolve only when exactly one compatible version exists
  in the selected source; otherwise validation fails and asks for an explicit
  version

The normalized runtime bundle should expose local add-on provenance:

```json
{
  "nodeId": "release-note",
  "source": {
    "kind": "local-addon",
    "scope": "project",
    "name": "team/release-note",
    "version": "1",
    "manifestPath": "<project>/.rielflow/addons/team/release-note/1/addon.json"
  }
}
```

## Add-on Descriptor

Each built-in add-on is defined by a descriptor owned by the runtime build.

```typescript
interface BuiltinNodeAddonDescriptor {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly allowedRoles: readonly ["worker"];
  readonly configSchema: JsonSchemaObject;
  readonly envSchema?: JsonSchemaObject;
  readonly inputSchema?: JsonSchemaObject;
  readonly execution:
    | { readonly kind: "node-payload-template" }
    | { readonly kind: "native-addon-executor"; readonly executor: string };
  readonly output: NodeOutputContract;
}
```

The descriptor may also contain an internal payload template, prompt template,
or native executor binding. Those implementation details are not authored in
workflow bundles.

Descriptor rules:

- `name` is namespaced; built-ins use the `rielflow/` prefix
- `version` is a catalog version, not a provider model version
- major versions are compatibility boundaries
- `configSchema` validates `addon.config` before the workflow can execute
- `envSchema`, when present, can restrict or describe `addon.env` bindings for
  runtime-owned add-ons that execute external tools
- descriptors without `envSchema` must reject `addon.env` rather than preserve a
  no-op mapping
- `inputSchema`, when present, validates `addon.inputs`; resolved add-on inputs
  become the effective node payload `variables`
- descriptor resolution must produce one effective node payload with the
  authored node id overlaid onto the descriptor template
- descriptor templates must not be allowed to change graph structure; they
  produce only the payload for the single referenced node
- native add-on executors may appear in the normalized runtime shape as
  add-on execution metadata, but authored node payloads should not write that
  internal executor binding directly in the first iteration

## Third-party Resolver Boundary

Third-party add-ons can be integrated through scoped local manifests or through
host code. Host-code integration is for add-ons that cannot be expressed as a
manifest/template add-on. A host application may provide resolver functions to
validation, load, save, and execution entry points. Each resolver receives the
authored add-on reference and either:

- returns `undefined`, or no payload and no issues, to indicate "not handled"
- returns validation issues for a handled but invalid add-on reference
- returns one effective `NodePayload` for the authored node id

```typescript
interface NodeAddonResolveInput {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}

type NodeAddonPayloadResolver = (
  input: NodeAddonResolveInput,
) => NodeAddonResolveResult | undefined;
```

Resolver rules:

- built-in `rielflow/*` references are resolved by the runtime catalog and are
  not overrideable by third-party resolvers
- resolver-facing types such as `NodeAddonPayloadResolver`,
  `NodeAddonResolveInput`, `NodeAddonResolveResult`, `WorkflowNodeAddonRef`,
  `NodePayload`, and `ValidationIssue` are part of the package-root public API
  so host applications and third-party add-on packages can type their resolver
  exports without relying on private deep imports
- the package root must resolve to the side-effect-free library entry
  (`src/lib.ts` / built `dist/lib.js`), while the CLI entry remains separate, so
  importing resolver types or helpers does not execute the command-line program
- third-party resolvers should be registered explicitly by the host process
  through API options; CLI package discovery, executable local add-ons, and
  lockfile-backed loading are future work
- resolver composition should be forgiving for package authors: `undefined`
  means the resolver did not handle the reference and validation should continue
  to the next registered resolver
- handled resolver results may omit `issues`; omitted `issues` is normalized to
  an empty list so simple add-on packages can return only a `payload`
- public execution helpers must preserve resolver options when they delegate to
  the workflow runtime; otherwise add-ons would validate through low-level load
  paths but fail during normal host-driven execution
- GraphQL schema validation and save mutations are host validation entry points;
  when invoked in-process they must pass the request context's resolver options
  into workflow validation so editor validation behaves like save and execution
  and the typed request context must expose the same resolver options as
  `LoadOptions`
- editor-facing revision and inspection metadata must ignore synthetic
  `nodeFile` values on add-on nodes; only authored workflow-local node payload
  files are hashed or reported as editable node files
- resolver output is an ordinary node payload, so third-party add-ons can start
  by targeting existing `agent`, `command`, `container`, or `user-action`
  execution paths
- resolver output is treated as untrusted runtime input and is normalized
  through the same node payload validation used for workflow-local node files
  before it is accepted into the runtime bundle
- custom native `nodeType: "addon"` execution for third parties is not part of
  this phase; it requires a separate executor registration and provenance model
- resolver output must not return runtime add-on metadata; the host resolver
  boundary maps third-party references to ordinary node execution only
- resolver errors and malformed resolver results are converted into
  `ValidationIssue` records rather than crashing workflow validation
- synchronous and asynchronous third-party resolver entry points must use the
  same package-boundary normalization contract; async resolver callbacks must
  not be invoked in a pre-normalization loop that lets thrown errors or malformed
  results escape `validateWorkflowBundleDetailedAsync`
- resolver-provided `nodeValidationResults` are additive metadata on a handled
  result and must be preserved exactly when resolver errors, malformed outputs,
  or payload validation failures are converted to structural validation issues

### Add-on Executability Validation

Add-on descriptors and host resolvers may contribute node executability results
through the shared validation model in
`design-docs/specs/design-workflow-node-executability-validation.md`.

Rules:

- add-on validation returns `NodeValidationResult(status,message)` records
  rather than transport-specific CLI or GraphQL payloads
- built-in `rielflow/*` descriptors may provide bounded, side-effect-free
  `validate` hooks
- host-code resolvers may return validation results with the resolved payload
  when the host owns the add-on implementation
- local manifest/template add-ons remain schema-only in this phase; manifest
  validation may produce node results, but loading a manifest must not execute
  arbitrary JavaScript, TypeScript, shell, or package lifecycle code
- validation results must be attributed to the authored add-on node id and the
  step ids that use that registry node
- add-on validation must feed the same detailed validation output used by CLI,
  GraphQL, library callers, and runtime readiness

This keeps add-on executability DRY: the add-on descriptor owns its reusable
validation logic, while workflow validation owns result aggregation and
transport formatting.

## Loader and Validation Flow

Add-on resolution belongs between workflow JSON validation and runtime bundle
normalization:

1. Load authored `workflow.json`.
2. Validate each `WorkflowNodeRef` has exactly one source: `nodeFile` or
   `addon`.
3. Resolve `addon.name` and `addon.version` from the built-in catalog for
   `rielflow/*`, from scoped local add-on roots for manifest/template add-ons, or
   from host-provided third-party resolvers for other namespaces.
4. Validate `addon.config`, `addon.env`, and `addon.inputs` through the
   descriptor or resolver. Resolver invocation is a validation boundary:
   thrown resolver errors, rejected async resolver promises, and malformed
   resolver return values become `ValidationIssue` records with the authored
   add-on path; they do not escape library, CLI, GraphQL, or readiness
   validation calls as uncaught exceptions.
5. For local manifests and third-party resolvers, normalize the returned payload
   through ordinary node payload validation and reject runtime-owned add-on
   execution metadata.
6. Materialize an effective node payload in memory for execution,
   inspection, and validation.
7. Mark the payload provenance as add-on resolved metadata.

The normalized runtime bundle should expose enough metadata for inspection:

```json
{
  "nodeId": "reply",
  "source": {
    "kind": "builtin-addon",
    "name": "rielflow/chat-reply-worker",
    "version": "1"
  }
}
```

For local filesystem add-ons, `source.kind` is `local-addon` and includes the
resolved scope plus manifest path.

Persistence rules:

- runtime execution artifacts should include the resolved descriptor identity in
  `meta.json`
- final `output.json` and mailbox outputs stay ordinary node outputs
- workflow save/edit APIs preserve `addon` references and do not write generated
  `nodeFile` payloads unless an explicit future `workflow vendor-addon` command
  asks for that

## Built-in `rielflow/chat-reply-worker`

### Purpose

`rielflow/chat-reply-worker` sends a reply to the chat conversation associated
with `runtimeVariables.event`.

It is intended for workflows started by chat-like event sources such as:

- `chat.message`
- `chat.mention`
- `chat.command`
- web-chat messages

The add-on is still valid in non-chat test runs, but it should complete in
`dry-run` or `intent-only` mode rather than attempting provider dispatch when no
reply target exists.

### Resolved Node Behavior

The add-on resolves to a runtime-owned native worker executor. The direct
authored `nodeType` surface does not need a provider-specific value; internally
the descriptor binds the node to the chat reply add-on executor. The normalized
runtime payload may use an internal add-on execution binding, but workflow
authors should continue to use `workflow.json.nodes[].addon`.

The executor:

1. reads the execution-local inbox contract
2. renders `config.textTemplate` against the normal node template context
3. extracts provider-neutral reply target metadata from
   `runtimeVariables.event`
4. creates a deterministic `ChatReplyRequest`
5. dispatches the request through the event reply adapter registry
6. writes a normal runtime-owned node output envelope

The workflow engine should depend only on a small reply dispatch interface. The
provider adapter implementation remains in the event layer, not in
`src/workflow/`.

### Configuration

Initial config:

```typescript
interface ChatReplyWorkerConfig {
  readonly textTemplate: string;
  readonly visibility?: "public" | "ephemeral";
  readonly threadPolicy?: "same-thread" | "conversation-root";
  readonly onMissingTarget?: "fail" | "intent-only" | "dry-run";
}
```

Authored `addon.inputs`, when present, is copied into the resolved node payload
`variables`. The chat reply worker can reference those keys from
`config.textTemplate` alongside normal runtime and inbox template variables.

Defaults:

- `visibility`: `"public"`
- `threadPolicy`: `"same-thread"`
- `onMissingTarget`: `"fail"` during normal execution and `"dry-run"` when the
  workflow run is explicitly using a mock scenario

Validation rules:

- `textTemplate` is required and must render to a non-empty string
- `visibility: "ephemeral"` is accepted only when the source adapter declares
  ephemeral replies are supported
- provider-specific formatting fields are intentionally omitted from the first
  version

## Built-in Agent Worker Add-ons

Generic agent-backed worker add-ons are available for workflows that want a
compact authored reference instead of a workflow-local `node-*.json` payload:

- `rielflow/codex-worker`
- `rielflow/claude-code-worker`
- `rielflow/codex-sdk-worker`
- `rielflow/claude-sdk-worker`
- `rielflow/cursor-sdk-worker`

All five are worker-only add-ons. They resolve to ordinary `agent` node
payloads:

- `rielflow/codex-worker` sets `executionBackend: "codex-agent"`
- `rielflow/claude-code-worker` sets `executionBackend: "claude-code-agent"`
- `rielflow/codex-sdk-worker` sets `executionBackend: "official/openai-sdk"`
- `rielflow/claude-sdk-worker` sets
  `executionBackend: "official/anthropic-sdk"`
- `rielflow/cursor-sdk-worker` sets
  `executionBackend: "official/cursor-sdk"`

The add-on name selects the backend. `executionBackend` remains the low-level
runtime adapter field and is not replaced by the add-on system. SDK-backed
worker add-ons intentionally use the same authored config shape as the
CLI-agent worker add-ons so examples can switch the backend through the add-on
name without introducing provider-specific workflow fields.

Authored example:

```json
{
  "id": "implement",
  "role": "worker",
  "addon": {
    "name": "rielflow/codex-worker",
    "version": "1",
    "config": {
      "model": "gpt-5.4-codex",
      "promptTemplate": "Implement this task: {{task}}",
      "sessionPolicy": {
        "mode": "reuse"
      }
    },
    "inputs": {
      "task": "Add checkout validation"
    }
  }
}
```

Agent worker config:

```typescript
interface AgentWorkerAddonConfig {
  readonly model: string;
  readonly promptTemplate: string;
  readonly systemPromptTemplate?: string;
  readonly sessionStartPromptTemplate?: string;
  readonly sessionPolicy?: { readonly mode: "new" | "reuse" };
  readonly timeoutMs?: number;
}
```

`addon.inputs` is copied into the resolved node payload `variables`. The prompt
template can reference those keys directly, and it can also reference the normal
workflow runtime variables and inbox context.

`addon.env` is not supported by these agent worker add-ons in version `1`.
Credential and runtime environment handling remains owned by the configured
agent backend adapters. Required SDK credentials are adapter preflight inputs:
`OPENAI_API_KEY` for `official/openai-sdk`, `ANTHROPIC_API_KEY` for
`official/anthropic-sdk`, and `CURSOR_API_KEY` for `official/cursor-sdk`.
Validation should surface missing backend support or credentials as runtime
readiness/executability information rather than silently falling back to a
different worker add-on.

SDK worker regression coverage should include:

- add-on resolution for all three SDK add-ons in
  `packages/rielflow/src/workflow/node-addons/sdk-agent-workers.test.ts`
- dispatch registration for `official/openai-sdk`,
  `official/anthropic-sdk`, and `official/cursor-sdk`
- package-boundary exports for workflow add-on types in
  `packages/rielflow/src/package-boundaries.test.ts`

Verification commands:

```bash
bun test packages/rielflow/src/workflow/node-addons/sdk-agent-workers.test.ts packages/rielflow/src/workflow/adapters/dispatch.test.ts packages/rielflow/src/package-boundaries.test.ts
bun run typecheck
```

### Cursor SDK Worker Boundary

`rielflow/cursor-sdk-worker` resolves to the `official/cursor-sdk` adapter, not
to `cursor-cli-agent`. Cursor SDK behavior must remain isolated behind
`packages/rielflow-adapters/src/cursor-sdk.ts` and its runtime wrapper in
`packages/rielflow/src/workflow/adapters/cursor-sdk.ts`.

The Cursor SDK adapter may use a Bun child process to load `@cursor/sdk`,
construct a JSONL local agent store, execute one prompt, and return a small JSON
result envelope. That child-process boundary is intentional because Bun runtime
compatibility is an adapter concern, not a workflow or add-on concern. The
parent adapter should pass only the model id, working directory, store root,
message, and resolved `CURSOR_API_KEY`; the workflow model should not expose
Cursor SDK process details.

The Cursor SDK prompt boundary currently combines `systemPromptText` and the
per-turn prompt before sending the SDK message because the Cursor SDK message
API does not expose the same separate system-prompt option as the local
CLI-agent runners. That is an intentional divergence from the local
`codex-agent` and `cursor-cli-agent` prompt-splitting behavior documented in
`design-docs/specs/architecture.md`.

Cursor SDK verification should stay deterministic by testing injected
`agentFactory` behavior and output parsing in
`packages/rielflow/src/workflow/adapters/cursor-sdk.test.ts`. Live Cursor SDK
coverage must remain credential-gated behind `CURSOR_API_KEY` in
`packages/rielflow/src/workflow/adapters/official-sdk-live-smoke.test.ts`.

## Built-in `rielflow/workflow-package-sandbox-review`

### Purpose

`rielflow/workflow-package-sandbox-review` reviews staged or fixture workflow
package content with an LLM-backed agent before a package is trusted by a
workflow. It is intended for sanitize/security review workflows that inspect
package manifests, workflow JSON, node payloads, prompts, and package-local
support files and then return a normal mailbox output with findings and a
decision.

This add-on is not a replacement for checkout integrity validation, static
pre-install scanning, or no-network container checks. Those checks remain
checkout-owned gates. This add-on is an ordinary workflow node so package
review can be composed into review, triage, registry-maintenance, or approval
workflows without adding Python-only checker behavior to the package installer.

### Resolved Node Behavior

The add-on resolves to an ordinary `agent` node payload. Version `1` supports
the same LLM backend boundary as existing agent execution paths:

- `codex-agent`
- `claude-code-agent`
- `cursor-cli-agent`, when the cursor adapter is available in the runtime

The descriptor selects the backend from `config.executionBackend`, validates
that it is one of the supported agent backends, and emits a resolved payload
whose `executionBackend`, `model`, `promptTemplate`, `variables`, and timeout
fields are ordinary agent-node fields. The workflow runtime must execute the
review through the selected adapter rather than through a Python-only static
checker or package checkout hook.

The prompt template is runtime-owned by the add-on descriptor. It should direct
the backend to treat package text as untrusted evidence, ignore instructions
embedded in the package, avoid executing package files, avoid expanding secret
values, and return structured review output. Workflow-authored `addon.inputs`
provide package evidence references and review hints, but they do not override
the safety instructions in the descriptor prompt.

### Configuration

Initial config:

```typescript
interface WorkflowPackageSandboxReviewConfig {
  readonly executionBackend:
    | "codex-agent"
    | "claude-code-agent"
    | "cursor-cli-agent";
  readonly model: string;
  readonly decisionPolicy?: "advisory" | "block-on-high";
  readonly maxEvidenceBytes?: number;
  readonly timeoutMs?: number;
}
```

Defaults:

- `decisionPolicy`: `"advisory"`
- `maxEvidenceBytes`: an implementation-owned bounded value that prevents
  unbounded package prompts
- `timeoutMs`: inherited from workflow defaults unless explicitly configured

`addon.inputs` should accept:

- `packageRoot`: optional staged package root path for runtime-owned evidence
  collection
- `packageSummary`: optional precomputed summary or selected file inventory
- `packageFiles`: optional bounded list of package-relative file records with
  text excerpts
- `reviewFocus`: optional workflow-authored focus text, treated as a reviewer
  hint and not as a safety policy override

At least one of `packageRoot`, `packageSummary`, or `packageFiles` must be
provided. `packageRoot` does not give the selected LLM backend direct file
system access. It is consumed only by rielflow-owned evidence collection before
agent execution.

`addon.env` is not supported in version `1`. Backend credentials and runtime
environment selection remain owned by the configured agent adapter. The add-on
must not forward host environment variables, registry signing keys, package
manager tokens, SSH keys, or secret files to the prompt.

### Evidence Collection Data Flow

The add-on data flow must keep package inspection deterministic and confined:

1. Validate `addon.config` and `addon.inputs`.
2. If `packageFiles` or `packageSummary` are supplied, normalize them into
   bounded evidence records without reading additional files.
3. If `packageRoot` is supplied, resolve it to a real staged package directory
   before the agent node starts.
4. Walk only the package root using implementation-owned include/ignore rules.
5. Convert selected files into package-relative evidence records.
6. Redact known secret patterns and truncate records according to
   `maxEvidenceBytes`.
7. Insert only the bounded evidence records, package summary, review focus, and
   metadata into the resolved agent node variables.
8. Run the selected agent backend against the descriptor-owned prompt and
   bounded variables.

The LLM backend must never receive a host path as an instruction to inspect on
its own. It receives text evidence collected by rielflow and package-relative
paths only for attribution.

Evidence collection rules:

- reject `packageRoot` when it is absent, unreadable, or not a directory
- resolve symlinks and reject files whose real path escapes `packageRoot`
- reject absolute package evidence paths in `packageFiles`
- normalize `.` and `..` segments before evidence records are accepted
- ignore `.git`, nested `.rielflow`, runtime artifacts, checkout provenance,
  temporary files, lock/cache directories, and binary files unless a later
  explicit allow-list includes them
- read text files only, with per-file and total byte limits
- mark truncated records with byte counts in `reviewedInputs`
- redact obvious token, key, SSH private-key, and environment-secret patterns
  before prompt insertion
- preserve package-relative paths and short evidence summaries for findings

When both `packageRoot` and explicit `packageFiles` are supplied, explicit
`packageFiles` are treated as the selected evidence set and `packageRoot` is
used only as a package label/confinement reference unless a future version adds
an explicit merge mode.

### Output Contract

The add-on writes the same runtime-owned mailbox envelope as any worker node.
The node payload should include structured review data inside the normal output
payload:

- `decision`: `allow`, `warn`, or `block`
- `severity`: `info`, `low`, `medium`, `high`, or `critical`
- `summary`: concise human-readable result
- `findings`: list of package-relative findings with severity, category,
  evidence summary, and remediation
- `reviewedInputs`: package label, file count, byte count, and truncation
  metadata
- `backend`: selected execution backend and model

The add-on must not write checkout provenance records or mutate package
manifests. Workflows that want to enforce the decision should branch on the
normal mailbox output.

### Fixture Workflow

Examples should include a workflow package sandbox review fixture under
`examples/` that uses this add-on as a normal workflow node. Fixture data should
cover:

- a clean package case that produces `decision: "allow"` or advisory `warn`
- a suspicious package case with prompt-injection or credential-exfiltration
  evidence that produces `decision: "block"` when `decisionPolicy` is
  `block-on-high`

The fixture should prefer `promptTemplateFile` for any long prompts or
case-specific setup. Tests should mock or fixture the selected agent adapter so
the add-on resolution and mailbox output contract are deterministic. Clean and
suspicious cases should exercise the same bounded evidence path used by
ordinary workflows, including at least one `packageRoot` fixture that produces
package-relative evidence records before mocked `codex-agent`,
`claude-code-agent`, or `cursor-cli-agent` execution.

### Safety Boundary

The package content supplied to the backend is evidence, not instructions.
Implementation must keep these boundaries explicit:

- no package scripts, hooks, commands, or workflow nodes are executed as part of
  the add-on
- file reads are bounded, confined to `packageRoot`, and selected before prompt
  construction
- evidence summaries must avoid secret expansion and should use
  package-relative paths
- checkout static/container scanners remain available before installation and
  must not depend on LLM review
- LLM review may be used before install only when a workflow explicitly stages
  or supplies package content to this add-on

### Cursor Adapter Mapping

`cursor-cli-agent` support is intentionally an adapter selection, not a new
add-on execution mode. When configured, the add-on resolves to the same
ordinary `agent` payload shape with `executionBackend: "cursor-cli-agent"`.
Any Cursor-specific CLI flags, session behavior, availability checks, and
credential handling must stay inside the cursor adapter. If the cursor adapter
is unavailable, validation should report an executability result for the add-on
node rather than silently falling back to codex or claude.

## Built-in `rielflow/x-gateway-read`

### Purpose

`rielflow/x-gateway-read` runs a read-only x-gateway GraphQL query in a
Docker-compatible container runner. It is intended for workflow nodes that need
to inspect X/Twitter state without embedding x-gateway-specific container
plumbing or credential forwarding in each workflow-local node payload.

The add-on is worker-only and resolves to a native add-on payload with
`nodeType: "addon"`. The runtime always invokes the read-only
`x-gateway-reader` binary from the configured container image. Workflow authors
cannot override that binary with the full `x-gateway` client.

### Authored Example

```json
{
  "id": "read-post",
  "role": "worker",
  "addon": {
    "name": "rielflow/x-gateway-read",
    "version": "1",
    "env": {
      "X_GW_TOKEN": {
        "fromEnv": "ACCOUNT_A_X_GW_TOKEN"
      }
    },
    "config": {
      "queryTemplate": "{ post(id: \"{{postId}}\") { id text } }",
      "image": "ghcr.io/tacogips/x-gateway:latest",
      "runnerKind": "docker"
    },
    "inputs": {
      "postId": "123"
    }
  }
}
```

### Configuration

```typescript
interface XGatewayReadAddonConfig {
  readonly queryTemplate: string;
  readonly image?: string;
  readonly runnerKind?: "podman" | "docker" | "nerdctl";
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}
```

Defaults:

- `image`: runtime default x-gateway image
- `runnerKind`: `workflow.defaults.containerRuntime.runnerKind` or `docker`
- `runnerPath`: `workflow.defaults.containerRuntime.runnerPath` or the runner
  kind executable name
- `networkPolicy`: runner default egress behavior

Execution behavior:

1. render `config.queryTemplate` with the normal node template context
2. resolve `addon.env` mappings from the rielflow runtime environment
3. run `x-gateway-reader graphql query <rendered-query> --json` in the
   configured container image
4. parse JSON stdout into the node payload under `xGateway`
5. attach stdout/stderr as process logs

Environment rules:

- `addon.env` is supported for this add-on because the descriptor consumes it
- target and source environment variable names must be valid environment names
- string shorthand means `{ "fromEnv": "<name>" }`
- object bindings may set `required: false`
- only mapped target environment variable names are passed to the container
  process; ambient host environment variables are not forwarded implicitly
- runtime readiness treats this add-on as a Docker-compatible container runner
  requirement, including inherited workflow-level runner defaults
- runtime readiness also reports each required `addon.env` source variable as an
  environment prerequisite; unset or empty required sources block readiness, and
  optional bindings with `required: false` do not block readiness or execution

Validation rules:

- `queryTemplate` is required and must render to a non-empty string
- `runnerKind` must be `podman`, `docker`, or `nerdctl`
- `networkPolicy` must be `disabled` or `egress-allowed`
- write and mutation surfaces are intentionally omitted from version `1`

## Built-in `rielflow/x-gateway`

### Purpose

`rielflow/x-gateway` runs an x-gateway GraphQL document in a Docker-compatible
container runner. It is intended for workflow nodes that intentionally need the
full x-gateway client surface, including post mutations such as creating X
posts, while still keeping credential forwarding explicit and scoped per add-on
node.

The add-on is worker-only and resolves to a native add-on payload with
`nodeType: "addon"`. The runtime always invokes the full `x-gateway` binary
from the configured container image. Workflow authors cannot override that
binary or supply an arbitrary command.

### Authored Example

```json
{
  "id": "post-to-x",
  "role": "worker",
  "addon": {
    "name": "rielflow/x-gateway",
    "version": "1",
    "env": {
      "X_GW_CONSUMER_KEY": {
        "fromEnv": "ACCOUNT_A_X_GW_CONSUMER_KEY"
      },
      "X_GW_CONSUMER_SECRET": {
        "fromEnv": "ACCOUNT_A_X_GW_CONSUMER_SECRET"
      },
      "X_GW_ACCESS_TOKEN": {
        "fromEnv": "ACCOUNT_A_X_GW_ACCESS_TOKEN"
      },
      "X_GW_ACCESS_TOKEN_SECRET": {
        "fromEnv": "ACCOUNT_A_X_GW_ACCESS_TOKEN_SECRET"
      }
    },
    "config": {
      "documentTemplate": "mutation { createPost(text: \"{{postText}}\") { id text } }",
      "image": "ghcr.io/tacogips/x-gateway:latest",
      "runnerKind": "docker"
    },
    "inputs": {
      "postText": "Hello from rielflow"
    }
  }
}
```

### Configuration

```typescript
interface XGatewayAddonConfig {
  readonly documentTemplate: string;
  readonly image?: string;
  readonly runnerKind?: "podman" | "docker" | "nerdctl";
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}
```

Defaults:

- `image`: runtime default x-gateway image
- `runnerKind`: `workflow.defaults.containerRuntime.runnerKind` or `docker`
- `runnerPath`: `workflow.defaults.containerRuntime.runnerPath` or the runner
  kind executable name
- `networkPolicy`: runner default egress behavior

Execution behavior:

1. render `config.documentTemplate` with the normal node template context
2. resolve `addon.env` mappings from the rielflow runtime environment
3. run `x-gateway graphql query <rendered-document> --json` in the configured
   container image
4. parse JSON stdout into the node payload under `xGateway`
5. attach stdout/stderr as process logs

Environment rules match `rielflow/x-gateway-read`: only explicitly mapped target
environment variable names are exposed to the container, required source
variables are runtime readiness prerequisites, and optional bindings may set
`required: false`.

Validation rules:

- `documentTemplate` is required and must render to a non-empty string
- `runnerKind` must be `podman`, `docker`, or `nerdctl`
- `networkPolicy` must be `disabled` or `egress-allowed`
- command or binary overrides are rejected; version `1` always runs
  `x-gateway`

## Built-in `rielflow/mail-gateway-read`

### Purpose

`rielflow/mail-gateway-read` runs a read-only mail-gateway GraphQL query in a
Docker-compatible container runner. It is intended for workflow nodes that need
to inspect configured mail accounts without embedding mail-gateway-specific
container plumbing or credential path forwarding in each workflow-local node
payload.

The add-on is worker-only and resolves to a native add-on payload with
`nodeType: "addon"`. The runtime always invokes the read-only
`mail-gateway-reader` binary from the configured container image. Workflow
authors cannot override that binary with the full `mail-gateway` client.

### Authored Example

```json
{
  "id": "read-mail",
  "role": "worker",
  "addon": {
    "name": "rielflow/mail-gateway-read",
    "version": "1",
    "env": {
      "MAIL_GATEWAY_CONFIG": {
        "fromEnv": "ACCOUNT_A_MAIL_GATEWAY_CONFIG"
      }
    },
    "config": {
      "queryTemplate": "{ message(accountId: \"{{accountId}}\", messageId: \"{{messageId}}\") { id subject } }",
      "image": "ghcr.io/tacogips/mail-gateway:latest",
      "runnerKind": "docker"
    },
    "inputs": {
      "accountId": "work",
      "messageId": "msg-123"
    }
  }
}
```

### Configuration

```typescript
interface MailGatewayReadAddonConfig {
  readonly queryTemplate: string;
  readonly image?: string;
  readonly runnerKind?: "podman" | "docker" | "nerdctl";
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}
```

Defaults:

- `image`: runtime default mail-gateway image
- `runnerKind`: `workflow.defaults.containerRuntime.runnerKind` or `docker`
- `runnerPath`: `workflow.defaults.containerRuntime.runnerPath` or the runner
  kind executable name
- `networkPolicy`: runner default egress behavior

Execution behavior:

1. render `config.queryTemplate` with the normal node template context
2. resolve `addon.env` mappings from the rielflow runtime environment
3. run `mail-gateway-reader graphql --query <rendered-query>` in the configured
   container image
4. parse JSON stdout into the node payload under `mailGateway`
5. attach stdout/stderr as process logs

Environment rules match the gateway add-ons above: only explicitly mapped target
environment variable names are exposed to the container, required source
variables are runtime readiness prerequisites, and optional bindings may set
`required: false`.

Validation rules:

- `queryTemplate` is required and must render to a non-empty string
- `runnerKind` must be `podman`, `docker`, or `nerdctl`
- `networkPolicy` must be `disabled` or `egress-allowed`
- send and mutation surfaces are intentionally omitted from version `1`

## Built-in `rielflow/mail-gateway`

### Purpose

`rielflow/mail-gateway` runs a mail-gateway GraphQL document in a
Docker-compatible container runner. It is intended for workflow nodes that
intentionally need the full mail-gateway client surface, including send
mutations such as `sendMessage`, while still keeping credential forwarding
explicit and scoped per add-on node.

The add-on is worker-only and resolves to a native add-on payload with
`nodeType: "addon"`. The runtime always invokes the full `mail-gateway` binary
from the configured container image. Workflow authors cannot override that
binary or supply an arbitrary command.

### Authored Example

```json
{
  "id": "send-mail",
  "role": "worker",
  "addon": {
    "name": "rielflow/mail-gateway",
    "version": "1",
    "env": {
      "MAIL_GATEWAY_CONFIG": {
        "fromEnv": "ACCOUNT_A_MAIL_GATEWAY_CONFIG"
      }
    },
    "config": {
      "documentTemplate": "mutation { sendMessage(input: { accountId: \"{{accountId}}\", to: [\"{{to}}\"], subject: \"{{subject}}\", textBody: \"{{body}}\" }) { message { id subject } } }",
      "image": "ghcr.io/tacogips/mail-gateway:latest",
      "runnerKind": "docker"
    },
    "inputs": {
      "accountId": "work",
      "to": "person@example.test",
      "subject": "Hello",
      "body": "Hello from rielflow"
    }
  }
}
```

### Configuration

```typescript
interface MailGatewayAddonConfig {
  readonly documentTemplate: string;
  readonly image?: string;
  readonly runnerKind?: "podman" | "docker" | "nerdctl";
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}
```

Defaults:

- `image`: runtime default mail-gateway image
- `runnerKind`: `workflow.defaults.containerRuntime.runnerKind` or `docker`
- `runnerPath`: `workflow.defaults.containerRuntime.runnerPath` or the runner
  kind executable name
- `networkPolicy`: runner default egress behavior

Execution behavior:

1. render `config.documentTemplate` with the normal node template context
2. resolve `addon.env` mappings from the rielflow runtime environment
3. run `mail-gateway graphql --query <rendered-document>` in the configured
   container image
4. parse JSON stdout into the node payload under `mailGateway`
5. attach stdout/stderr as process logs

Environment rules match `rielflow/mail-gateway-read`: only explicitly mapped
target environment variable names are exposed to the container, required source
variables are runtime readiness prerequisites, and optional bindings may set
`required: false`.

Validation rules:

- `documentTemplate` is required and must render to a non-empty string
- `runnerKind` must be `podman`, `docker`, or `nerdctl`
- `networkPolicy` must be `disabled` or `egress-allowed`
- command or binary overrides are rejected; version `1` always runs
  `mail-gateway`

## Built-in `rielflow/mp4-audio-extract`

### Purpose

`rielflow/mp4-audio-extract` extracts FLAC audio from one MP4 file. The built-in
native executor renders an authored MP4 path, invokes `ffmpeg` with argv/no
shell, writes the deterministic node artifact `audio/extracted.flac`, and
publishes a concrete `audioPath` plus artifact-relative metadata.

This is a trusted runtime built-in under the reserved `rielflow/` namespace. It
is not a local manifest add-on and does not allow workflow-authored executable
code.

### Authored Example

```json
{
  "id": "extract-audio",
  "role": "worker",
  "addon": {
    "name": "rielflow/mp4-audio-extract",
    "version": "1",
    "config": {
      "mp4PathTemplate": "{{args.videoPath}}",
      "sampleRateHertz": 16000,
      "audioChannelCount": 1
    }
  }
}
```

### Configuration

Version `1` supports:

- `mp4PathTemplate`: required template that renders to the MP4 input path
- `ffmpegPath`: optional executable path, defaulting to `ffmpeg`
- `sampleRateHertz`: optional positive integer passed to `ffmpeg` as `-ar`
- `audioChannelCount`: optional positive integer passed to `ffmpeg` as `-ac`

Validation rules:

- `config` and `inputs` must be objects when present
- version must be `1`
- `mp4PathTemplate` must be a non-empty string
- `ffmpegPath` must be a non-empty string when present
- numeric audio fields must be positive integers when present

### Native Data Flow

The executor renders `mp4PathTemplate` with the normal node template context,
resolves the rendered path through the existing node working-directory policy,
and rejects empty paths or control characters. The MP4 input path may be
absolute or relative to the node execution working directory, matching existing
command and git add-on path behavior.

Audio extraction:

1. create an `audio/` child directory under the node artifact directory
2. invoke `ffmpeg` with `spawn`/argv and no shell
3. read from the rendered MP4 path and write `audio/extracted.flac`
4. fail the node with process-log attachments when `ffmpeg` exits non-zero

The default extracted audio format is FLAC with one channel unless
`audioChannelCount` sets a different channel count. `sampleRateHertz` is passed
only when authored.

### Output Contract

The add-on publishes an ordinary output payload under `audioExtract`:

```json
{
  "audioExtract": {
    "audioPath": "<artifact-dir>/audio/extracted.flac",
    "metadata": {
      "provider": "ffmpeg",
      "sourceFileName": "meeting.mp4",
      "audioArtifactPath": "audio/extracted.flac",
      "sampleRateHertz": 16000,
      "audioChannelCount": 1
    }
  }
}
```

`audioPath` is suitable for a downstream local-audio consumer such as
`rielflow/google-speech-to-text` `audioPathTemplate`. Safe metadata may include
file names, artifact-relative paths, and selected config values. It must not
include the full host environment or full source path unless an existing
artifact policy already exposes that path for native node execution.

Failure rules:

- missing or invalid MP4 path fails before invoking `ffmpeg`
- `ffmpeg` failure fails the node and attaches only process stdout/stderr logs

### Reply Target Metadata

The event trigger layer should expose reply target data in
`runtimeVariables.event`.

Provider-specific event adapters normalize their incoming data into a
provider-neutral shape:

```typescript
interface EventReplyTarget {
  readonly sourceId: string;
  readonly provider: string;
  readonly eventId: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly actorId?: string;
  readonly capabilities?: readonly ChatReplyCapability[];
}
```

Rules:

- credentials, channel secrets, and webhook signing data are never copied into
  `runtimeVariables.event`
- adapters may store provider raw payloads as event artifacts and expose only
  stable references
- missing reply target metadata is a configuration/runtime error unless
  `onMissingTarget` allows intent-only or dry-run behavior

### Reply Request

The executor submits this provider-neutral request:

```typescript
interface ChatReplyRequest {
  readonly target: EventReplyTarget;
  readonly message: {
    readonly text: string;
  };
  readonly visibility: "public" | "ephemeral";
  readonly idempotencyKey: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}
```

The idempotency key must be stable for the node execution. A retry of the same
node execution must not post duplicate chat messages.

### Output Contract

The add-on publishes an ordinary node output payload:

```json
{
  "reply": {
    "status": "sent",
    "target": {
      "sourceId": "web-chat",
      "provider": "web-chat",
      "conversationId": "thread-123"
    },
    "message": {
      "text": "The workflow result is ready."
    },
    "providerMessageId": "msg-456",
    "dispatchId": "reply-789"
  },
  "when": {
    "replied": true
  }
}
```

Allowed `reply.status` values:

- `sent`: provider dispatch completed successfully
- `queued`: provider adapter accepted the request for asynchronous delivery
- `intent-only`: the node produced a reply intent but did not dispatch it
- `dry-run`: no provider dispatch was attempted

Failure rules:

- provider rejection fails the node unless a future config explicitly allows
  best-effort replies
- an invalid rendered message fails the node
- duplicate dispatch for the same idempotency key must return the original
  dispatch result when the adapter can determine it

## Event Layer Responsibilities

The event layer owns provider reply dispatch.

Required service boundary:

```typescript
interface EventReplyDispatcher {
  dispatchChatReply(
    request: ChatReplyRequest,
  ): Promise<ChatReplyDispatchResult>;
}
```

Responsibilities:

- route by `target.sourceId` to the configured event source adapter
- enforce source adapter capabilities
- apply credentials and provider-specific endpoint details from event source
  configuration, not workflow JSON
- persist reply receipts for audit and idempotency
- normalize provider response metadata into `ChatReplyDispatchResult`

The chat reply worker add-on consumes that interface. It does not import Slack,
Discord, Telegram, or web-chat SDKs directly.

## Security and Supply Chain

Current rules:

- built-in `rielflow/*` add-ons resolve through the installed runtime catalog
- non-`rielflow/` add-ons resolve only when the host process explicitly provides
  resolver functions
- no network access occurs during workflow load or validation
- unknown or unhandled add-on names fail validation
- add-on descriptors are part of the installed runtime and are covered by the
  same release integrity model as the rest of `rielflow`
- native add-ons that execute subprocesses use `spawn` with argv and no shell
- native add-ons that need credentials consume only explicit `addon.env`
  bindings and redact credential-bearing paths or values from logs and errors
- external add-on registries, package downloads, and lockfiles are future work

Future distributed add-on support must require:

- an explicit add-on lockfile with resolved package identity and integrity
- no install scripts by default
- a local cache populated by an explicit operator command
- descriptor schema validation before any executable payload is trusted

## Compatibility

Existing workflows using `nodeFile` continue unchanged.

Add-on nodes are additive:

- authored `nodeFile` nodes remain the default
- normalized runtime payloads can use the same execution, output validation, and
  artifact publication paths as ordinary nodes
- GraphQL and TUI surfaces should display add-on provenance alongside node type
  and role
- examples can introduce add-on usage without changing existing bundle layout

## Test Expectations

The implementation should cover:

- validation rejects a node reference with both `nodeFile` and `addon`
- validation rejects a node reference with neither `nodeFile` nor `addon`
- validation rejects unknown built-in add-on names and unsupported versions
- validation rejects invalid chat reply add-on config
- validation rejects `addon.env` for descriptors that do not consume explicit
  environment bindings
- validation accepts `addon.inputs` and materializes them as resolved payload
  `variables`
- validation rejects workflow-local node payload files that author runtime-only
  `nodeType: "addon"` instead of using `workflow.json.nodes[].addon`
- validation accepts the built-in agent worker add-ons, both x-gateway add-ons,
  both mail-gateway add-ons, and `rielflow/mp4-audio-extract`
- validation rejects invalid MP4 audio extract add-on config and unsupported
  versions
- loader materializes an effective payload with the authored node id
- workflow save/edit preserves the authored `addon` reference
- chat reply worker renders text from upstream output
- chat reply worker fails when no reply target exists and `onMissingTarget` is
  `fail`
- chat reply worker emits `intent-only` or `dry-run` output when configured
- reply dispatch is idempotent across node retry/resume
- MP4 audio extract executor invokes `ffmpeg` with argv/no shell, writes
  extracted audio under the node artifact directory, and does not forward
  unrelated ambient environment values to `ffmpeg`
- provider-specific adapter code stays outside `src/workflow/`

## References

- `design-docs/specs/design-event-listener-workflow-trigger.md`
- `design-docs/specs/design-node-execution-inbox-contract.md`
- `design-docs/specs/design-node-output-contract.md`
- `design-docs/specs/design-workflow-json.md`
