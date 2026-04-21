import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEventSourceRegistry } from "./adapter-registry";
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
});
