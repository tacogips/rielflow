# Expected results (default-superviser)

This directory holds the default **`superviserWorkflowId`** bundle
(`divedra-default-superviser`) used when `--auto-improve` is combined with
`--nested-superviser` (or library `nestedSuperviserDriver`).

It is a **reference shape** for phase-2 supervision: the engine injects
`supervisionRunId`, `targetSessionId`, and `superviserTargetWorkflowId` into the
superviser session runtime variables. It is not meant as a standalone
deterministic run without a paired **target** workflow and those variables.

For an operator-facing fail-then-succeed demo with phase-1 engine supervision,
use `../supervised-mock-retry/` and `../auto-improve/README.md`.
