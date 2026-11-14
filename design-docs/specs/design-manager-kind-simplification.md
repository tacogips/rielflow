# Manager Kind Simplification

Historical note: this document is superseded by `design-docs/specs/design-unified-workflow-role-model.md` as of 2026-03-19. It records the earlier root-manager versus subworkflow-manager split only.

This document defines the planned refactor that removes product-branded nested manager kinds from the authored workflow schema while preserving the existing root-vs-sub-workflow execution model.

## Overview

The current workflow schema distinguishes manager scope with these authored kinds:

- `root-manager`
- `sub-divedra-manager`
- legacy `manager`
- legacy `sub-manager`

This has two problems:

1. `sub-divedra-manager` bakes the product name into a structural role.
2. Legacy aliases make the authored schema larger than the runtime semantics actually require.

The runtime does need an explicit distinction between the root workflow manager and a sub-workflow manager, but that distinction is about scope, not branding.

## Goals

- Keep an explicit authored distinction between root-scope and sub-workflow-scope managers.
- Rename the nested manager kind to a neutral structural term.
- Remove legacy manager-kind aliases from the authored schema and normalization path.
- Preserve current manager control, mailbox, and execution-planning behavior.
- Keep node ids, prompt file names, and workflow-level `managerNodeId` semantics unchanged.

## Non-Goals

- Renaming node ids such as `divedra-manager` or `main-divedra`
- Changing prompt templates, environment variables, or package names
- Reworking the root-manager execution model
- Introducing implicit manager-scope inference from node id naming

## Proposed Authored Schema

### `NodeKind`

The target authored `NodeKind` set becomes:

- `task`
- `branch-judge`
- `loop-judge`
- `root-manager`
- `subworkflow-manager`
- `input`
- `output`

Removed authored values:

- `manager`
- `sub-divedra-manager`
- `sub-manager`

### Structural Rules

- `workflow.managerNodeId` must reference exactly one node with kind `root-manager`.
- `subWorkflows[].managerNodeId` must reference nodes with kind `subworkflow-manager`.
- Only `workflow.managerNodeId` may use `root-manager`.
- A node cannot simultaneously satisfy both root and sub-workflow manager roles.

## Runtime Semantics

The refactor is naming cleanup, not a behavior redesign.

### Root Manager

The root manager remains responsible for:

- starting the workflow run
- planning sub-workflow entry
- validating root-scope manager-control actions
- mediating root-to-sub-workflow mailbox deliveries

### Sub-Workflow Manager

A `subworkflow-manager` remains responsible for:

- owning one `subWorkflows[]` boundary
- dispatching to that boundary's child `input`
- scoping retries, optional-node decisions, and communication replay to its owned sub-workflow

### Scope Derivation

Manager scope remains structurally derived from:

- `workflow.managerNodeId`
- `subWorkflows[].managerNodeId`

The runtime should continue using those fields for ownership and routing decisions. The kind rename should only change the authored vocabulary and the branch conditions that currently look for `sub-divedra-manager`.

## Validation and Loading

The validator and loader should enforce the new authored vocabulary directly.

Expected outcome:

- `root-manager` stays valid
- `subworkflow-manager` becomes the only valid sub-workflow manager kind
- legacy manager aliases are rejected instead of normalized

This refactor intentionally does not preserve backward compatibility for older authored workflow bundles.

## Authoring and Example Alignment

Workflow authoring tools, example bundles, workflow templates, and fixtures should all author the same canonical kinds:

```json
{
  "managerNodeId": "divedra-manager",
  "nodes": [
    { "id": "divedra-manager", "kind": "root-manager" },
    { "id": "main-divedra", "kind": "subworkflow-manager" }
  ],
  "subWorkflows": [
    {
      "id": "main",
      "managerNodeId": "main-divedra"
    }
  ]
}
```

Node ids may still contain `divedra`; the refactor only removes branding from the structural kind system.

## Affected Areas

- shared workflow types and validator
- workflow template generation and example bundles
- manager-control scope checks
- node-execution mailbox rendering and prompt composition
- engine-side manager planning branches
- editor structural kind assignment and validation messages
- tests and E2E fixtures that currently author legacy or branded nested kinds

## Risks

- test coverage is broad, so renaming the kind will create wide but shallow churn
- validator, engine, mailbox, and editor code must move together to avoid transient schema/runtime drift
- examples and test fixtures may keep passing locally if they still use old kinds through accidental normalization, so alias removal must be verified explicitly

## Acceptance Criteria

- authored workflow bundles accept `subworkflow-manager` and reject `sub-divedra-manager`
- runtime behavior for root manager and sub-workflow manager remains unchanged
- editor-created workflows persist `root-manager` and `subworkflow-manager`
- example bundles and E2E fixtures use the new canonical kind names
- repository tests and typechecks pass after the refactor
