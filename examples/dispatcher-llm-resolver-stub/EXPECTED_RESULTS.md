# Expected Results

This helper workflow is intentionally small. It is the resolver target used by
the default supervisor-dispatcher demo, not a standalone product workflow.

Stable assertions:

- The workflow validates under `--workflow-definition-dir ./examples`.
- The workflow is worker-only and starts at `resolver-worker`.
- The `resolver-worker` node uses `codex-agent` with the workflow-local
  `prompts/resolver-worker.md` prompt.
- Supervisor-dispatcher mock scenarios under `../default-supervisor-dispatcher/`
  can override this worker output to exercise direct-answer and
  start-managed-workflow decisions.
