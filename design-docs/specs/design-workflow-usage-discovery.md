# Workflow Usage Discovery

Design for an AI-facing workflow discovery surface that lists what each workflow
is for, how to call it, and the authored step overview an LLM needs to choose
and invoke the right workflow.

## Overview

`divedra` already has two workflow discovery surfaces:

- `workflow list` for compact human overview
- `workflow inspect <name>` for authored structure and runtime readiness

Neither surface is optimized for an LLM that needs to answer:

- Which workflow should I use for this job?
- What input should I pass to the workflow manager or entry step?
- What output should I expect back from the workflow?

This design adds a workflow-usage discovery surface that is intentionally
smaller than full structural inspection. It exposes workflow purpose, the
callable contract of the workflow's external entrypoint, and a compact summary
of the authored steps.

## Goals

- let an AI agent enumerate workflows by purpose
- expose the workflow-level call contract without requiring step-by-step graph
  analysis
- expose a compact authored step overview so the AI can understand the workflow
  stages without loading the full inspection payload
- keep the payload small enough for prompt/tool use
- preserve the existing human-focused `workflow list` contract
- reuse existing authored workflow metadata where possible

## Non-Goals

- replacing `workflow inspect` for structural debugging
- exposing low-level graph/debugging data such as transitions, dispatch ids, or
  runtime readiness in the discovery payload
- deriving undocumented input contracts from prompt text heuristics
- changing workflow execution semantics

## Key Decision

Add a dedicated `workflow usage` command rather than overloading
`workflow list`.

Reasoning:

- `workflow list` is intentionally a human overview surface
- AI-facing workflow selection needs different fields than the human overview
- a separate command avoids breaking existing CLI/JSON consumers that already
  parse `workflow list`

## Callable Contract Model

The workflow-level callable contract is derived from the workflow's externally
invocable step:

- use `managerStepId` when the workflow has a manager step
- otherwise use `entryStepId`

This derived step is called the **callable step** in this design.

The usage surface must expose:

- workflow description
- callable step id
- callable role (`manager` or `worker`)
- callable input contract
- callable output contract
- compact step summaries (`stepId`, role, optional description)

## Authored Input Contract

Node payloads already support:

- `output.description`
- `output.jsonSchema`

To make workflow invocation discoverable, add a symmetric optional `input`
contract on node payloads:

```json
{
  "input": {
    "description": "Structured manager input for issue-driven implementation.",
    "jsonSchema": {
      "type": "object"
    }
  }
}
```

Rules:

- `input` is optional
- when present, it must define `description` and/or `jsonSchema`
- the usage surface reports exactly the authored contract from the callable node
- no attempt is made to infer contracts from prompt templates or variable names

## Output Contract

The callable output contract continues to come from the callable node's existing
`output` field.

For worker-only workflows, the callable output is the entry worker's output
contract.

For manager-led workflows, the callable output is the manager step node's
output contract.

## CLI Surface

Add:

- `workflow usage`
- `workflow usage <name>`

Behavior:

- `workflow usage` lists all catalog-visible workflows with their usage
  contracts
- `workflow usage <name>` returns one resolved workflow usage contract
- scoped workflow resolution follows the same project/user rules as other
  workflow commands
- text output is concise and optimized for copying into an LLM context
- `--output json` returns the full machine-readable usage payload

Initial scope:

- local catalog inspection only
- remote GraphQL parity can be added later if needed

## Response Shape

Per workflow:

```json
{
  "workflowName": "design-and-implement-review-loop",
  "workflowId": "design-and-implement-review-loop",
  "source": {
    "scope": "project",
    "workflowDirectory": "/path/to/workflow"
  },
  "description": "Resolve a GitHub issue through design, planning, implementation, and review loops.",
  "callable": {
    "stepId": "divedra-manager",
    "role": "manager",
    "input": {
      "description": "Issue reference and repository context.",
      "jsonSchema": {
        "type": "object"
      }
    },
    "output": {
      "description": "Accepted workflow result summary and changed files."
    }
  }
}
```

Text output should avoid step-by-step graph detail and instead print:

- workflow name
- source
- description
- callable step id and role
- input description
- output description
- one compact line per authored step showing `stepId`, role, and description

## Inspection Summary Alignment

`buildInspectionSummary(...)` should expose the same derived callable contract so
existing JSON inspection and GraphQL workflow views can reuse the data.

This does not turn `workflow inspect` into the AI discovery command. It simply
keeps the single-workflow structural inspection payload aligned with the new
usage contract model.

When the callable input contract exists, text `workflow inspect <name>` should
add a short variable-usage block. The block should show copyable forms for:

- inline JSON object input, for example `--variables '{"hours":48}'`
- explicit file input, for example `--variables @./variables.json`
- historical bare file input, for example `--variables ./variables.json`

If `callable.input.jsonSchema` is an object schema with properties, the inline
example may be shaped from those properties using safe placeholder values. This
sample is an operator hint only. Runtime execution still requires a JSON object
and does not validate the object against the callable schema in this design
slice.

JSON `workflow inspect --output json` must keep the callable input as structured
data. In particular, `callable.input.jsonSchema` remains nested JSON in the
inspection payload, while text output may summarize or render it for humans.

## Skill Guidance

The divedra workflow-run skill should instruct LLMs to:

1. run `workflow usage --output json` first when choosing a workflow
2. inspect the listed description, callable input/output contract, and compact
   step overview
3. call `workflow run` only after the contract matches the requested task

This keeps workflow selection explicit and reduces prompt-time guesswork.
