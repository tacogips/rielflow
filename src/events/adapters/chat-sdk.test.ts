import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

async function readFixtureJson(
  relativePath: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.resolve(relativePath), "utf8"),
  ) as Record<string, unknown>;
}

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

  test("keeps checked-in Chat SDK fixtures on the generic secure boundary", async () => {
    const adapter = createChatSdkEventSourceAdapter();
    const fixtureSource = (await readFixtureJson(
      "examples/event-sources/.divedra-events/sources/chat-sdk-slack.json",
    )) as unknown as ChatSdkSourceConfig;
    const binding = await readFixtureJson(
      "examples/event-sources/.divedra-events/bindings/chat-sdk-slack-to-workflow.json",
    );
    const destination = await readFixtureJson(
      "examples/event-sources/.divedra-events/destinations/chat-sdk-slack-replies.json",
    );
    const payload = await readFixtureJson(
      "examples/event-sources/payloads/chat-sdk-slack-message.json",
    );

    expect(fixtureSource).toMatchObject({
      id: "chat-sdk-slack",
      kind: "chat-sdk",
      provider: "slack",
      mode: "generic-webhook",
      webhook: {
        path: "chat-sdk/slack",
        signingSecretEnv: "DIVEDRA_CHAT_SDK_SLACK_WEBHOOK_SECRET",
        bearerTokenEnv: "DIVEDRA_CHAT_SDK_SLACK_BEARER_TOKEN",
      },
      send: {
        endpointUrlEnv: "DIVEDRA_CHAT_SDK_SLACK_SEND_URL",
        tokenEnv: "DIVEDRA_CHAT_SDK_SLACK_SEND_TOKEN",
      },
    });
    expect(JSON.stringify(fixtureSource)).not.toContain("xoxb-");
    expect(JSON.stringify(fixtureSource)).not.toContain("Bearer ");
    expect(binding).toMatchObject({
      id: "chat-sdk-slack-to-workflow",
      sourceId: "chat-sdk-slack",
      outputDestinations: ["chat-sdk-slack-replies"],
      match: { eventType: "chat.message" },
      workflowName: "first-four-arithmetic-pipeline",
    });
    expect(destination).toMatchObject({
      id: "chat-sdk-slack-replies",
      kind: "chat",
      sourceId: "chat-sdk-slack",
    });

    const envelope = await adapter.normalize({
      sourceId: "chat-sdk-slack",
      source: fixtureSource,
      receivedAt: "2026-05-15T00:00:00.000Z",
      body: payload,
      rawRef: { root: "artifact", path: "events/redacted-chat-sdk.json" },
    });

    expect(envelope).toMatchObject({
      sourceId: "chat-sdk-slack",
      eventId: "chat-sdk-slack-evt-1",
      provider: "slack",
      eventType: "chat.message",
      conversation: { id: "C123", threadId: "1720000000.000100" },
      input: {
        provider: "slack",
        text: "Run the arithmetic workflow from Slack.",
        format: "plain",
        rawEventType: "message",
      },
      rawRef: { root: "artifact", path: "events/redacted-chat-sdk.json" },
    });
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
        status: 202,
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
      status: "queued",
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
