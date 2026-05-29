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

  test("normalizes deterministic image and PDF attachment descriptors", async () => {
    const adapter = createChatSdkEventSourceAdapter();
    const event = await adapter.normalize({
      sourceId: "team-slack",
      source,
      receivedAt: "2026-05-14T00:00:00.000Z",
      body: {
        provider: "slack",
        eventId: "evt-attachments",
        message: {
          text: "judge these attachments",
          attachments: [
            {
              id: "img-1",
              kind: "image",
              mediaType: "image/png",
              filename: "dashboard.png",
              sizeBytes: 2048,
              source: {
                url: "https://files.example.test/private/dashboard.png",
                token: "secret-token",
              },
              contentRef: "chat-sdk/evt-attachments/dashboard.png",
              imageDescription:
                "Screenshot shows a green deployment dashboard with all checks passing.",
              classificationHints: ["deployment", "healthy"],
              customMetadata: { channel: "release" },
            },
            {
              id: "pdf-1",
              kind: "pdf",
              mediaType: "application/pdf",
              filename: "incident-report.pdf",
              sizeBytes: 4096,
              source: "s3://private-bucket/incident-report.pdf?token=secret",
              contentRef: "chat-sdk/evt-attachments/incident-report.pdf",
              textContent:
                "Incident report: customer data exposure was not observed.",
              classificationHints: { documentType: "incident-report" },
            },
          ],
        },
      },
    });

    expect(event.input["attachments"]).toEqual([
      {
        id: "img-1",
        kind: "image",
        mediaType: "image/png",
        filename: "dashboard.png",
        sizeBytes: 2048,
        source: { redacted: true },
        contentRef: "chat-sdk/evt-attachments/dashboard.png",
        imageDescription:
          "Screenshot shows a green deployment dashboard with all checks passing.",
        classificationHints: ["deployment", "healthy"],
        customMetadata: { channel: "release" },
      },
      {
        id: "pdf-1",
        kind: "pdf",
        mediaType: "application/pdf",
        filename: "incident-report.pdf",
        sizeBytes: 4096,
        source: { redacted: true },
        contentRef: "chat-sdk/evt-attachments/incident-report.pdf",
        textContent:
          "Incident report: customer data exposure was not observed.",
        classificationHints: { documentType: "incident-report" },
      },
    ]);
    expect(JSON.stringify(event.input)).not.toContain("secret-token");
    expect(JSON.stringify(event.input)).not.toContain("private-bucket");
  });

  test("rejects invalid attachment entries and unsafe evidence fields", async () => {
    const adapter = createChatSdkEventSourceAdapter();
    const normalizeWithAttachment = (attachment: unknown) =>
      adapter.normalize({
        sourceId: "team-slack",
        source,
        receivedAt: "2026-05-14T00:00:00.000Z",
        body: {
          provider: "slack",
          eventId: "evt-invalid-attachment",
          message: {
            text: "judge this attachment",
            attachments: [attachment],
          },
        },
      });

    await expect(normalizeWithAttachment("not-an-object")).rejects.toThrow(
      "message.attachments[0] must be a JSON object",
    );
    await expect(
      normalizeWithAttachment({
        kind: "pdf",
        filename: 123,
      }),
    ).rejects.toThrow("filename must be a string");
    await expect(
      normalizeWithAttachment({
        kind: "pdf",
        contentRef: 123,
      }),
    ).rejects.toThrow("contentRef must be a string");
    await expect(
      normalizeWithAttachment({
        kind: "pdf",
        contentRef: "../secret.pdf",
      }),
    ).rejects.toThrow("contentRef must be data-root-relative");
    await expect(
      normalizeWithAttachment({
        kind: "pdf",
        textContent: "x".repeat(16_385),
      }),
    ).rejects.toThrow("textContent exceeds 16384 characters");
  });

  test("keeps checked-in Chat SDK fixtures on the generic secure boundary", async () => {
    const adapter = createChatSdkEventSourceAdapter();
    const fixtureSource = (await readFixtureJson(
      "examples/event-sources/.rielflow-events/sources/chat-sdk-slack.json",
    )) as unknown as ChatSdkSourceConfig;
    const binding = await readFixtureJson(
      "examples/event-sources/.rielflow-events/bindings/chat-sdk-slack-to-workflow.json",
    );
    const destination = await readFixtureJson(
      "examples/event-sources/.rielflow-events/destinations/chat-sdk-slack-replies.json",
    );
    const payload = await readFixtureJson(
      "examples/event-sources/payloads/chat-sdk-slack-message.json",
    );
    const attachmentJudgementPayload = await readFixtureJson(
      "examples/event-sources/payloads/chat-sdk-attachment-judgement-message.json",
    );
    const unsupportedPayload = await readFixtureJson(
      "examples/event-sources/payloads/chat-sdk-attachment-judgement-unsupported.json",
    );

    expect(fixtureSource).toMatchObject({
      id: "chat-sdk-slack",
      kind: "chat-sdk",
      provider: "slack",
      mode: "generic-webhook",
      webhook: {
        path: "chat-sdk/slack",
        signingSecretEnv: "RIEL_CHAT_SDK_SLACK_WEBHOOK_SECRET",
        bearerTokenEnv: "RIEL_CHAT_SDK_SLACK_BEARER_TOKEN",
      },
      send: {
        endpointUrlEnv: "RIEL_CHAT_SDK_SLACK_SEND_URL",
        tokenEnv: "RIEL_CHAT_SDK_SLACK_SEND_TOKEN",
      },
    });
    expect(JSON.stringify(fixtureSource)).not.toContain("xoxb-");
    expect(JSON.stringify(fixtureSource)).not.toContain("Bearer ");
    expect(binding).toMatchObject({
      id: "chat-sdk-slack-to-workflow",
      sourceId: "chat-sdk-slack",
      outputDestinations: ["chat-sdk-slack-replies"],
      match: { eventType: "chat.message" },
      workflowName: "chat-event-attachment-judgement",
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

    const attachmentEnvelope = await adapter.normalize({
      sourceId: "chat-sdk-slack",
      source: fixtureSource,
      receivedAt: "2026-05-15T00:00:00.000Z",
      body: attachmentJudgementPayload,
    });
    expect(attachmentEnvelope.input["attachments"]).toEqual([
      expect.objectContaining({
        id: "img-release-dashboard",
        kind: "image",
        imageDescription: expect.stringContaining("green deployment dashboard"),
      }),
      expect.objectContaining({
        id: "pdf-incident-summary",
        kind: "pdf",
        textContent: expect.stringContaining(
          "customer data exposure was not observed",
        ),
      }),
    ]);

    const unsupportedEnvelope = await adapter.normalize({
      sourceId: "chat-sdk-slack",
      source: fixtureSource,
      receivedAt: "2026-05-15T00:00:00.000Z",
      body: unsupportedPayload,
    });
    expect(unsupportedEnvelope.input["attachments"]).toEqual([
      expect.objectContaining({
        id: "archive-unknown",
        kind: "other",
        mediaType: "application/zip",
      }),
    ]);
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
        headers: { "x-rielflow-signature": signature },
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
      "x-rielflow-idempotency-key": "reply-1",
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
