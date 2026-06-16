# Swift Stdio Node JSONL I/O

## Purpose

Swift workflow execution must support command and container nodes without
reintroducing worker-visible inbox/outbox message files. Rielflow remains the
owner of runtime message routing and stores accepted node output through the
runtime store, backed by SQLite in production.

## Contract

Command and container workers use the same stdio JSONL contract:

- stdin contains one UTF-8 JSON object followed by `\n`.
- stdout contains zero or one UTF-8 JSON object line.
- Empty stdout means the node produced no workflow output.
- Non-empty stdout must contain valid top-level JSON object data on one JSONL
  record.
- Multiple non-empty stdout JSONL records fail closed for the current Swift
  single-output runtime contract.
- Invalid JSON fails the node before publication.
- Valid JSON is validated by Rielflow and then published through the runtime
  store; workers never create canonical workflow message rows directly.

There is no `RIELFLOW_WORKFLOW_INPUT` or `RIELFLOW_WORKFLOW_OUTPUT` data path in
the script/container ABI. Environment variables remain available only for
identity metadata and explicit user-configured values.
The runtime strips ambient and authored `RIEL_MAILBOX_DIR`,
`RIELFLOW_WORKFLOW_INPUT`, and `RIELFLOW_WORKFLOW_OUTPUT` before launching the
worker process.

The stdin input value includes:

- `workflowId`
- `workflowExecutionId`
- `stepId`
- `nodeId`
- `executionIndex`
- `nodeType`
- `variables`
- `input`

The stdout value is the workflow output object itself, or an output-contract
envelope object containing `when`, `payload`, and optional `completionPassed`.

## Command Nodes

Command nodes declare:

```json
{
  "nodeType": "command",
  "command": {
    "executable": "node",
    "arguments": ["worker.js"],
    "environment": {
      "APP_ENV": "local"
    }
  }
}
```

Swift resolves non-absolute executables through `/usr/bin/env` so workflow
definitions can use `node`, `python3`, or similar PATH-based tools.

At execution time, Swift writes exactly one JSONL value to command stdin and
parses command stdout as JSONL candidate output. stderr remains diagnostic-only.

## Container Nodes

Container nodes declare:

```json
{
  "nodeType": "container",
  "container": {
    "runnerKind": "docker",
    "image": "ghcr.io/example/worker:latest",
    "command": ["./run.sh"],
    "environment": {
      "APP_ENV": "local"
    }
  }
}
```

Swift invokes the configured runner with stdin attached to the container. For
Docker-compatible runners, the executor uses `run --rm -i` so the same single
JSONL input value can be delivered through container stdin.

Container stdout is parsed as JSONL candidate output. stderr remains
diagnostic-only.

## Validation And Persistence

The Swift executor parses stdout before publication:

- empty stdout returns no payload and records the step as completed without
  accepted output
- malformed JSON or a non-object top-level value throws `invalid_output`
- multiple non-empty JSONL records throw `invalid_output`
- valid object output is passed to the normal output validator and publisher

The runtime publisher records failed executions for invalid output. Accepted
objects are stored as accepted output and routed to downstream steps through the
runtime store.

## Non-Goals

- Do not reintroduce `RIEL_MAILBOX_DIR`, `inbox/input.json`, or
  `outbox/output.json`.
- Do not let workers write canonical workflow message rows directly.
- Do not use `RIELFLOW_WORKFLOW_INPUT` or `RIELFLOW_WORKFLOW_OUTPUT` as the
  script/container data exchange channel.
