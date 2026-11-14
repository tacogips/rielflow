import { describe, expect, test } from "vitest";
import { bindingMatchesEvent, mapEventToWorkflowInput } from "./input-mapping";
import type { EventBinding, ExternalEventEnvelope } from "./types";

function makeEvent(): ExternalEventEnvelope {
  return {
    sourceId: "chat",
    eventId: "event-1",
    provider: "webhook",
    eventType: "chat.message",
    receivedAt: "2026-04-20T00:00:00.000Z",
    dedupeKey: "dedupe-1",
    actor: { id: "u1", displayName: "User One" },
    conversation: { id: "c1", threadId: "t1" },
    input: {
      text: "hello",
      file: { path: "plans/release.md" },
    },
  };
}

describe("event input mapping", () => {
  test("maps templates while preserving object-valued exact references", () => {
    const binding: EventBinding = {
      id: "binding",
      sourceId: "chat",
      workflowName: "demo",
      inputMapping: {
        mode: "template",
        template: {
          request: "{{event.input.text}}",
          user: "{{event.actor.displayName}}",
          file: "{{event.input.file}}",
        },
        mirrorToHumanInput: true,
      },
    };

    const mapped = mapEventToWorkflowInput(binding, makeEvent(), {
      id: "chat",
      kind: "webhook",
      path: "/events/chat",
    });

    expect(mapped.workflowInput).toEqual({
      request: "hello",
      user: "User One",
      file: { path: "plans/release.md" },
    });
    expect(mapped.runtimeVariables["humanInput"]).toEqual(mapped.workflowInput);
    expect(mapped.runtimeVariables["event"]).toMatchObject({
      sourceId: "chat",
      eventType: "chat.message",
      conversation: { id: "c1", threadId: "t1" },
    });
  });

  test("matches event type, conversation, and repository path prefix", () => {
    const binding: EventBinding = {
      id: "binding",
      sourceId: "chat",
      workflowName: "demo",
      match: {
        eventType: "chat.message",
        conversationId: "c1",
        pathPrefix: "plans/",
      },
      inputMapping: { mode: "event-input" },
    };

    expect(bindingMatchesEvent(binding, makeEvent())).toBe(true);
    expect(
      bindingMatchesEvent(
        {
          ...binding,
          match: { ...binding.match, pathPrefix: "notes/" },
        },
        makeEvent(),
      ),
    ).toBe(false);
  });
});