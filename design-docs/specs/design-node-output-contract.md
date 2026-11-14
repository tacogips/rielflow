# Node Output Contract Design

This document defines how a workflow node declares the shape of its publishable output and how the runtime validates and publishes that output.

## Overview

Current runtime behavior lets adapters return a final `output.json` payload directly. That is too permissive for nodes that need a stable machine-readable contract.

This design introduces an optional per-node output contract with these goals:

- let workflow authors declare the business output shape in `node-{id}.json`
- provide that contract to the LLM/backend on every execution attempt
- keep final `output.json` and mailbox publication under runtime ownership
- reject invalid candidate outputs before downstream routing
- feed validation errors back to the LLM and request a corrected submission
- preserve deterministic artifact history for every output attempt

The runtime continues to own the execution envelope (`provider`, `model`, `when`, `completionPassed`, timestamps, mailbox writes). The LLM only proposes the business payload.

## Node Payload Contract

`node-{id}.json` gains optional `output` configuration:

```json
{
  "id": "implement",
  "executionBackend": "codex-agent",
  "model": "gpt-5",
  "promptTemplate": "Implement {{feature}}.",
  "variables": {
    "feature": "node output contracts"
  },
  "output": {
    "description": "Return the implementation summary payload used by downstream review nodes.",
    "maxValidationAttempts": 3,
    "jsonSchema": {
      "type": "object",
      "required": ["summary", "changedFiles"],
      "additionalProperties": false,
      "properties": {
        "summary": { "type": "string", "minLength": 1 },
        "changedFiles": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 }
        }
      }
    }
  }
}
```

Rules:

- `output` is optional.
- when `output` is present, it must define at least one of `output.description` or `output.jsonSchema`.
- `output.description` is optional free text passed to the backend as contract guidance, but if present it must be non-empty after trimming.
- `output.jsonSchema` is optional. If omitted, no schema validation occurs.
- `output.maxValidationAttempts` is optional and applies whenever `output` is present.
- unknown keys inside `output` are rejected at workflow validation time so contract authoring mistakes fail fast instead of being silently ignored.
- schema validation applies to the candidate business payload only, not to the runtime envelope fields.
- the candidate payload is always a top-level JSON object because published `output.payload` remains object-shaped for downstream compatibility, so the root schema must allow `object`.
- if `jsonSchema` is omitted, retries only repair malformed/non-object candidate submissions; no additional field-level schema validation occurs.

## Canonical Output Shape Rule

Published execution-local and canonical mailbox outputs remain JSON objects even
when the originating backend is text-oriented.

Rules:

- `outbox/output.json` is always a JSON file
- published `output.payload` remains a JSON object
- if a node declares `output.jsonSchema`, the candidate must satisfy that schema
- if a node does not declare `output.jsonSchema`, the runtime still requires a
  top-level JSON object business payload
- text-oriented adapters may accept raw text from a model/backend internally,
  but they must normalize it to an object before publication
- the generic fallback wrapper for semantically plain-text business output is
  `{"text":"..."}`, not `{"data":"..."}`

Rationale:

- `text` is self-describing while `data` is too generic to be a stable contract
- downstream mapping such as `output.payload.foo` remains object-oriented
- runtime inspection, GraphQL exposure, and future command/container execution
  remain consistent

## Runtime Artifact Model

Each node execution artifact directory keeps the final published output and every candidate attempt:

```text
{artifact-root}/{workflowId}/executions/{workflowExecutionId}/nodes/{nodeId}/{nodeExecId}/
  input.json
  output.json
  meta.json
  handoff.json
  output-attempts/
    attempt-000001/
      request.json
      candidate.json
      validation.json
    attempt-000002/
      request.json
      candidate.json
      validation.json
```

Artifact rules:

- `output-attempts/*/request.json` stores the exact retry-attempt request context prepared by the runtime for that attempt, including prompt augmentation, reserved candidate path, and prior validation feedback.
- `output-attempts/*/candidate.json` stores the runtime-copied candidate business payload proposed on that attempt after the runtime has read it from the reserved submission path.
- `output-attempts/*/validation.json` stores validation result details and retry feedback.
- `output.json` is written only by the runtime after successful validation, or as a terminal failure envelope when execution fails.
- mailbox `outbox/*/output.json` is copied from the runtime-published `output.json`, never from an LLM-written file.
- the reserved candidate submission path exposed to adapters should be a dedicated staging path, not a sibling of the final `output.json`, so adapters do not learn the publish location just by walking parent directories from the writable temp file.
- before each adapter attempt, the runtime clears any pre-existing file at the reserved candidate staging path so stale temp output from a prior run or retry can never be mistaken for the current submission.
- after each attempt finishes, the runtime deletes the reserved temp staging directory regardless of success or failure because the audited copy lives under `output-attempts/*/candidate.json`; the temp file is execution plumbing, not a durable artifact.

## Execution Model

For a node without `output.jsonSchema`:

1. Runtime executes the adapter once.
2. Adapter returns a candidate payload.
3. Runtime wraps it in the standard output envelope and publishes `output.json`.
4. No `output-attempts/` retry artifacts are created unless `node.output` is configured.

If `output.maxValidationAttempts` is configured without `jsonSchema`, the same flow is used except malformed/non-object candidate submissions may be retried before the runtime gives up.

For a node with `output.jsonSchema`:

1. Runtime executes the adapter with output contract metadata.
2. Adapter returns a candidate payload, or signals that its response was not a valid top-level JSON object candidate.
3. Runtime writes the candidate payload into `output-attempts/{attempt}/candidate.json`.
4. Runtime validates the candidate payload against the node schema.
5. If valid, runtime publishes the final `output.json` and may route it downstream.
6. If the candidate is malformed or schema-invalid and attempts remain, runtime records the rejection in `validation.json`, feeds a compact error summary back into the next adapter attempt, and requests a corrected payload.
7. If the final attempt is still invalid, the node execution fails and no downstream mailbox delivery is created.

## Adapter Contract

The adapter input includes:

- workflow and node ids
- execution artifact directory
- current output attempt number
- candidate path reserved for the current attempt
- explicit publication policy declaring that final `output.json` and mailbox writes are runtime-owned
- optional output contract description
- optional JSON Schema object
- prior validation failures for retry feedback

Backward compatibility:

- existing adapters may continue returning the candidate payload inline.
- future adapters may optionally write a candidate JSON file and return its path.
- candidate-file submission is only valid for nodes that explicitly configure `output`; legacy non-contract nodes must return the payload inline.
- official text-only SDK adapters must parse contract-enabled model text into a top-level JSON object candidate before returning control to the runtime. For usability, they may accept either bare JSON text or a single fenced JSON block, but they must still reject prose-wrapped or non-object responses.
- official text-only SDK adapters for non-schema nodes may continue to consume
  raw text internally, but the published candidate must still be normalized into
  an object-shaped payload such as `{"text":"..."}` before runtime publication
- deterministic/mock adapters that simulate repeated responses should key contract retries off the runtime-provided output attempt number rather than only the node execution count.
- external wrapper adapters that proxy to LLM processes should avoid exposing the final node artifact directory when `output` is configured; the reserved candidate staging path is the only output-write location they need for structured-output publication.
- in either mode, the runtime remains the only component that publishes final `output.json`.

## Validation Scope

The first implementation supports a strict, documented subset of JSON Schema. Unsupported keywords are rejected at workflow validation time so authors do not assume a stronger contract than the runtime enforces.

Initial supported keywords:

- `$schema`
- `type`
- `properties`
- `required`
- `additionalProperties`
- `items`
- `enum`
- `const`
- `minLength`
- `maxLength`
- `pattern`
- `minimum`
- `maximum`
- `minItems`
- `maxItems`
- `anyOf`
- `oneOf`
- `allOf`
- `description`
- `title`

Non-goals for the first cut:

- remote `$ref` resolution
- schema registries
- custom formats
- automatic type generation from schema

## Prompting and Feedback

The runtime appends a deterministic output-contract block to the provider prompt when `output` is configured.

The block includes:

- output description
- JSON-only response requirement for the business payload
- reserved candidate staging path for adapters that choose file-based submission
- concise schema excerpt or full schema JSON
- retry feedback from the previous failed attempt

The runtime does not expose the final publish mailbox/output path in adapter input or in the LLM prompt. The reserved candidate staging path is the only writable output target the adapter should use; runtime publication to `output.json` and mailbox snapshots happens only after successful validation.

The runtime also keeps that execution-only contract block out of the published `output.json` envelope and mailbox snapshots. Downstream nodes may consume the published output envelope, so candidate paths and retry feedback must remain internal to the execution attempt rather than becoming part of downstream-visible artifacts.

Retry feedback must stay short and machine-actionable, for example:

```text
Previous output was rejected.
- $.summary: required property is missing
- $.changedFiles[0]: must be a string
Return a corrected JSON object that satisfies the schema.
```

The runtime may truncate retry diagnostics to the first several schema errors and shorten long messages so follow-up prompts stay stable and readable.

If the node declares only `output.description` without `output.jsonSchema`, the retry instruction must not mention schema conformance. In that mode the repair loop only asks for a corrected top-level JSON object.

Malformed candidate diagnostics follow the same repair loop. This includes reserved candidate-file failures such as missing files, unreadable JSON, or non-object JSON written to the temp candidate path. For example, if a text-only backend returns prose or non-object JSON, the runtime should surface feedback such as:

```text
Previous output was rejected.
- $: response must be a top-level JSON object
Return a corrected JSON object that satisfies the schema.
```

## Identifier Visibility

The adapter/node execution receives enough identity to produce a candidate deterministically:

- `workflowId`
- `workflowExecutionId`
- `nodeId`
- `nodeExecId`
- upstream `communicationId` references that were already consumed into this execution

The adapter/node execution does not receive future transport identity:

- no future `communicationId`
- no mailbox publish path
- no permission to allocate delivery ids

Those identifiers do not exist until the runtime has accepted the candidate payload. This keeps publication authority on the runtime side and prevents adapters from coupling themselves to mailbox implementation details.

## Session and Mailbox Semantics

- the node execution still owns `nodeExecId`
- the workflow execution still owns `workflowExecutionId`
- mailbox `communicationId` allocation remains unchanged
- downstream nodes only see outputs that passed publication
- failed validation is a node execution failure, not a mailbox failure

This keeps mailbox semantics simple:

- invalid candidate output never enters mailbox transport
- `communicationId` is allocated only after a node has a publishable output

## Failure Semantics

New failure mode:

- `output_validation_failed`: adapter produced a candidate payload that failed schema validation on the final allowed attempt

When this happens:

- node execution status becomes `failed`
- `meta.json` records validation failure details
- `output.json` records a failure envelope for auditability
- no downstream transition is executed

## Compatibility and Migration

- existing workflows remain valid because `output` is optional
- existing adapters remain valid because inline payload output remains supported
- existing downstream logic remains valid because published `output.json` retains the current envelope shape and `payload` remains the business payload field
- nodes that truly produce plain text can remain schema-less, but their stable
  published shape must be `output.payload.text` per the canonical output shape
  rule

## References

See also:

- `design-docs/specs/design-node-mailbox.md`
- `design-docs/specs/design-workflow-json.md`
