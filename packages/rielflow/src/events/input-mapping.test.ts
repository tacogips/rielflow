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
      attachments: [
        {
          id: "img-1",
          kind: "image",
          mediaType: "image/png",
          filename: "release.png",
          imageDescription: "green release dashboard",
          extra: { preserved: true },
        },
      ],
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

  test("event-input mode preserves attachments in workflow and runtime event input", () => {
    const binding: EventBinding = {
      id: "binding",
      sourceId: "chat",
      workflowName: "demo",
      inputMapping: { mode: "event-input" },
    };
    const source = {
      id: "chat",
      kind: "chat-sdk",
      provider: "slack",
      mode: "generic-webhook",
      webhook: { path: "chat-sdk/slack" },
    } as const;

    const mapped = mapEventToWorkflowInput(binding, makeEvent(), source);

    expect(mapped.workflowInput["attachments"]).toEqual([
      {
        id: "img-1",
        kind: "image",
        mediaType: "image/png",
        filename: "release.png",
        imageDescription: "green release dashboard",
        extra: { preserved: true },
      },
    ]);
    expect(
      (
        mapped.runtimeVariables["event"] as {
          input: { attachments: unknown };
        }
      ).input.attachments,
    ).toEqual(mapped.workflowInput["attachments"]);
    expect(mapped.runtimeVariables["humanInput"]).toEqual(mapped.workflowInput);
  });

  test("template mode can select attachments arrays and array members", () => {
    const binding: EventBinding = {
      id: "binding",
      sourceId: "chat",
      workflowName: "demo",
      inputMapping: {
        mode: "template",
        template: {
          attachments: "{{event.input.attachments}}",
          firstFilename: "{{event.input.attachments.0.filename}}",
          firstAttachment: "{{event.input.attachments.0}}",
        },
        mirrorToHumanInput: false,
      },
    };

    const mapped = mapEventToWorkflowInput(binding, makeEvent(), {
      id: "chat",
      kind: "chat-sdk",
      provider: "slack",
      mode: "generic-webhook",
      webhook: { path: "chat-sdk/slack" },
    });

    expect(mapped.workflowInput).toEqual({
      attachments: [
        {
          id: "img-1",
          kind: "image",
          mediaType: "image/png",
          filename: "release.png",
          imageDescription: "green release dashboard",
          extra: { preserved: true },
        },
      ],
      firstFilename: "release.png",
      firstAttachment: {
        id: "img-1",
        kind: "image",
        mediaType: "image/png",
        filename: "release.png",
        imageDescription: "green release dashboard",
        extra: { preserved: true },
      },
    });
    expect(mapped.runtimeVariables["humanInput"]).toBeUndefined();
  });

  test("honors explicit mirrorToHumanInput overrides for chat-sdk sources", () => {
    const source = {
      id: "chat",
      kind: "chat-sdk",
      provider: "slack",
      mode: "generic-webhook",
      webhook: { path: "chat-sdk/slack" },
    } as const;
    const disabled = mapEventToWorkflowInput(
      {
        id: "disabled",
        sourceId: "chat",
        workflowName: "demo",
        inputMapping: { mode: "event-input", mirrorToHumanInput: false },
      },
      makeEvent(),
      source,
    );
    const enabled = mapEventToWorkflowInput(
      {
        id: "enabled",
        sourceId: "chat",
        workflowName: "demo",
        inputMapping: { mode: "event-input", mirrorToHumanInput: true },
      },
      makeEvent(),
      {
        id: "file",
        kind: "file-change",
        directory: ".",
        changeTypes: ["create"],
      },
    );

    expect(disabled.runtimeVariables["humanInput"]).toBeUndefined();
    expect(enabled.runtimeVariables["humanInput"]).toEqual(
      enabled.workflowInput,
    );
  });
});
