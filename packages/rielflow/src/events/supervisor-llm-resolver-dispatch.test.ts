import { describe, expect, test } from "vitest";
import {
  interpretSupervisorDispatchResolverRootJson,
  resolveSupervisorEventText,
} from "./supervisor-llm-resolver";
import type { EventBinding, ExternalEventEnvelope } from "./types";

function buildBinding(): EventBinding {
  return {
    id: "binding-1",
    sourceId: "source-1",
    workflowName: "workflow-1",
    inputMapping: { mode: "event-input" },
    execution: {
      mode: "supervised",
      control: {
        intentMapping: {
          mode: "llm-command",
          resolverWorkflowName: "resolver",
          resolverNodeId: "node",
        },
      },
    },
  };
}

function buildEvent(
  input: Readonly<Record<string, unknown>>,
): ExternalEventEnvelope {
  return {
    sourceId: "source-1",
    eventId: "evt-1",
    provider: "webhook",
    eventType: "chat.message",
    receivedAt: "2026-04-29T00:00:00.000Z",
    dedupeKey: "dedupe-1",
    input,
  };
}

describe("interpretSupervisorDispatchResolverRootJson", () => {
  test("unwraps adapter payload and returns parsed proposal", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      {
        payload: {
          action: "status",
          reason: "user asked",
          confidence: 0.9,
        },
      },
      { minConfidence: 0.75, invalidOutputBehavior: "error" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.action).toBe("status");
      expect(r.proposal.reason).toBe("user asked");
    }
  });

  test("returns error on invalid structure when behavior is error", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      { action: "bogus", reason: "x" },
      { minConfidence: 0.75, invalidOutputBehavior: "error" },
    );
    expect(r.ok).toBe(false);
  });

  test("clarifies on invalid structure when behavior is clarify", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      { action: "bogus", reason: "x" },
      { minConfidence: 0.75, invalidOutputBehavior: "clarify" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.action).toBe("clarify");
      expect(r.proposal.confidence).toBe(1);
    }
  });

  test("no-ops on invalid structure when behavior is no-op", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      { action: "bogus", reason: "x" },
      { minConfidence: 0.75, invalidOutputBehavior: "no-op" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.action).toBe("no-op");
    }
  });

  test("applies floor to low confidence", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      {
        action: "status",
        reason: "low",
        confidence: 0.1,
      },
      { minConfidence: 0.75, invalidOutputBehavior: "clarify" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.action).toBe("clarify");
    }
  });

  test("omitted confidence passes floor check", () => {
    const r = interpretSupervisorDispatchResolverRootJson(
      {
        action: "no-op",
        reason: "n",
      },
      { minConfidence: 0.75, invalidOutputBehavior: "error" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.action).toBe("no-op");
    }
  });
});

describe("resolveSupervisorEventText", () => {
  test("uses event.input.text as the default path and trims LLM resolver text", () => {
    expect(
      resolveSupervisorEventText({
        binding: buildBinding(),
        event: buildEvent({ text: "  hello resolver  " }),
        trimString: true,
      }),
    ).toBe("hello resolver");
  });

  test("resolves custom LLM input paths with trimming", () => {
    expect(
      resolveSupervisorEventText({
        binding: buildBinding(),
        event: buildEvent({ message: { body: "  status please  " } }),
        inputPath: "event.input.message.body",
        trimString: true,
      }),
    ).toBe("status please");
  });

  test("does not traverse arrays unless the caller explicitly opts in", () => {
    const binding = buildBinding();
    const event = buildEvent({ commands: ["start worker"] });

    expect(
      resolveSupervisorEventText({
        binding,
        event,
        inputPath: "event.input.commands.0",
        trimString: true,
      }),
    ).toBeUndefined();
    expect(
      resolveSupervisorEventText({
        binding,
        event,
        inputPath: "event.input.commands.0",
        allowArrayTraversal: true,
      }),
    ).toBe("start worker");
  });
});
