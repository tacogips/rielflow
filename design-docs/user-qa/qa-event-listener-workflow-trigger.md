# Event Listener Workflow Trigger Open Decisions

These decisions should be confirmed before the implementation plan moves from
blocked planning to executable implementation.

## Decisions

- [ ] Confirm whether event configuration should default to `.divedra-events/`
      adjacent to `.divedra/`, or whether it should live under another project-level
      directory.
- [ ] Confirm whether event-triggered workflow input should expose
      `workflowInput` as the canonical variable while mirroring to `humanInput` for
      compatibility.
- [ ] Confirm first supported chat providers. Recommended first slice: Slack,
      Discord, and Telegram through Chat SDK; Signal as a later standalone adapter.
- [ ] Confirm whether webhook-backed event dispatch must always be asynchronous.
      The design recommends async by default and rejects synchronous webhook
      execution unless explicitly allowed for local-only use.
- [ ] Confirm whether the first implementation needs automatic provider replies
      after workflow completion, or whether trigger-only ingestion is sufficient for
      the first milestone.
- [ ] Confirm whether cron needs multi-process/distributed locking in the first
      release. The design recommends single-process scheduling first.
- [x] Confirm whether S3 repository file-created events should support only AWS
      S3 first, or whether S3-compatible object stores must be supported in the
      first implementation. Decision: support S3-compatible stores through an
      abstract event receiver, not AWS S3 only.
- [x] Confirm the preferred S3 event delivery mode for the first milestone:
      EventBridge, SQS, SNS-to-webhook bridge, polling, or more than one.
      Decision: no polling. S3-compatible store events are received by an event
      monitoring/receiver abstraction and then dispatched to workflow execution.
- [ ] Confirm whether S3 repository file-created events should pass metadata
      only in the first release, or whether selected object contents should be
      downloaded under the divedra data root and exposed as file refs.

## Reference

Supporting design:
`design-docs/specs/design-event-listener-workflow-trigger.md`.
