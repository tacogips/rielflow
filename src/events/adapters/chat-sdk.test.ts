import { createHmac } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { createChatSdkEventSourceAdapter } from "./chat-sdk";
import { verifyWebhookRequest } from "./webhook";
import type { ChatSdkSourceConfig } from "../types";

const source = {
  id: "team-slack",
  kind: "chat-sdk",
  provider: "slack",
  webhook: {
    path: "chat-sdk/team-slack",
    signingSecretEnv: "CHAT_SDK_SECRET",
  },
  send: {
    endpointUrlEnv: "CHAT_SDK_SEND_URL",
    tokenEnv: "CHAT_SDK_SEND_TOKEN",
  },
} as const satisfies ChatSdkSourceConfig;

describe("Chat SDK event source adapter", () => {
  test.each([
    "slack",
    "teams",
    "gchat",
    "discord",
    "telegram",
    "github",
    "linear",
    "whatsapp",
    "messenger",
    "web",
  ] as const)("normalizes %s inbound messages", async (provider) => {
    const adapter = createChatSdkEventSourceAdapter();
    const event = await adapter.normalize({
      sourceId: `${provider}-source`,
      source: { ...source, id: `${provider}-source`, provider },
      receivedAt: "2026-05-14T00:00:00.000Z",
      body: {
        provider,
        eventId: "evt-1",
        eventType: "message",
        occurredAt: "2026-05-13T23:59:00.000Z",
        actor: { id: "user-1", displayName: "Operator" },
        conversation: { id: "conv-1", threadId: "thread-1" },
        message: {
          text: "review this branch",
          format: "markdown",
          attachments: [{ type: "link", url: "https://example.test" }],
        },
      },
      rawRef: { root: "artifact", path: "events/raw-redacted.json" },
    });

    expect(event).toMatchObject({
      sourceId: `${provider}-source`,
      eventId: "evt-1",
      provider,
      eventType: "chat.message",
      occurredAt: "2026-05-13T23:59:00.000Z",
      receivedAt: "2026-05-14T00:00:00.000Z",
      dedupeKey: `${provider}-source:${provider}:evt-1`,
      actor: { id: "user-1", displayName: "Operator" },
      conversation: { id: "conv-1", threadId: "thread-1" },
      input: {
        provider,
        text: "review this branch",
        format: "markdown",
        attachments: [{ type: "link", url: "https://example.test" }],
        rawEventType: "message",
      },
      rawRef: { root: "artifact", path: "events/raw-redacted.json" },
    });
  });

  test("rejects provider mismatches and missing text", async () => {
    const adapter = createChatSdkEventSourceAdapter();
    await expect(
      adapter.normalize({
        sourceId: "team-slack",
        source,
        receivedAt: "2026-05-14T00:00:00.000Z",
        body: {
          provider: "discord",
          eventId: "evt-1",
          message: { text: "wrong provider" },
        },
      }),
    ).rejects.toThrow("does not match source provider");

    await expect(
      adapter.normalize({
        sourceId: "team-slack",
        source,
        receivedAt: "2026-05-14T00:00:00.000Z",
        body: {
          provider: "slack",
          eventId: "evt-1",
          message: {},
        },
      }),
    ).rejects.toThrow("message.text is required");
  });

  test("derives stable fallback dedupe when eventId is absent", async () => {
    const adapter = createChatSdkEventSourceAdapter();
    const raw = {
      sourceId: "team-slack",
      source,
      receivedAt: "2026-05-14T00:00:00.000Z",
      body: {
        provider: "slack",
        actor: { id: "user-1" },
        conversation: { id: "conv-1" },
        message: { text: "same message" },
      },
    } as const;

    const first = await adapter.normalize(raw);
    const second = await adapter.normalize(raw);

    expect(first.eventId).toBe(second.eventId);
    expect(first.dedupeKey).toBe(second.dedupeKey);
  });

  test("verifies generic webhook signatures before normalization", () => {
    const bodyText = JSON.stringify({
      provider: "slack",
      message: { text: "signed" },
    });
    const signature = createHmac("sha256", "secret")
      .update(bodyText)
      .digest("hex");

    expect(
      verifyWebhookRequest({
        source: {
          id: source.id,
          kind: "webhook",
          path: "/events/chat-sdk/team-slack",
          signingSecretEnv: "CHAT_SDK_SECRET",
        },
        headers: { "x-divedra-signature": signature },
        bodyText,
        env: { CHAT_SDK_SECRET: "secret" },
        now: new Date("2026-05-14T00:00:00.000Z"),
      }).ok,
    ).toBe(true);
  });

  test("dispatches replies to generic Chat SDK send endpoints without persisting tokens", async () => {
    const adapter = createChatSdkEventSourceAdapter();
    const calls: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ providerMessageId: "msg-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await adapter.dispatchChatReply?.({
      source,
      env: {
        CHAT_SDK_SEND_URL: "https://chat-sdk.example/send",
        CHAT_SDK_SEND_TOKEN: "secret-token",
      },
      fetchImpl,
      request: {
        target: {
          sourceId: "team-slack",
          provider: "slack",
          eventId: "evt-1",
          conversationId: "conv-1",
          threadId: "thread-1",
        },
        message: { text: "done" },
        visibility: "public",
        threadPolicy: "same-thread",
        idempotencyKey: "reply-1",
        workflowId: "wf",
        workflowExecutionId: "exec",
        nodeId: "reply",
        nodeExecId: "node-exec",
      },
    });

    expect(result).toEqual({
      status: "sent",
      provider: "slack",
      providerMessageId: "msg-1",
    });
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer secret-token",
      "x-divedra-idempotency-key": "reply-1",
    });
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      provider: "slack",
      target: { conversationId: "conv-1", threadId: "thread-1" },
      message: { text: "done" },
      idempotencyKey: "reply-1",
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  test("reports unset send endpoint environment", async () => {
    const adapter = createChatSdkEventSourceAdapter();

    await expect(
      adapter.dispatchChatReply?.({
        source,
        env: { CHAT_SDK_SEND_TOKEN: "secret-token" },
        fetchImpl: async () => new Response(null, { status: 200 }),
        request: {
          target: {
            sourceId: "team-slack",
            provider: "slack",
            eventId: "evt-1",
            conversationId: "conv-1",
          },
          message: { text: "done" },
          visibility: "public",
          threadPolicy: "same-thread",
          idempotencyKey: "reply-1",
          workflowId: "wf",
          workflowExecutionId: "exec",
          nodeId: "reply",
          nodeExecId: "node-exec",
        },
      }),
    ).rejects.toThrow("send endpoint env 'CHAT_SDK_SEND_URL' is not set");
  });

  test("reports Chat SDK send HTTP failures", async () => {
    const adapter = createChatSdkEventSourceAdapter();

    await expect(
      adapter.dispatchChatReply?.({
        source,
        env: {
          CHAT_SDK_SEND_URL: "https://chat-sdk.example/send",
          CHAT_SDK_SEND_TOKEN: "secret-token",
        },
        fetchImpl: async () => new Response(null, { status: 500 }),
        request: {
          target: {
            sourceId: "team-slack",
            provider: "slack",
            eventId: "evt-1",
            conversationId: "conv-1",
          },
          message: { text: "done" },
          visibility: "public",
          threadPolicy: "same-thread",
          idempotencyKey: "reply-1",
          workflowId: "wf",
          workflowExecutionId: "exec",
          nodeId: "reply",
          nodeExecId: "node-exec",
        },
      }),
    ).rejects.toThrow("send endpoint rejected request with HTTP 500");
  });
});
