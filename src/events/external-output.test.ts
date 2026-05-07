import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  loadEventReplyDispatchByIdempotencyKey,
  saveEventReplyDispatchToRuntimeDb,
} from "../workflow/runtime-db";
import {
  publishExternalOutputMessage,
  publishWorkflowBusinessFinalExternalOutput,
  resolveExternalOutputDispatchTarget,
} from "./external-output";
import type { ExternalOutputMessage } from "./types";
import type { ChatReplyDispatchRequest } from "../workflow/types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-external-output-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function sampleMessageNoDispatchTarget(
  idempotencyKey: string,
): ExternalOutputMessage {
  return {
    kind: "external-output",
    outputKind: "business-final",
    address: { sourceId: "src" },
    payload: { workflowOutput: {} },
    idempotencyKey,
    createdAt: "2026-04-30T00:00:00.000Z",
  };
}

describe("external-output", () => {
  test("resolveExternalOutputDispatchTarget prefers embedded chatReplyTarget", () => {
    const target = resolveExternalOutputDispatchTarget(
      {},
      {
        chatReplyTarget: {
          sourceId: "s",
          provider: "p",
          eventId: "e",
          conversationId: "c",
        },
      },
    );
    expect(target).toEqual({
      sourceId: "s",
      provider: "p",
      conversationId: "c",
      eventId: "e",
    });
  });

  test("persists no_delivery_target without calling dispatcher when no target", async () => {
    const rootDataDir = await makeTempDir();
    const message = sampleMessageNoDispatchTarget("ext-out-no-target-1");
    const dispatcher = {
      async dispatchChatReply() {
        throw new Error("should not dispatch");
      },
    };
    const result = await publishExternalOutputMessage({
      dispatcher,
      message,
      workflowId: "wf",
      workflowExecutionId: "sess",
      nodeId: "n1",
      nodeExecId: "nx1",
      runtimeOptions: { rootDataDir },
    });
    expect(result).toBeNull();
    const row = await loadEventReplyDispatchByIdempotencyKey(
      "ext-out-no-target-1",
      { rootDataDir },
    );
    expect(row?.status).toBe("no_delivery_target");
    expect(row?.error).toBe("no_dispatch_target");
  });

  test("reuses idempotency for no_delivery_target without re-dispatching", async () => {
    const rootDataDir = await makeTempDir();
    const key = "ext-out-no-target-2";
    await saveEventReplyDispatchToRuntimeDb(
      {
        idempotencyKey: key,
        sourceId: "none",
        provider: "none",
        workflowId: "wf",
        workflowExecutionId: "sess",
        nodeId: "n1",
        nodeExecId: "nx1",
        eventId: key,
        conversationId: "none",
        status: "no_delivery_target",
        requestJson: "{}",
        error: "no_dispatch_target",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
      { rootDataDir },
    );
    let calls = 0;
    const dispatcher = {
      async dispatchChatReply() {
        calls += 1;
        return { status: "sent" as const, provider: "p" };
      },
    };
    const message = sampleMessageNoDispatchTarget(key);
    const result = await publishExternalOutputMessage({
      dispatcher,
      message,
      workflowId: "wf",
      workflowExecutionId: "sess",
      nodeId: "n1",
      nodeExecId: "nx1",
      runtimeOptions: { rootDataDir },
    });
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  test("business-final publication forwards runtime event output destinations", async () => {
    const rootDataDir = await makeTempDir();
    const dispatched: ChatReplyDispatchRequest[] = [];
    const dispatcher = {
      async dispatchChatReply(request: ChatReplyDispatchRequest) {
        dispatched.push(request);
        return { status: "sent" as const, provider: "p" };
      },
    };

    const result = await publishWorkflowBusinessFinalExternalOutput({
      dispatcher,
      runtimeOptions: { rootDataDir },
      workflowId: "wf",
      workflowExecutionId: "sess",
      runtimeVariables: {
        eventBindingId: "binding-1",
        eventOutputDestinations: ["chat-output", "archive-output"],
        event: {
          sourceId: "chat-source",
          eventId: "evt-1",
          provider: "webhook",
          eventType: "chat.message",
          receivedAt: "2026-04-30T00:00:00.000Z",
          dedupeKey: "dedupe-1",
          conversation: { id: "conv-1", threadId: "thread-1" },
          actor: { id: "actor-1" },
          input: { text: "hello" },
        },
      },
      publishedNodeId: "output",
      publishedNodeExecId: "exec-1",
      workflowOutputPayload: { answer: "done" },
      createdAt: "2026-04-30T00:00:00.000Z",
    });

    expect(result).toEqual({ status: "sent", provider: "p" });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      outputDestinationIds: ["chat-output", "archive-output"],
      message: { text: JSON.stringify({ answer: "done" }) },
      target: {
        sourceId: "chat-source",
        eventId: "evt-1",
        conversationId: "conv-1",
        threadId: "thread-1",
      },
    });
  });
});
