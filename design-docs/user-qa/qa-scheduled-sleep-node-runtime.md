# Scheduled Sleep Node Runtime User Q&A

These decisions affect how the first scheduled sleep and shared cron scheduler
milestone behaves in edge cases. The design document uses provisional defaults
so implementation planning can proceed, but these items should be confirmed
before the behavior is treated as a stable public contract.

## Pending Decisions

1. Restart recovery:
   Should the first implementation recover pending sleep and cron scheduled
   events after a process restart, or is process-local scheduling acceptable
   initially while preserving a durable event-pool interface for later
   hardening?

## Resolved First-Milestone Decisions

1. Cancellation scope:
   `design-docs/specs/design-scheduled-sleep-node-runtime.md` defines the
   first-milestone scope: workflow cancellation, rerun or step replacement,
   terminal session finalization, and event fire failure are all in scope for
   scheduled sleep lifecycle handling.

2. Initial sleep schema:
   `sleep.durationMs` and `sleep.until` are both in the first milestone.
   `sleep.until` requires an explicit timezone or UTC offset, and exactly one
   wake condition is allowed per sleep node.

## Follow-Up Questions

1. Failed continuation repair:
   Should a later operator repair/retry command be added for failed scheduled
   continuation events?
