import { describe, expect, test } from "vitest";
import {
  buildControlStatusExternalOutputMessage,
  buildSupervisorControlChatReplyRequest,
  formatSupervisorControlReplyText,
  resolveChatReplyTargetFromEnvelope,
} from "./supervisor-control-reply";
import type { ExternalEventEnvelope } from "./types";
import type { SupervisedWorkflowView } from "../workflow/supervisor-client";

function baseEvent(
  input: Pick<ExternalEventEnvelope, "sourceId" | "eventId" | "input"> &
    Partial<ExternalEventEnvelope>,
): ExternalEventEnvelope {
  return {
    sourceId: input.sourceId,
    eventId: input.eventId,
    provider: input.provider ?? "p",
    eventType: input.eventType ?? "t",
    receivedAt: input.receivedAt ?? "2026-04-29T00:00:00.000Z",
    dedupeKey: input.dedupeKey ?? "d",
    input: input.input,
    ...(input.conversation === undefined
      ? {}
      : { conversation: input.conversation }),
    ...(input.actor === undefined ? {} : { actor: input.actor }),
  };
}

describe("supervisor-control-reply", () => {
  test("resolveChatReplyTargetFromEnvelope returns null when no conversation or replyTarget", () => {
    const event = baseEvent({
      sourceId: "s",
      eventId: "e",
      input: { text: "x" },
    });
    expect(resolveChatReplyTargetFromEnvelope(event)).toBeNull();
  });

  test("resolveChatReplyTargetFromEnvelope uses top-level conversation metadata", () => {
    const event = baseEvent({
      sourceId: "src-1",
      eventId: "ev-1",
      input: { text: "x" },
      conversation: { id: "c1", threadId: "t1" },
      actor: { id: "a1" },
    });
    expect(resolveChatReplyTargetFromEnvelope(event)).toEqual({
      sourceId: "src-1",
      provider: "p",
      eventId: "ev-1",
      conversationId: "c1",
      threadId: "t1",
      actorId: "a1",
    });
  });

  test("resolveChatReplyTargetFromEnvelope prefers embedded replyTarget", () => {
    const event = baseEvent({
      sourceId: "s",
      eventId: "e",
      input: {
        text: "x",
        replyTarget: {
          sourceId: "rs",
          provider: "rp",
          eventId: "re",
          conversationId: "rc",
          threadId: "rt",
          actorId: "ra",
        },
      },
    });
    expect(resolveChatReplyTargetFromEnvelope(event)).toEqual({
      sourceId: "rs",
      provider: "rp",
      eventId: "re",
      conversationId: "rc",
      threadId: "rt",
      actorId: "ra",
    });
  });

  test("formatSupervisorControlReplyText includes run and target status", () => {
    const now = "2026-04-29T00:00:00.000Z";
    const view: SupervisedWorkflowView = {
      supervisedRun: {
        supervisedRunId: "esv-1",
        sourceId: "s",
        bindingId: "b",
        correlationKey: "k",
        supervisorWorkflowName: "sw",
        targetWorkflowName: "tw",
        activeTargetExecutionId: "exe-1",
        status: "running",
        restartCount: 0,
        maxRestartsOnFailure: 3,
        autoImproveEnabled: false,
        createdAt: now,
        updatedAt: now,
      },
      activeTargetStatus: "running",
    };
    const text = formatSupervisorControlReplyText(view, "status");
    expect(text).toContain("esv-1");
    expect(text).toContain("targetExecutionId: exe-1");
    expect(text).toContain("targetSessionStatus: running");
  });

  test("buildSupervisorControlChatReplyRequest returns null without reply routing", () => {
    const event = baseEvent({
      sourceId: "s",
      eventId: "e",
      input: { text: "x" },
    });
    expect(
      buildSupervisorControlChatReplyRequest({
        event,
        receiptId: "r1",
        action: "status",
        skipReason: "no target",
      }),
    ).toBeNull();
  });

  test("buildSupervisorControlChatReplyRequest builds skip message when no view", () => {
    const event = baseEvent({
      sourceId: "s",
      eventId: "e",
      input: { text: "x" },
      conversation: { id: "c1" },
    });
    const req = buildSupervisorControlChatReplyRequest({
      event,
      receiptId: "r1",
      action: "skip",
      skipReason: "ambiguous",
    });
    expect(req).not.toBeNull();
    if (req === null) {
      throw new Error("expected chat reply request");
    }
    expect(req.message.text).toBe(
      "Supervisor needs a specific workflow target before running this command: ambiguous",
    );
    expect(req.idempotencyKey).toBe("supervisor-control:r1:skip");
    expect(
      req.dispatchAuditMetadata?.["canonicalExternalOutput"],
    ).toMatchObject({
      kind: "external-output",
      outputKind: "control-status",
    });
  });

  test("buildControlStatusExternalOutputMessage is control-status", () => {
    const event = baseEvent({
      sourceId: "s",
      eventId: "e",
      input: { text: "x" },
      conversation: { id: "c1" },
    });
    const msg = buildControlStatusExternalOutputMessage({
      event,
      receiptId: "r2",
      action: "skip",
      skipReason: "x",
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    expect(msg?.outputKind).toBe("control-status");
    expect(msg?.idempotencyKey).toBe("supervisor-control:r2:skip");
  });
});
