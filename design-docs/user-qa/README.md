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

## Adding New Items

1. Create a new file with appropriate prefix (`qa-` or `pending-`)
2. Include clear description of the question or decision needed
3. List available options if applicable
4. Update this README.md with a reference to the new item
