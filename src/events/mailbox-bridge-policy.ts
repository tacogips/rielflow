import type { EventBinding } from "./types";

/** Effective policy after applying defaults (always includes `output` streams). */
export interface ResolvedEventMailboxBridgePolicy {
  readonly input: {
    readonly consumer: "direct-workflow" | "supervisor";
  };
  readonly output: {
    readonly reply: { readonly mode: "none" | "final" };
    readonly progress: { readonly mode: "none" | "status-only" };
    readonly control: { readonly mode: "none" | "status-only" };
  };
}

/**
 * Resolves effective external mailbox bridge policy for an event binding.
 * Authored `mailboxBridge` fields override defaults; omitted fields use
 * backward-compatible defaults derived from `execution.mode`.
 */
export function resolveEventMailboxBridgePolicy(
  binding: EventBinding,
): ResolvedEventMailboxBridgePolicy {
  const mode = binding.execution?.mode;
  const supervisedLike =
    mode === "supervised" || mode === "supervisor-dispatch";
  const defaultConsumer: "direct-workflow" | "supervisor" = supervisedLike
    ? "supervisor"
    : "direct-workflow";
  const authored = binding.mailboxBridge;
  return {
    input: {
      consumer: authored?.input?.consumer ?? defaultConsumer,
    },
    output: {
      reply: { mode: authored?.output?.reply?.mode ?? "final" },
      progress: { mode: authored?.output?.progress?.mode ?? "status-only" },
      control: {
        mode:
          authored?.output?.control?.mode ??
          (supervisedLike ? "status-only" : "none"),
      },
    },
  };
}
