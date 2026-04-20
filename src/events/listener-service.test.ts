import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createEventListenerService,
  type EventListenerRuntime,
} from "./listener-service";
import { listEventReplyDispatchesFromRuntimeDb } from "../workflow/runtime-db";

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
    expect(replyCalls).toHaveLength(1);
    expect(replyCalls[0]?.url).toBe("https://reply.example.test/listener");
    expect(JSON.parse(String(replyCalls[0]?.init?.body))).toMatchObject({
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
    ).toHaveLength(1);
    await listener.stop();
  });
});
