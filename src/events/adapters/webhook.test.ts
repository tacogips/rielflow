import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  createWebhookEventSourceAdapter,
  verifyWebhookRequest,
} from "./webhook";

describe("webhook event source adapter", () => {
  test("verifies HMAC signatures and rejects replayed timestamps", () => {
    const bodyText = JSON.stringify({ input: { text: "hello" } });
    const signature = createHmac("sha256", "secret")
      .update(bodyText)
      .digest("hex");
    const now = new Date("2026-02-03T00:00:00.000Z");

    expect(
      verifyWebhookRequest({
        source: {
          id: "webhook",
          kind: "webhook",
          path: "/events/webhook",
          signingSecretEnv: "WEBHOOK_SECRET",
          timestampHeader: "x-event-time",
          replayWindowMs: 1000,
        },
        headers: {
          "x-divedra-signature": `sha256=${signature}`,
          "x-event-time": String(now.getTime()),
        },
        bodyText,
        env: { WEBHOOK_SECRET: "secret" },
        now,
      }),
    ).toEqual({ ok: true });

    expect(
      verifyWebhookRequest({
        source: {
          id: "webhook",
          kind: "webhook",
          path: "/events/webhook",
          signingSecretEnv: "WEBHOOK_SECRET",
          timestampHeader: "x-event-time",
          replayWindowMs: 1000,
        },
        headers: {
          "x-divedra-signature": `sha256=${signature}`,
          "x-event-time": "1",
        },
        bodyText,
        env: { WEBHOOK_SECRET: "secret" },
        now,
      }),
    ).toEqual({ ok: false, reason: "replay" });
  });

  test("normalizes generic webhook payloads", async () => {
    const adapter = createWebhookEventSourceAdapter();
    const envelope = await adapter.normalize({
      sourceId: "webhook",
      receivedAt: "2026-04-20T00:00:00.000Z",
      body: {
        eventId: "evt-1",
        eventType: "chat.message",
        actor: { id: "u1", displayName: "User One" },
        conversation: { id: "c1" },
        input: { text: "hello" },
      },
    });

    expect(envelope).toMatchObject({
      sourceId: "webhook",
      eventId: "evt-1",
      provider: "webhook",
      eventType: "chat.message",
      input: { text: "hello" },
      actor: { id: "u1", displayName: "User One" },
      conversation: { id: "c1" },
    });
  });

  test("dispatches chat replies to configured webhook endpoint", async () => {
    const adapter = createWebhookEventSourceAdapter();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          dispatchId: "dispatch-1",
          providerMessageId: "message-1",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const result = await adapter.dispatchChatReply?.({
      source: {
        id: "webhook",
        kind: "webhook",
        path: "/events/webhook",
        provider: "chat-webhook",
        replyEndpointEnv: "WEBHOOK_REPLY_URL",
      },
      request: {
        target: {
          sourceId: "webhook",
          provider: "chat-webhook",
          eventId: "evt-1",
          conversationId: "conv-1",
        },
        message: { text: "hello back" },
        visibility: "public",
        threadPolicy: "same-thread",
        idempotencyKey: "reply-key",
        workflowId: "wf",
        workflowExecutionId: "sess-1",
        nodeId: "reply",
        nodeExecId: "exec-1",
      },
      env: { WEBHOOK_REPLY_URL: "https://example.test/reply" },
      fetchImpl,
    });

    expect(result).toEqual({
      status: "sent",
      provider: "chat-webhook",
      dispatchId: "dispatch-1",
      providerMessageId: "message-1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://example.test/reply");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-divedra-idempotency-key": "reply-key",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      type: "divedra.chat_reply",
      sourceId: "webhook",
      target: {
        conversationId: "conv-1",
      },
      message: { text: "hello back" },
      workflowExecutionId: "sess-1",
    });
  });
});
