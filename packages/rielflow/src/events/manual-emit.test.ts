import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { emitEventFile } from "./manual-emit";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rielflow-emit-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readReceiptArtifact(input: {
  readonly rootDataDir: string;
  readonly ref:
    | { readonly root: "artifact"; readonly path: string }
    | undefined;
}): Promise<string> {
  expect(input.ref).toBeDefined();
  if (input.ref === undefined) {
    return "";
  }
  return await readFile(path.join(input.rootDataDir, input.ref.path), "utf8");
}

function expectNoChatSdkAttachmentSecrets(value: string): void {
  expect(value).not.toContain("secret-token");
  expect(value).not.toContain("signed-url-token");
  expect(value).not.toContain("private-bucket");
  expect(value).not.toContain("https://files.example.test/private");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("manual event emit", () => {
  test("dispatches matching events through GraphQL endpoint and dedupes retries", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".rielflow");
    const eventRoot = path.join(root, ".rielflow-events");
    const rootDataDir = path.join(root, "data");
    const eventFile = path.join(root, "event.json");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "webhook.json"), {
      id: "webhook",
      kind: "webhook",
      path: "/events/webhook",
    });
    await writeJson(path.join(eventRoot, "bindings", "webhook-demo.json"), {
      id: "webhook-demo",
      sourceId: "webhook",
      workflowName: "demo",
      match: { eventType: "chat.message" },
      inputMapping: {
        mode: "template",
        template: {
          request: "{{event.input.text}}",
        },
        mirrorToHumanInput: true,
      },
      execution: {
        async: true,
      },
    });
    await writeJson(eventFile, {
      eventId: "evt-1",
      eventType: "chat.message",
      input: { text: "hello" },
    });

    const fetchImpl = vi.fn(async (_request, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        variables: {
          input: {
            workflowName: string;
            runtimeVariables: Readonly<Record<string, unknown>>;
            async: boolean;
          };
        };
      };
      expect(payload.variables.input.workflowName).toBe("demo");
      expect(payload.variables.input.async).toBe(true);
      expect(payload.variables.input.runtimeVariables["workflowInput"]).toEqual(
        {
          request: "hello",
        },
      );
      expect(payload.variables.input.runtimeVariables["humanInput"]).toEqual({
        request: "hello",
      });
      return new Response(
        JSON.stringify({
          data: {
            executeWorkflow: {
              workflowExecutionId: "sess-event",
              sessionId: "sess-event",
              status: "running",
              accepted: true,
              exitCode: null,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const first = await emitEventFile({
      sourceId: "webhook",
      eventFile,
      workflowRoot,
      eventRoot,
      rootDataDir,
      endpoint: "http://example.test/graphql",
      fetchImpl,
      cwd: root,
    });
    const second = await emitEventFile({
      sourceId: "webhook",
      eventFile,
      workflowRoot,
      eventRoot,
      rootDataDir,
      endpoint: "http://example.test/graphql",
      fetchImpl,
      cwd: root,
    });

    expect(first[0]?.receipt.status).toBe("dispatched");
    expect(first[0]?.workflowExecutionId).toBe("sess-event");
    expect(second[0]?.receipt.status).toBe("duplicate");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("records mapped receipts without dispatching in read-only mode", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".rielflow");
    const eventRoot = path.join(root, ".rielflow-events");
    const rootDataDir = path.join(root, "data");
    const eventFile = path.join(root, "event.json");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "webhook.json"), {
      id: "webhook",
      kind: "webhook",
      path: "/events/webhook",
    });
    await writeJson(path.join(eventRoot, "bindings", "webhook-demo.json"), {
      id: "webhook-demo",
      sourceId: "webhook",
      workflowName: "demo",
      match: { eventType: "chat.message" },
      inputMapping: {
        mode: "template",
        template: {
          request: "{{event.input.text}}",
        },
      },
    });
    await writeJson(eventFile, {
      eventId: "evt-read-only",
      eventType: "chat.message",
      input: { text: "hello readonly" },
    });

    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const results = await emitEventFile({
      sourceId: "webhook",
      eventFile,
      workflowRoot,
      eventRoot,
      rootDataDir,
      endpoint: "http://example.test/graphql",
      fetchImpl,
      cwd: root,
      readOnly: true,
    });

    const inputRef = results[0]?.receipt.inputRef;
    expect(results[0]?.receipt.status).toBe("skipped");
    expect(results[0]?.receipt.error).toContain("read-only mode");
    expect(inputRef).toBeDefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    if (inputRef === undefined) {
      return;
    }
    expect(
      JSON.parse(await readFile(path.join(rootDataDir, inputRef.path), "utf8")),
    ).toMatchObject({
      workflowInput: {
        request: "hello readonly",
      },
    });
  });

  test("emits Matrix room message fixtures through normalization", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".rielflow");
    const eventRoot = path.join(root, ".rielflow-events");
    const rootDataDir = path.join(root, "data");
    const eventFile = path.join(root, "matrix-event.json");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "team-matrix.json"), {
      id: "team-matrix",
      kind: "matrix",
      homeserverUrlEnv: "RIEL_MATRIX_HOMESERVER_URL",
      accessTokenEnv: "RIEL_MATRIX_ACCESS_TOKEN",
      userId: "@rielflow:matrix.example",
      rooms: [{ roomId: "!release:matrix.example" }],
    });
    await writeJson(path.join(eventRoot, "bindings", "matrix-demo.json"), {
      id: "matrix-demo",
      sourceId: "team-matrix",
      workflowName: "demo",
      match: { eventType: "chat.message" },
      inputMapping: {
        mode: "template",
        template: {
          request: "{{event.input.text}}",
          roomId: "{{event.conversation.id}}",
        },
      },
    });
    await writeJson(eventFile, {
      room_id: "!release:matrix.example",
      type: "m.room.message",
      event_id: "$event-1",
      sender: "@alice:matrix.example",
      content: {
        msgtype: "m.text",
        body: "Run the release workflow.",
      },
    });

    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const results = await emitEventFile({
      sourceId: "team-matrix",
      eventFile,
      workflowRoot,
      eventRoot,
      rootDataDir,
      endpoint: "http://example.test/graphql",
      env: {
        RIEL_MATRIX_HOMESERVER_URL: "https://matrix.example",
        RIEL_MATRIX_ACCESS_TOKEN: "secret-token",
      },
      fetchImpl,
      cwd: root,
      readOnly: true,
    });

    expect(results[0]?.receipt.status).toBe("skipped");
    const inputRef = results[0]?.receipt.inputRef;
    expect(inputRef).toBeDefined();
    if (inputRef === undefined) {
      return;
    }
    expect(
      JSON.parse(await readFile(path.join(rootDataDir, inputRef.path), "utf8")),
    ).toMatchObject({
      workflowInput: {
        request: "Run the release workflow.",
        roomId: "!release:matrix.example",
      },
    });
  });

  test("emits Discord Gateway fixtures with bounded history", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".rielflow");
    const eventRoot = path.join(root, ".rielflow-events");
    const rootDataDir = path.join(root, "data");
    const eventFile = path.join(root, "discord-event.json");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "discord.json"), {
      id: "discord-gateway-personas",
      kind: "discord-gateway",
      tokenEnv: "RIEL_DISCORD_BOT_TOKEN",
      applicationIdEnv: "RIEL_DISCORD_APPLICATION_ID",
      channels: [{ id: "234567890123456789", includeThreads: true }],
      history: { maxMessages: 2, maxBytes: 4096 },
    });
    await writeJson(path.join(eventRoot, "bindings", "discord.json"), {
      id: "discord-gateway-demo",
      sourceId: "discord-gateway-personas",
      workflowName: "demo",
      match: { eventType: "chat.message" },
      inputMapping: {
        mode: "template",
        template: {
          request: "{{event.input.text}}",
          history: "{{event.input.history}}",
          threadId: "{{event.conversation.threadId}}",
        },
      },
    });
    await writeJson(eventFile, {
      id: "345678901234567890",
      channel_id: "567890123456789012",
      parent_channel_id: "234567890123456789",
      timestamp: "2026-05-29T10:02:00.000Z",
      content: "Mika, what do you think?",
      author: {
        id: "456789012345678901",
        username: "operator",
        global_name: "Operator",
        bot: false,
      },
      historySourceMode: "memory",
      history: [
        {
          messageId: "111111111111111111",
          authorId: "222222222222222222",
          displayName: "Yui",
          isBot: false,
          createdAt: "2026-05-29T10:00:00.000Z",
          text: "We need to pick between option one and two.",
          conversationId: "234567890123456789",
          threadId: "567890123456789012",
        },
      ],
    });

    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const results = await emitEventFile({
      sourceId: "discord-gateway-personas",
      eventFile,
      workflowRoot,
      eventRoot,
      rootDataDir,
      endpoint: "http://example.test/graphql",
      fetchImpl,
      cwd: root,
      readOnly: true,
    });

    expect(results[0]?.receipt.status).toBe("skipped");
    const inputRef = results[0]?.receipt.inputRef;
    expect(inputRef).toBeDefined();
    if (inputRef === undefined) {
      return;
    }
    expect(
      JSON.parse(await readFile(path.join(rootDataDir, inputRef.path), "utf8")),
    ).toMatchObject({
      workflowInput: {
        request: "Mika, what do you think?",
        history: [
          {
            messageId: "111111111111111111",
            text: "We need to pick between option one and two.",
          },
        ],
        threadId: "567890123456789012",
      },
    });
  });

  test("emits Chat SDK generic payloads through normalization", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".rielflow");
    const eventRoot = path.join(root, ".rielflow-events");
    const rootDataDir = path.join(root, "data");
    const eventFile = path.join(root, "chat-sdk-event.json");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "team-slack.json"), {
      id: "team-slack",
      kind: "chat-sdk",
      provider: "slack",
      webhook: {
        path: "chat-sdk/team-slack",
        bearerTokenEnv: "RIEL_CHAT_SDK_BEARER_TOKEN",
      },
    });
    await writeJson(path.join(eventRoot, "bindings", "team-slack.json"), {
      id: "team-slack-demo",
      sourceId: "team-slack",
      workflowName: "demo",
      match: { eventType: "chat.message" },
      inputMapping: {
        mode: "template",
        template: {
          request: "{{event.input.text}}",
          provider: "{{event.input.provider}}",
          conversationId: "{{event.conversation.id}}",
        },
      },
    });
    await writeJson(eventFile, {
      provider: "slack",
      eventId: "evt-chat-sdk",
      actor: { id: "U123", displayName: "Operator" },
      conversation: { id: "C123", threadId: "T123" },
      message: {
        text: "run release workflow",
        attachments: [
          {
            id: "img-1",
            kind: "image",
            filename: "release.png",
            mediaType: "image/png",
            contentRef: "chat-sdk/evt-chat-sdk/release.png",
            imageDescription: "green release dashboard",
            source: {
              downloadUrl:
                "https://files.example.test/private/release.png?signed=signed-url-token",
              token: "secret-token",
              bucket: "private-bucket",
            },
          },
        ],
      },
    });

    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const results = await emitEventFile({
      sourceId: "team-slack",
      eventFile,
      workflowRoot,
      eventRoot,
      rootDataDir,
      endpoint: "http://example.test/graphql",
      fetchImpl,
      cwd: root,
      readOnly: true,
    });

    expect(results[0]?.receipt.status).toBe("skipped");
    const rawArtifact = await readReceiptArtifact({
      rootDataDir,
      ref: results[0]?.receipt.rawRef,
    });
    const normalizedArtifact = await readReceiptArtifact({
      rootDataDir,
      ref: results[0]?.receipt.normalizedRef,
    });
    const inputRef = results[0]?.receipt.inputRef;
    expect(inputRef).toBeDefined();
    if (inputRef === undefined) {
      return;
    }
    const inputArtifact = await readFile(
      path.join(rootDataDir, inputRef.path),
      "utf8",
    );
    expect(JSON.parse(inputArtifact)).toMatchObject({
      workflowInput: {
        request: "run release workflow",
        provider: "slack",
        conversationId: "C123",
      },
    });
    expect(JSON.parse(rawArtifact)).toMatchObject({
      message: { attachments: [{ source: { redacted: true } }] },
    });
    expect(JSON.parse(normalizedArtifact)).toMatchObject({
      input: { attachments: [{ source: { redacted: true } }] },
    });
    expectNoChatSdkAttachmentSecrets(rawArtifact);
    expectNoChatSdkAttachmentSecrets(normalizedArtifact);
    expectNoChatSdkAttachmentSecrets(inputArtifact);
  });
});
