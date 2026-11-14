# Workflow Execution Working Directory

This document defines how workflow execution working directories are resolved at run time.

## Overview

Workflow execution needs a stable working directory concept that is separate from workflow bundle lookup and runtime artifact roots.

The runtime now distinguishes:

- command invocation directory: the caller `cwd` used to resolve relative CLI/library inputs
- workflow execution working directory: the effective base directory for a workflow run
- node working directory: an optional per-node override resolved from the workflow execution working directory

## Resolution Rules

### Workflow Execution Working Directory

When a workflow run does not specify a working directory, the runtime must use the command invocation directory.

When a workflow run specifies a working directory:

- absolute paths are used as-is after normalization
- relative paths are resolved from the command invocation directory
- surrounding whitespace is trimmed; whitespace-only values are invalid

This execution working directory affects node execution only. It does not change workflow root lookup, artifact root lookup, or session-store lookup.

### Node Working Directory

Each node payload may specify a top-level `workingDirectory`.

- absolute node paths are used as-is after normalization
- relative node paths are resolved from the effective workflow execution working directory
- surrounding whitespace is trimmed before validation and resolution

This field must be available to manager nodes and worker nodes, not only native command/container nodes.

### Legacy Native Command Override

`command.workingDirectory` remains accepted for compatibility with existing native command nodes.

- it follows the same absolute-or-relative resolution rule as the new node-level field
- surrounding whitespace is trimmed before validation and resolution
- when both `nodePayload.workingDirectory` and `command.workingDirectory` are present, the node-level field wins

### Container-Specific Internal Working Directory

`container.workingDirectory` remains a separate container-runtime concept.

- it still represents an in-container absolute path passed to the container runner
- it is not redefined by this design

## Public Interfaces

Execution-time workflow working directory must be exposed through:

- CLI workflow/session execution commands via `--working-dir` / `--working-directory`
- GraphQL execution inputs as `workingDirectory`
- library workflow execution inputs as `workflowWorkingDirectory`

The workflow JSON bundle does not add a workflow-level persisted working directory field. The workflow execution working directory is runtime input, not authored workflow structure.

## Validation

Node-level `workingDirectory` and compatibility `command.workingDirectory` accept any non-empty string path.

- empty strings are invalid
- whitespace-only strings are invalid
- values are not constrained to workflow-relative paths

## Runtime Backends

The effective node working directory must be threaded into:

- local Codex adapter session `cwd`
- local Claude adapter runner `cwd` and `projectPath`
- native command node process spawn `cwd`

Remote SDK backends do not consume a local filesystem working directory directly, but they should still receive the resolved value in the adapter input contract for consistency.
