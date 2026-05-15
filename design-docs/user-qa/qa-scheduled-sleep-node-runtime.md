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

2. Initial sleep schema:
   Should `sleep.durationMs` be the only supported wake condition in the first
   implementation, or should `sleep.until` ship at the same time with explicit
   timestamp and timezone validation?

## Resolved First-Milestone Decisions

1. Cancellation scope:
   `design-docs/specs/design-scheduled-sleep-node-runtime.md` defines the
   first-milestone scope: workflow cancellation, rerun or step replacement,
   terminal session finalization, and event fire failure are all in scope for
   scheduled sleep lifecycle handling.

## Follow-Up Questions

1. Failed continuation repair:
   Should a later operator repair/retry command be added for failed scheduled
   continuation events?
