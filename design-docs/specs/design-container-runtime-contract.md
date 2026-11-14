# Container Runtime Contract

This document defines the workflow authoring contract for container-oriented
node execution metadata, including workflow-level runner defaults, node-level
container configuration, and when a node may reference a prebuilt image or a
workflow-local Containerfile/Dockerfile path.

## Overview

The current runtime executes container nodes through the native node executor,
and workflow authoring needs a canonical, validated place to declare how
container-backed execution obtains its image and which container runner should
be used by default.

The design goals for this slice are:

- keep node-level container configuration explicit and portable
- keep workflow-level container runner defaults explicit and overridable
- prefer prebuilt image references for stable execution
- allow workflow-local build metadata when image publication is not yet part of
  the workflow author's process
- reject invalid or ambiguous container configuration during workflow validation
- keep manager-owned mailbox routing separate from worker-visible container I/O surfaces
- align container worker I/O with the same execution inbox/outbox contract used by other node types

## Authoring Model

Workflow defaults may declare:

```json
{
  "defaults": {
    "containerRuntime": {
      "runnerKind": "podman",
      "runnerPath": "/usr/bin/podman"
    }
  }
}
```

Node payloads may declare:

```json
{
  "nodeType": "container",
  "durability": {
    "mode": "node-persistent",
    "mountPath": "/durable"
  },
  "container": {
    "image": "ghcr.io/example/reviewer:latest",
    "networkPolicy": "disabled"
  }
}
```

or:

```json
{
  "nodeType": "container",
  "durability": {
    "mode": "node-persistent"
  },
  "container": {
    "runnerKind": "docker",
    "build": {
      "contextPath": "containers/reviewer",
      "containerfilePath": "containers/reviewer/Containerfile",
      "target": "runtime"
    },
    "entrypoint": ["./entry.sh"],
    "argsTemplate": ["--mailbox-dir", "/mailbox"],
    "workspace": {
      "mode": "ephemeral",
      "mountPath": "/workspace"
    },
    "resources": {
      "memoryMaxMb": 512
    },
    "envTemplate": {
      "TASK_ROLE": "{{role}}"
    }
  }
}
```

## Rules

- `workflow.defaults.containerRuntime.runnerKind` defaults to `podman`
- `workflow.defaults.containerRuntime.runnerPath` is optional
- `nodeType = "container"` requires a `container` object
- `container` nodes do not require agent-only `model` or `promptTemplate` fields
- `container.runnerKind`, when omitted, falls back to workflow defaults and then
  to `podman`
- `container.runnerPath`, when omitted, falls back to workflow defaults
- exactly one image source must be declared for a `container` node:
  - `image`
  - `build`
- `build.contextPath` must be a workflow-relative path without `.` or `..`
  segments
- `build.containerfilePath`, when provided, must also be workflow-relative
  without `.` or `..` segments
- `build.containerfilePath` must not target
  canonical workflow definition files
  such as `workflow.json` or `node-*.json`
- `build.target`, when provided, must be a non-empty string
- `podman`, `docker`, `nerdctl`, and `apple-container` are valid runner kinds
- host-side environments such as Colima, OrbStack, and Lima are not runner
  kinds; they are environment/provider details outside this contract
- container workers must not read canonical cross-node communication directories
  directly
- instead, the runtime exposes a node-local execution mailbox root, typically at
  `/mailbox`, and sets `DIVEDRA_MAILBOX_DIR` to that mount path
- worker-facing metadata under that mailbox root must use relative paths such as
  `inbox/input.json` and `outbox/output.json`, not host absolute paths
- managers remain the only components that create or route canonical mailbox
  artifacts
- file inputs for `container` nodes use no extra mount mechanism; worker-visible
  file refs must resolve under `inbox/files/` relative to `DIVEDRA_MAILBOX_DIR`
- staged output for a container node must be written under `outbox/` relative to
  `DIVEDRA_MAILBOX_DIR`;
  only the runtime may promote that staged output into canonical execution
  artifacts or downstream routed messages
- `durability.mode = "node-persistent"` mounts a writable host-backed durable
  directory into the container at `durability.mountPath` or `/durable`
- durable host storage is scoped to workflow id and node id:
  - `{artifact-root}/{workflow_id}/durable/{node_id}/`
- `durability` is distinct from `sessionPolicy`; it is workload-managed
  filesystem persistence, not runtime-managed conversational session reuse
- `stdout` and `stderr` are captured as logs only
- container process environment is explicit:
  - the container receives rendered `container.envTemplate` values
  - the runtime injects `DIVEDRA_MAILBOX_DIR`, `DIVEDRA_WORKFLOW_ID`,
    `DIVEDRA_WORKFLOW_EXECUTION_ID`, `DIVEDRA_NODE_ID`, and
    `DIVEDRA_NODE_EXEC_ID`
  - ambient host environment variables are available to the runner process
    itself, but are not forwarded into the container unless the workflow
    author explicitly maps them through `envTemplate`
- `workspace.mode = "ephemeral"` may expose a writable scratch mount, typically
  at `/workspace`
- `networkPolicy` may be `disabled` or `egress-allowed`
- `resources.cpuMax`, `resources.memoryMaxMb`, and `resources.pidsMax`, when
  present, must be positive

## Why Containerfile Path Is Canonical

The primary execution identity for a container node should still be an image
reference.
That keeps runtime behavior reproducible and decouples node execution from local
build policy.

However, requiring every container workflow author to pre-publish an image is too
heavy for local development. The optional `build` block provides a canonical
place for workflow-local build metadata, including `containerfilePath`, without
forcing all nodes into a Dockerfile-driven model.

## Runtime Behavior

Current runtime behavior:

- workflow validation accepts and preserves the container metadata
- `runWorkflow()` and `call-step` execute container nodes through the native
  executor
- the runtime prepares mailbox bind mounts, optional workspace and durable
  mounts, and captures `stdout.log` / `stderr.log`
- runner availability remains an environment/readiness concern rather than a
  schema concern

## Future Executor Shape

The future implementation should introduce a dedicated container-runtime
manager/executor layer between workflow execution and runner-specific process
launching.

That layer is responsible for:

- merging workflow-level `defaults.containerRuntime` with node-level
  `container` overrides
- resolving the runner binary from `runnerKind` and optional `runnerPath`
- preparing execution-local bind mounts, including `/mailbox/inbox` and
  `/mailbox/outbox`
- preparing `DIVEDRA_MAILBOX_DIR` for the container process
- preparing optional scratch workspace mounts such as `/workspace`
- preparing optional durable mounts such as `/durable` backed by
  `{artifact-root}/{workflow_id}/durable/{node_id}/`
- invoking runner-specific launch/build behavior for `podman`, `docker`,
  `nerdctl`, or `apple-container`
- enforcing normalized resource and network policy before launch
- capturing `stdout`, `stderr`, exit status, timeout, and cancellation outcomes
- normalizing runner results back into the workflow runtime contract

Runner-specific CLI details should stay behind that manager/executor boundary
rather than leaking into workflow orchestration logic.

## V1 Behavioral Recommendations

- v1 supports one-shot container jobs only; long-lived service/compose-style
  containers are out of scope
- exit code `0` advances to runtime output validation; non-zero exit codes fail
  the node
- timeout and user/runtime cancellation are distinct failure classes
- exit code `0` with missing required staged output still fails the node
- retries launch a fresh container with the same immutable inbox snapshot and a
  fresh scratch workspace when enabled
- when `durability.mode = "node-persistent"` is enabled, later calls of the
  same workflow/node identity reuse the same durable storage mount
- container logs should be persisted into the node artifact directory as
  `stdout.log` and `stderr.log`
