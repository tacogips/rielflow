import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createMatrixEventSourceAdapter } from "./matrix";
import type { MatrixSourceConfig } from "../types";
import type { ChatReplyDispatchRequest } from "../../workflow/types";
import type { EventSourceDiagnostic } from "../source-adapter";

async function readFixtureJson(
  relativePath: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.resolve(relativePath), "utf8"),
  ) as Record<string, unknown>;
}

function matrixSource(
  overrides: Partial<MatrixSourceConfig> = {},
): MatrixSourceConfig {
  return {
    id: "team-matrix",
    kind: "matrix",
    homeserverUrlEnv: "RIEL_MATRIX_HOMESERVER_URL",
    accessTokenEnv: "RIEL_MATRIX_ACCESS_TOKEN",
    userId: "@rielflow:matrix.example",
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

  test("keeps checked-in Matrix fixtures on the explicit chat reply contract", async () => {
    const adapter = createMatrixEventSourceAdapter();
    const source = (await readFixtureJson(
      "examples/event-sources/.rielflow-events/sources/team-matrix.json",
    )) as unknown as MatrixSourceConfig;
    const binding = await readFixtureJson(
      "examples/event-sources/.rielflow-events/bindings/matrix-release-chat-to-workflow.json",
    );
    const destination = await readFixtureJson(
      "examples/event-sources/.rielflow-events/destinations/release-matrix-chat.json",
    );
    const payload = await readFixtureJson(
      "examples/event-sources/payloads/matrix-room-message.json",
    );

    expect(source).toMatchObject({
      id: "team-matrix",
      kind: "matrix",
      homeserverUrlEnv: "RIEL_MATRIX_HOMESERVER_URL",
      accessTokenEnv: "RIEL_MATRIX_ACCESS_TOKEN",
      rooms: [{ roomId: "!release:matrix.example" }],
    });
    expect(binding).toMatchObject({
      id: "matrix-release-chat-to-workflow",
      sourceId: "team-matrix",
      outputDestinations: ["release-matrix-chat"],
      match: {
        eventType: "chat.message",
        conversationId: "!release:matrix.example",
      },
      workflowName: "matrix-chat-reply",
      inputMapping: { mode: "event-input", mirrorToHumanInput: true },
    });
    expect(destination).toMatchObject({
      id: "release-matrix-chat",
      kind: "chat",
      sourceId: "team-matrix",
      target: {
        provider: "matrix",
        conversationId: "!release:matrix.example",
      },
    });

    const envelope = await adapter.normalize({
      sourceId: "team-matrix",
      source,
      receivedAt: "2026-05-15T00:00:00.000Z",
      body: payload,
    });

    expect(envelope).toMatchObject({
      sourceId: "team-matrix",
      eventId: "$release-event-1",
      provider: "matrix",
      eventType: "chat.message",
      conversation: {
        id: "!release:matrix.example",
        threadId: "$release-thread-root",
      },
      input: {
        text: "Run the release workflow from Matrix.",
        roomId: "!release:matrix.example",
        replyToEventId: "$release-parent",
        threadRootEventId: "$release-thread-root",
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
          ...roomMessage({ sender: "@rielflow:matrix.example" }),
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

  test("downloads text-compatible Matrix attachment content during sync", async () => {
    const adapter = createMatrixEventSourceAdapter();
    const abortController = new AbortController();
    const dispatched: unknown[] = [];
    let resolveDispatch: (() => void) | undefined;
    const dispatchSeen = new Promise<void>((resolve) => {
      resolveDispatch = resolve;
    });
    const fetchCalls: Array<{
      readonly url: string;
      readonly init: RequestInit | undefined;
    }> = [];

    const handle = await adapter.start({
      source: matrixSource({
        sync: { pollTimeoutMs: 1000 },
        attachments: {
          downloadText: true,
          maxBytes: 64,
          allowedMimeTypes: ["text/plain"],
        },
      }),
      signal: abortController.signal,
      now: () => new Date("2026-05-13T00:00:00.000Z"),
      env: {
        RIEL_MATRIX_HOMESERVER_URL: "https://matrix.example",
        RIEL_MATRIX_ACCESS_TOKEN: "secret-token",
      },
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url: String(url), init });
        if (String(url).includes("/_matrix/client/v1/media/download/")) {
          return new Response("attachment content for the workflow", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        return new Response(
          JSON.stringify({
            next_batch: "sync-token-2",
            rooms: {
              join: {
                "!release:matrix.example": {
                  timeline: {
                    events: [
                      roomMessage({
                        event_id: "$attachment-event-1",
                        content: {
                          msgtype: "m.file",
                          body: "notes.txt",
                          url: "mxc://matrix.example/media-1",
                          info: { mimetype: "text/plain", size: 35 },
                        },
                      }),
                    ],
                  },
                },
              },
            },
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

    expect(fetchCalls[1]).toMatchObject({
      url: "https://matrix.example/_matrix/client/v1/media/download/matrix.example/media-1",
      init: {
        method: "GET",
        headers: {
          authorization: "Bearer secret-token",
          range: "bytes=0-63",
        },
      },
    });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      eventId: "$attachment-event-1",
      input: {
        text: "notes.txt\n\nattachment content for the workflow",
        attachmentText: "attachment content for the workflow",
        attachments: [
          {
            name: "notes.txt",
            msgtype: "m.file",
            mediaUrl: "mxc://matrix.example/media-1",
            mimetype: "text/plain",
            size: 35,
            contentText: "attachment content for the workflow",
            truncated: false,
          },
        ],
      },
    });
    expect(JSON.stringify(dispatched[0])).not.toContain("secret-token");
  });

  test("keeps attachment metadata during manual normalization without downloading media", async () => {
    const adapter = createMatrixEventSourceAdapter();

    const event = await adapter.normalize({
      sourceId: "team-matrix",
      source: matrixSource({
        attachments: {
          downloadText: true,
          maxBytes: 64,
          allowedMimeTypes: ["text/plain"],
        },
      }),
      receivedAt: "2026-05-13T00:00:00.000Z",
      body: {
        room_id: "!release:matrix.example",
        ...roomMessage({
          content: {
            msgtype: "m.file",
            body: "manual-notes.txt",
            url: "mxc://matrix.example/manual-media",
            info: { mimetype: "text/plain", size: 21 },
          },
        }),
      },
    });

    expect(event).toMatchObject({
      input: {
        text: "manual-notes.txt",
        attachmentText: "",
        attachments: [
          {
            name: "manual-notes.txt",
            msgtype: "m.file",
            mediaUrl: "mxc://matrix.example/manual-media",
            mimetype: "text/plain",
            size: 21,
          },
        ],
      },
    });
    expect(JSON.stringify(event.input["attachments"])).not.toContain(
      "contentText",
    );
  });

  test("keeps Matrix attachment failures encrypted media and binary media non-fatal", async () => {
    const adapter = createMatrixEventSourceAdapter();
    const abortController = new AbortController();
    const dispatched: unknown[] = [];
    const diagnostics: EventSourceDiagnostic[] = [];
    let resolveDispatches: (() => void) | undefined;
    const dispatchesSeen = new Promise<void>((resolve) => {
      resolveDispatches = resolve;
    });
    const fetchCalls: Array<{
      readonly url: string;
      readonly init: RequestInit | undefined;
    }> = [];

    const handle = await adapter.start({
      source: matrixSource({
        sync: { pollTimeoutMs: 1000 },
        attachments: {
          downloadText: true,
          maxBytes: 16,
          allowedMimeTypes: ["text/*"],
        },
      }),
      signal: abortController.signal,
      now: () => new Date("2026-05-13T00:00:00.000Z"),
      env: {
        RIEL_MATRIX_HOMESERVER_URL: "https://matrix.example",
        RIEL_MATRIX_ACCESS_TOKEN: "secret-token",
      },
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url: String(url), init });
        if (String(url).includes("/_matrix/client/v1/media/download/")) {
          return new Response("provider failure with secret-token", {
            status: 503,
            headers: { "content-type": "text/plain" },
          });
        }
        return new Response(
          JSON.stringify({
            next_batch: "sync-token-2",
            rooms: {
              join: {
                "!release:matrix.example": {
                  timeline: {
                    events: [
                      roomMessage({
                        event_id: "$attachment-fail",
                        content: {
                          msgtype: "m.file",
                          body: "bad.txt",
                          url: "mxc://matrix.example/bad-media",
                          info: { mimetype: "text/plain", size: 40 },
                        },
                      }),
                      roomMessage({
                        event_id: "$attachment-encrypted",
                        content: {
                          msgtype: "m.file",
                          body: "secret.txt",
                          file: { url: "mxc://matrix.example/encrypted" },
                          info: { mimetype: "text/plain", size: 40 },
                        },
                      }),
                      roomMessage({
                        event_id: "$attachment-binary",
                        content: {
                          msgtype: "m.image",
                          body: "diagram.png",
                          url: "mxc://matrix.example/image",
                          info: { mimetype: "image/png", size: 40 },
                        },
                      }),
                      roomMessage({
                        event_id: "$attachment-invalid-url",
                        content: {
                          msgtype: "m.file",
                          body: "invalid.txt",
                          url: "https://matrix.example/media",
                          info: { mimetype: "text/plain", size: 40 },
                        },
                      }),
                    ],
                  },
                },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      dispatch: async (event) => {
        dispatched.push(event);
        if (dispatched.length === 4) {
          resolveDispatches?.();
        }
      },
      diagnosticSink: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });

    await dispatchesSeen;
    await handle.stop();
    abortController.abort();

    expect(
      fetchCalls.filter((call) =>
        call.url.includes("/_matrix/client/v1/media/download/"),
      ),
    ).toHaveLength(1);
    expect(dispatched).toHaveLength(4);
    expect(dispatched).toEqual([
      expect.objectContaining({
        eventId: "$attachment-fail",
        input: expect.objectContaining({
          text: "bad.txt",
          attachmentText: "",
          attachments: [
            expect.objectContaining({
              name: "bad.txt",
              downloadError: "MatrixAttachmentDownloadHttpError",
            }),
          ],
        }),
      }),
      expect.objectContaining({
        eventId: "$attachment-encrypted",
        input: expect.objectContaining({
          text: "secret.txt",
          attachmentText: "",
          attachments: [
            expect.objectContaining({
              name: "secret.txt",
              mediaUrl: "mxc://matrix.example/encrypted",
              encrypted: true,
            }),
          ],
        }),
      }),
      expect.objectContaining({
        eventId: "$attachment-binary",
        input: expect.objectContaining({
          text: "diagram.png",
          attachmentText: "",
          attachments: [
            expect.objectContaining({
              name: "diagram.png",
              mimetype: "image/png",
            }),
          ],
        }),
      }),
      expect.objectContaining({
        eventId: "$attachment-invalid-url",
        input: expect.objectContaining({
          text: "invalid.txt",
          attachmentText: "",
          attachments: [
            expect.objectContaining({
              name: "invalid.txt",
              downloadError: "MatrixAttachmentInvalidMediaUrl",
            }),
          ],
        }),
      }),
    ]);
    expect(diagnostics).toEqual([
      {
        sourceId: "team-matrix",
        httpStatus: 503,
        errorClass: "MatrixAttachmentDownloadHttpError",
      },
      {
        sourceId: "team-matrix",
        errorClass: "MatrixAttachmentInvalidMediaUrl",
      },
    ]);
    expect(JSON.stringify({ dispatched, diagnostics })).not.toContain(
      "secret-token",
    );
    expect(JSON.stringify({ dispatched, diagnostics })).not.toContain(
      "provider failure",
    );
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
        RIEL_MATRIX_HOMESERVER_URL: "https://matrix.example",
        RIEL_MATRIX_ACCESS_TOKEN: "secret-token",
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
        RIEL_MATRIX_HOMESERVER_URL: "https://matrix.example",
        RIEL_MATRIX_ACCESS_TOKEN: "secret-token",
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

  test("reloads persisted Matrix room history after source restart", async () => {
    const dataRoot = await mkdtemp(
      path.join(os.tmpdir(), "rielflow-matrix-history-"),
    );
    const source = matrixSource({
      history: {
        maxMessages: 5,
        maxBytes: 32768,
        maxAgeMs: 86400000,
        scope: "thread-or-room",
      },
      sync: { pollTimeoutMs: 1000 },
    });

    async function dispatchOne(
      event: Record<string, unknown>,
    ): Promise<unknown> {
      const adapter = createMatrixEventSourceAdapter();
      const abortController = new AbortController();
      let dispatched: unknown;
      let resolveDispatch: (() => void) | undefined;
      const dispatchSeen = new Promise<void>((resolve) => {
        resolveDispatch = resolve;
      });
      const handle = await adapter.start({
        source,
        signal: abortController.signal,
        now: () => new Date("2026-05-13T00:00:00.000Z"),
        env: {
          RIEL_MATRIX_HOMESERVER_URL: "https://matrix.example",
          RIEL_MATRIX_ACCESS_TOKEN: "secret-token",
        },
        eventDataRoot: dataRoot,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              next_batch: "sync-token-2",
              rooms: {
                join: {
                  "!release:matrix.example": {
                    timeline: { events: [event] },
                  },
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        dispatch: async (envelope) => {
          dispatched = envelope;
          resolveDispatch?.();
        },
      });
      await dispatchSeen;
      await new Promise((resolve) => setTimeout(resolve, 10));
      await handle.stop();
      abortController.abort();
      return dispatched;
    }

    const first = await dispatchOne(
      roomMessage({
        event_id: "$event-1",
        content: {
          msgtype: "m.text",
          body: "remember the Matrix marker",
          "m.relates_to": {
            rel_type: "m.thread",
            event_id: "$thread-root",
          },
        },
      }),
    );
    expect(first).toMatchObject({
      input: {
        history: [],
        historySource: { mode: "empty", messageCount: 0 },
      },
    });

    const second = await dispatchOne(
      roomMessage({
        event_id: "$event-2",
        content: {
          msgtype: "m.text",
          body: "what was the Matrix marker?",
          "m.relates_to": {
            rel_type: "m.thread",
            event_id: "$thread-root",
          },
        },
      }),
    );

    expect(second).toMatchObject({
      input: {
        historySource: { mode: "persisted", messageCount: 1 },
        history: [
          expect.objectContaining({
            messageId: "$event-1",
            authorId: "@alice:matrix.example",
            text: "remember the Matrix marker",
            conversationId: "!release:matrix.example",
            threadId: "$thread-root",
            provider: "matrix",
          }),
        ],
      },
    });
    expect(JSON.stringify((second as { input: unknown }).input)).not.toContain(
      "secret-token",
    );
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
        RIEL_MATRIX_HOMESERVER_URL:
          "https://matrix.example?access_token=url-secret",
        RIEL_MATRIX_ACCESS_TOKEN: "matrix-bot-token",
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
        RIEL_MATRIX_HOMESERVER_URL:
          "https://matrix.example?access_token=url-secret",
        RIEL_MATRIX_ACCESS_TOKEN: "matrix-bot-token",
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
        RIEL_MATRIX_HOMESERVER_URL: "https://matrix.example",
        RIEL_MATRIX_ACCESS_TOKEN: "matrix-bot-token",
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
