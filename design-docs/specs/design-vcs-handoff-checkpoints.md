# VCS Handoff Checkpoints Design

This document defines how `divedra` creates deterministic handoff artifacts that can be checkpointed in Git/Jujutsu during long-running workflows.

## Overview

Goal: improve output-to-next-input reliability by making handoff state explicit and auditable.

`divedra` continues to use runtime artifacts as the primary execution contract, and VCS as a durability/audit layer.

## Artifact Additions

Each node execution directory:

- `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/input.json`
- `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/output.json`
- `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/meta.json`
- `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/handoff.json` (new)
- `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/commit-message.txt` (new)

### handoff.json

Purpose: stable handoff metadata for downstream consumers and VCS checkpoints.

Fields:
- `schemaVersion: 1`
- `generatedAt: string` (ISO timestamp)
- `nodeId: string`
- `outputRef`: `{ workflowExecutionId, workflowId, outputNodeId, nodeExecId, artifactDir, subWorkflowId? }`
- `inputHash: "sha256:<hex>"`
- `outputHash: "sha256:<hex>"`
- `nextNodes: string[]`

## Input Contract Extension

`input.json` adds:
- `upstreamOutputRefs: UpstreamOutputRef[]`

`UpstreamOutputRef`:
- `fromNodeId: string`
- `transitionWhen: string`
- `status: "succeeded" | "failed" | "timed_out" | "cancelled"`
- `workflowExecutionId: string`
- `workflowId: string`
- `subWorkflowId?: string`
- `outputNodeId: string`
- `nodeExecId: string`
- `artifactDir: string`

This removes implicit "latest output" behavior for downstream resolution and enables explicit references.

## Commit Message Template

`commit-message.txt` is generated per node execution to encourage consistent checkpoint metadata:

- `Node-ID`
- `Subworkflow-ID` (placeholder when not available)
- `Run-ID`
- `Workflow-ID`
- `Node-Exec-ID`
- `Artifact-Dir`
- `Input-Hash`
- `Output-Hash`
- `Next-Node`

This file is not an execution dependency. It is an operator aid for Git/JJ commits.

## Operational Guidance

- Runtime truth: artifact files (`input/output/meta/handoff`).
- Audit/recovery truth: VCS commits of those artifacts.
- Recommended commit cadence: node completion, branch decision, loop boundary.

## References

See `design-docs/references/README.md` for external references.
