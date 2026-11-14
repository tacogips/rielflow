import { describe, expect, test } from "vitest";
import { createMatrixEventSourceAdapter } from "./matrix";
import type { MatrixSourceConfig } from "../types";
import type { ChatReplyDispatchRequest } from "../../workflow/types";
import type { EventSourceDiagnostic } from "../source-adapter";

function matrixSource(
  overrides: Partial<MatrixSourceConfig> = {},
): MatrixSourceConfig {
  return {
    id: "team-matrix",
    kind: "matrix",
    homeserverUrlEnv: "DIVEDRA_MATRIX_HOMESERVER_URL",
    accessTokenEnv: "DIVEDRA_MATRIX_ACCESS_TOKEN",
    userId: "@divedra:matrix.example",
    rooms: [
      { roomId: "!release:matrix.example", alias: "#release:matrix.example" },
    ],
    ...overrides,
  };
}

function roomMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "m.room.message",
    event_id: "$event-1",
    sender: "@alice:matrix.example",
    origin_server_ts: 1_778_641_000_000,
    content: {
      msgtype: "m.text",
      body: "Ship the release checklist.",
    },
    ...overrides,
  };
}

function replyRequest(
  overrides: Partial<ChatReplyDispatchRequest> = {},
): ChatReplyDispatchRequest {
  return {
    target: {
      sourceId: "team-matrix",
      provider: "matrix",
      eventId: "$event-1",
      conversationId: "!release:matrix.example",
      threadId: "$thread-root",
      actorId: "@alice:matrix.example",
    },
    message: { text: "Acknowledged." },
    visibility: "public",
    threadPolicy: "same-thread",
    idempotencyKey: "reply-key:1",
    workflowId: "wf",
    workflowExecutionId: "exec",
    nodeId: "reply",
    nodeExecId: "node-exec",
    ...overrides,
  };
}

describe("matrix event source adapter", () => {
  test("normalizes Matrix room messages to chat.message envelopes", async () => {
    const adapter = createMatrixEventSourceAdapter();

    const event = await adapter.normalize({
      sourceId: "team-matrix",
      source: matrixSource(),
      receivedAt: "2026-05-13T00:00:00.000Z",
      body: {
        room_id: "!release:matrix.example",
        ...roomMessage({
          content: {
            msgtype: "m.text",
            body: "Ship the release checklist.",
            format: "org.matrix.custom.html",
            formatted_body: "<p>Ship the release checklist.</p>",
            "m.relates_to": {
              rel_type: "m.thread",
              event_id: "$thread-root",
              "m.in_reply_to": { event_id: "$previous" },
            },
          },
        }),
      },
    });

    expect(event).toMatchObject({
      sourceId: "team-matrix",
      eventId: "$event-1",
      provider: "matrix",
      eventType: "chat.message",
      occurredAt: "2026-05-13T02:56:40.000Z",
      receivedAt: "2026-05-13T00:00:00.000Z",
      dedupeKey: "team-matrix:!release:matrix.example:$event-1",
      actor: {
        id: "@alice:matrix.example",
        displayName: "@alice:matrix.example",
      },
      conversation: {
        id: "!release:matrix.example",
        threadId: "$thread-root",
      },
      input: {
        text: "Ship the release checklist.",
        html: "<p>Ship the release checklist.</p>",
        roomId: "!release:matrix.example",
        eventId: "$event-1",
        sender: "@alice:matrix.example",
        msgtype: "m.text",
        replyToEventId: "$previous",
        threadRootEventId: "$thread-root",
        replyTarget: {
          sourceId: "team-matrix",
          provider: "matrix",
          eventId: "$event-1",
          conversationId: "!release:matrix.example",
          threadId: "$thread-root",
          actorId: "@alice:matrix.example",
        },
      },
    });
  });

  test("rejects unsupported or own Matrix messages during normalization", async () => {
    const adapter = createMatrixEventSourceAdapter();

    await expect(
      adapter.normalize({
        sourceId: "team-matrix",
        source: matrixSource(),
        receivedAt: "2026-05-13T00:00:00.000Z",
        body: {
          room_id: "!release:matrix.example",
          ...roomMessage({ sender: "@divedra:matrix.example" }),
        },
      }),
    ).rejects.toThrow("supported room message");

    await expect(
      adapter.normalize({
        sourceId: "team-matrix",
        source: matrixSource(),
        receivedAt: "2026-05-13T00:00:00.000Z",
        body: {
          room_id: "!release:matrix.example",
          ...roomMessage({
            content: { msgtype: "m.image", body: "image.png" },
          }),
        },
      }),
    ).rejects.toThrow("supported room message");
  });

  test("ignores Matrix formatted_body without the custom HTML format marker", async () => {
    const adapter = createMatrixEventSourceAdapter();

    const event = await adapter.normalize({
      sourceId: "team-matrix",
      source: matrixSource(),
      receivedAt: "2026-05-13T00:00:00.000Z",
      body: {
        room_id: "!release:matrix.example",
        ...roomMessage({
          content: {
            msgtype: "m.text",
            body: "Plain text is trusted.",
            formatted_body: "<b>Plain text is trusted.</b>",
          },
        }),
      },
    });

    expect(event.input).toMatchObject({
      text: "Plain text is trusted.",
    });
    expect(event.input).not.toHaveProperty("html");
  });

  test("dispatches Matrix chat replies with idempotent transaction ids", async () => {
    const adapter = createMatrixEventSourceAdapter();
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> =
      [];

    const result = await adapter.dispatchChatReply?.({
      source: matrixSource({ provider: "matrix-production" }),
      request: replyRequest(),
      env: {
        DIVEDRA_MATRIX_HOMESERVER_URL: "https://matrix.example",
        DIVEDRA_MATRIX_ACCESS_TOKEN: "secret-token",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ event_id: "$reply-event" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(result).toEqual({
      status: "sent",
      provider: "matrix-production",
      providerMessageId: "$reply-event",
    });
    expect(calls[0]?.url).toBe(
      "https://matrix.example/_matrix/client/v3/rooms/!release%3Amatrix.example/send/m.room.message/reply-key%3A1",
    );
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: "Bearer secret-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      msgtype: "m.text",
      body: "Acknowledged.",
      "m.relates_to": {
        rel_type: "m.thread",
        event_id: "$thread-root",
        is_falling_back: true,
        "m.in_reply_to": { event_id: "$event-1" },
      },
    });
  });

  test("polls Matrix sync and dispatches supported room events", async () => {
    const adapter = createMatrixEventSourceAdapter();
    const abortController = new AbortController();
    const dispatched: unknown[] = [];
    let resolveDispatch: (() => void) | undefined;
    const dispatchSeen = new Promise<void>((resolve) => {
      resolveDispatch = resolve;
    });

    const handle = await adapter.start({
      source: matrixSource({ sync: { pollTimeoutMs: 1000 } }),
      signal: abortController.signal,
      now: () => new Date("2026-05-13T00:00:00.000Z"),
      env: {
        DIVEDRA_MATRIX_HOMESERVER_URL: "https://matrix.example",
        DIVEDRA_MATRIX_ACCESS_TOKEN: "secret-token",
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            next_batch: "sync-token-2",
            rooms: {
              join: {
                "!release:matrix.example": {
                  timeline: {
                    events: [roomMessage()],
                  },
                },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      dispatch: async (event) => {
        dispatched.push(event);
        resolveDispatch?.();
      },
    });

    await dispatchSeen;
    await handle.stop();
    abortController.abort();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      sourceId: "team-matrix",
      eventId: "$event-1",
      eventType: "chat.message",
    });
  });

  test("emits sanitized diagnostics for rejected Matrix sync responses", async () => {
    const adapter = createMatrixEventSourceAdapter();
    const abortController = new AbortController();
    const diagnostics: EventSourceDiagnostic[] = [];
    let resolveDiagnostic: (() => void) | undefined;
    const diagnosticSeen = new Promise<void>((resolve) => {
      resolveDiagnostic = resolve;
    });

    const handle = await adapter.start({
      source: matrixSource({ sync: { pollTimeoutMs: 1000 } }),
      signal: abortController.signal,
      now: () => new Date("2026-05-13T00:00:00.000Z"),
      env: {
        DIVEDRA_MATRIX_HOMESERVER_URL:
          "https://matrix.example?access_token=url-secret",
        DIVEDRA_MATRIX_ACCESS_TOKEN: "matrix-bot-token",
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            errcode: "M_FORBIDDEN",
            error: "Authorization: Bearer matrix-bot-token raw provider body",
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      dispatch: async () => {},
      diagnosticSink: (diagnostic) => {
        diagnostics.push(diagnostic);
        resolveDiagnostic?.();
      },
    });

    await diagnosticSeen;
    await handle.stop();
    abortController.abort();

    expect(diagnostics).toEqual([
      {
        sourceId: "team-matrix",
        httpStatus: 503,
        errorClass: "MatrixSyncHttpError",
      },
    ]);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("matrix-bot-token");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("url-secret");
    expect(serialized).not.toContain("raw provider body");
  });

  test("emits response status diagnostics for malformed Matrix sync JSON", async () => {
    const adapter = createMatrixEventSourceAdapter();
    const abortController = new AbortController();
    const diagnostics: EventSourceDiagnostic[] = [];
    let resolveDiagnostic: (() => void) | undefined;
    const diagnosticSeen = new Promise<void>((resolve) => {
      resolveDiagnostic = resolve;
    });

    const handle = await adapter.start({
      source: matrixSource({ sync: { pollTimeoutMs: 1000 } }),
      signal: abortController.signal,
      now: () => new Date("2026-05-13T00:00:00.000Z"),
      env: {
        DIVEDRA_MATRIX_HOMESERVER_URL:
          "https://matrix.example?access_token=url-secret",
        DIVEDRA_MATRIX_ACCESS_TOKEN: "matrix-bot-token",
      },
      fetchImpl: async () =>
        new Response(
          "Authorization: Bearer matrix-bot-token raw provider body",
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      dispatch: async () => {},
      diagnosticSink: (diagnostic) => {
        diagnostics.push(diagnostic);
        resolveDiagnostic?.();
      },
    });

    await diagnosticSeen;
    await handle.stop();
    abortController.abort();

    expect(diagnostics).toEqual([
      {
        sourceId: "team-matrix",
        httpStatus: 200,
        errorClass: "SyntaxError",
      },
    ]);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("matrix-bot-token");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("url-secret");
    expect(serialized).not.toContain("raw provider body");
  });

  test("emits sanitized diagnostics for Matrix sync fetch failures", async () => {
    const adapter = createMatrixEventSourceAdapter();
    const abortController = new AbortController();
    const diagnostics: EventSourceDiagnostic[] = [];
    let resolveDiagnostic: (() => void) | undefined;
    const diagnosticSeen = new Promise<void>((resolve) => {
      resolveDiagnostic = resolve;
    });

    const handle = await adapter.start({
      source: matrixSource({ sync: { pollTimeoutMs: 1000 } }),
      signal: abortController.signal,
      now: () => new Date("2026-05-13T00:00:00.000Z"),
      env: {
        DIVEDRA_MATRIX_HOMESERVER_URL: "https://matrix.example",
        DIVEDRA_MATRIX_ACCESS_TOKEN: "matrix-bot-token",
      },
      fetchImpl: async () => {
        const error = new Error(
          "Authorization: Bearer matrix-bot-token https://matrix.example/_matrix/client/v3/sync?access_token=url-secret",
        );
        error.name = "ProviderSyncFailure";
        throw error;
      },
      dispatch: async () => {},
      diagnosticSink: (diagnostic) => {
        diagnostics.push(diagnostic);
        resolveDiagnostic?.();
      },
    });

    await diagnosticSeen;
    await handle.stop();
    abortController.abort();

    expect(diagnostics).toEqual([
      {
        sourceId: "team-matrix",
        errorClass: "ProviderSyncFailure",
      },
    ]);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("matrix-bot-token");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("url-secret");
    expect(serialized).not.toContain("/_matrix/client/v3/sync");
  });
});
