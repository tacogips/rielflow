# Node Add-on Catalog and Built-in Workers

This document defines an authored workflow add-on mechanism and the current
built-in worker add-ons: chat reply, agent worker, x-gateway worker nodes, and
mail-gateway worker nodes.

## Overview

Workflow authors often need common nodes whose behavior is operational rather
than business-specific. Examples include replying to a triggering chat event,
running a standard agent-backed implementation worker, querying/posting through
x-gateway, or reading/sending mail through mail-gateway without copying
container and credential plumbing into every workflow bundle.

Authors should be able to reference these nodes as built-in add-ons from
`workflow.json` without writing a `nodes/node-*.json` payload or maintaining
provider-specific operational code in each workflow.

The add-on mechanism is an authoring and resolution layer. It does not replace
node roles, `nodeType`, output contracts, or the runtime-owned mailbox model.

## Goals

- let `workflow.json.nodes[]` reference reusable built-in and third-party
  worker nodes
- keep add-on resolution deterministic, inspectable, and validation-friendly
- ship a small deterministic built-in catalog under the `divedra/` namespace
- keep `divedra/` reserved for runtime-provided add-ons while allowing
  non-`divedra/` add-ons to be resolved by host-provided extension code
- allow non-`divedra/` add-ons to be installed in project and user scope
  add-on roots under `<scope-root>/addons`
- keep provider SDKs and credentials outside workflow bundles
- make chat replies runtime-owned and idempotent
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
        "name": "divedra/chat-reply-worker",
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
  names to divedra runtime environment variable names; ambient host environment
  variables are not forwarded implicitly
- `addon.inputs` is an optional invocation-specific variable map; resolved
  add-on inputs become the effective node payload `variables`
- `divedra/` is a reserved namespace for built-ins; third-party references
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
~/.divedra/addons/acme/reviewer/1/addon.json
<project>/.divedra/addons/team/release-note/1/addon.json
```

Rules:

- user-scope add-ons live under `~/.divedra/addons` by default
- project-scope add-ons live under `<project>/.divedra/addons` by default
- scope roots, including `addons`, are configurable through the scoped root
  resolver described in `design-docs/specs/design-user-scope-workflows.md`
- `DIVEDRA_ADDON_ROOT` and `--addon-root` are direct add-on-root overrides,
  parallel to `DIVEDRA_WORKFLOW_DEFINITION_DIR`; they point at the directory containing
  `<namespace>/<addon-name>/<version>/addon.json`
- `divedra/` remains reserved for built-in runtime add-ons and must not be
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

1. built-in runtime catalog for `divedra/*`
2. explicit direct add-on root override, when supplied
3. project scope add-on root, when present
4. user scope add-on root
5. host-provided resolver functions

For direct workflow definition directory mode, scoped add-on roots are not
inferred from the direct workflow definition directory. The host may still pass explicit
resolver functions, or the caller may supply `--addon-root` /
`DIVEDRA_ADDON_ROOT`.

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
    "manifestPath": "<project>/.divedra/addons/team/release-note/1/addon.json"
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

- `name` is namespaced; built-ins use the `divedra/` prefix
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

- built-in `divedra/*` references are resolved by the runtime catalog and are
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
- resolver errors and malformed resolver results are converted into validation
  issues rather than crashing workflow validation

## Loader and Validation Flow

Add-on resolution belongs between workflow JSON validation and runtime bundle
normalization:

1. Load authored `workflow.json`.
2. Validate each `WorkflowNodeRef` has exactly one source: `nodeFile` or
   `addon`.
3. Resolve `addon.name` and `addon.version` from the built-in catalog for
   `divedra/*`, from scoped local add-on roots for manifest/template add-ons, or
   from host-provided third-party resolvers for other namespaces.
4. Validate `addon.config`, `addon.env`, and `addon.inputs` through the
   descriptor or resolver.
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
    "name": "divedra/chat-reply-worker",
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

## Built-in `divedra/chat-reply-worker`

### Purpose

`divedra/chat-reply-worker` sends a reply to the chat conversation associated
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

Two generic agent-backed worker add-ons are available for workflows that want a
compact authored reference instead of a workflow-local `node-*.json` payload:

- `divedra/codex-worker`
- `divedra/claude-code-worker`

Both are worker-only add-ons. They resolve to ordinary `agent` node payloads:

- `divedra/codex-worker` sets `executionBackend: "codex-agent"`
- `divedra/claude-code-worker` sets `executionBackend: "claude-code-agent"`

The add-on name selects the backend. `executionBackend` remains the low-level
runtime adapter field and is not replaced by the add-on system.

Authored example:

```json
{
  "id": "implement",
  "role": "worker",
  "addon": {
    "name": "divedra/codex-worker",
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
agent backend adapters.

## Built-in `divedra/x-gateway-read`

### Purpose

`divedra/x-gateway-read` runs a read-only x-gateway GraphQL query in a
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
    "name": "divedra/x-gateway-read",
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
- `runnerKind`: `workflow.defaults.containerRuntime.runnerKind` or `podman`
- `runnerPath`: `workflow.defaults.containerRuntime.runnerPath` or the runner
  kind executable name
- `networkPolicy`: runner default egress behavior

Execution behavior:

1. render `config.queryTemplate` with the normal node template context
2. resolve `addon.env` mappings from the divedra runtime environment
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

## Built-in `divedra/x-gateway`

### Purpose

`divedra/x-gateway` runs an x-gateway GraphQL document in a Docker-compatible
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
    "name": "divedra/x-gateway",
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
      "postText": "Hello from divedra"
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
- `runnerKind`: `workflow.defaults.containerRuntime.runnerKind` or `podman`
- `runnerPath`: `workflow.defaults.containerRuntime.runnerPath` or the runner
  kind executable name
- `networkPolicy`: runner default egress behavior

Execution behavior:

1. render `config.documentTemplate` with the normal node template context
2. resolve `addon.env` mappings from the divedra runtime environment
3. run `x-gateway graphql query <rendered-document> --json` in the configured
   container image
4. parse JSON stdout into the node payload under `xGateway`
5. attach stdout/stderr as process logs

Environment rules match `divedra/x-gateway-read`: only explicitly mapped target
environment variable names are exposed to the container, required source
variables are runtime readiness prerequisites, and optional bindings may set
`required: false`.

Validation rules:

- `documentTemplate` is required and must render to a non-empty string
- `runnerKind` must be `podman`, `docker`, or `nerdctl`
- `networkPolicy` must be `disabled` or `egress-allowed`
- command or binary overrides are rejected; version `1` always runs
  `x-gateway`

## Built-in `divedra/mail-gateway-read`

### Purpose

`divedra/mail-gateway-read` runs a read-only mail-gateway GraphQL query in a
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
    "name": "divedra/mail-gateway-read",
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
- `runnerKind`: `workflow.defaults.containerRuntime.runnerKind` or `podman`
- `runnerPath`: `workflow.defaults.containerRuntime.runnerPath` or the runner
  kind executable name
- `networkPolicy`: runner default egress behavior

Execution behavior:

1. render `config.queryTemplate` with the normal node template context
2. resolve `addon.env` mappings from the divedra runtime environment
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

## Built-in `divedra/mail-gateway`

### Purpose

`divedra/mail-gateway` runs a mail-gateway GraphQL document in a
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
    "name": "divedra/mail-gateway",
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
      "body": "Hello from divedra"
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
- `runnerKind`: `workflow.defaults.containerRuntime.runnerKind` or `podman`
- `runnerPath`: `workflow.defaults.containerRuntime.runnerPath` or the runner
  kind executable name
- `networkPolicy`: runner default egress behavior

Execution behavior:

1. render `config.documentTemplate` with the normal node template context
2. resolve `addon.env` mappings from the divedra runtime environment
3. run `mail-gateway graphql --query <rendered-document>` in the configured
   container image
4. parse JSON stdout into the node payload under `mailGateway`
5. attach stdout/stderr as process logs

Environment rules match `divedra/mail-gateway-read`: only explicitly mapped
target environment variable names are exposed to the container, required source
variables are runtime readiness prerequisites, and optional bindings may set
`required: false`.

Validation rules:

- `documentTemplate` is required and must render to a non-empty string
- `runnerKind` must be `podman`, `docker`, or `nerdctl`
- `networkPolicy` must be `disabled` or `egress-allowed`
- command or binary overrides are rejected; version `1` always runs
  `mail-gateway`

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

- built-in `divedra/*` add-ons resolve through the installed runtime catalog
- non-`divedra/` add-ons resolve only when the host process explicitly provides
  resolver functions
- no network access occurs during workflow load or validation
- unknown or unhandled add-on names fail validation
- add-on descriptors are part of the installed runtime and are covered by the
  same release integrity model as the rest of `divedra`
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
  and both mail-gateway add-ons
- loader materializes an effective payload with the authored node id
- workflow save/edit preserves the authored `addon` reference
- chat reply worker renders text from upstream output
- chat reply worker fails when no reply target exists and `onMissingTarget` is
  `fail`
- chat reply worker emits `intent-only` or `dry-run` output when configured
- reply dispatch is idempotent across node retry/resume
- provider-specific adapter code stays outside `src/workflow/`

## References

- `design-docs/specs/design-event-listener-workflow-trigger.md`
- `design-docs/specs/design-node-execution-inbox-contract.md`
- `design-docs/specs/design-node-output-contract.md`
- `design-docs/specs/design-workflow-json.md`
