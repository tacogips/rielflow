# Output Contract Candidate-Path Prompt Implementation Plan

**Status**: Completed
**Created**: 2026-05-05
**Last Updated**: 2026-05-05
**Design Reference**: `design-docs/specs/architecture.md`

## Goal

Clarify output-contract prompt text so repository-editing workflow nodes do not
interpret the reserved candidate path as a global filesystem write restriction.

## Scope

Included:

- workflow-run prompt text built by `src/workflow/engine.ts`
- direct `call-step` prompt text built by `src/workflow/call-step-impl.ts`
- regression coverage for the generated prompt wording

Excluded:

- changing candidate-file validation or reserved candidate path enforcement
- changing mailbox or output artifact ownership
- changing workflow node authoring conventions

## Deliverables

- `src/workflow/engine.ts`: clarify that Candidate-Path is only for final
  structured JSON output submission.
- `src/workflow/call-step-impl.ts`: apply the same clarification for direct
  step calls.
- `src/workflow/engine.test.ts`: assert the prompt preserves the runtime-owned
  output contract while allowing instructed repository edits.

## Completion Criteria

- [x] Prompt no longer says all file writes must target Candidate-Path.
- [x] Prompt still requires final business JSON file submissions to use the
  reserved Candidate-Path.
- [x] Candidate path validation semantics are unchanged.
- [x] Targeted tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-05-05

**Tasks completed**: Updated output-contract prompt wording in workflow-run and
call-step paths, and added regression coverage for the safer wording.

**Verification**:

- `bun test src/workflow/engine.test.ts -t "makes runtime-owned publication rules explicit"`
- `bun run typecheck`
