# User Q&A

This directory contains items requiring user confirmation or decision.

## Purpose

Store questions, pending decisions, and items awaiting user approval.

## File Naming Convention

| Prefix     | Use Case                     |
| ---------- | ---------------------------- |
| `qa-`      | Questions/confirmation items |
| `pending-` | Pending decisions            |

## Current Items

- `qa-event-supervisor-control.md`: public naming, default restart limit,
  chat command structure, multi-run correlation, and cancellation propagation
  decisions for event-driven workflow supervisor control.
- `qa-matrix-event-source.md`: receive transport, rich Matrix event scope,
  reply threading, token/identity, and sync-state retention decisions for
  Element/Matrix event sources.
- `qa-chat-sdk-event-sources.md`: direct Chat SDK dependency policy, provider
  rollout depth, web provider scope, and rich interaction normalization.
- `qa-homebrew-deployment-support.md`: Homebrew tap ownership, release URL
  pattern, target matrix, and version smoke-test decisions for standalone
  release archives.
- `qa-workflow-package-checkout.md`: scope flag naming, package update command
  aliasing, modified projected skill update policy, and skill search metadata
  decisions for workflow package checkout.
- `qa-scheduled-sleep-node-runtime.md`: restart recovery, initial sleep schema,
  and cancellation-scope decisions for scheduled sleep and shared cron
  scheduling.
- `qa-scheduled-workflow-execution.md`: timezone defaults, missed-run policy,
  schedule CRUD scope, result delivery destination, and startup rehydration
  scope for chat-created workflow schedules.
- `qa-product-rename-rielflow.md`: CLI alias, package/release compatibility,
  historical document rewrite scope, and runtime data migration decisions for
  the product rename from rielflow to Rielflow.

## Adding New Items

1. Create a new file with appropriate prefix (`qa-` or `pending-`)
2. Include clear description of the question or decision needed
3. List available options if applicable
4. Update this README.md with a reference to the new item

## Resolved Items

- `qa-product-code-duplicate-scavenge-blockers.md`: resolved owner decisions
  that unblock `REF-003` and `REF-015` in the product-code duplicate-scavenge
  implementation plan.
