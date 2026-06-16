# Swift Stdio Node JSONL I/O Implementation Plan

## Header

- Plan ID: `swift-stdio-node-io`
- Status: Completed
- Owner: Codex
- Created: 2026-06-13
- Updated: 2026-06-13
- Design Reference: `design-docs/specs/design-swift-stdio-node-io.md`
- Workflow: `codex-design-and-implement-review-loop` manually continued after
  the earlier automated Rielflow run stalled

## Scope

Replace the temporary Swift command/container environment/file contract with a
stdio JSONL contract. Rielflow writes the resolved input envelope as one JSONL
value to stdin, parses stdout JSONL as the candidate output, validates output
JSON, and records accepted output or failures through the runtime store.

## Tasks

### TASK-001 Model And Contract

- Status: Completed
- Add command/container execution metadata to `AgentNodePayload`.
- Add a Core stdio-node executor protocol and invocation envelope.
- Preserve decode compatibility for command/container nodes without `model`.

### TASK-002 Runtime Publication

- Status: Completed
- Route command/container nodes through an injected stdio-node executor.
- Record invalid output as failed step execution.
- Allow missing or empty output to complete a root step without accepted output.

### TASK-003 Local Process And Container Executor

- Status: Completed
- Implement a local process executor in `RielflowAdapters`.
- Pass the input envelope to stdin as one JSONL value.
- Parse stdout as zero or one JSONL output value.
- Strip `RIEL_MAILBOX_DIR`.
- Build container runner arguments with stdin attached through `-i`.

### TASK-004 Verification And Documentation

- Status: Completed
- Add deterministic Core and Adapters tests for valid output, empty output,
  invalid JSON, multiple stdout records, and container stdin construction.
- Update design and implementation-plan tracking.
- Run focused and full Swift verification.

## Verification

- Passed:
  - `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test --filter 'WorkflowStdioNodeExecutorTests|DeterministicWorkflowRunnerTests'`
    plus `AgentAdapterTests/testFoundationRunnerUnsetsAmbientEnvironmentKeys`
    passed 27 tests.
  - `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test`
    passed 262 tests.
  - CLI smoke proved a command-node workflow reads JSONL stdin, writes JSONL
    stdout, and produces accepted root output `{"received":"rielflow"}`.
  - CLI smoke proved invalid stdout JSONL fails the workflow with
    `invalidOutput`.
  - `jq empty impl-plans/PROGRESS.json`
  - `git diff --check`

## Notes

Container input uses stdin because it is the standard process boundary shared by
Docker-compatible runners and ordinary scripts. The Swift executor uses
`docker run --rm -i` style arguments so the runtime can write the same one-line
JSONL input to the runner process stdin.

Self-review must keep command-node fail-closed coverage for multiple
publishable direct transitions so stdio-node behavior stays aligned with agent
and add-on execution.
