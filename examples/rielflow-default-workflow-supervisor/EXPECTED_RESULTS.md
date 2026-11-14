# Expected Results

This helper workflow is intentionally small. It provides the supervisor
workflow id used by the chat-facing dispatcher demo while lifecycle actions are
validated and applied by the runtime dispatcher.

Stable assertions:

- The workflow validates under `--workflow-definition-dir ./examples`.
- `workflowId` is `rielflow-default-workflow-supervisor`.
- `managerStepId` and `entryStepId` both point to `rielflow-manager`.
- The graph is a one-step manager shell suitable for mock scenarios and
  integration tests.
- The paired dispatcher demo validates through
  `../default-supervisor-dispatcher/EXPECTED_RESULTS.md`.
