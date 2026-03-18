# User Action Open Decisions

**Status**: Pending

**Created**: 2026-03-18

**Category**: Architecture Decision

## Question

Which first-iteration product limits should be locked for `user-action` nodes and multi-tool human reply handling?

## Context

The proposed design intentionally leaves provider-specific transport details abstract so Matrix, Discord, and future tools can share one runtime contract.
The design now fixes runtime ownership for reply collection, keeps `NodeExecutionRecord` terminal-only during `user-action` waits, and treats optional-node skip output as runtime-owned control-flow metadata rather than business-payload schema output.
Two product decisions still need confirmation before implementation starts.

## Decisions Needed

### 1. Reply winner policy

Recommended default:

- first valid reply wins
- later replies are stored for audit only

Alternative:

- collect multiple replies and require explicit manager selection

Tradeoff:

- first-valid-reply is simpler and restart-safe
- multi-reply selection is more flexible but adds another decision state and UI/control-plane work

### 2. Inbound transport mode

Recommended default:

- core runtime uses a pull-style `collectReplies(...)` abstraction
- individual tool implementations may still fill that abstraction from polling or from a webhook-backed local buffer

Alternative:

- require webhook-only or long-lived streaming integrations

Tradeoff:

- the pull abstraction is easier to resume after restarts and does not force one provider model
- webhook-only can be lower latency but creates more server and deployment coupling

## Recommendation

Approve the recommended defaults for the first implementation:

- first valid reply wins
- pull-style reply collection abstraction

## Decision

(Awaiting user confirmation)
