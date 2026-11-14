import { describe, expect, test } from "vitest";
import { resolveSupervisorIntent } from "./supervisor-intent";
import type { EventBinding, ExternalEventEnvelope } from "./types";

function buildBinding(
  input: { readonly inputPath?: string | undefined } = {},
): EventBinding {
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
          ...(input.inputPath === undefined
            ? {}
            : { inputPath: input.inputPath }),
          commands: {
            start: ["start"],
            stop: ["stop", "cancel"],
            restart: "restart",
            rerun: "rerun",
            status: "status",
            progress: "progress",
            input: ["input", "submit", "resume"],
          },
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
  test("command-map uses event.input.text as the default input path", () => {
    const result = resolveSupervisorIntent({
      binding: buildBinding(),
      event: buildEvent("start release review"),
    });

    expect(result).toEqual({
      outcome: "action",
      action: "start",
      args: ["release", "review"],
      commandText: "start release review",
    });
  });

  test("command-map preserves resolved text whitespace while parsing commands", () => {
    const result = resolveSupervisorIntent({
      binding: buildBinding(),
      event: buildEvent("  start padded  "),
    });

    expect(result).toEqual({
      outcome: "action",
      action: "start",
      args: ["padded"],
      commandText: "  start padded  ",
    });
  });

  test("command-map resolves custom input paths", () => {
    const result = resolveSupervisorIntent({
      binding: buildBinding({ inputPath: "event.input.message.body" }),
      event: {
        ...buildEvent("ignored default text"),
        input: { message: { body: "stop now" } },
      },
    });

    expect(result).toEqual({
      outcome: "action",
      action: "stop",
      args: ["now"],
      commandText: "stop now",
    });
  });

  test("command-map allows array traversal for configured input paths", () => {
    const result = resolveSupervisorIntent({
      binding: buildBinding({ inputPath: "event.input.commands.0" }),
      event: {
        ...buildEvent("ignored default text"),
        input: { commands: ["restart worker"] },
      },
    });

    expect(result).toEqual({
      outcome: "action",
      action: "restart",
      args: ["worker"],
      commandText: "restart worker",
    });
  });

  test("command-map routes unmatched chat text to command-analysis", () => {
    const result = resolveSupervisorIntent({
      binding: buildBinding(),
      event: buildEvent("please continue"),
    });

    expect(result).toEqual({
      outcome: "skip",
      reason: "command-analysis required: unknown-first-token",
    });
  });

  test("command-map supports configured aliases as exact first-token commands", () => {
    const result = resolveSupervisorIntent({
      binding: buildBinding(),
      event: buildEvent("submit next answer"),
    });

    expect(result).toEqual({
      outcome: "action",
      action: "input",
      args: ["next", "answer"],
      commandText: "submit next answer",
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
