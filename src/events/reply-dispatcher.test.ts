import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createDefaultEventSourceRegistry,
  createEventSourceRegistry,
} from "./adapter-registry";
import { createEventReplyDispatcher } from "./reply-dispatcher";
import {
  listEventReplyDispatchesFromRuntimeDb,
  loadEventReplyDispatchByIdempotencyKey,
} from "../workflow/runtime-db";
import type { EventSourceAdapter } from "./source-adapter";
import type { ChatReplyDispatchRequest } from "../workflow/types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-reply-dispatcher-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function makeReplyRequest(
  idempotencyKey = "reply-key",
): ChatReplyDispatchRequest {
  return {
    target: {
      sourceId: "webhook",
      provider: "webhook",
      eventId: "evt-1",
      conversationId: "conv-1",
    },
    message: { text: "hello" },
    visibility: "public",
    threadPolicy: "same-thread",
    idempotencyKey,
    workflowId: "wf",
    workflowExecutionId: "sess-1",
    nodeId: "reply",
    nodeExecId: "exec-1",
  };
}

describe("event reply dispatcher", () => {
  test("routes chat replies to the source adapter and reuses idempotent results", async () => {
    const rootDataDir = await makeTempDir();
    let calls = 0;
    const adapter: EventSourceAdapter = {
      kind: "webhook",
      capabilities: {
        eventTypes: ["chat.message"],
        supportsStart: false,
        webhook: true,
        chatReply: true,
      },
      async start(input) {
        return { sourceId: input.source.id, stop: async () => {} };
      },
      async normalize() {
        throw new Error("not used");
      },
      async dispatchChatReply(input) {
        calls += 1;
        return {
          status: "sent",
          provider: input.source.provider ?? input.source.kind,
          providerMessageId: `message-${String(calls)}`,
        };
      },
    };
    const registry = createEventSourceRegistry([adapter]);
    const dispatcher = createEventReplyDispatcher({
      configuration: {
        eventRoot: "/events",
        sources: [
          {
            id: "webhook",
            kind: "webhook",
            provider: "chat-webhook",
            path: "/events/webhook",
          },
        ],
        destinations: [],
        bindings: [],
      },
      registry,
      env: {},
      fetchImpl: async () => new Response(null, { status: 204 }),
      runtimeOptions: { rootDataDir },
    });

    const first = await dispatcher.dispatchChatReply(makeReplyRequest());
    const second = await dispatcher.dispatchChatReply(makeReplyRequest());

    expect(first).toEqual({
      status: "sent",
      provider: "chat-webhook",
      providerMessageId: "message-1",
    });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  test("shares only in-flight reply dispatches before relying on persistence", async () => {
    const rootDataDir = await makeTempDir();
    let calls = 0;
    let releaseDispatch: (() => void) | undefined;
    let notifyDispatchStarted: (() => void) | undefined;
    const dispatchStarted = new Promise<void>((resolve) => {
      notifyDispatchStarted = resolve;
    });
    const adapter: EventSourceAdapter = {
      kind: "webhook",
      capabilities: {
        eventTypes: ["chat.message"],
        supportsStart: false,
        webhook: true,
        chatReply: true,
      },
      async start(input) {
        return { sourceId: input.source.id, stop: async () => {} };
      },
      async normalize() {
        throw new Error("not used");
      },
      async dispatchChatReply(input) {
        calls += 1;
        notifyDispatchStarted?.();
        await new Promise<void>((resolve) => {
          releaseDispatch = resolve;
        });
        return {
          status: "sent",
          provider: input.source.provider ?? input.source.kind,
          providerMessageId: `message-${String(calls)}`,
        };
      },
    };
    const dispatcher = createEventReplyDispatcher({
      configuration: {
        eventRoot: "/events",
        sources: [
          {
            id: "webhook",
            kind: "webhook",
            provider: "chat-webhook",
            path: "/events/webhook",
          },
        ],
        destinations: [],
        bindings: [],
      },
      registry: createEventSourceRegistry([adapter]),
      env: {},
      fetchImpl: async () => new Response(null, { status: 204 }),
      runtimeOptions: { rootDataDir },
    });

    const request = makeReplyRequest("concurrent-reply-key");
    const first = dispatcher.dispatchChatReply(request);
    const second = dispatcher.dispatchChatReply(request);
    await dispatchStarted;
    releaseDispatch?.();

    const firstResult = await first;
    expect(firstResult).toEqual({
      status: "sent",
      provider: "chat-webhook",
      providerMessageId: "message-1",
    });
    expect(await second).toEqual(firstResult);
    expect(await dispatcher.dispatchChatReply(request)).toEqual(firstResult);
    expect(calls).toBe(1);
  });

  test("persists successful replies and reuses them across dispatcher instances", async () => {
    const rootDataDir = await makeTempDir();
    let calls = 0;
    const adapter: EventSourceAdapter = {
      kind: "webhook",
      capabilities: {
        eventTypes: ["chat.message"],
        supportsStart: false,
        webhook: true,
        chatReply: true,
      },
      async start(input) {
        return { sourceId: input.source.id, stop: async () => {} };
      },
      async normalize() {
        throw new Error("not used");
      },
      async dispatchChatReply(input) {
        calls += 1;
        return {
          status: "queued",
          provider: input.source.provider ?? input.source.kind,
          dispatchId: `dispatch-${String(calls)}`,
        };
      },
    };
    const registry = createEventSourceRegistry([adapter]);
    const configuration = {
      eventRoot: "/events",
      sources: [
        {
          id: "webhook",
          kind: "webhook",
          provider: "chat-webhook",
          path: "/events/webhook",
        },
      ],
      destinations: [],
      bindings: [],
    } as const;
    const request = makeReplyRequest("persistent-reply-key");

    const firstDispatcher = createEventReplyDispatcher({
      configuration,
      registry,
      env: {},
      fetchImpl: async () => new Response(null, { status: 204 }),
      runtimeOptions: { rootDataDir },
    });
    const first = await firstDispatcher.dispatchChatReply(request);
    const persisted = await loadEventReplyDispatchByIdempotencyKey(
      request.idempotencyKey,
      { rootDataDir },
    );
    const secondDispatcher = createEventReplyDispatcher({
      configuration,
      registry,
      env: {},
      fetchImpl: async () => new Response(null, { status: 204 }),
      runtimeOptions: { rootDataDir },
    });
    const second = await secondDispatcher.dispatchChatReply(request);

    expect(first).toEqual({
      status: "queued",
      provider: "chat-webhook",
      dispatchId: "dispatch-1",
    });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    expect(persisted).toMatchObject({
      idempotencyKey: "persistent-reply-key",
      sourceId: "webhook",
      provider: "chat-webhook",
      workflowExecutionId: "sess-1",
      nodeId: "reply",
      status: "queued",
      dispatchId: "dispatch-1",
    });
    expect(JSON.parse(persisted?.requestJson ?? "{}")).toMatchObject({
      idempotencyKey: "persistent-reply-key",
      message: { text: "hello" },
    });
    expect(
      await listEventReplyDispatchesFromRuntimeDb({}, { rootDataDir }),
    ).toHaveLength(1);
  });

  test("persists failed reply dispatch attempts", async () => {
    const rootDataDir = await makeTempDir();
    const adapter: EventSourceAdapter = {
      kind: "webhook",
      capabilities: {
        eventTypes: ["chat.message"],
        supportsStart: false,
        webhook: true,
        chatReply: true,
      },
      async start(input) {
        return { sourceId: input.source.id, stop: async () => {} };
      },
      async normalize() {
        throw new Error("not used");
      },
      async dispatchChatReply() {
        throw new Error("reply endpoint unavailable");
      },
    };
    const dispatcher = createEventReplyDispatcher({
      configuration: {
        eventRoot: "/events",
        sources: [
          {
            id: "webhook",
            kind: "webhook",
            provider: "chat-webhook",
            path: "/events/webhook",
          },
        ],
        destinations: [],
        bindings: [],
      },
      registry: createEventSourceRegistry([adapter]),
      env: {},
      fetchImpl: async () => new Response(null, { status: 204 }),
      runtimeOptions: { rootDataDir },
    });

    await expect(
      dispatcher.dispatchChatReply(makeReplyRequest("failed-reply-key")),
    ).rejects.toThrow("reply endpoint unavailable");

    expect(
      await loadEventReplyDispatchByIdempotencyKey("failed-reply-key", {
        rootDataDir,
      }),
    ).toMatchObject({
      idempotencyKey: "failed-reply-key",
      status: "failed",
      error: "reply endpoint unavailable",
    });
  });

  test("persists failed explicit destination attempts with destination source provider", async () => {
    const rootDataDir = await makeTempDir();
    const adapter: EventSourceAdapter = {
      kind: "webhook",
      capabilities: {
        eventTypes: ["chat.message"],
        supportsStart: false,
        webhook: true,
        chatReply: true,
      },
      async start(input) {
        return { sourceId: input.source.id, stop: async () => {} };
      },
      async normalize() {
        throw new Error("not used");
      },
      async dispatchChatReply() {
        throw new Error("reply destination unavailable");
      },
    };
    const dispatcher = createEventReplyDispatcher({
      configuration: {
        eventRoot: "/events",
        sources: [
          {
            id: "inbound-chat",
            kind: "webhook",
            provider: "inbound-provider",
            path: "/events/inbound",
          },
          {
            id: "reply-chat",
            kind: "webhook",
            provider: "reply-provider",
            path: "/events/reply",
          },
        ],
        destinations: [
          {
            id: "chat-output",
            kind: "chat",
            sourceId: "reply-chat",
          },
        ],
        bindings: [],
      },
      registry: createEventSourceRegistry([adapter]),
      env: {},
      fetchImpl: async () => new Response(null, { status: 204 }),
      runtimeOptions: { rootDataDir },
    });

    await expect(
      dispatcher.dispatchChatReply({
        ...makeReplyRequest("failed-explicit-destination-key"),
        outputDestinationId: "chat-output",
        target: {
          sourceId: "inbound-chat",
          provider: "inbound-provider",
          eventId: "evt-1",
          conversationId: "conv-1",
        },
      }),
    ).rejects.toThrow("reply destination unavailable");

    expect(
      await loadEventReplyDispatchByIdempotencyKey(
        "failed-explicit-destination-key",
        { rootDataDir },
      ),
    ).toMatchObject({
      idempotencyKey: "failed-explicit-destination-key",
      provider: "reply-provider",
      status: "failed",
      error: "reply destination unavailable",
    });
  });

  test("rejects sources whose adapters do not support chat replies", async () => {
    const rootDataDir = await makeTempDir();
    const adapter: EventSourceAdapter = {
      kind: "cron",
      capabilities: {
        eventTypes: ["cron.tick"],
        supportsStart: false,
        webhook: false,
      },
      async start(input) {
        return { sourceId: input.source.id, stop: async () => {} };
      },
      async normalize() {
        throw new Error("not used");
      },
    };
    const dispatcher = createEventReplyDispatcher({
      configuration: {
        eventRoot: "/events",
        sources: [{ id: "webhook", kind: "cron" }],
        destinations: [],
        bindings: [],
      },
      registry: createEventSourceRegistry([adapter]),
      env: {},
      fetchImpl: async () => new Response(null, { status: 204 }),
      runtimeOptions: { rootDataDir },
    });

    await expect(
      dispatcher.dispatchChatReply(makeReplyRequest("unsupported-reply-key")),
    ).rejects.toThrow("does not support chat replies");
  });

  test("routes chat replies through an explicit chat output destination", async () => {
    const rootDataDir = await makeTempDir();
    const deliveredSourceIds: string[] = [];
    const deliveredConversationIds: string[] = [];
    const adapter: EventSourceAdapter = {
      kind: "webhook",
      capabilities: {
        eventTypes: ["chat.message"],
        supportsStart: false,
        webhook: true,
        chatReply: true,
      },
      async start(input) {
        return { sourceId: input.source.id, stop: async () => {} };
      },
      async normalize() {
        throw new Error("not used");
      },
      async dispatchChatReply(input) {
        deliveredSourceIds.push(input.source.id);
        deliveredConversationIds.push(input.request.target.conversationId);
        return {
          status: "sent",
          provider: input.source.provider ?? input.source.kind,
          providerMessageId: "message-explicit",
        };
      },
    };
    const dispatcher = createEventReplyDispatcher({
      configuration: {
        eventRoot: "/events",
        sources: [
          {
            id: "inbound-chat",
            kind: "webhook",
            path: "/events/inbound",
          },
          {
            id: "reply-chat",
            kind: "webhook",
            provider: "reply-provider",
            path: "/events/reply",
          },
        ],
        destinations: [
          {
            id: "chat-output",
            kind: "chat",
            sourceId: "reply-chat",
            target: {
              conversationId: "peer-conversation",
            },
          },
        ],
        bindings: [],
      },
      registry: createEventSourceRegistry([adapter]),
      env: {},
      fetchImpl: async () => new Response(null, { status: 204 }),
      runtimeOptions: { rootDataDir },
    });

    const result = await dispatcher.dispatchChatReply({
      ...makeReplyRequest("explicit-destination-key"),
      outputDestinationId: "chat-output",
      target: {
        sourceId: "inbound-chat",
        provider: "inbound",
        eventId: "evt-1",
        conversationId: "conv-1",
      },
    });

    expect(result).toEqual({
      status: "sent",
      provider: "reply-provider",
      providerMessageId: "message-explicit",
    });
    expect(deliveredSourceIds).toEqual(["reply-chat"]);
    expect(deliveredConversationIds).toEqual(["peer-conversation"]);
  });

  test("dispatches Matrix replies without persisting access tokens", async () => {
    const rootDataDir = await makeTempDir();
    const calls: RequestInit[] = [];
    const dispatcher = createEventReplyDispatcher({
      configuration: {
        eventRoot: "/events",
        sources: [
          {
            id: "team-matrix",
            kind: "matrix",
            provider: "matrix",
            homeserverUrlEnv: "DIVEDRA_MATRIX_HOMESERVER_URL",
            accessTokenEnv: "DIVEDRA_MATRIX_ACCESS_TOKEN",
            userId: "@divedra:matrix.example",
            rooms: [{ roomId: "!release:matrix.example" }],
          },
        ],
        destinations: [],
        bindings: [],
      },
      registry: createDefaultEventSourceRegistry(),
      env: {
        DIVEDRA_MATRIX_HOMESERVER_URL: "https://matrix.example",
        DIVEDRA_MATRIX_ACCESS_TOKEN: "secret-token",
      },
      fetchImpl: async (_url, init) => {
        calls.push(init ?? {});
        return new Response(JSON.stringify({ event_id: "$reply-event" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      runtimeOptions: { rootDataDir },
    });

    const result = await dispatcher.dispatchChatReply({
      ...makeReplyRequest("matrix-reply-key"),
      target: {
        sourceId: "team-matrix",
        provider: "matrix",
        eventId: "$event-1",
        conversationId: "!release:matrix.example",
      },
    });
    const persisted = await loadEventReplyDispatchByIdempotencyKey(
      "matrix-reply-key",
      { rootDataDir },
    );

    expect(result).toEqual({
      status: "sent",
      provider: "matrix",
      providerMessageId: "$reply-event",
    });
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer secret-token",
    });
    expect(persisted).toMatchObject({
      idempotencyKey: "matrix-reply-key",
      sourceId: "team-matrix",
      provider: "matrix",
      status: "sent",
      providerMessageId: "$reply-event",
    });
    expect(persisted?.requestJson).not.toContain("secret-token");
    expect(JSON.stringify(persisted)).not.toContain("secret-token");
  });

  test("fans out destination lists to all enabled chat destinations", async () => {
    const rootDataDir = await makeTempDir();
    const deliveredSourceIds: string[] = [];
    const adapter: EventSourceAdapter = {
      kind: "webhook",
      capabilities: {
        eventTypes: ["chat.message"],
        supportsStart: false,
        webhook: true,
        chatReply: true,
      },
      async start(input) {
        return { sourceId: input.source.id, stop: async () => {} };
      },
      async normalize() {
        throw new Error("not used");
      },
      async dispatchChatReply(input) {
        deliveredSourceIds.push(input.source.id);
        return {
          status: "sent",
          provider: input.source.provider ?? input.source.kind,
        };
      },
    };
    const dispatcher = createEventReplyDispatcher({
      configuration: {
        eventRoot: "/events",
        sources: [
          {
            id: "inbound-chat",
            kind: "webhook",
            path: "/events/inbound",
          },
          {
            id: "reply-chat",
            kind: "webhook",
            provider: "reply-provider",
            path: "/events/reply",
          },
          {
            id: "peer-chat",
            kind: "webhook",
            provider: "peer-provider",
            path: "/events/peer",
          },
        ],
        destinations: [
          {
            id: "backup-output",
            kind: "s3-backup",
            provider: "s3-compatible",
            bucket: "archive",
          },
          {
            id: "chat-output",
            kind: "chat",
            sourceId: "reply-chat",
          },
          {
            id: "peer-output",
            kind: "chat",
            sourceId: "peer-chat",
          },
        ],
        bindings: [],
      },
      registry: createEventSourceRegistry([adapter]),
      env: {},
      fetchImpl: async () => new Response(null, { status: 204 }),
      runtimeOptions: { rootDataDir },
    });

    const result = await dispatcher.dispatchChatReply({
      ...makeReplyRequest("destination-list-key"),
      outputDestinationIds: ["backup-output", "chat-output", "peer-output"],
      target: {
        sourceId: "inbound-chat",
        provider: "inbound",
        eventId: "evt-1",
        conversationId: "conv-1",
      },
    });

    expect(result).toEqual({
      status: "sent",
      provider: "reply-provider",
      destinationResults: [
        {
          destinationId: "chat-output",
          sourceId: "reply-chat",
          idempotencyKey: "destination-list-key:destination:chat-output",
          status: "sent",
          provider: "reply-provider",
        },
        {
          destinationId: "peer-output",
          sourceId: "peer-chat",
          idempotencyKey: "destination-list-key:destination:peer-output",
          status: "sent",
          provider: "peer-provider",
        },
      ],
    });
    expect(deliveredSourceIds).toEqual(["reply-chat", "peer-chat"]);

    const replay = await dispatcher.dispatchChatReply({
      ...makeReplyRequest("destination-list-key"),
      outputDestinationIds: ["backup-output", "chat-output", "peer-output"],
      target: {
        sourceId: "inbound-chat",
        provider: "inbound",
        eventId: "evt-1",
        conversationId: "conv-1",
      },
    });
    expect(replay).toEqual(result);
    expect(deliveredSourceIds).toEqual(["reply-chat", "peer-chat"]);
  });

  test("dispatches Chat SDK replies through configured send endpoints with redacted persistence", async () => {
    const rootDataDir = await makeTempDir();
    const calls: RequestInit[] = [];
    const dispatcher = createEventReplyDispatcher({
      configuration: {
        eventRoot: "/events",
        sources: [
          {
            id: "team-slack",
            kind: "chat-sdk",
            provider: "slack",
            webhook: { path: "chat-sdk/team-slack" },
            send: {
              endpointUrlEnv: "CHAT_SDK_SEND_URL",
              tokenEnv: "CHAT_SDK_SEND_TOKEN",
            },
          },
        ],
        destinations: [],
        bindings: [],
      },
      registry: createDefaultEventSourceRegistry(),
      env: {
        CHAT_SDK_SEND_URL: "https://chat-sdk.example.test/send",
        CHAT_SDK_SEND_TOKEN: "secret-token",
      },
      fetchImpl: async (_url, init) => {
        calls.push(init ?? {});
        return new Response(
          JSON.stringify({ providerMessageId: "slack-msg" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
      runtimeOptions: { rootDataDir },
    });

    const result = await dispatcher.dispatchChatReply({
      ...makeReplyRequest("chat-sdk-reply-key"),
      target: {
        sourceId: "team-slack",
        provider: "slack",
        eventId: "evt-1",
        conversationId: "C123",
        threadId: "T123",
      },
    });
    const persisted = await loadEventReplyDispatchByIdempotencyKey(
      "chat-sdk-reply-key",
      { rootDataDir },
    );

    expect(result).toEqual({
      status: "sent",
      provider: "slack",
      providerMessageId: "slack-msg",
    });
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      provider: "slack",
      target: { conversationId: "C123", threadId: "T123" },
      message: { text: "hello" },
      idempotencyKey: "chat-sdk-reply-key",
    });
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer secret-token",
    });
    expect(persisted).toMatchObject({
      idempotencyKey: "chat-sdk-reply-key",
      sourceId: "team-slack",
      provider: "slack",
      status: "sent",
      providerMessageId: "slack-msg",
    });
    expect(JSON.stringify(persisted)).not.toContain("secret-token");
  });
});
