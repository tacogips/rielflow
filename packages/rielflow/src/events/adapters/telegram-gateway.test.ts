import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createTelegramGatewayEventSourceAdapter,
  dispatchTelegramGatewayReply,
} from "./telegram-gateway";
import type { TelegramGatewaySourceConfig } from "../types";
import type { ChatReplyDispatchRequest } from "../../workflow/types";

function telegramSource(
  overrides: Partial<TelegramGatewaySourceConfig> = {},
): TelegramGatewaySourceConfig {
  return {
    id: "telegram-gateway-personas",
    kind: "telegram-gateway",
    provider: "telegram",
    tokenEnv: "RIEL_TELEGRAM_BOT_TOKEN",
    botIdEnv: "RIEL_TELEGRAM_BOT_ID",
    chats: [{ id: "-1001234567890", personas: ["yui", "mika", "rina"] }],
    history: {
      maxMessages: 3,
      maxBytes: 4096,
      maxAgeMs: 86_400_000,
      scope: "chat",
    },
    filters: { ignoreBots: true, ignoreSelf: true },
    ...overrides,
  };
}

function telegramUpdate(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    update_id: 1001,
    message: {
      message_id: 42,
      date: 1_780_048_860,
      chat: {
        id: -1001234567890,
        type: "supergroup",
        title: "Persona Lab",
      },
      from: {
        id: 2001,
        is_bot: false,
        first_name: "Operator",
        username: "operator",
      },
      text: "Mika, what do you think?",
    },
    ...overrides,
  };
}

function replyRequest(
  overrides: Partial<ChatReplyDispatchRequest> = {},
): ChatReplyDispatchRequest {
  return {
    target: {
      sourceId: "telegram-gateway-personas",
      provider: "telegram",
      eventId: "42",
      conversationId: "-1001234567890",
      actorId: "2001",
    },
    message: { text: "Mika thinks this angle will land better." },
    visibility: "public",
    threadPolicy: "same-thread",
    idempotencyKey: "telegram-reply-key",
    workflowId: "wf",
    workflowExecutionId: "exec",
    nodeId: "reply",
    nodeExecId: "reply-exec",
    ...overrides,
  };
}

describe("telegram gateway event source adapter", () => {
  test("normalizes Telegram messages with persisted chat history", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rielflow-telegram-"));
    const adapter = createTelegramGatewayEventSourceAdapter();

    const first = await adapter.normalize({
      sourceId: "telegram-gateway-personas",
      source: telegramSource(),
      receivedAt: "2026-05-29T10:00:00.000Z",
      eventDataRoot: root,
      body: telegramUpdate({
        update_id: 1000,
        message: {
          message_id: 41,
          date: 1_780_048_800,
          chat: { id: -1001234567890, type: "supergroup" },
          from: { id: 2001, is_bot: false, first_name: "Operator" },
          text: "We need a trend-aware take.",
        },
      }),
    });
    await adapter.recordAcceptedEvent?.({
      source: telegramSource(),
      event: first,
      eventDataRoot: root,
      now: () => new Date("2026-05-29T10:00:01.000Z"),
    });

    const restartedAdapter = createTelegramGatewayEventSourceAdapter();
    const second = await restartedAdapter.normalize({
      sourceId: "telegram-gateway-personas",
      source: telegramSource(),
      receivedAt: "2026-05-29T10:01:00.000Z",
      eventDataRoot: root,
      body: telegramUpdate(),
      rawRef: { root: "artifact", path: "events/telegram/redacted.json" },
    });

    expect(second).toMatchObject({
      sourceId: "telegram-gateway-personas",
      eventId: "1001:42",
      provider: "telegram",
      eventType: "chat.message",
      occurredAt: "2026-05-29T10:01:00.000Z",
      receivedAt: "2026-05-29T10:01:00.000Z",
      dedupeKey: "telegram-gateway-personas:1001:42",
      actor: {
        id: "2001",
        displayName: "Operator",
        username: "operator",
        isBot: false,
      },
      conversation: { id: "-1001234567890" },
      input: {
        provider: "telegram",
        text: "Mika, what do you think?",
        historySource: {
          mode: "persisted",
          historyKey: "telegram-gateway-personas:-1001234567890",
          messageCount: 1,
        },
        telegram: {
          updateId: 1001,
          messageId: "42",
          chatId: "-1001234567890",
          chatType: "supergroup",
          chatTitle: "Persona Lab",
        },
        replyTarget: {
          sourceId: "telegram-gateway-personas",
          provider: "telegram",
          eventId: "42",
          conversationId: "-1001234567890",
          actorId: "2001",
        },
      },
      rawRef: { root: "artifact", path: "events/telegram/redacted.json" },
    });
    expect(
      (second.input["history"] as readonly { readonly text: string }[]).map(
        (entry) => entry.text,
      ),
    ).toEqual(["We need a trend-aware take."]);
  });

  test("polls Telegram updates and preserves photo attachment descriptors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rielflow-telegram-"));
    const adapter = createTelegramGatewayEventSourceAdapter();
    const abortController = new AbortController();
    const dispatched: unknown[] = [];
    let resolveDispatch: (() => void) | undefined;
    const dispatchSeen = new Promise<void>((resolve) => {
      resolveDispatch = resolve;
    });
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> =
      [];

    const handle = await adapter.start({
      source: telegramSource({
        polling: { timeoutSeconds: 1, limit: 10 },
        attachments: { includePhotos: true, resolveFilePaths: true },
      }),
      signal: abortController.signal,
      now: () => new Date("2026-05-29T10:02:00.000Z"),
      eventDataRoot: root,
      env: {
        RIEL_TELEGRAM_BOT_TOKEN: "telegram-secret",
        RIEL_TELEGRAM_BOT_ID: "9999",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        if (String(url).includes("/getFile")) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: { file_path: "photos/file.jpg" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (String(url).includes("/file/bottelegram-secret/photos/file.jpg")) {
          return new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          });
        }
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              telegramUpdate({
                update_id: 1002,
                message: {
                  message_id: 43,
                  date: 1_780_048_920,
                  chat: { id: -1001234567890, type: "supergroup" },
                  from: { id: 2001, is_bot: false, first_name: "Operator" },
                  caption: "Rina, inspect this layout.",
                  photo: [
                    {
                      file_id: "small-photo",
                      file_unique_id: "small-unique",
                      width: 90,
                      height: 90,
                      file_size: 2048,
                    },
                    {
                      file_id: "large-photo",
                      file_unique_id: "large-unique",
                      width: 1280,
                      height: 720,
                      file_size: 123456,
                    },
                  ],
                },
              }),
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      dispatch: async (event) => {
        dispatched.push(event);
        resolveDispatch?.();
      },
    });

    await dispatchSeen;
    await handle.stop();
    abortController.abort();

    expect(calls[0]?.url).toContain("/bottelegram-secret/getUpdates");
    expect(calls[0]?.url).toContain("allowed_updates=");
    expect(calls[1]?.url).toBe(
      "https://api.telegram.org/bottelegram-secret/getFile",
    );
    expect(calls[2]?.url).toBe(
      "https://api.telegram.org/file/bottelegram-secret/photos/file.jpg",
    );
    expect(dispatched).toHaveLength(1);
    const attachment = (
      dispatched[0] as {
        readonly input: {
          readonly attachments: readonly [
            { readonly localPath?: string; readonly contentRef?: string },
          ];
          readonly imagePaths?: readonly string[];
        };
      }
    ).input.attachments[0];
    expect(attachment.localPath).toBeDefined();
    expect(attachment.contentRef).toBe(
      "attachments/telegram-gateway/telegram-gateway-personas/1002-43-large-photo.jpg",
    );
    expect(await readFile(attachment.localPath ?? "", "base64")).toBe(
      "AQIDBA==",
    );
    expect(dispatched[0]).toMatchObject({
      eventId: "1002:43",
      input: {
        text: "Rina, inspect this layout.",
        attachmentText: "Rina, inspect this layout.",
        attachments: [
          {
            id: "large-photo",
            kind: "image",
            mediaType: "image/jpeg",
            filename: "telegram-photo-43.jpg",
            sizeBytes: 123456,
            width: 1280,
            height: 720,
            caption: "Rina, inspect this layout.",
            fileId: "large-photo",
            fileUniqueId: "large-unique",
            filePath: "photos/file.jpg",
            localPath: attachment.localPath,
            contentRef:
              "attachments/telegram-gateway/telegram-gateway-personas/1002-43-large-photo.jpg",
            source: {
              provider: "telegram",
              fileId: "large-photo",
              filePath: "photos/file.jpg",
              localPath: attachment.localPath,
              contentRef:
                "attachments/telegram-gateway/telegram-gateway-personas/1002-43-large-photo.jpg",
            },
          },
        ],
        imagePaths: [attachment.localPath],
      },
    });
    expect(JSON.stringify(dispatched)).not.toContain("telegram-secret");
  });

  test("dispatches Telegram chat replies through sendMessage", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> =
      [];

    const result = await dispatchTelegramGatewayReply({
      source: telegramSource(),
      request: replyRequest(),
      env: { RIEL_TELEGRAM_BOT_TOKEN: "telegram-secret" },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            ok: true,
            result: { message_id: 44, chat: { id: -1001234567890 } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    expect(result).toEqual({
      status: "sent",
      provider: "telegram",
      providerMessageId: "44",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.telegram.org/bottelegram-secret/sendMessage",
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      chat_id: "-1001234567890",
      text: "Mika thinks this angle will land better.",
      reply_parameters: {
        message_id: 42,
        allow_sending_without_reply: true,
      },
    });
  });

  test("keeps checked-in Telegram Gateway fixtures on the chat reply contract", async () => {
    const adapter = createTelegramGatewayEventSourceAdapter();
    const source = JSON.parse(
      await readFile(
        "examples/event-sources/.rielflow-events/sources/telegram-gateway-personas.json",
        "utf8",
      ),
    ) as TelegramGatewaySourceConfig;
    const payload = JSON.parse(
      await readFile(
        "examples/event-sources/payloads/telegram-gateway-photo-message.json",
        "utf8",
      ),
    ) as unknown;

    const envelope = await adapter.normalize({
      sourceId: "telegram-gateway-personas",
      source,
      receivedAt: "2026-05-29T10:05:00.000Z",
      body: payload,
    });

    expect(envelope).toMatchObject({
      sourceId: "telegram-gateway-personas",
      provider: "telegram",
      eventType: "chat.message",
      conversation: { id: "-1001234567890" },
      input: {
        text: "Yui, summarize this image and ask Mika too.",
        attachments: [
          expect.objectContaining({
            kind: "image",
            filename: "telegram-photo-77.jpg",
            fileId: "telegram-large-photo",
          }),
        ],
        replyTarget: {
          sourceId: "telegram-gateway-personas",
          provider: "telegram",
          conversationId: "-1001234567890",
        },
      },
    });
  });
});
