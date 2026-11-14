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
├── <feature>.md
├── completed/
└── templates/
```

## Active Plans

| Plan                                           | Created    | Design Reference |
| ---------------------------------------------- | ---------- | ---------------- |
| `workflow-inspect-structure-description-lines` | 2026-05-13 | `command`        |

## Recently Completed

| Plan                                               | Completed  | Design Reference                                                              |
| -------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| `workflow-inspect-structure-compact-routing`       | 2026-05-13 | `command`                                                                     |
| `workflow-inspect-structure`                       | 2026-05-13 | `command`                                                                     |
| `nix-precommit-management`                         | 2026-05-07 | `README.md`, `AGENTS.md`                                                      |
| `chat-task-planning-and-supervisor-collaboration`  | 2026-05-07 | `design-chat-task-planning-lifecycle`, `design-supervisor-chat-collaboration` |
| `output-destinations-supervisor-memory-foundation` | 2026-05-06 | `design-output-destinations-and-supervisor-memory`                            |
| `default-supervision-runner-pool-regression-fixes` | 2026-05-06 | `architecture`, `command`, `design-event-supervisor-control`                  |
| `workflow-runner-event-channel`                    | 2026-05-06 | `design-event-supervisor-control`                                             |
| `deterministic-supervisor-runner-pool`             | 2026-05-06 | `architecture`, `command`, `design-event-supervisor-control`                  |
| `default-supervisor-backed-workflow-run`           | 2026-05-06 | `architecture`, `command`                                                     |
| `bounded-fanout-join-workflow-execution`           | 2026-05-06 | `design-bounded-fanout-join-workflow-execution`                               |
| `default-node-timeout-60-minutes`                  | 2026-05-06 | `design-workflow-json`                                                        |
| `inline-workflow-variables-and-inspect-usage`      | 2026-05-06 | `command`, `notes`                                                            |
| `output-contract-candidate-path-prompt`            | 2026-05-06 | `architecture`                                                                |
| `real-backend-runtime-artifact-audit`              | 2026-05-06 | `design-node-execution-inbox-contract`                                        |
| `session-command-project-scope`                    | 2026-05-06 | `design-user-scope-workflows`                                                 |
| `output-contract-adapter-envelope-normalization`   | 2026-05-05 | `design-node-output-contract`, `architecture`                                 |
| `graphql-llm-session-message-selection`            | 2026-05-04 | `architecture`                                                                |
| `graphql-llm-session-message-field-selection`      | 2026-05-04 | `architecture`                                                                |
| `session-health-command`                           | 2026-05-04 | `design-session-health`                                                       |
| `robust-manager-output-parsing`                    | 2026-05-04 | `architecture`                                                                |
| `graphql-llm-session-messages`                     | 2026-05-04 | `architecture`                                                                |
| `step-run-history-rerun-runtime`                   | 2026-05-02 | `design-step-run-history-rerun`                                               |
| `step-run-history-rerun-foundation`                | 2026-05-02 | `design-step-run-history-rerun`                                               |
| `workflow-overview-status-surface`                 | 2026-05-02 | `design-workflow-overview-status-surface`, `architecture`, `command`          |
| `workflow-supervisor-dispatcher`                   | 2026-05-02 | `design-workflow-supervisor-dispatcher`                                       |
| `workflow-supervisor-dispatcher-foundation`        | 2026-05-01 | `design-workflow-supervisor-dispatcher`                                       |
| `workflow-supervisor-dispatcher-runtime`           | 2026-05-02 | `design-workflow-supervisor-dispatcher`                                       |

## Completed Plans

| Plan                                                     | Completed  | Design Reference                                                                                                                              |
| -------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `event-external-mailbox-binding-foundation`              | 2026-04-30 | `design-event-external-mailbox-binding`                                                                                                       |
| `supervisor-natural-language-control`                    | 2026-04-29 | `design-event-supervisor-control`, `design-auto-improve-superviser-mode`                                                                      |
| `event-supervisor-control-review-hardening`              | 2026-04-29 | `design-event-supervisor-control`, `event-supervisor-control-foundation`                                                                      |
| `event-supervisor-control-foundation`                    | 2026-04-29 | `design-event-supervisor-control`, `design-event-listener-workflow-trigger`, `design-auto-improve-superviser-mode`                            |
| `workflow-legacy-compatibility-removal`                  | 2026-04-29 | `design-workflow-json`, `design-node-jump-and-code-manager-runtime`, `design-unified-workflow-role-model`, `architecture`, `command`, `notes` |
| `workflow-legacy-compatibility-removal-tail-cleanup`     | 2026-04-29 | `design-workflow-json`, `design-unified-workflow-role-model`, `architecture`, `command`, `notes`                                              |
| `auto-improve-superviser-workflow-phase-2`               | 2026-04-25 | `design-auto-improve-superviser-mode`, `architecture`, `command`                                                                              |
| `graphql-supervision-execution-parity`                   | 2026-04-26 | `design-auto-improve-superviser-mode`, `command`                                                                                              |
| `step-addressed-workflow-runtime-cutover`                | 2026-04-29 | `design-workflow-json`, `design-node-jump-and-code-manager-runtime`, `design-workflow-steps-and-node-reuse`, `architecture`, `command`        |
| `auto-improve-superviser-mode`                           | 2026-04-25 | `design-auto-improve-superviser-mode`, `design-node-jump-and-code-manager-runtime`, `architecture`, `command`                                 |
| `auto-improve-supervision-review-follow-up`              | 2026-04-25 | `design-auto-improve-superviser-mode`, `architecture`, `command`                                                                              |
| `scoped-local-addons`                                    | 2026-04-21 | `design-node-addon-catalog-and-chat-reply-worker`, `design-user-scope-workflows`                                                              |
| `event-root-manager-session-stickiness-record-lifecycle` | 2026-04-22 | `design-event-listener-workflow-trigger`                                                                                                      |
| `event-root-manager-session-stickiness-binding-scope`    | 2026-04-22 | `design-event-listener-workflow-trigger`                                                                                                      |
| `event-root-manager-session-stickiness`                  | 2026-04-22 | `design-node-session-reuse`, `design-event-listener-workflow-trigger`, `design-node-jump-and-code-manager-runtime`                            |
| `scoped-workflow-catalog-safety-follow-up`               | 2026-04-21 | `design-user-scope-workflows`, `architecture`                                                                                                 |
| `scoped-workflow-source-visibility`                      | 2026-04-21 | `design-user-scope-workflows`, `command`                                                                                                      |
| `scoped-workflow-graphql-server`                         | 2026-04-21 | `design-user-scope-workflows`                                                                                                                 |
| `scoped-workflow-runtime-follow-up`                      | 2026-04-21 | `design-user-scope-workflows`, `command`                                                                                                      |
| `scoped-workflow-catalog`                                | 2026-04-21 | `design-user-scope-workflows`                                                                                                                 |
| `third-party-addon-async-resolution`                     | 2026-04-21 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `third-party-addon-definition-registry`                  | 2026-04-21 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `third-party-addon-resolver-ergonomics`                  | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `third-party-addon-resolver-unhandled-return`            | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `third-party-addon-editor-revision`                      | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `third-party-addon-graphql-validation`                   | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `third-party-addon-package-root-entrypoint`              | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`, `architecture`                                                                             |
| `third-party-addon-public-api`                           | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `third-party-addon-resolver-validation`                  | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `third-party-addon-resolution`                           | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `mail-gateway-addons`                                    | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `node-addon-authored-payload-guard`                      | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `node-addon-worker-role-validation`                      | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `x-gateway-addon`                                        | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `x-gateway-read-env-readiness`                           | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `x-gateway-read-addon`                                   | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `agent-worker-addons`                                    | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `workflow-role-unification-structural-cleanup`           | 2026-04-20 | `design-unified-workflow-role-model`                                                                                                          |
| `event-reply-dispatch-persistence`                       | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `event-chat-reply-webhook-example`                       | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `event-reply-dispatcher`                                 | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `node-addon-chat-reply-worker`                           | 2026-04-20 | `design-node-addon-catalog-and-chat-reply-worker`                                                                                             |
| `event-replay-controls`                                  | 2026-04-20 | `design-event-listener-workflow-trigger`, `command`                                                                                           |
| `event-mock-scenario-dispatch`                           | 2026-04-20 | `design-event-listener-workflow-trigger`, `command`                                                                                           |
| `gemini-hook-support`                                    | 2026-04-20 | `design-hook-command`, `command`                                                                                                              |
| `event-receipt-operator-commands`                        | 2026-04-20 | `design-event-listener-workflow-trigger`, `command`                                                                                           |
| `hook-snippet-command`                                   | 2026-04-20 | `design-hook-command`, `command`                                                                                                              |
| `hook-event-recording`                                   | 2026-04-20 | `design-hook-command`, `command`, `design-data-model`                                                                                         |
| `event-source-adapters`                                  | 2026-04-20 | `design-event-listener-workflow-trigger`                                                                                                      |
| `event-listener-workflow-trigger-foundation`             | 2026-04-20 | `design-event-listener-workflow-trigger`                                                                                                      |
| `container-runtime-env-isolation`                        | 2026-04-20 | `design-container-runtime-contract`                                                                                                           |
| `root-data-dir-project-root-scoping`                     | 2026-03-26 | `command`, `architecture`                                                                                                                     |
| `workflow-execution-working-directory`                   | 2026-04-12 | `command`, `architecture`, `notes`                                                                                                            |
| `hook-command-review-follow-up`                          | 2026-04-09 | `design-hook-command`                                                                                                                         |
| `hook-command-cross-vendor-alignment`                    | 2026-04-09 | `design-hook-command`, `command`                                                                                                              |
| `hook-command-hardening`                                 | 2026-04-09 | `design-hook-command`, `command`                                                                                                              |
| `hook-command`                                           | 2026-04-09 | `design-hook-command`, `command`                                                                                                              |
| `workflow-role-unification`                              | 2026-04-05 | `design-unified-workflow-role-model`                                                                                                          |
| `tui-solid-runtime-fallback-hardening`                   | 2026-03-26 | `design-tui`, `architecture`                                                                                                                  |
| `tui-opentui-solid-migration`                            | 2026-03-26 | `design-tui`, `command`                                                                                                                       |
| `tui-workflow-browser-and-json-input`                    | 2026-03-26 | `design-tui`                                                                                                                                  |
| `remove-web-ui`                                          | 2026-03-24 | `command`                                                                                                                                     |
| `manager-kind-simplification`                            | 2026-03-18 | `design-workflow-json`, `architecture`, `notes`                                                                                               |
| `workflow-core-and-validation`                           | 2026-02-23 | `design-data-model`, `design-workflow-json`, `architecture`                                                                                   |
| `workflow-cli-mvp`                                       | 2026-02-23 | `command`, `design-workflow-json`                                                                                                             |
| `workflow-execution-and-session`                         | 2026-02-24 | `architecture`, `command`                                                                                                                     |
| `workflow-serve-mvp`                                     | 2026-02-23 | `architecture`, `command`, `notes`                                                                                                            |
| `workflow-vcs-handoff-checkpoints`                       | 2026-02-23 | `architecture`, `notes`                                                                                                                       |
| `workflow-save-revision-api`                             | 2026-02-24 | `architecture`, `notes`                                                                                                                       |
| `workflow-web-editor-execution`                          | 2026-03-15 | `architecture`, `notes`                                                                                                                       |
| `workflow-deterministic-mock-and-rerun`                  | 2026-02-24 | `architecture`, `command`                                                                                                                     |
| `autonomous-execution-gap-closure`                       | 2026-02-24 | `architecture`, `notes`                                                                                                                       |
| `workflow-tui-mvp`                                       | 2026-02-25 | `design-tui`                                                                                                                                  |
| `workflow-tui-cli-parity`                                | 2026-02-25 | `design-tui`                                                                                                                                  |
| `workflow-tui-resume-decoupling`                         | 2026-02-25 | `design-tui`                                                                                                                                  |
| `node-execution-backend-selection`                       | 2026-03-07 | `architecture`                                                                                                                                |
| `node-output-contract-and-validation`                    | 2026-03-07 | `design-node-output-contract`, `design-data-model`, `architecture`                                                                            |
| `divedra-manager-prompt-contract`                        | 2026-03-07 | `architecture`, `notes`                                                                                                                       |
| `node-session-reuse`                                     | 2026-03-07 | `design-node-session-reuse`, `architecture`, `design-data-model`                                                                              |
| `node-backend-model-separation`                          | 2026-03-07 | `design-data-model`, `design-workflow-json`, `architecture`, `notes`                                                                          |
| `runtime-owned-external-output-publication`              | 2026-03-08 | `architecture`, `design-node-output-contract`, `notes`                                                                                        |
| `mailbox-delivery-manager-ownership`                     | 2026-03-08 | `design-node-mailbox`, `architecture`                                                                                                         |
| `mailbox-output-snapshot-fidelity`                       | 2026-03-08 | `design-node-mailbox`, `architecture`                                                                                                         |
| `mailbox-cross-boundary-routing-scope`                   | 2026-03-09 | `design-node-mailbox`, `architecture`                                                                                                         |
| `mailbox-cross-boundary-edge-validation`                 | 2026-03-09 | `design-node-mailbox`, `design-workflow-json`, `architecture`                                                                                 |
| `mailbox-artifact-atomic-writes`                         | 2026-03-09 | `design-node-mailbox`, `architecture`                                                                                                         |
| `branch-and-loop-block-subworkflows`                     | 2026-03-09 | `design-workflow-json`, `design-data-model`, `architecture`, `notes`                                                                          |
| `refactoring-shared-ui-contract`                         | 2026-03-10 | `architecture`, `notes`                                                                                                                       |
| `refactoring-shared-visualization-derivation`            | 2026-03-10 | `architecture`, `notes`                                                                                                                       |
| `refactoring-shared-editable-workflow-types`             | 2026-03-10 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-api-client`                          | 2026-03-10 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-workflow-operations`                 | 2026-03-10 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-support-helpers`                     | 2026-03-10 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-state-helpers`                       | 2026-03-10 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-mutation-helpers`                    | 2026-03-10 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-data-loaders`                        | 2026-03-10 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-field-updates`                       | 2026-03-09 | `architecture`, `notes`                                                                                                                       |
| `refactoring-server-api-request-parsing`                 | 2026-03-09 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-execution-helpers`                   | 2026-03-09 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-action-helpers`                      | 2026-03-10 | `architecture`, `notes`                                                                                                                       |
| `refactoring-server-ui-asset-serving`                    | 2026-03-10 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-component-boundaries`                | 2026-03-09 | `architecture`, `notes`                                                                                                                       |
| `refactoring-server-workflow-bundle-parsing`             | 2026-03-09 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-main-panel-component`                | 2026-03-09 | `architecture`, `notes`                                                                                                                       |
| `refactoring-frontend-solidjs-migration`                 | 2026-03-09 | `architecture`, `notes`                                                                                                                       |
| `refactoring-editor-session-controller`                  | 2026-03-09 | `architecture`, `notes`                                                                                                                       |
| `frontend-mode-built-asset-contract`                     | 2026-03-09 | `architecture`, `notes`                                                                                                                       |
| `frontend-mode-package-root-alignment`                   | 2026-03-09 | `architecture`, `notes`                                                                                                                       |
| `frontend-tooling-package-root-alignment`                | 2026-03-09 | `architecture`, `notes`                                                                                                                       |
| `graphql-manager-control-plane`                          | 2026-03-15 | `design-graphql-manager-control-plane`                                                                                                        |
| `graphql-manager-control-plane-surface`                  | 2026-03-15 | `design-graphql-manager-control-plane`                                                                                                        |
| `graphql-manager-ambient-context-transport`              | 2026-03-15 | `design-graphql-manager-control-plane`                                                                                                        |
| `graphql-manager-artifact-atomic-writes`                 | 2026-03-15 | `architecture`, `design-graphql-manager-control-plane`                                                                                        |
| `graphql-manager-runtime-session-lifecycle`              | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                                                                        |
| `graphql-manager-http-context-isolation`                 | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                                                                        |
| `graphql-manager-control-mode-exclusivity`               | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                                                                        |
| `graphql-manager-control-mode-claim-atomicity`           | 2026-03-15 | `design-graphql-manager-control-plane`, `notes`                                                                                               |
| `graphql-manager-message-id-collision-safety`            | 2026-03-15 | `design-graphql-manager-control-plane`, `notes`                                                                                               |
| `graphql-manager-idempotency-canonicalization`           | 2026-03-15 | `design-graphql-manager-control-plane`                                                                                                        |
| `graphql-manager-communication-scope-enforcement`        | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                                                                        |
| `graphql-manager-attachment-scope-enforcement`           | 2026-03-15 | `design-graphql-manager-control-plane`, `command`, `notes`                                                                                    |
| `graphql-manager-http-transport-context-hardening`       | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                                                                        |
| `graphql-cli-execution-transport`                        | 2026-03-15 | `design-graphql-manager-control-plane`, `command`                                                                                             |
| `graphql-browser-execution-session-migration`            | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                                                                        |
| `graphql-browser-workflow-definition-migration`          | 2026-03-15 | `design-graphql-manager-control-plane`, `architecture`                                                                                        |
| `graphql-library-rest-surface-simplification`            | 2026-03-16 | `design-graphql-manager-control-plane`, `architecture`, `command`                                                                             |
| `runtime-artifact-atomic-write-collision-safety`         | 2026-03-15 | `architecture`, `design-graphql-manager-control-plane`                                                                                        |
| `tui-resume-runtime-variable-merge`                      | 2026-03-15 | `design-tui`, `command`                                                                                                                       |
| `example-node-combination-showcase`                      | 2026-03-17 | `design-workflow-json`, `design-container-runtime-contract`, `architecture`                                                                   |
| `node-execution-inbox-contract`                          | 2026-03-17 | `design-node-execution-inbox-contract`, `design-node-mailbox`, `architecture`                                                                 |
| `user-action-and-optional-node-execution`                | 2026-03-18 | `design-user-action-and-optional-node-execution`                                                                                              |

## Phase Dependencies

| Phase | Status    | Depends On                                   |
| ----- | --------- | -------------------------------------------- |
| 1     | COMPLETED | -                                            |
| 2     | COMPLETED | Phase 1                                      |
| 3     | COMPLETED | Phase 2                                      |
| 4     | COMPLETED | Phase 3                                      |
| 5     | COMPLETED | Phase 4                                      |
| 6     | COMPLETED | Phase 5                                      |
| 7     | COMPLETED | Phase 6                                      |
| 8     | COMPLETED | Phase 7                                      |
| 9     | COMPLETED | Phase 8                                      |
| 10    | COMPLETED | Phase 9                                      |
| 11    | COMPLETED | Phase 10                                     |
| 12    | COMPLETED | Phase 11                                     |
| 13    | COMPLETED | Phase 12                                     |
| 14    | COMPLETED | Phase 13                                     |
| 15    | COMPLETED | Phase 14                                     |
| 16    | COMPLETED | Phase 15                                     |
| 17    | COMPLETED | Phase 16                                     |
| 18    | COMPLETED | Phase 17                                     |
| 19    | COMPLETED | Phase 18                                     |
| 20    | COMPLETED | Phase 19                                     |
| 21    | COMPLETED | Phase 20                                     |
| 22    | COMPLETED | Phase 21                                     |
| 23    | COMPLETED | Phase 22                                     |
| 24    | COMPLETED | Phase 23                                     |
| 25    | COMPLETED | Phase 24                                     |
| 26    | COMPLETED | Phase 25                                     |
| 27    | COMPLETED | Phase 26                                     |
| 28    | COMPLETED | Phase 27                                     |
| 29    | COMPLETED | Phase 28                                     |
| 30    | COMPLETED | Phase 29                                     |
| 31    | COMPLETED | Phase 30                                     |
| 32    | COMPLETED | Phase 31                                     |
| 33    | COMPLETED | Phase 32                                     |
| 34    | COMPLETED | Phase 33                                     |
| 35    | COMPLETED | Phase 34                                     |
| 36    | COMPLETED | Phase 35                                     |
| 37    | COMPLETED | Phase 36                                     |
| 38    | COMPLETED | Phase 37                                     |
| 39    | COMPLETED | Phase 38                                     |
| 40    | COMPLETED | Phase 39                                     |
| 41    | COMPLETED | Phase 40                                     |
| 42    | COMPLETED | Phase 41                                     |
| 43    | COMPLETED | Phase 42                                     |
| 44    | COMPLETED | Phase 43                                     |
| 45    | COMPLETED | Phase 44                                     |
| 46    | COMPLETED | Phase 45                                     |
| 47    | COMPLETED | Phase 46                                     |
| 48    | COMPLETED | Phase 47                                     |
| 49    | COMPLETED | Phase 48                                     |
| 50    | COMPLETED | Phase 49                                     |
| 51    | COMPLETED | Phase 50                                     |
| 52    | COMPLETED | Phase 51                                     |
| 53    | COMPLETED | Phase 52                                     |
| 54    | COMPLETED | Phase 53                                     |
| 55    | COMPLETED | Phase 54                                     |
| 56    | COMPLETED | Phase 55                                     |
| 57    | COMPLETED | Phase 56                                     |
| 58    | COMPLETED | Phase 57                                     |
| 59    | COMPLETED | Phase 58                                     |
| 60    | COMPLETED | Phase 59                                     |
| 61    | COMPLETED | Phase 60                                     |
| 62    | COMPLETED | Phase 61                                     |
| 63    | COMPLETED | Phase 62                                     |
| 64    | COMPLETED | Phase 63                                     |
| 65    | COMPLETED | Phase 64                                     |
| 66    | COMPLETED | Phase 65                                     |
| 67    | COMPLETED | Phase 66                                     |
| 68    | COMPLETED | Phase 67                                     |
| 69    | COMPLETED | Phase 68                                     |
| 70    | COMPLETED | Phase 69                                     |
| 71    | COMPLETED | Phase 70                                     |
| 72    | COMPLETED | Phase 71                                     |
| 73    | COMPLETED | -                                            |
| 74    | COMPLETED | Phase 71                                     |
| 75    | COMPLETED | -                                            |
| 76    | COMPLETED | -                                            |
| 77    | COMPLETED | -                                            |
| 78    | COMPLETED | Phase 77                                     |
| 79    | COMPLETED | -                                            |
| 80    | COMPLETED | -                                            |
| 81    | COMPLETED | -                                            |
| 82    | COMPLETED | Phase 71                                     |
| 83    | COMPLETED | Phase 71                                     |
| 84    | COMPLETED | Phase 83                                     |
| 85    | COMPLETED | Phase 84                                     |
| 86    | COMPLETED | Phase 85                                     |
| 87    | COMPLETED | -                                            |
| 88    | COMPLETED | Phase 64                                     |
| 89    | COMPLETED | Phase 88                                     |
| 90    | COMPLETED | -                                            |
| 91    | COMPLETED | Phase 90                                     |
| 92    | COMPLETED | Phases 83, 84, 85, 86                        |
| 93    | COMPLETED | Phase 92                                     |
| 94    | COMPLETED | Phase 91                                     |
| 95    | COMPLETED | Phases 92, 93                                |
| 96    | COMPLETED | Phase 94                                     |
| 97    | COMPLETED | Phase 96                                     |
| 98    | COMPLETED | -                                            |
| 99    | COMPLETED | Phase 98                                     |
| 100   | COMPLETED | Phase 99                                     |
| 101   | COMPLETED | Phase 99                                     |
| 102   | COMPLETED | Phase 101                                    |
| 103   | COMPLETED | Phase 98                                     |
| 104   | COMPLETED | Phase 103                                    |
| 105   | COMPLETED | Phase 103                                    |
| 106   | COMPLETED | Phase 98                                     |
| 107   | COMPLETED | Phase 106                                    |
| 108   | COMPLETED | Phase 105                                    |
| 109   | COMPLETED | Phase 98                                     |
| 110   | COMPLETED | Phase 109                                    |
| 111   | COMPLETED | Phase 110                                    |
| 112   | COMPLETED | Phase 111                                    |
| 113   | COMPLETED | Phase 111                                    |
| 114   | COMPLETED | Phase 111                                    |
| 115   | COMPLETED | Phase 114                                    |
| 116   | COMPLETED | Phases 110, 111                              |
| 117   | COMPLETED | Phases 114, 116                              |
| 118   | COMPLETED | -                                            |
| 119   | COMPLETED | -                                            |
| 120   | COMPLETED | -                                            |
| 121   | COMPLETED | Phase 120                                    |
| 122   | COMPLETED | Phase 121                                    |
| 123   | COMPLETED | Phase 122                                    |
| 124   | COMPLETED | Phase 121                                    |
| 125   | COMPLETED | Phase 124                                    |
| 126   | COMPLETED | -                                            |
| 127   | COMPLETED | -                                            |
| 128   | COMPLETED | -                                            |
| 129   | COMPLETED | Phases 16, 65, 71, 82                        |
| 130   | COMPLETED | Phases 125, 128, 129 (+ earlier foundations) |
| 131   | COMPLETED | Phase 130                                    |
| 132   | COMPLETED | Phase 130                                    |
| 133   | COMPLETED | Phases 129, 132                              |
| 153   | COMPLETED | Phase 152                                    |
| 154   | COMPLETED | Phase 153                                    |
| 155   | COMPLETED | Phase 154                                    |

### Phase to Plans Mapping

```
PHASE_TO_PLANS = {
  1: ["impl-plans/completed/workflow-core-and-validation.md"],
  2: ["impl-plans/completed/workflow-cli-mvp.md"],
  3: ["impl-plans/completed/workflow-execution-and-session.md"],
  4: ["impl-plans/completed/workflow-serve-mvp.md"],
  5: ["impl-plans/completed/workflow-vcs-handoff-checkpoints.md"],
  6: ["impl-plans/completed/workflow-save-revision-api.md"],
  7: ["impl-plans/completed/workflow-deterministic-mock-and-rerun.md"],
  8: ["impl-plans/completed/autonomous-execution-gap-closure.md"],
  9: ["impl-plans/completed/workflow-tui-mvp.md"],
  10: ["impl-plans/completed/workflow-tui-cli-parity.md"],
  11: ["impl-plans/completed/workflow-tui-resume-decoupling.md"],
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
  72: ["impl-plans/completed/tui-opentui-solid-migration.md", "impl-plans/completed/tui-solid-runtime-fallback-hardening.md", "impl-plans/completed/remove-web-ui.md", "impl-plans/completed/root-data-dir-project-root-scoping.md"],
  73: ["impl-plans/node-system-and-session-prompts.md"],
  74: ["impl-plans/tui-workflow-definition-screen.md"],
  75: ["impl-plans/example-workflow-expected-results-and-verification.md"],
  76: ["impl-plans/simplified-workflow-json-transition-examples.md"],
  77: ["impl-plans/inline-node-and-nested-example-layout.md"],
  78: ["impl-plans/workflow-definition-alignment-follow-up.md"],
  79: ["impl-plans/tui-workflow-history-delete-all.md"],
  80: ["impl-plans/workflow-id-filesystem-safety.md"],
  81: ["impl-plans/completed/v2-cutover-command-container-runtime.md"],
  82: ["impl-plans/workflow-role-unification-structural-cleanup.md"],
  83: ["impl-plans/hook-command.md"],
  84: ["impl-plans/hook-command-hardening.md"],
  85: ["impl-plans/hook-command-cross-vendor-alignment.md"],
  86: ["impl-plans/hook-command-review-follow-up.md"],
  87: ["impl-plans/workflow-execution-working-directory.md"],
  88: ["impl-plans/web-workflow-viewer.md"],
  89: ["impl-plans/container-runtime-env-isolation.md"],
  90: ["impl-plans/event-listener-workflow-trigger-foundation.md"],
  91: ["impl-plans/completed/event-source-adapters.md"],
  92: ["impl-plans/hook-event-recording.md"],
  93: ["impl-plans/hook-snippet-command.md"],
  94: ["impl-plans/event-receipt-operator-commands.md"],
  95: ["impl-plans/gemini-hook-support.md"],
  96: ["impl-plans/event-mock-scenario-dispatch.md"],
  97: ["impl-plans/event-replay-controls.md"],
  98: ["impl-plans/node-addon-chat-reply-worker.md"],
  99: ["impl-plans/event-reply-dispatcher.md"],
  100: ["impl-plans/event-chat-reply-webhook-example.md"],
  101: ["impl-plans/event-reply-dispatch-persistence.md"],
  102: ["impl-plans/agent-worker-addons.md"],
  103: ["impl-plans/x-gateway-read-addon.md"],
  104: ["impl-plans/x-gateway-read-env-readiness.md"],
  105: ["impl-plans/x-gateway-addon.md"],
  106: ["impl-plans/node-addon-worker-role-validation.md"],
  107: ["impl-plans/node-addon-authored-payload-guard.md"],
  108: ["impl-plans/mail-gateway-addons.md"],
  109: ["impl-plans/third-party-addon-resolution.md"],
  110: ["impl-plans/third-party-addon-resolver-validation.md"],
  111: ["impl-plans/third-party-addon-public-api.md"],
  112: ["impl-plans/third-party-addon-payload-shape-guard.md"],
  113: ["impl-plans/third-party-addon-package-root-entrypoint.md"],
  114: ["impl-plans/third-party-addon-graphql-validation.md"],
  115: ["impl-plans/third-party-addon-editor-revision.md"],
  116: ["impl-plans/third-party-addon-resolver-unhandled-return.md"],
  117: ["impl-plans/third-party-addon-resolver-ergonomics.md"],
  118: ["impl-plans/third-party-addon-definition-registry.md"],
  119: ["impl-plans/third-party-addon-async-resolution.md"],
  120: ["impl-plans/scoped-workflow-catalog.md"],
  121: ["impl-plans/scoped-workflow-runtime-follow-up.md"],
  122: ["impl-plans/scoped-workflow-graphql-server.md"],
  123: ["impl-plans/scoped-workflow-source-visibility.md"],
  124: ["impl-plans/scoped-workflow-catalog-safety-follow-up.md"],
  125: ["impl-plans/scoped-local-addons.md"],
  126: ["impl-plans/event-root-manager-session-stickiness.md"],
  127: ["impl-plans/event-root-manager-session-stickiness-binding-scope.md"],
  128: ["impl-plans/event-root-manager-session-stickiness-record-lifecycle.md"],
  129: ["impl-plans/completed/step-addressed-workflow-runtime-cutover.md"],
  130: ["impl-plans/completed/auto-improve-superviser-mode.md"],
  131: ["impl-plans/completed/auto-improve-supervision-review-follow-up.md"],
  132: ["impl-plans/completed/auto-improve-superviser-workflow-phase-2.md"],
  133: ["impl-plans/workflow-legacy-compatibility-removal.md", "impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md"],
  134: ["impl-plans/graphql-supervision-execution-parity.md"],
  153: ["impl-plans/completed/workflow-overview-status-surface.md"],
  154: ["impl-plans/completed/step-run-history-rerun-foundation.md"],
  155: ["impl-plans/completed/step-run-history-rerun-runtime.md"],
}
```
