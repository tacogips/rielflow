import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createDiscordGatewayEventSourceAdapter,
  dispatchDiscordGatewayReply,
  normalizeDiscordGatewayRawEvent,
  startDiscordGatewaySource,
} from "./discord-gateway";
import {
  createDiscordGatewayHistoryPersistence,
  discordGatewayHistoryFilePath,
  discordGatewayHistoryKey,
  persistedHistoryBounds,
} from "./discord-gateway-history-persistence";
import type { DiscordGatewaySourceConfig } from "../types";
import type {
  EventSourceDispatchOutcome,
  EventSourceDiagnostic,
} from "../source-adapter";
import type { ChatReplyDispatchRequest } from "../../workflow/types";

type MessageListener = (event: { readonly data: string }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  closed = false;
  private readonly listeners: MessageListener[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: MessageListener): void {
    if (type === "message") {
      this.listeners.push(listener);
    }
  }

  send(value: string): void {
    this.sent.push(value);
  }

  close(): void {
    this.closed = true;
  }

  emitMessage(value: unknown): void {
    const data = JSON.stringify(value);
    for (const listener of this.listeners) {
      listener({ data });
    }
  }
}

function discordSource(
  overrides: Partial<DiscordGatewaySourceConfig> = {},
): DiscordGatewaySourceConfig {
  return {
    id: "discord-gateway-personas",
    kind: "discord-gateway",
    tokenEnv: "RIEL_DISCORD_BOT_TOKEN",
    applicationIdEnv: "RIEL_DISCORD_APPLICATION_ID",
    channels: [
      {
        id: "234567890123456789",
        includeThreads: true,
        personas: ["yui", "mika", "rina"],
      },
    ],
    history: {
      maxMessages: 3,
      maxBytes: 4096,
      maxAgeMs: 86_400_000,
      scope: "thread-or-channel",
      fetchOnMessage: "when-cache-empty",
    },
    ...overrides,
  };
}

function messagePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "345678901234567890",
    channel_id: "567890123456789012",
    parent_channel_id: "234567890123456789",
    guild_id: "123456789012345678",
    timestamp: "2026-05-29T10:02:00.000Z",
    content: "Mika, what do you think?",
    author: {
      id: "456789012345678901",
      username: "operator",
      global_name: "Operator",
      bot: false,
    },
    mentions: [{ id: "999999999999999999" }],
    ...overrides,
  };
}

function replyRequest(
  overrides: Partial<ChatReplyDispatchRequest> = {},
): ChatReplyDispatchRequest {
  return {
    target: {
      sourceId: "discord-gateway-personas",
      provider: "discord",
      eventId: "345678901234567890",
      conversationId: "234567890123456789",
      threadId: "567890123456789012",
      actorId: "456789012345678901",
    },
    message: { text: "Mika thinks the second option fits better." },
    visibility: "public",
    threadPolicy: "same-thread",
    idempotencyKey: "discord-reply-key",
    workflowId: "wf",
    workflowExecutionId: "exec",
    nodeId: "reply",
    nodeExecId: "reply-exec",
    ...overrides,
  };
}

describe("discord gateway event source adapter", () => {
  test("normalizes Discord messages with bounded chronological history", () => {
    const sourceId = "discord-gateway-personas";
    const event = normalizeDiscordGatewayRawEvent({
      sourceId,
      source: discordSource({ history: { maxMessages: 2, maxBytes: 4096 } }),
      receivedAt: "2026-05-29T10:03:00.000Z",
      body: {
        ...messagePayload(),
        historySourceMode: "rest",
        history: [
          {
            id: "345678901234567890",
            channel_id: "567890123456789012",
            parent_channel_id: "234567890123456789",
            timestamp: "2026-05-29T10:02:00.000Z",
            content: "Mika, what do you think?",
            author: { id: "456789012345678901", bot: false },
          },
          {
            id: "111111111111111111",
            channel_id: "567890123456789012",
            parent_channel_id: "234567890123456789",
            timestamp: "2026-05-29T10:00:00.000Z",
            content: "We need to pick between option one and two.",
            author: {
              id: "222222222222222222",
              username: "yui",
              global_name: "Yui",
              bot: false,
            },
          },
          {
            id: "333333333333333333",
            channel_id: "567890123456789012",
            parent_channel_id: "234567890123456789",
            timestamp: "2026-05-29T10:01:00.000Z",
            content: "Option two has fewer moving parts.",
            author: {
              id: "444444444444444444",
              username: "rina",
              global_name: "Rina",
              bot: false,
            },
          },
        ],
      },
      rawRef: { root: "artifact", path: "events/redacted.json" },
    });

    expect(event).toMatchObject({
      sourceId,
      eventId: "345678901234567890",
      provider: "discord",
      eventType: "chat.message",
      occurredAt: "2026-05-29T10:02:00.000Z",
      dedupeKey: `${sourceId}:345678901234567890`,
      actor: {
        id: "456789012345678901",
        displayName: "Operator",
        username: "operator",
        isBot: false,
      },
      conversation: {
        id: "234567890123456789",
        threadId: "567890123456789012",
      },
      input: {
        provider: "discord",
        text: "Mika, what do you think?",
        historySource: {
          mode: "rest",
          maxMessages: 2,
          count: 2,
        },
        replyTarget: {
          sourceId: "discord-gateway-personas",
          provider: "discord",
          eventId: "345678901234567890",
          conversationId: "234567890123456789",
          threadId: "567890123456789012",
          actorId: "456789012345678901",
        },
      },
      rawRef: { root: "artifact", path: "events/redacted.json" },
    });
    expect(
      (event.input["history"] as readonly { readonly messageId: string }[]).map(
        (entry) => entry.messageId,
      ),
    ).toEqual(["111111111111111111", "333333333333333333"]);
  });

  test("normalizes and downloads Discord image attachments", async () => {
    const originalFetch = globalThis.fetch;
    const root = await mkdtemp(
      path.join(os.tmpdir(), "rielflow-discord-attachments-"),
    );
    globalThis.fetch = (async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://cdn.discord.test/yui.png");
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;
    try {
      const adapter = createDiscordGatewayEventSourceAdapter();
      const event = await adapter.normalize({
        sourceId: "discord-gateway-personas",
        source: discordSource({
          attachments: {
            includeImages: true,
            resolveFilePaths: true,
            maxBytes: 1024,
          },
        }),
        receivedAt: "2026-05-29T10:03:00.000Z",
        eventDataRoot: root,
        body: messagePayload({
          content: "この画像に写っている内容を短く説明して。",
          attachments: [
            {
              id: "999999999999999998",
              filename: "yui.png",
              url: "https://cdn.discord.test/yui.png",
              proxy_url: "https://media.discord.test/yui.png",
              content_type: "image/png",
              size: 3,
              width: 512,
              height: 512,
            },
          ],
        }),
      });

      const attachments = event.input["attachments"] as readonly [
        {
          readonly localPath: string;
          readonly contentRef: string;
          readonly source: { readonly localPath: string };
        },
      ];
      expect(attachments[0]).toMatchObject({
        id: "999999999999999998",
        kind: "image",
        mediaType: "image/png",
        filename: "yui.png",
        contentRef:
          "attachments/discord-gateway/discord-gateway-personas/345678901234567890-999999999999999998-yui.png",
      });
      expect(event.input).toMatchObject({
        attachmentText: "この画像に写っている内容を短く説明して。",
        imagePaths: [attachments[0].localPath],
      });
      expect(attachments[0].source.localPath).toBe(attachments[0].localPath);
      expect(await readFile(attachments[0].localPath)).toEqual(
        new Uint8Array([1, 2, 3]),
      );
    } finally {
      globalThis.fetch = originalFetch;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("drops a history entry that exceeds maxBytes by itself", () => {
    const event = normalizeDiscordGatewayRawEvent({
      sourceId: "discord-gateway-personas",
      source: discordSource({ history: { maxMessages: 5, maxBytes: 120 } }),
      receivedAt: "2026-05-29T10:03:00.000Z",
      body: {
        ...messagePayload(),
        history: [
          {
            messageId: "111111111111111111",
            authorId: "222222222222222222",
            isBot: false,
            createdAt: "2026-05-29T10:00:00.000Z",
            text: "x".repeat(500),
            conversationId: "234567890123456789",
            threadId: "567890123456789012",
          },
        ],
      },
    });

    expect(event.input["history"]).toEqual([]);
    expect(event.input["historySource"]).toMatchObject({
      count: 0,
      maxBytes: 120,
    });
  });

  test("starts Gateway receive path with REST history and safe filters", async () => {
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    const controller = new AbortController();
    const diagnostics: EventSourceDiagnostic[] = [];
    let resolveDispatched:
      | ((event: ReturnType<typeof normalizeDiscordGatewayRawEvent>) => void)
      | undefined;
    const dispatched = new Promise<
      ReturnType<typeof normalizeDiscordGatewayRawEvent>
    >((resolve) => {
      resolveDispatched = resolve;
    });

    const handle = await startDiscordGatewaySource({
      source: discordSource(),
      signal: controller.signal,
      now: () => new Date("2026-05-29T10:03:00.000Z"),
      env: {
        RIEL_DISCORD_BOT_TOKEN: "bot-token",
        RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify([
            {
              id: "333333333333333333",
              channel_id: "567890123456789012",
              parent_channel_id: "234567890123456789",
              timestamp: "2026-05-29T10:01:00.000Z",
              content: "Option two has fewer moving parts.",
              author: { id: "444444444444444444", bot: false },
            },
            {
              id: "111111111111111111",
              channel_id: "567890123456789012",
              parent_channel_id: "234567890123456789",
              timestamp: "2026-05-29T10:00:00.000Z",
              content: "We need to pick between option one and two.",
              author: { id: "222222222222222222", bot: false },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
      dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
        resolveDispatched?.(event);
        return { receipts: [] };
      },
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.emitMessage({
      op: 10,
      d: { heartbeat_interval: 100000 },
    });
    socket?.emitMessage({ t: "MESSAGE_CREATE", d: messagePayload() });

    const event = await dispatched;
    expect(event.input["historySource"]).toMatchObject({
      mode: "rest",
      count: 2,
    });
    expect(
      (event.input["history"] as readonly { readonly messageId: string }[]).map(
        (entry) => entry.messageId,
      ),
    ).toEqual(["111111111111111111", "333333333333333333"]);
    expect(diagnostics).toEqual([
      {
        sourceId: "discord-gateway-personas",
        errorClass: "DiscordGatewayHistoryPersistenceUnavailable",
      },
    ]);
    expect(JSON.stringify(socket?.sent)).toContain("rielflow");
    expect(JSON.stringify(socket?.sent)).toContain("bot-token");

    await handle.stop();
    expect(socket?.closed).toBe(true);
    globalThis.WebSocket = originalWebSocket;
  });

  test("downloads image attachments in Gateway receive path", async () => {
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    const dataRoot = await mkdtemp(
      path.join(os.tmpdir(), "rielflow-discord-gateway-images-"),
    );
    const diagnostics: EventSourceDiagnostic[] = [];
    let handle:
      | Awaited<ReturnType<typeof startDiscordGatewaySource>>
      | undefined;
    let resolveDispatched:
      | ((event: ReturnType<typeof normalizeDiscordGatewayRawEvent>) => void)
      | undefined;
    const dispatched = new Promise<
      ReturnType<typeof normalizeDiscordGatewayRawEvent>
    >((resolve) => {
      resolveDispatched = resolve;
    });

    try {
      handle = await startDiscordGatewaySource({
        source: discordSource({
          history: { fetchOnMessage: "never" },
          attachments: {
            includeImages: true,
            resolveFilePaths: true,
            maxBytes: 1024,
          },
        }),
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        eventDataRoot: dataRoot,
        fetchImpl: async (url) => {
          expect(String(url)).toContain("cdn.discordapp.com");
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        },
        diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
        dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
          resolveDispatched?.(event);
          return { receipts: [] };
        },
      });

      const socket = FakeWebSocket.instances[0];
      expect(socket).toBeDefined();
      socket?.emitMessage({
        op: 10,
        d: { heartbeat_interval: 100000 },
      });
      socket?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload({
          content: "",
          attachments: [
            {
              id: "777777777777777777",
              filename: "profile.png",
              url: "https://cdn.discordapp.com/attachments/channel/file/profile.png",
              content_type: "image/png",
              size: 3,
              width: 64,
              height: 64,
            },
          ],
        }),
      });

      const event = await dispatched;
      const imagePaths = event.input["imagePaths"] as readonly string[];
      expect(event.input["text"]).toBe("[Image attachment]");
      expect(imagePaths).toHaveLength(1);
      expect(imagePaths[0]?.startsWith(path.resolve(dataRoot))).toBe(true);
      await access(imagePaths[0] ?? "");
      expect(await readFile(imagePaths[0] ?? "")).toEqual(
        Buffer.from([1, 2, 3]),
      );
      expect(event.input["attachments"]).toMatchObject([
        {
          id: "777777777777777777",
          kind: "image",
          mediaType: "image/png",
          localPath: imagePaths[0],
        },
      ]);
      expect(diagnostics).toEqual([]);
    } finally {
      await handle?.stop();
      globalThis.WebSocket = originalWebSocket;
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("persists bounded normalized history files below the event data root", async () => {
    const dataRoot = await mkdtemp(
      path.join(os.tmpdir(), "rielflow-discord-history-"),
    );
    try {
      const source = discordSource({ id: "discord/gateway personas" });
      const key = discordGatewayHistoryKey({
        sourceId: source.id,
        channelId: "567890123456789012",
        parentChannelId: "234567890123456789",
        scope: "thread-or-channel",
      });
      const persistence = createDiscordGatewayHistoryPersistence({
        eventDataRoot: dataRoot,
        sourceId: source.id,
        bounds: persistedHistoryBounds({
          maxMessages: 3,
          maxBytes: 4096,
          maxAgeMs: 86_400_000,
          scope: "thread-or-channel",
          includeBotMessages: false,
        }),
      });

      await persistence.save(
        key,
        [
          {
            messageId: "333333333333333333",
            authorId: "444444444444444444",
            isBot: false,
            createdAt: "2026-05-29T10:01:00.000Z",
            text: "Persisted context",
            conversationId: "234567890123456789",
            threadId: "567890123456789012",
          },
        ],
        "2026-05-29T10:03:00.000Z",
      );

      const filePath = discordGatewayHistoryFilePath({
        eventDataRoot: dataRoot,
        sourceId: source.id,
        historyKey: key,
      });
      expect(filePath.startsWith(path.resolve(dataRoot))).toBe(true);
      expect(filePath).not.toContain("discord/gateway personas");
      const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
        readonly version: number;
        readonly sourceId: string;
        readonly historyKey: string;
        readonly bounds: Record<string, unknown>;
        readonly messages: readonly Record<string, unknown>[];
      };
      expect(persisted).toMatchObject({
        version: 1,
        sourceId: source.id,
        historyKey: key,
        bounds: {
          maxMessages: 3,
          maxBytes: 4096,
          maxAgeMs: 86_400_000,
          scope: "thread-or-channel",
          includeBotMessages: false,
        },
      });
      expect(persisted.messages).toEqual([
        expect.objectContaining({
          messageId: "333333333333333333",
          text: "Persisted context",
        }),
      ]);
      expect(JSON.stringify(persisted)).not.toContain("bot-token");
      expect(JSON.stringify(persisted)).not.toContain("rawRef");
      expect(await persistence.load(key, "2026-05-29T10:04:00.000Z")).toEqual(
        persisted.messages,
      );
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("reloads persisted thread history across Gateway source restarts without REST", async () => {
    const originalWebSocket = globalThis.WebSocket;
    const dataRoot = await mkdtemp(
      path.join(os.tmpdir(), "rielflow-discord-restart-"),
    );
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    const source = discordSource({
      history: {
        maxMessages: 2,
        maxBytes: 4096,
        maxAgeMs: 86_400_000,
        scope: "thread-or-channel",
        fetchOnMessage: "never",
      },
    });
    try {
      let resolveFirst:
        | ((event: ReturnType<typeof normalizeDiscordGatewayRawEvent>) => void)
        | undefined;
      const firstDispatched = new Promise<
        ReturnType<typeof normalizeDiscordGatewayRawEvent>
      >((resolve) => {
        resolveFirst = resolve;
      });
      const firstHandle = await startDiscordGatewaySource({
        source,
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        eventDataRoot: dataRoot,
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        fetchImpl: async () => {
          throw new Error("REST history should not be fetched");
        },
        dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
          resolveFirst?.(event);
          return { receipts: [] };
        },
      });
      FakeWebSocket.instances[0]?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload({
          id: "333333333333333333",
          timestamp: "2026-05-29T10:01:00.000Z",
          content: "The second option is simpler.",
        }),
      });
      await firstDispatched;
      await firstHandle.stop();

      FakeWebSocket.instances = [];
      let resolveSecond:
        | ((event: ReturnType<typeof normalizeDiscordGatewayRawEvent>) => void)
        | undefined;
      const secondDispatched = new Promise<
        ReturnType<typeof normalizeDiscordGatewayRawEvent>
      >((resolve) => {
        resolveSecond = resolve;
      });
      const secondHandle = await startDiscordGatewaySource({
        source,
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:04:00.000Z"),
        eventDataRoot: dataRoot,
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        fetchImpl: async () => {
          throw new Error("REST history should not be fetched");
        },
        dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
          resolveSecond?.(event);
          return { receipts: [] };
        },
      });
      FakeWebSocket.instances[0]?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload({
          id: "555555555555555555",
          timestamp: "2026-05-29T10:02:00.000Z",
          content: "Use that one.",
        }),
      });

      const event = await secondDispatched;
      expect(event.input["historySource"]).toMatchObject({
        mode: "persisted",
        count: 1,
      });
      expect(event.input["history"]).toEqual([
        expect.objectContaining({
          messageId: "333333333333333333",
          text: "The second option is simpler.",
        }),
      ]);
      await secondHandle.stop();
    } finally {
      globalThis.WebSocket = originalWebSocket;
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("ignores corrupt persisted history with sanitized diagnostics", async () => {
    const originalWebSocket = globalThis.WebSocket;
    const dataRoot = await mkdtemp(
      path.join(os.tmpdir(), "rielflow-discord-corrupt-"),
    );
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    const source = discordSource({
      history: { fetchOnMessage: "never", scope: "thread-or-channel" },
    });
    const key = discordGatewayHistoryKey({
      sourceId: source.id,
      channelId: "567890123456789012",
      parentChannelId: "234567890123456789",
      scope: "thread-or-channel",
    });
    const filePath = discordGatewayHistoryFilePath({
      eventDataRoot: dataRoot,
      sourceId: source.id,
      historyKey: key,
    });
    const diagnostics: EventSourceDiagnostic[] = [];
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, '{"version":2,"messages":[]}\n', "utf8");
      let resolveDispatched:
        | ((event: ReturnType<typeof normalizeDiscordGatewayRawEvent>) => void)
        | undefined;
      const dispatched = new Promise<
        ReturnType<typeof normalizeDiscordGatewayRawEvent>
      >((resolve) => {
        resolveDispatched = resolve;
      });
      const handle = await startDiscordGatewaySource({
        source,
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        eventDataRoot: dataRoot,
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
        dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
          resolveDispatched?.(event);
          return { receipts: [] };
        },
      });
      FakeWebSocket.instances[0]?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload(),
      });
      const event = await dispatched;
      expect(event.input["history"]).toEqual([]);
      expect(diagnostics).toContainEqual({
        sourceId: source.id,
        errorClass: "DiscordGatewayPersistedHistoryInvalidSchema",
      });
      expect(JSON.stringify(diagnostics)).not.toContain("bot-token");
      await handle.stop();
    } finally {
      globalThis.WebSocket = originalWebSocket;
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("does not write persisted history in read-only mode", async () => {
    const originalWebSocket = globalThis.WebSocket;
    const dataRoot = await mkdtemp(
      path.join(os.tmpdir(), "rielflow-discord-readonly-"),
    );
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    const source = discordSource({ history: { fetchOnMessage: "never" } });
    const diagnostics: EventSourceDiagnostic[] = [];
    try {
      let resolveDispatched:
        | ((event: ReturnType<typeof normalizeDiscordGatewayRawEvent>) => void)
        | undefined;
      const dispatched = new Promise<
        ReturnType<typeof normalizeDiscordGatewayRawEvent>
      >((resolve) => {
        resolveDispatched = resolve;
      });
      const handle = await startDiscordGatewaySource({
        source,
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        eventDataRoot: dataRoot,
        readOnly: true,
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
        dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
          resolveDispatched?.(event);
          return { receipts: [] };
        },
      });
      FakeWebSocket.instances[0]?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload(),
      });
      await dispatched;
      const key = discordGatewayHistoryKey({
        sourceId: source.id,
        channelId: "567890123456789012",
        parentChannelId: "234567890123456789",
        scope: "thread-or-channel",
      });
      await expect(
        access(
          discordGatewayHistoryFilePath({
            eventDataRoot: dataRoot,
            sourceId: source.id,
            historyKey: key,
          }),
        ),
      ).rejects.toThrow();
      expect(diagnostics).toContainEqual({
        sourceId: source.id,
        errorClass: "DiscordGatewayHistoryPersistenceReadOnly",
      });
      await handle.stop();
    } finally {
      globalThis.WebSocket = originalWebSocket;
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("rejects thread messages when parent channel disables threads", async () => {
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    let dispatchCount = 0;

    try {
      const handle = await startDiscordGatewaySource({
        source: discordSource({
          channels: [
            {
              id: "234567890123456789",
              includeThreads: false,
              personas: ["yui", "mika", "rina"],
            },
          ],
        }),
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        fetchImpl: async () => new Response("[]", { status: 200 }),
        dispatch: async (): Promise<EventSourceDispatchOutcome> => {
          dispatchCount += 1;
          return { receipts: [] };
        },
      });

      FakeWebSocket.instances[0]?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload(),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(dispatchCount).toBe(0);
      await handle.stop();
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });

  test("accepts an explicitly configured thread before parent thread fallback", async () => {
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    let resolveDispatched:
      | ((event: ReturnType<typeof normalizeDiscordGatewayRawEvent>) => void)
      | undefined;
    const dispatched = new Promise<
      ReturnType<typeof normalizeDiscordGatewayRawEvent>
    >((resolve) => {
      resolveDispatched = resolve;
    });

    try {
      const handle = await startDiscordGatewaySource({
        source: discordSource({
          channels: [
            {
              id: "234567890123456789",
              includeThreads: false,
              personas: ["yui", "mika", "rina"],
            },
            {
              id: "567890123456789012",
              personas: ["mika"],
            },
          ],
          history: {
            maxMessages: 3,
            maxBytes: 4096,
            maxAgeMs: 86_400_000,
            scope: "thread-or-channel",
            fetchOnMessage: "never",
          },
        }),
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        fetchImpl: async () => new Response("[]", { status: 200 }),
        dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
          resolveDispatched?.(event);
          return { receipts: [] };
        },
      });

      FakeWebSocket.instances[0]?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload(),
      });

      await expect(dispatched).resolves.toMatchObject({
        eventId: "345678901234567890",
      });
      await handle.stop();
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });

  test("fetches parent channel REST history for thread messages in channel scope", async () => {
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    const urls: string[] = [];
    let resolveDispatched:
      | ((event: ReturnType<typeof normalizeDiscordGatewayRawEvent>) => void)
      | undefined;
    const dispatched = new Promise<
      ReturnType<typeof normalizeDiscordGatewayRawEvent>
    >((resolve) => {
      resolveDispatched = resolve;
    });

    try {
      const handle = await startDiscordGatewaySource({
        source: discordSource({
          history: {
            maxMessages: 3,
            maxBytes: 4096,
            maxAgeMs: 86_400_000,
            scope: "channel",
            fetchOnMessage: "always",
          },
        }),
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        fetchImpl: async (url) => {
          urls.push(String(url));
          return new Response("[]", { status: 200 });
        },
        dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
          resolveDispatched?.(event);
          return { receipts: [] };
        },
      });

      FakeWebSocket.instances[0]?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload(),
      });

      await expect(dispatched).resolves.toMatchObject({
        eventId: "345678901234567890",
      });
      expect(urls[0]).toContain("/channels/234567890123456789/messages");
      await handle.stop();
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });

  test("resolves real Discord thread messages without parent_channel_id", async () => {
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    let resolveDispatched:
      | ((event: ReturnType<typeof normalizeDiscordGatewayRawEvent>) => void)
      | undefined;
    const dispatched = new Promise<
      ReturnType<typeof normalizeDiscordGatewayRawEvent>
    >((resolve) => {
      resolveDispatched = resolve;
    });

    try {
      const handle = await startDiscordGatewaySource({
        source: discordSource({
          channels: [
            {
              id: "234567890123456789",
              includeThreads: true,
              personas: ["yui", "mika", "rina"],
            },
          ],
          history: {
            maxMessages: 3,
            maxBytes: 4096,
            maxAgeMs: 86_400_000,
            scope: "thread-or-channel",
            fetchOnMessage: "never",
          },
        }),
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        fetchImpl: async (url) => {
          expect(String(url)).toContain("/channels/567890123456789012");
          return new Response(
            JSON.stringify({
              id: "567890123456789012",
              parent_id: "234567890123456789",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
        dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
          resolveDispatched?.(event);
          return { receipts: [] };
        },
      });

      FakeWebSocket.instances[0]?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload({ parent_channel_id: undefined }),
      });

      await expect(dispatched).resolves.toMatchObject({
        conversation: {
          id: "234567890123456789",
          threadId: "567890123456789012",
        },
        input: {
          replyTarget: {
            conversationId: "234567890123456789",
            threadId: "567890123456789012",
          },
        },
      });
      await handle.stop();
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });

  test("serializes same-thread messages while parent lookup is pending", async () => {
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    const events: ReturnType<typeof normalizeDiscordGatewayRawEvent>[] = [];
    let lookupCount = 0;
    let releaseFirstLookup: (() => void) | undefined;
    const firstLookupBlocked = new Promise<void>((resolve) => {
      releaseFirstLookup = resolve;
    });

    try {
      const handle = await startDiscordGatewaySource({
        source: discordSource({
          channels: [
            {
              id: "234567890123456789",
              includeThreads: true,
              personas: ["yui", "mika", "rina"],
            },
          ],
          history: {
            maxMessages: 3,
            maxBytes: 4096,
            maxAgeMs: 86_400_000,
            scope: "thread-or-channel",
            fetchOnMessage: "never",
          },
        }),
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        fetchImpl: async () => {
          lookupCount += 1;
          if (lookupCount === 1) {
            await firstLookupBlocked;
          }
          return new Response(
            JSON.stringify({
              id: "567890123456789012",
              parent_id: "234567890123456789",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
        dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
          events.push(event);
          return { receipts: [] };
        },
      });

      const socket = FakeWebSocket.instances[0];
      socket?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload({
          id: "111111111111111111",
          parent_channel_id: undefined,
          content: "First thread message",
        }),
      });
      socket?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload({
          id: "222222222222222222",
          parent_channel_id: undefined,
          content: "Second thread message",
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(lookupCount).toBe(1);
      expect(events).toEqual([]);
      releaseFirstLookup?.();
      for (let attempt = 0; attempt < 10 && events.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(events.map((event) => event.eventId)).toEqual([
        "111111111111111111",
        "222222222222222222",
      ]);
      expect(
        (
          events[1]?.input["history"] as
            | readonly { readonly messageId: string }[]
            | undefined
        )?.map((entry) => entry.messageId),
      ).toEqual(["111111111111111111"]);
      await handle.stop();
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });

  test("caches a dispatched message before a blocked dispatch completes", async () => {
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    const events: ReturnType<typeof normalizeDiscordGatewayRawEvent>[] = [];
    let releaseFirstDispatch: (() => void) | undefined;
    const firstDispatchBlocked = new Promise<void>((resolve) => {
      releaseFirstDispatch = resolve;
    });

    try {
      const handle = await startDiscordGatewaySource({
        source: discordSource({
          channels: [{ id: "234567890123456789" }],
          history: {
            maxMessages: 3,
            maxBytes: 4096,
            maxAgeMs: 86_400_000,
            scope: "channel",
            fetchOnMessage: "never",
          },
        }),
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        fetchImpl: async () => new Response("[]", { status: 200 }),
        dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
          events.push(event);
          if (events.length === 1) {
            await firstDispatchBlocked;
          }
          return { receipts: [] };
        },
      });

      const socket = FakeWebSocket.instances[0];
      socket?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload({
          id: "111111111111111111",
          channel_id: "234567890123456789",
          parent_channel_id: undefined,
          content: "First message",
        }),
      });
      socket?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload({
          id: "222222222222222222",
          channel_id: "234567890123456789",
          parent_channel_id: undefined,
          content: "Second message",
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(events).toHaveLength(1);
      releaseFirstDispatch?.();
      for (let attempt = 0; attempt < 10 && events.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(events).toHaveLength(2);
      expect(
        (
          events[1]?.input["history"] as
            | readonly { readonly messageId: string }[]
            | undefined
        )?.map((entry) => entry.messageId),
      ).toEqual(["111111111111111111"]);
      await handle.stop();
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });

  test("serializes same-conversation messages while REST history fetch is pending", async () => {
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
    const events: ReturnType<typeof normalizeDiscordGatewayRawEvent>[] = [];
    let fetchCount = 0;
    let releaseFirstFetch: (() => void) | undefined;
    const firstFetchBlocked = new Promise<void>((resolve) => {
      releaseFirstFetch = resolve;
    });

    try {
      const handle = await startDiscordGatewaySource({
        source: discordSource({
          channels: [{ id: "234567890123456789" }],
          history: {
            maxMessages: 3,
            maxBytes: 4096,
            maxAgeMs: 86_400_000,
            scope: "channel",
            fetchOnMessage: "always",
          },
        }),
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        env: {
          RIEL_DISCORD_BOT_TOKEN: "bot-token",
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        fetchImpl: async () => {
          fetchCount += 1;
          if (fetchCount === 1) {
            await firstFetchBlocked;
          }
          return new Response("[]", { status: 200 });
        },
        dispatch: async (event): Promise<EventSourceDispatchOutcome> => {
          events.push(event);
          return { receipts: [] };
        },
      });

      const socket = FakeWebSocket.instances[0];
      socket?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload({
          id: "111111111111111111",
          channel_id: "234567890123456789",
          parent_channel_id: undefined,
          content: "First message",
        }),
      });
      socket?.emitMessage({
        t: "MESSAGE_CREATE",
        d: messagePayload({
          id: "222222222222222222",
          channel_id: "234567890123456789",
          parent_channel_id: undefined,
          content: "Second message",
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchCount).toBe(1);
      expect(events).toEqual([]);
      releaseFirstFetch?.();
      for (let attempt = 0; attempt < 10 && events.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(events.map((event) => event.eventId)).toEqual([
        "111111111111111111",
        "222222222222222222",
      ]);
      expect(
        (
          events[1]?.input["history"] as
            | readonly { readonly messageId: string }[]
            | undefined
        )?.map((entry) => entry.messageId),
      ).toEqual(["111111111111111111"]);
      await handle.stop();
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  });

  test("requires configured token env before opening the Gateway", async () => {
    await expect(
      startDiscordGatewaySource({
        source: discordSource(),
        signal: new AbortController().signal,
        now: () => new Date("2026-05-29T10:03:00.000Z"),
        env: {
          RIEL_DISCORD_APPLICATION_ID: "999999999999999999",
        },
        fetchImpl: async () => new Response(null, { status: 204 }),
        dispatch: async () => ({ receipts: [] }),
      }),
    ).rejects.toThrow("RIEL_DISCORD_BOT_TOKEN");
  });

  test("dispatches replies to thread or conversation root by policy", async () => {
    const urls: string[] = [];
    const authorizations: string[] = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      urls.push(String(url));
      authorizations.push(
        new Headers(init?.headers).get("authorization") ?? "",
      );
      return new Response(JSON.stringify({ id: "999999999999999998" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const sameThread = await dispatchDiscordGatewayReply({
      source: discordSource(),
      request: replyRequest(),
      env: { RIEL_DISCORD_BOT_TOKEN: "bot-token" },
      fetchImpl,
    });
    const conversationRoot = await dispatchDiscordGatewayReply({
      source: discordSource(),
      request: replyRequest({
        idempotencyKey: "discord-root-reply-key",
        threadPolicy: "conversation-root",
      }),
      env: { RIEL_DISCORD_BOT_TOKEN: "bot-token" },
      fetchImpl,
    });
    const replyAs = await dispatchDiscordGatewayReply({
      source: discordSource({
        replyBots: { mika: { tokenEnv: "RIEL_DISCORD_MIKA_TOKEN" } },
      }),
      request: replyRequest({
        idempotencyKey: "discord-reply-as-key",
        message: {
          text: "Mika thinks the second option fits better.",
          replyAs: "mika",
        },
      }),
      env: {
        RIEL_DISCORD_BOT_TOKEN: "bot-token",
        RIEL_DISCORD_MIKA_TOKEN: "mika-token",
      },
      fetchImpl,
    });

    expect(sameThread).toEqual({
      status: "sent",
      provider: "discord",
      providerMessageId: "999999999999999998",
    });
    expect(conversationRoot.provider).toBe("discord");
    expect(replyAs.provider).toBe("discord");
    expect(urls[0]).toContain("/channels/567890123456789012/messages");
    expect(urls[1]).toContain("/channels/234567890123456789/messages");
    expect(authorizations[2]).toBe("Bot mika-token");
  });

  test("advertises the built-in adapter capabilities", () => {
    expect(createDiscordGatewayEventSourceAdapter().capabilities).toEqual({
      eventTypes: ["chat.message"],
      supportsStart: true,
      webhook: false,
      chatReply: true,
    });
  });
});
