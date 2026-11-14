import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { emitEventFile } from "./manual-emit";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-chat-reply-example-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("chat reply event example", () => {
  test("dispatches the checked-in add-on workflow to a webhook reply endpoint", async () => {
    const root = await makeTempDir();
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> =
      [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
      return new Response(
        JSON.stringify({ providerMessageId: "example-message-1" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const results = await emitEventFile({
      sourceId: "example-reply-webhook",
      workflowRoot: path.resolve("examples"),
      eventRoot: path.resolve("examples/event-sources/.divedra-events"),
      rootDataDir: path.join(root, "data"),
      eventFile: path.resolve(
        "examples/event-sources/payloads/chat-reply-message.json",
      ),
      env: {
        DIVEDRA_EXAMPLE_REPLY_ENDPOINT: "https://reply.example.test/messages",
      },
      fetchImpl,
      cwd: process.cwd(),
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.receipt.status).toBe("dispatched");
    expect(results[0]?.workflowName).toBe("chat-reply-webhook");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const finalCall = calls.at(-1);
    expect(finalCall?.url).toBe("https://reply.example.test/messages");
    expect(finalCall?.init?.headers).toMatchObject({
      "content-type": "application/json",
      "x-divedra-idempotency-key": expect.stringContaining(
        "chat-reply:chat-reply-webhook:",
      ),
    });
    expect(JSON.parse(String(finalCall?.init?.body))).toMatchObject({
      type: "divedra.chat_reply",
      sourceId: "example-reply-webhook",
      target: {
        sourceId: "example-reply-webhook",
        provider: "webhook",
        eventId: "chat-reply-fixture-1",
        conversationId: "example-channel",
        threadId: "thread-1",
      },
      message: {
        text: "Thanks Example User. I received: Please acknowledge this webhook message.",
      },
      workflowId: "chat-reply-webhook",
      nodeId: "reply-to-chat",
    });
  });
});
