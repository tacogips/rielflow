# Default Node Timeout 60 Minutes Implementation Plan

**Status**: Completed
**Created**: 2026-05-05
**Last Updated**: 2026-05-05
**Design Reference**: `design-docs/specs/design-workflow-json.md`

## Goal

Make divedra workflow node timeout behavior default to 60 minutes so long-running
agent implementation and review steps do not fail under the previous shorter
runtime default.

## Scope

Included:

- runtime fallback used when authored workflow JSON omits `defaults.nodeTimeoutMs`
- checked-in project workflow bundles that previously overrode shorter defaults
- checked-in divedra workflow bundles used for self-hosted workflows
- regression test description for omitted timeout defaults

Excluded:

- changing explicit per-node `timeoutMs` overrides
- changing active workflow sessions already started with older persisted timeout
  values
- changing stall detection or external process watchdog behavior

## Deliverables

- `src/workflow/types.ts`: set `DEFAULT_NODE_TIMEOUT_MS` to 60 minutes.
- `src/workflow/validate.test.ts`: align the default-timeout regression name
  with the 60-minute behavior.
- `.divedra/workflows/*/workflow.json`: normalize checked-in workflow bundle
  defaults to `3600000` milliseconds where the project intentionally wants the
  global default behavior.

## Completion Criteria

- [x] Omitted `defaults.nodeTimeoutMs` resolves to 60 minutes.
- [x] Project-local workflow defaults use `3600000` milliseconds.
- [x] Divedra self-hosted workflow defaults use `3600000` milliseconds.
- [x] Targeted validation and type checking pass.

## Progress Log

### Session: 2026-05-05 12:40 JST

**Tasks completed**: Updated the runtime default constant, normalized local
workflow bundle defaults, and aligned the validation test label.

**Verification**:

- `bun test src/workflow/validate.test.ts -t "defaults omitted nodeTimeoutMs"`
- `bun run typecheck`
- `bun run divedra/src/main.ts workflow validate design-and-implement-review-loop`
- `bun run divedra/src/main.ts workflow validate parity-backlog-design-implement-loop`
- `bun run divedra/src/main.ts workflow validate parity-global-design-plan-implement-loop`
- `bun run divedra/src/main.ts workflow validate recent-change-quality-loop`
- `bun run src/main.ts workflow validate design-and-implement-review-loop`
- `bun run src/main.ts workflow validate recent-change-quality-loop`
