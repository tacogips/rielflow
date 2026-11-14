# Implementation Plans

This directory contains implementation plans that translate design documents into actionable implementation specifications.

## Purpose

Implementation plans bridge design documents (what to build) and actual code (how to build). They provide:

- Clear deliverables without code
- Interface and function specifications
- Dependency mapping for concurrent execution
- Progress tracking across sessions

## Directory Structure

```
impl-plans/
├── README.md
├── PROGRESS.json
├── active/
├── completed/
└── templates/
```

## Active Plans

| Plan                          | Status      | Design Reference                     |
| ----------------------------- | ----------- | ------------------------------------ |
| `workflow-role-unification`   | In Progress | `design-unified-workflow-role-model` |

## Completed Plans

| Plan                                               | Completed  | Design Reference                                                                                    |
| -------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `root-data-dir-project-root-scoping`               | 2026-03-26 | `command`, `architecture`                                                                           |
| `tui-solid-runtime-fallback-hardening`             | 2026-03-26 | `design-tui`, `architecture`                                                                        |
| `tui-opentui-solid-migration`                      | 2026-03-26 | `design-tui`, `command`                                                                             |
| `tui-workflow-browser-and-json-input`              | 2026-03-26 | `design-tui`                                                                                        |
| `remove-web-ui`                                   | 2026-03-24 | `command`                                                                                           |
| `manager-kind-simplification`                      | 2026-03-18 | `design-manager-kind-simplification`, `design-workflow-json`                                        |
| `workflow-core-and-validation`                     | 2026-02-23 | `design-data-model`, `design-workflow-json`, `architecture`                                         |
| `workflow-cli-mvp`                                 | 2026-02-23 | `command`, `design-workflow-json`                                                                   |
| `workflow-execution-and-session`                   | 2026-02-24 | `architecture`, `command`                                                                           |
| `workflow-serve-mvp`                               | 2026-02-23 | `design-workflow-web-editor`, `architecture`, `command`                                             |
| `workflow-vcs-handoff-checkpoints`                 | 2026-02-23 | `architecture`, `design-vcs-handoff-checkpoints`                                                    |
| `workflow-save-revision-api`                       | 2026-02-24 | `design-workflow-web-editor`                                                                        |
| `workflow-web-editor-execution`                    | 2026-03-15 | `design-workflow-web-editor`                                                                        |
| `workflow-deterministic-mock-and-rerun`            | 2026-02-24 | `architecture`, `command`                                                                           |
| `autonomous-execution-gap-closure`                 | 2026-02-24 | `design-autonomous-execution-gap-closure`                                                           |
| `workflow-tui-mvp`                                 | 2026-02-25 | `design-tui`                                                                                        |
| `workflow-tui-cli-parity`                          | 2026-02-25 | `design-tui`                                                                                        |
| `workflow-tui-resume-decoupling`                   | 2026-02-25 | `design-tui`                                                                                        |
| `node-execution-backend-selection`                 | 2026-03-07 | `architecture`                                                                                      |
| `node-output-contract-and-validation`              | 2026-03-07 | `design-node-output-contract`, `design-data-model`, `architecture`                                  |
| `divedra-manager-prompt-contract`                  | 2026-03-07 | `design-divedra-manager-prompt-contract`, `architecture`                                            |
| `node-session-reuse`                               | 2026-03-07 | `design-node-session-reuse`, `architecture`, `design-data-model`                                    |
| `node-backend-model-separation`                    | 2026-03-07 | `design-node-backend-model-separation`, `design-data-model`, `design-workflow-json`, `architecture` |
| `runtime-owned-external-output-publication`        | 2026-03-08 | `design-runtime-owned-external-output-publication`, `architecture`, `design-node-output-contract`   |
| `mailbox-delivery-manager-ownership`               | 2026-03-08 | `design-node-mailbox`, `architecture`                                                               |
| `mailbox-output-snapshot-fidelity`                 | 2026-03-08 | `design-node-mailbox`, `architecture`                                                               |
| `mailbox-cross-boundary-routing-scope`             | 2026-03-09 | `design-node-mailbox`, `architecture`                                                               |
| `mailbox-cross-boundary-edge-validation`           | 2026-03-09 | `design-node-mailbox`, `design-workflow-json`, `architecture`                                       |
| `mailbox-artifact-atomic-writes`                   | 2026-03-09 | `design-node-mailbox`, `architecture`                                                               |
| `branch-and-loop-block-subworkflows`               | 2026-03-09 | `design-workflow-json`, `design-data-model`, `architecture`, `design-workflow-web-editor`           |
| `refactoring-shared-ui-contract`                   | 2026-03-10 | `design-refactoring-shared-ui-contract`                                                             |
| `refactoring-shared-visualization-derivation`      | 2026-03-10 | `design-refactoring-shared-visualization-derivation`                                                |
| `refactoring-shared-editable-workflow-types`       | 2026-03-10 | `design-refactoring-shared-editable-workflow-types`                                                 |
| `refactoring-editor-api-client`                    | 2026-03-10 | `design-refactoring-editor-api-client`                                                              |
| `refactoring-editor-workflow-operations`           | 2026-03-10 | `design-refactoring-editor-workflow-operations`                                                     |
| `refactoring-editor-support-helpers`               | 2026-03-10 | `design-refactoring-editor-support-helpers`                                                         |
| `refactoring-editor-state-helpers`                 | 2026-03-10 | `design-refactoring-editor-state-helpers`                                                           |
| `refactoring-editor-mutation-helpers`              | 2026-03-10 | `design-refactoring-editor-mutation-helpers`                                                        |
| `refactoring-editor-data-loaders`                  | 2026-03-10 | `design-refactoring-editor-data-loaders`                                                            |
| `refactoring-editor-field-updates`                 | 2026-03-09 | `design-refactoring-editor-field-updates`                                                           |
| `refactoring-server-api-request-parsing`           | 2026-03-09 | `design-refactoring-server-api-request-parsing`                                                     |
| `refactoring-editor-execution-helpers`             | 2026-03-09 | `design-refactoring-editor-execution-helpers`                                                       |
| `refactoring-editor-action-helpers`                | 2026-03-10 | `design-refactoring-editor-action-helpers`                                                          |
| `refactoring-server-ui-asset-serving`              | 2026-03-10 | `design-refactoring-server-ui-asset-serving`                                                        |
| `refactoring-editor-component-boundaries`          | 2026-03-09 | `design-refactoring-editor-component-boundaries`                                                    |
| `refactoring-server-workflow-bundle-parsing`       | 2026-03-09 | `design-refactoring-server-workflow-bundle-parsing`                                                 |
| `refactoring-editor-main-panel-component`          | 2026-03-09 | `design-refactoring-editor-main-panel-component`                                                    |
| `refactoring-frontend-solidjs-migration`           | 2026-03-09 | `design-workflow-web-editor`, `design-refactoring-investigation-plan`                               |
| `refactoring-editor-session-controller`            | 2026-03-09 | `design-refactoring-editor-session-controller`, `design-workflow-web-editor`                        |
| `frontend-mode-built-asset-contract`               | 2026-03-09 | `design-workflow-web-editor`, `architecture`                                                        |
| `frontend-mode-package-root-alignment`             | 2026-03-09 | `design-workflow-web-editor`, `architecture`                                                        |
| `frontend-tooling-package-root-alignment`          | 2026-03-09 | `design-workflow-web-editor`, `architecture`                                                        |
| `graphql-manager-control-plane`                    | 2026-03-15 | `design-graphql-manager-control-plane`                                                              |
| `graphql-manager-control-plane-surface`            | 2026-03-15 | `design-graphql-manager-control-plane`                                                              |
| `graphql-manager-ambient-context-transport`        | 2026-03-15 | `design-graphql-manager-control-plane`                                                              |
| `graphql-manager-artifact-atomic-writes`           | 2026-03-15 | `architecture`, `design-graphql-manager-control-plane`                                              |
| `graphql-manager-runtime-session-lifecycle`        | 2026-03-15 | `design-graphql-manager-runtime-session-lifecycle`, `design-graphql-manager-control-plane`          |
| `graphql-manager-http-context-isolation`           | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                              |
| `graphql-manager-control-mode-exclusivity`         | 2026-03-15 | `design-graphql-manager-control-plane`, `design-graphql-manager-runtime-session-lifecycle`          |
| `graphql-manager-control-mode-claim-atomicity`     | 2026-03-15 | `design-graphql-manager-control-plane`, `notes`                                                     |
| `graphql-manager-message-id-collision-safety`      | 2026-03-15 | `design-graphql-manager-control-plane`, `notes`                                                     |
| `graphql-manager-idempotency-canonicalization`     | 2026-03-15 | `design-graphql-manager-control-plane`                                                              |
| `graphql-manager-communication-scope-enforcement`  | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                              |
| `graphql-manager-attachment-scope-enforcement`     | 2026-03-15 | `design-graphql-manager-control-plane`, `command`, `notes`                                          |
| `graphql-manager-http-transport-context-hardening` | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                              |
| `graphql-cli-execution-transport`                  | 2026-03-15 | `design-graphql-manager-control-plane`, `command`                                                   |
| `graphql-browser-execution-session-migration`      | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                              |
| `graphql-browser-workflow-definition-migration`    | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                              |
| `graphql-library-rest-surface-simplification`      | 2026-03-16 | `design-graphql-manager-control-plane`, `architecture`, `command`                                   |
| `runtime-artifact-atomic-write-collision-safety`   | 2026-03-15 | `architecture`, `design-graphql-manager-control-plane`                                              |
| `tui-resume-runtime-variable-merge`                | 2026-03-15 | `design-tui`, `command`                                                                             |
| `example-node-combination-showcase`                | 2026-03-17 | `design-workflow-json`, `design-container-runtime-contract`, `architecture`                         |
| `node-execution-inbox-contract`                    | 2026-03-17 | `design-node-execution-inbox-contract`, `design-node-mailbox`, `architecture`                       |
| `user-action-and-optional-node-execution`          | 2026-03-18 | `design-user-action-and-optional-node-execution`                                                    |

## Phase Dependencies

| Phase | Status      | Depends On |
| ----- | ----------- | ---------- |
| 1     | COMPLETED   | -          |
| 2     | COMPLETED   | Phase 1    |
| 3     | COMPLETED   | Phase 2    |
| 4     | COMPLETED   | Phase 3    |
| 5     | COMPLETED   | Phase 4    |
| 6     | COMPLETED   | Phase 5    |
| 7     | COMPLETED   | Phase 6    |
| 8     | COMPLETED   | Phase 7    |
| 9     | COMPLETED   | Phase 8    |
| 10    | COMPLETED   | Phase 9    |
| 11    | COMPLETED   | Phase 10   |
| 12    | COMPLETED   | Phase 11   |
| 13    | COMPLETED   | Phase 12   |
| 14    | COMPLETED   | Phase 13   |
| 15    | COMPLETED   | Phase 14   |
| 16    | COMPLETED   | Phase 15   |
| 17    | COMPLETED   | Phase 16   |
| 18    | COMPLETED   | Phase 17   |
| 19    | COMPLETED   | Phase 18   |
| 20    | COMPLETED   | Phase 19   |
| 21    | COMPLETED   | Phase 20   |
| 22    | COMPLETED   | Phase 21   |
| 23    | COMPLETED   | Phase 22   |
| 24    | COMPLETED   | Phase 23   |
| 25    | COMPLETED   | Phase 24   |
| 26    | COMPLETED   | Phase 25   |
| 27    | COMPLETED   | Phase 26   |
| 28    | COMPLETED   | Phase 27   |
| 29    | COMPLETED   | Phase 28   |
| 30    | COMPLETED   | Phase 29   |
| 31    | COMPLETED   | Phase 30   |
| 32    | COMPLETED   | Phase 31   |
| 33    | COMPLETED   | Phase 32   |
| 34    | COMPLETED   | Phase 33   |
| 35    | COMPLETED   | Phase 34   |
| 36    | COMPLETED   | Phase 35   |
| 37    | COMPLETED   | Phase 36   |
| 38    | COMPLETED   | Phase 37   |
| 39    | COMPLETED   | Phase 38   |
| 40    | COMPLETED   | Phase 39   |
| 41    | COMPLETED   | Phase 40   |
| 42    | COMPLETED   | Phase 41   |
| 43    | COMPLETED   | Phase 42   |
| 44    | COMPLETED   | Phase 43   |
| 45    | COMPLETED   | Phase 44   |
| 46    | COMPLETED   | Phase 45   |
| 47    | COMPLETED   | Phase 46   |
| 48    | COMPLETED   | Phase 47   |
| 49    | COMPLETED   | Phase 48   |
| 50    | COMPLETED   | Phase 49   |
| 51    | COMPLETED   | Phase 50   |
| 52    | COMPLETED   | Phase 51   |
| 53    | COMPLETED   | Phase 52   |
| 54    | COMPLETED   | Phase 53   |
| 55    | COMPLETED   | Phase 54   |
| 56    | COMPLETED   | Phase 55   |
| 57    | COMPLETED   | Phase 56   |
| 58    | COMPLETED   | Phase 57   |
| 59    | COMPLETED   | Phase 58   |
| 60    | COMPLETED   | Phase 59   |
| 61    | COMPLETED   | Phase 60   |
| 62    | COMPLETED   | Phase 61   |
| 63    | COMPLETED   | Phase 62   |
| 64    | COMPLETED   | Phase 63   |
| 65    | COMPLETED   | Phase 64   |
| 66    | COMPLETED   | Phase 65   |
| 67    | COMPLETED   | Phase 66   |
| 68    | COMPLETED   | Phase 67   |
| 69    | COMPLETED   | Phase 68   |
| 70    | COMPLETED   | Phase 69   |
| 71    | IN_PROGRESS | Phase 70   |
| 72    | COMPLETED   | Phase 71   |

### Phase to Plans Mapping

```
PHASE_TO_PLANS = {
  1: ["completed/workflow-core-and-validation.md"],
  2: ["completed/workflow-cli-mvp.md"],
  3: ["completed/workflow-execution-and-session.md"],
  4: ["completed/workflow-serve-mvp.md"],
  5: ["completed/workflow-vcs-handoff-checkpoints.md"],
  6: ["completed/workflow-save-revision-api.md"],
  7: ["completed/workflow-deterministic-mock-and-rerun.md"],
  8: ["completed/autonomous-execution-gap-closure.md"],
  9: ["completed/workflow-tui-mvp.md"],
  10: ["completed/workflow-tui-cli-parity.md"],
  11: ["completed/workflow-tui-resume-decoupling.md"],
  12: ["impl-plans/node-execution-backend-selection.md"],
  13: ["impl-plans/node-output-contract-and-validation.md"],
  14: ["impl-plans/workflow-web-editor-execution.md"],
  15: ["impl-plans/divedra-manager-prompt-contract.md"],
  16: ["impl-plans/node-session-reuse.md"],
  17: ["impl-plans/node-backend-model-separation.md"],
  18: ["impl-plans/runtime-owned-external-output-publication.md"],
  19: ["impl-plans/mailbox-delivery-manager-ownership.md"],
  20: ["impl-plans/mailbox-output-snapshot-fidelity.md"],
  21: ["impl-plans/mailbox-cross-boundary-routing-scope.md"],
  22: ["impl-plans/mailbox-cross-boundary-edge-validation.md"],
  23: ["impl-plans/mailbox-artifact-atomic-writes.md"],
  24: ["impl-plans/branch-and-loop-block-subworkflows.md"],
  25: ["impl-plans/refactoring-shared-ui-contract.md"],
  26: ["impl-plans/refactoring-shared-visualization-derivation.md"],
  27: ["impl-plans/refactoring-shared-editable-workflow-types.md"],
  28: ["impl-plans/refactoring-editor-api-client.md"],
  29: ["impl-plans/refactoring-editor-workflow-operations.md"],
  30: ["impl-plans/refactoring-editor-support-helpers.md"],
  31: ["impl-plans/refactoring-editor-state-helpers.md"],
  32: ["impl-plans/refactoring-editor-mutation-helpers.md"],
  33: ["impl-plans/refactoring-editor-data-loaders.md"],
  34: ["impl-plans/refactoring-editor-field-updates.md"],
  35: ["impl-plans/refactoring-server-api-request-parsing.md"],
  36: ["impl-plans/refactoring-editor-execution-helpers.md"],
  37: ["impl-plans/refactoring-editor-action-helpers.md"],
  38: ["impl-plans/refactoring-server-ui-asset-serving.md"],
  39: ["impl-plans/refactoring-editor-component-boundaries.md"],
  40: ["impl-plans/refactoring-server-workflow-bundle-parsing.md"],
  41: ["impl-plans/refactoring-editor-main-panel-component.md"],
  42: ["impl-plans/refactoring-frontend-solidjs-migration.md", "impl-plans/refactoring-editor-session-controller.md"],
  43: ["impl-plans/frontend-mode-built-asset-contract.md"],
  44: ["impl-plans/frontend-mode-package-root-alignment.md"],
  45: ["impl-plans/frontend-tooling-package-root-alignment.md"],
  46: ["impl-plans/graphql-manager-control-plane.md"],
  47: ["impl-plans/graphql-manager-control-plane-surface.md"],
  48: ["impl-plans/graphql-manager-ambient-context-transport.md"],
  49: ["impl-plans/graphql-manager-artifact-atomic-writes.md"],
  50: ["impl-plans/graphql-manager-runtime-session-lifecycle.md"],
  51: ["impl-plans/graphql-manager-http-context-isolation.md"],
  52: ["impl-plans/runtime-artifact-atomic-write-collision-safety.md"],
  53: ["impl-plans/tui-resume-runtime-variable-merge.md"],
  54: ["impl-plans/graphql-manager-control-mode-exclusivity.md"],
  55: ["impl-plans/graphql-manager-control-mode-claim-atomicity.md"],
  56: ["impl-plans/graphql-manager-message-id-collision-safety.md"],
  57: ["impl-plans/graphql-manager-idempotency-canonicalization.md"],
  58: ["impl-plans/graphql-manager-communication-scope-enforcement.md"],
  59: ["impl-plans/graphql-manager-attachment-scope-enforcement.md"],
  60: ["impl-plans/graphql-manager-http-transport-context-hardening.md"],
  61: ["impl-plans/graphql-cli-execution-transport.md"],
  62: ["impl-plans/graphql-browser-execution-session-migration.md"],
  63: ["impl-plans/graphql-browser-workflow-definition-migration.md"],
  64: ["impl-plans/graphql-workflow-execution-overview.md"],
  65: ["impl-plans/manager-driven-call-node-runtime.md"],
  66: ["impl-plans/graphql-library-rest-surface-simplification.md"],
  67: ["impl-plans/example-node-combination-showcase.md"],
  68: ["impl-plans/node-execution-inbox-contract.md"],
  69: ["impl-plans/user-action-and-optional-node-execution.md"],
  70: ["impl-plans/manager-kind-simplification.md"],
  71: ["impl-plans/workflow-role-unification.md", "impl-plans/tui-workflow-browser-and-json-input.md"],
  72: ["impl-plans/completed/tui-opentui-solid-migration.md", "impl-plans/completed/tui-solid-runtime-fallback-hardening.md", "impl-plans/completed/remove-web-ui.md", "impl-plans/completed/root-data-dir-project-root-scoping.md"]
}
```
