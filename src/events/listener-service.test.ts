import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createEventListenerService,
  type EventListenerRuntime,
} from "./listener-service";
import { listEventReplyDispatchesFromRuntimeDb } from "../workflow/runtime-db";
import { createEventSourceRegistry } from "./adapter-registry";
import {
  createScheduledEventManager,
  type ScheduledEventManager,
} from "./scheduled-event-manager";
import type { EventSourceAdapter } from "./source-adapter";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-listener-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeMinimalWebhookFixture(input: {
  readonly root: string;
  readonly signingSecretEnv?: string;
}): Promise<{
  readonly workflowRoot: string;
  readonly eventRoot: string;
}> {
  const workflowRoot = path.join(input.root, ".divedra");
  const eventRoot = path.join(input.root, ".divedra-events");
  await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
    workflowId: "demo",
  });
  await writeJson(path.join(eventRoot, "sources", "chat-webhook.json"), {
    id: "chat-webhook",
    kind: "webhook",
    path: "/events/chat",
    ...(input.signingSecretEnv === undefined
      ? {}
      : { signingSecretEnv: input.signingSecretEnv }),
  });
  await writeJson(path.join(eventRoot, "bindings", "chat-demo.json"), {
    id: "chat-demo",
    sourceId: "chat-webhook",
    workflowName: "demo",
    inputMapping: {
      mode: "event-input",
    },
  });
  return { workflowRoot, eventRoot };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("event listener service", () => {
  test("dispatches chat-shaped webhook events through a mocked HTTP runtime", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    const rootDataDir = path.join(root, "data");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "chat-webhook.json"), {
      id: "chat-webhook",
      kind: "webhook",
      path: "/events/chat",
    });
    await writeJson(path.join(eventRoot, "bindings", "chat-demo.json"), {
      id: "chat-demo",
      sourceId: "chat-webhook",
      workflowName: "demo",
      match: {
        eventType: "chat.message",
      },
      inputMapping: {
        mode: "template",
        template: {
          request: "{{event.input.text}}",
          user: "{{event.actor.displayName}}",
        },
        mirrorToHumanInput: true,
      },
      execution: {
        async: true,
      },
    });

    let capturedFetch:
      | ((request: Request) => Response | Promise<Response>)
      | undefined;
    const runtime: EventListenerRuntime = {
      serve: (options) => {
        capturedFetch = options.fetch;
        return {
          port: options.port,
          stop: () => {},
        };
      },
    };
    const fetchImpl = vi.fn(async (_request, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        variables: {
          input: {
            workflowName: string;
            runtimeVariables: Readonly<Record<string, unknown>>;
          };
        };
      };
      expect(payload.variables.input.workflowName).toBe("demo");
      expect(payload.variables.input.runtimeVariables["workflowInput"]).toEqual(
        {
          request: "hello from chat",
          user: "Mock Chat User",
        },
      );
      return new Response(
        JSON.stringify({
          data: {
            executeWorkflow: {
              workflowExecutionId: "sess-chat",
              sessionId: "sess-chat",
              status: "running",
              accepted: true,
              exitCode: null,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const listener = await createEventListenerService(undefined, runtime).start(
      {
        workflowRoot,
        eventRoot,
        rootDataDir,
        endpoint: "http://example.test/graphql",
        fetchImpl,
        cwd: root,
        port: 0,
      },
    );
    expect(listener.sources).toEqual(["chat-webhook"]);
    expect(capturedFetch).toBeDefined();
    if (capturedFetch === undefined) {
      return;
    }

    const response = await capturedFetch(
      new Request("http://127.0.0.1/events/chat", {
        method: "POST",
        body: JSON.stringify({
          eventId: "chat-1",
          eventType: "chat.message",
          actor: {
            id: "user-1",
            displayName: "Mock Chat User",
          },
          input: {
            text: "hello from chat",
          },
        }),
      }),
    );
    const body = (await response.json()) as {
      readonly accepted: boolean;
      readonly receipts: readonly { readonly status: string }[];
    };

    expect(response.status).toBe(202);
    expect(body.accepted).toBe(true);
    expect(body.receipts[0]?.status).toBe("dispatched");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await listener.stop();
  });

  test("returns 400 for malformed webhook JSON without dispatching", async () => {
    const root = await makeTempDir();
    const { workflowRoot, eventRoot } = await writeMinimalWebhookFixture({
      root,
    });

    let capturedFetch:
      | ((request: Request) => Response | Promise<Response>)
      | undefined;
    const runtime: EventListenerRuntime = {
      serve: (options) => {
        capturedFetch = options.fetch;
        return {
          port: options.port,
          stop: () => {},
        };
      },
    };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));

    const listener = await createEventListenerService(undefined, runtime).start(
      {
        workflowRoot,
        eventRoot,
        rootDataDir: path.join(root, "data"),
        endpoint: "http://example.test/graphql",
        fetchImpl,
        cwd: root,
        port: 0,
      },
    );
    expect(capturedFetch).toBeDefined();
    if (capturedFetch === undefined) {
      return;
    }

    const response = await capturedFetch(
      new Request("http://127.0.0.1/events/chat", {
        method: "POST",
        body: "{",
      }),
    );
    const body = (await response.json()) as { readonly error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("valid JSON");
    expect(fetchImpl).not.toHaveBeenCalled();
    await listener.stop();
  });

  test("verifies signed webhook bodies before parsing JSON", async () => {
    const root = await makeTempDir();
    const { workflowRoot, eventRoot } = await writeMinimalWebhookFixture({
      root,
      signingSecretEnv: "WEBHOOK_SECRET",
    });

    let capturedFetch:
      | ((request: Request) => Response | Promise<Response>)
      | undefined;
    const runtime: EventListenerRuntime = {
      serve: (options) => {
        capturedFetch = options.fetch;
        return {
          port: options.port,
          stop: () => {},
        };
      },
    };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));

    const listener = await createEventListenerService(undefined, runtime).start(
      {
        workflowRoot,
        eventRoot,
        rootDataDir: path.join(root, "data"),
        endpoint: "http://example.test/graphql",
        env: { WEBHOOK_SECRET: "secret" },
        fetchImpl,
        cwd: root,
        port: 0,
      },
    );
    expect(capturedFetch).toBeDefined();
    if (capturedFetch === undefined) {
      return;
    }

    const response = await capturedFetch(
      new Request("http://127.0.0.1/events/chat", {
        method: "POST",
        headers: {
          "x-divedra-signature": createHmac("sha256", "wrong-secret")
            .update("{")
            .digest("hex"),
        },
        body: "{",
      }),
    );
    const body = (await response.json()) as { readonly error: string };

    expect(response.status).toBe(401);
    expect(body.error).toContain("signature rejected");
    expect(fetchImpl).not.toHaveBeenCalled();
    await listener.stop();
  });

  test("returns 400 for webhook payloads that cannot be normalized", async () => {
    const root = await makeTempDir();
    const { workflowRoot, eventRoot } = await writeMinimalWebhookFixture({
      root,
    });

    let capturedFetch:
      | ((request: Request) => Response | Promise<Response>)
      | undefined;
    const runtime: EventListenerRuntime = {
      serve: (options) => {
        capturedFetch = options.fetch;
        return {
          port: options.port,
          stop: () => {},
        };
      },
    };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));

    const listener = await createEventListenerService(undefined, runtime).start(
      {
        workflowRoot,
        eventRoot,
        rootDataDir: path.join(root, "data"),
        endpoint: "http://example.test/graphql",
        fetchImpl,
        cwd: root,
        port: 0,
      },
    );
    expect(capturedFetch).toBeDefined();
    if (capturedFetch === undefined) {
      return;
    }

    const response = await capturedFetch(
      new Request("http://127.0.0.1/events/chat", {
        method: "POST",
        body: "[]",
      }),
    );
    const body = (await response.json()) as { readonly error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("webhook body must be a JSON object");
    expect(fetchImpl).not.toHaveBeenCalled();
    await listener.stop();
  });

  test("serves Chat SDK routes with bearer auth, rate limits, and chat.message dispatch", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "team-slack.json"), {
      id: "team-slack",
      kind: "chat-sdk",
      provider: "slack",
      webhook: {
        path: "chat-sdk/team-slack",
        bearerTokenEnv: "CHAT_SDK_TOKEN",
        rateLimit: { windowMs: 60000, maxRequests: 2 },
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
          provider: "{{event.provider}}",
          conversationId: "{{event.conversation.id}}",
        },
      },
      execution: { async: true },
    });

    let capturedFetch:
      | ((request: Request) => Response | Promise<Response>)
      | undefined;
    const runtime: EventListenerRuntime = {
      serve: (options) => {
        capturedFetch = options.fetch;
        return { port: options.port, stop: () => {} };
      },
    };
    const fetchImpl = vi.fn(async (_request, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        variables: {
          input: {
            runtimeVariables: Readonly<Record<string, unknown>>;
          };
        };
      };
      expect(payload.variables.input.runtimeVariables["workflowInput"]).toEqual(
        {
          request: "ship it",
          provider: "slack",
          conversationId: "C123",
        },
      );
      return new Response(
        JSON.stringify({
          data: {
            executeWorkflow: {
              workflowExecutionId: "sess-chat-sdk",
              sessionId: "sess-chat-sdk",
              status: "running",
              accepted: true,
              exitCode: null,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const listener = await createEventListenerService(undefined, runtime).start(
      {
        workflowRoot,
        eventRoot,
        rootDataDir: path.join(root, "data"),
        endpoint: "http://example.test/graphql",
        env: { CHAT_SDK_TOKEN: "secret" },
        fetchImpl,
        cwd: root,
        port: 0,
      },
    );
    expect(capturedFetch).toBeDefined();
    if (capturedFetch === undefined) {
      return;
    }

    const request = {
      provider: "slack",
      eventId: "evt-chat-sdk-1",
      actor: { id: "U123", displayName: "Operator" },
      conversation: { id: "C123", threadId: "T123" },
      message: { text: "ship it" },
    };
    const unauthorized = await capturedFetch(
      new Request("http://127.0.0.1/events/chat-sdk/team-slack", {
        method: "POST",
        body: JSON.stringify(request),
      }),
    );
    expect(unauthorized.status).toBe(401);

    const first = await capturedFetch(
      new Request("http://127.0.0.1/events/chat-sdk/team-slack", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify(request),
      }),
    );
    const duplicate = await capturedFetch(
      new Request("http://127.0.0.1/events/chat-sdk/team-slack", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify(request),
      }),
    );
    const limited = await capturedFetch(
      new Request("http://127.0.0.1/events/chat-sdk/team-slack", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify({ ...request, eventId: "evt-chat-sdk-2" }),
      }),
    );
    const firstBody = (await first.json()) as {
      readonly accepted: boolean;
      readonly receipts: readonly { readonly duplicate: boolean }[];
    };
    const duplicateBody = (await duplicate.json()) as {
      readonly receipts: readonly { readonly duplicate: boolean }[];
    };

    expect(first.status).toBe(202);
    expect(firstBody.accepted).toBe(true);
    expect(firstBody.receipts[0]?.duplicate).toBe(false);
    expect(duplicate.status).toBe(202);
    expect(duplicateBody.receipts[0]?.duplicate).toBe(true);
    expect(limited.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await listener.stop();
  });

  test("starts enabled Matrix sources with env and fetch context", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "team-matrix.json"), {
      id: "team-matrix",
      kind: "matrix",
      homeserverUrlEnv: "DIVEDRA_MATRIX_HOMESERVER_URL",
      accessTokenEnv: "DIVEDRA_MATRIX_ACCESS_TOKEN",
      userId: "@divedra:matrix.example",
      rooms: [{ roomId: "!release:matrix.example" }],
      sync: { pollTimeoutMs: 1000 },
    });

    let resolveSync: (() => void) | undefined;
    const syncSeen = new Promise<void>((resolve) => {
      resolveSync = resolve;
    });
    const fetchImpl = vi.fn(async (url, init) => {
      expect(String(url)).toContain("/_matrix/client/v3/sync?timeout=1000");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer secret-token",
      });
      resolveSync?.();
      return new Response(
        JSON.stringify({ next_batch: "next", rooms: { join: {} } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const listener = await createEventListenerService().start({
      workflowRoot,
      eventRoot,
      rootDataDir: path.join(root, "data"),
      env: {
        DIVEDRA_MATRIX_HOMESERVER_URL: "https://matrix.example",
        DIVEDRA_MATRIX_ACCESS_TOKEN: "secret-token",
      },
      fetchImpl,
      cwd: root,
      port: 0,
    });

    await syncSeen;
    expect(listener.sources).toEqual(["team-matrix"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await listener.stop();
  });

  test("shares the listener scheduled event manager with started cron adapters", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "sleep-flow", "workflow.json"), {
      workflowId: "sleep-flow",
      description: "sleep flow",
      entryStepId: "wait",
      nodes: [
        { id: "wait-node", nodeFile: "nodes/node-wait.json" },
        { id: "worker-node", nodeFile: "nodes/node-worker.json" },
      ],
      steps: [
        {
          id: "wait",
          nodeId: "wait-node",
          role: "worker",
          transitions: [{ toStepId: "worker", label: "always" }],
        },
        { id: "worker", nodeId: "worker-node", role: "worker" },
      ],
    });
    await writeJson(
      path.join(workflowRoot, "sleep-flow", "nodes/node-wait.json"),
      {
        id: "wait-node",
        nodeType: "sleep",
        variables: {},
        sleep: { durationMs: 60_000 },
      },
    );
    await writeJson(
      path.join(workflowRoot, "sleep-flow", "nodes/node-worker.json"),
      {
        id: "worker-node",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "worker",
        variables: {},
      },
    );
    await writeJson(path.join(eventRoot, "sources", "a-cron.json"), {
      id: "a-cron",
      kind: "cron",
      schedule: "0 2 * * *",
      timezone: "UTC",
    });
    await writeJson(path.join(eventRoot, "bindings", "a-cron-sleep.json"), {
      id: "a-cron-sleep",
      sourceId: "a-cron",
      workflowName: "sleep-flow",
      match: { eventType: "cron.tick" },
      inputMapping: { mode: "event-input" },
      execution: { async: false },
    });

    const scheduledEventManager = createScheduledEventManager();
    let capturedScheduledEventManager: ScheduledEventManager | undefined;
    const cronAdapter: EventSourceAdapter = {
      kind: "cron",
      capabilities: {
        eventTypes: ["cron.tick"],
        supportsStart: true,
        webhook: false,
      },
      start: async (input) => {
        capturedScheduledEventManager = input.scheduledEventManager;
        input.scheduledEventManager?.register({
          id: "cron:a-cron",
          kind: "cron",
          dueAt: new Date(Date.now() + 60_000),
          dedupeKey: "cron:a-cron",
          payload: { sourceId: "a-cron" },
          fire: async () => {},
        });
        await input.dispatch({
          sourceId: "a-cron",
          eventId: "cron-1",
          provider: "cron",
          eventType: "cron.tick",
          occurredAt: "2026-04-20T02:00:00.000Z",
          receivedAt: "2026-04-20T02:00:01.000Z",
          dedupeKey: "cron-1",
          input: {
            scheduleId: "a-cron",
            scheduledAt: "2026-04-20T02:00:00.000Z",
            firedAt: "2026-04-20T02:00:01.000Z",
            timezone: "UTC",
          },
        });
        return {
          sourceId: input.source.id,
          stop: async () => {},
        };
      },
      normalize: async () => {
        throw new Error("not used");
      },
    };
    const registry = createEventSourceRegistry([cronAdapter]);
    const runtime: EventListenerRuntime = {
      serve: (options) => ({
        port: options.port,
        stop: () => {},
      }),
    };

    const listener = await createEventListenerService(registry, runtime).start({
      workflowRoot,
      eventRoot,
      rootDataDir: path.join(root, "data"),
      sessionStoreRoot: path.join(root, "sessions"),
      artifactRoot: path.join(root, "artifacts"),
      scheduledEventManager,
      cwd: root,
      port: 0,
    });

    expect(capturedScheduledEventManager).toBe(scheduledEventManager);
    expect(
      scheduledEventManager
        .list()
        .map((event) => event.kind)
        .sort(),
    ).toEqual(["cron"]);
    await listener.stop();
    scheduledEventManager.stop();
  });

  test("stops started adapters when HTTP listener startup fails", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "a-cron.json"), {
      id: "a-cron",
      kind: "cron",
      schedule: "0 2 * * *",
      timezone: "UTC",
    });
    await writeJson(path.join(eventRoot, "sources", "z-webhook.json"), {
      id: "z-webhook",
      kind: "webhook",
      path: "/events/webhook",
    });

    const stopCron = vi.fn(async () => {});
    const cronAdapter: EventSourceAdapter = {
      kind: "cron",
      capabilities: {
        eventTypes: ["cron.tick"],
        supportsStart: true,
        webhook: false,
      },
      start: async (input) => ({
        sourceId: input.source.id,
        stop: stopCron,
      }),
      normalize: async () => {
        throw new Error("not used");
      },
    };
    const webhookAdapter: EventSourceAdapter = {
      kind: "webhook",
      capabilities: {
        eventTypes: ["webhook.event"],
        supportsStart: false,
        webhook: true,
      },
      start: async (input) => ({
        sourceId: input.source.id,
        stop: async () => {},
      }),
      normalize: async () => {
        throw new Error("not used");
      },
    };
    const registry = createEventSourceRegistry([cronAdapter, webhookAdapter]);
    const runtime: EventListenerRuntime = {
      serve: () => {
        throw new Error("listen failed");
      },
    };

    await expect(
      createEventListenerService(registry, runtime).start({
        workflowRoot,
        eventRoot,
        rootDataDir: path.join(root, "data"),
        cwd: root,
        port: 0,
      }),
    ).rejects.toThrow("listen failed");
    expect(stopCron).toHaveBeenCalledTimes(1);
  });

  test("stops the HTTP listener when an adapter stop fails", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "a-cron.json"), {
      id: "a-cron",
      kind: "cron",
      schedule: "0 2 * * *",
      timezone: "UTC",
    });
    await writeJson(path.join(eventRoot, "sources", "z-webhook.json"), {
      id: "z-webhook",
      kind: "webhook",
      path: "/events/webhook",
    });

    const stopServer = vi.fn(() => {});
    const cronAdapter: EventSourceAdapter = {
      kind: "cron",
      capabilities: {
        eventTypes: ["cron.tick"],
        supportsStart: true,
        webhook: false,
      },
      start: async (input) => ({
        sourceId: input.source.id,
        stop: async () => {
          throw new Error("cron stop failed");
        },
      }),
      normalize: async () => {
        throw new Error("not used");
      },
    };
    const webhookAdapter: EventSourceAdapter = {
      kind: "webhook",
      capabilities: {
        eventTypes: ["webhook.event"],
        supportsStart: false,
        webhook: true,
      },
      start: async (input) => ({
        sourceId: input.source.id,
        stop: async () => {},
      }),
      normalize: async () => {
        throw new Error("not used");
      },
    };
    const registry = createEventSourceRegistry([cronAdapter, webhookAdapter]);
    const runtime: EventListenerRuntime = {
      serve: (options) => ({
        port: options.port,
        stop: stopServer,
      }),
    };

    const listener = await createEventListenerService(registry, runtime).start({
      workflowRoot,
      eventRoot,
      rootDataDir: path.join(root, "data"),
      cwd: root,
      port: 0,
    });

    await expect(listener.stop()).rejects.toThrow("cron stop failed");
    expect(stopServer).toHaveBeenCalledTimes(1);
  });

  test("serves the checked-in chat reply webhook example through HTTP", async () => {
    const root = await makeTempDir();
    const rootDataDir = path.join(root, "data");
    let capturedFetch:
      | ((request: Request) => Response | Promise<Response>)
      | undefined;
    const runtime: EventListenerRuntime = {
      serve: (options) => {
        capturedFetch = options.fetch;
        return {
          port: options.port,
          stop: () => {},
        };
      },
    };
    const replyCalls: Array<{
      readonly url: string;
      readonly init?: RequestInit;
    }> = [];
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes("/_matrix/client/v3/sync")) {
        return new Response(
          JSON.stringify({ next_batch: "next", rooms: { join: {} } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      replyCalls.push({
        url: String(url),
        ...(init === undefined ? {} : { init }),
      });
      return new Response(
        JSON.stringify({ providerMessageId: "served-message-1" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const listener = await createEventListenerService(undefined, runtime).start(
      {
        workflowRoot: path.resolve("examples"),
        eventRoot: path.resolve("examples/event-sources/.divedra-events"),
        rootDataDir,
        env: {
          DIVEDRA_EXAMPLE_REPLY_ENDPOINT: "https://reply.example.test/listener",
          DIVEDRA_MATRIX_HOMESERVER_URL: "https://matrix.example",
          DIVEDRA_MATRIX_ACCESS_TOKEN: "secret-token",
        },
        fetchImpl,
        cwd: process.cwd(),
        port: 0,
      },
    );
    expect(capturedFetch).toBeDefined();
    if (capturedFetch === undefined) {
      return;
    }

    const response = await capturedFetch(
      new Request("http://127.0.0.1/events/example-reply-webhook", {
        method: "POST",
        body: JSON.stringify({
          eventId: "served-chat-1",
          eventType: "chat.message",
          actor: {
            id: "user-1",
            displayName: "Served User",
          },
          conversation: {
            id: "served-channel",
            threadId: "served-thread",
          },
          input: {
            text: "hello from served listener",
          },
        }),
      }),
    );
    const body = (await response.json()) as {
      readonly accepted: boolean;
      readonly receipts: readonly { readonly status: string }[];
    };

    expect(response.status).toBe(202);
    expect(body.accepted).toBe(true);
    expect(body.receipts[0]?.status).toBe("dispatched");
    expect(replyCalls).toHaveLength(4);
    const finalCall = replyCalls.at(-1);
    expect(finalCall?.url).toBe("https://reply.example.test/listener");
    expect(JSON.parse(String(finalCall?.init?.body))).toMatchObject({
      type: "divedra.chat_reply",
      target: {
        sourceId: "example-reply-webhook",
        eventId: "served-chat-1",
        conversationId: "served-channel",
        threadId: "served-thread",
      },
      message: {
        text: "Thanks Served User. I received: hello from served listener",
      },
    });
    expect(
      await listEventReplyDispatchesFromRuntimeDb({}, { rootDataDir }),
    ).toHaveLength(4);
    await listener.stop();
  });
});
