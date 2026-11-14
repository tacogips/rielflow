# Event Chat Reply Webhook Example Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#workflow-authoring-model`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

## Design Summary

Add a checked-in example that demonstrates authoring a workflow node with the
built-in `divedra/chat-reply-worker` add-on and dispatching it from a webhook
event source with an outbound reply endpoint.

## Modules

### 1. Example Workflow

#### `examples/chat-reply-webhook/`

**Status**: Completed

**Checklist**:

- [x] Add worker-only workflow using an authored add-on node
- [x] Add expected-results notes
- [x] Keep the workflow valid under `--workflow-definition-dir ./examples`

### 2. Event Fixtures

#### `examples/event-sources/.divedra-events/`

**Status**: Completed

**Checklist**:

- [x] Add webhook source with `replyEndpointEnv`
- [x] Add binding to `chat-reply-webhook`
- [x] Add chat payload fixture
- [x] Update event source README usage

### 3. Verification

#### `src/events/chat-reply-example.test.ts`

**Status**: Completed

**Checklist**:

- [x] Exercise the checked-in fixture through `emitEventFile`
- [x] Assert outbound webhook reply payload and idempotency header
- [x] Run typecheck and targeted tests

## Completion Criteria

- [x] Example workflow validates
- [x] Event configuration validates
- [x] Local event emit can dispatch a real reply through a mocked fetch endpoint
- [x] Targeted tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-04-20

**Tasks Completed**: Example workflow, event fixture, usage docs, integration test
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added `chat-reply-webhook` and `example-reply-webhook` fixtures. Also included normalized event input in workflow runtime event metadata so add-on templates can render `{{event.input.*}}`.
