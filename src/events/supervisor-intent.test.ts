import { describe, expect, test } from "vitest";
import { resolveSupervisorIntent } from "./supervisor-intent";
import type { EventBinding, ExternalEventEnvelope } from "./types";

function buildBinding(): EventBinding {
  return {
    id: "binding-1",
    sourceId: "source-1",
    workflowName: "demo",
    inputMapping: { mode: "event-input" },
    execution: {
      mode: "supervised",
      control: {
        intentMapping: {
          mode: "command-map",
          inputPath: "event.input.text",
          commands: {
            start: "start",
            stop: "stop",
            restart: "restart",
            status: "status",
          },
          defaultAction: "input",
        },
      },
    },
  };
}

function buildEvent(text: string): ExternalEventEnvelope {
  return {
    sourceId: "source-1",
    eventId: "evt-1",
    provider: "webhook",
    eventType: "chat.message",
    receivedAt: "2026-04-29T00:00:00.000Z",
    dedupeKey: "dedupe-1",
    conversation: {
      id: "conv-1",
      threadId: "thread-1",
    },
    input: {
      text,
    },
  };
}

describe("resolveSupervisorIntent", () => {
  test("command-map matches the first token of chat text", () => {
    const result = resolveSupervisorIntent({
      binding: buildBinding(),
      event: buildEvent("start release review"),
    });

    expect(result).toEqual({
      outcome: "action",
      action: "start",
    });
  });

  test("command-map falls back to input for unmatched chat text", () => {
    const result = resolveSupervisorIntent({
      binding: buildBinding(),
      event: buildEvent("please continue"),
    });

    expect(result).toEqual({
      outcome: "action",
      action: "input",
    });
  });

  test("llm-command bindings skip on the sync resolver path (use resolveSupervisorIntentAsync)", () => {
    const binding: EventBinding = {
      ...buildBinding(),
      execution: {
        mode: "supervised",
        control: {
          intentMapping: {
            mode: "llm-command",
            inputPath: "event.input.text",
            resolverWorkflowName: "divedra-default-workflow-supervisor",
            resolverNodeId: "resolve-chat-command",
          },
        },
      },
    };

    const result = resolveSupervisorIntent({
      binding,
      event: buildEvent("stop the workflow"),
    });

    expect(result).toEqual({
      outcome: "skip",
      reason: "llm-command intent mapping requires async resolution",
    });
  });
});
