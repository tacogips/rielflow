import { describe, expect, test } from "vitest";
import { resolveEventMailboxBridgePolicy } from "./mailbox-bridge-policy";
import type { EventBinding } from "./types";

function binding(
  overrides: Partial<EventBinding> & Pick<EventBinding, "id" | "sourceId">,
): EventBinding {
  return {
    id: overrides.id,
    sourceId: overrides.sourceId,
    ...(overrides.workflowName === undefined ||
    overrides.workflowName.trim().length === 0
      ? {}
      : { workflowName: overrides.workflowName.trim() }),
    inputMapping: overrides.inputMapping ?? { mode: "event-input" },
    ...(overrides.execution === undefined
      ? {}
      : { execution: overrides.execution }),
    ...(overrides.mailboxBridge === undefined
      ? {}
      : { mailboxBridge: overrides.mailboxBridge }),
  };
}

describe("resolveEventMailboxBridgePolicy", () => {
  test("defaults direct binding to final reply and no control output", () => {
    const policy = resolveEventMailboxBridgePolicy(
      binding({
        id: "b1",
        sourceId: "s",
        workflowName: "wf",
      }),
    );
    expect(policy.input.consumer).toBe("direct-workflow");
    expect(policy.output.reply.mode).toBe("final");
    expect(policy.output.progress.mode).toBe("status-only");
    expect(policy.output.control.mode).toBe("none");
  });

  test("defaults supervised binding to supervisor consumer and status-only control", () => {
    const policy = resolveEventMailboxBridgePolicy(
      binding({
        id: "b2",
        sourceId: "s",
        workflowName: "wf",
        execution: { mode: "supervised" },
      }),
    );
    expect(policy.input.consumer).toBe("supervisor");
    expect(policy.output.control.mode).toBe("status-only");
  });

  test("defaults supervisor-dispatch binding like supervised for mailbox streams", () => {
    const policy = resolveEventMailboxBridgePolicy(
      binding({
        id: "b-dispatch",
        sourceId: "s",
        execution: { mode: "supervisor-dispatch" },
      }),
    );
    expect(policy.input.consumer).toBe("supervisor");
    expect(policy.output.control.mode).toBe("status-only");
  });

  test("honors authored mailboxBridge reply none", () => {
    const policy = resolveEventMailboxBridgePolicy(
      binding({
        id: "b3",
        sourceId: "s",
        workflowName: "wf",
        mailboxBridge: {
          output: { reply: { mode: "none" } },
        },
      }),
    );
    expect(policy.output.reply.mode).toBe("none");
  });
});
