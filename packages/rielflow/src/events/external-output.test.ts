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
  publishWorkflowFailureExternalOutput,
  resolveExternalOutputDispatchTarget,
  sanitizeWorkflowFailureMessage,
} from "./external-output";
import type { ExternalOutputMessage } from "./types";
import type { ChatReplyDispatchRequest } from "../workflow/types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-external-output-"),
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
  test("sanitizeWorkflowFailureMessage redacts common credential shapes", () => {
    const sanitized = sanitizeWorkflowFailureMessage(
      "provider failed token=8902822519:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi Bearer secretBearerValue1234567890",
    );

    expect(sanitized).toBe(
      "provider failed token=[redacted] Bearer [redacted]",
    );
  });

  test("sanitizeWorkflowFailureMessage redacts structured secret fields", () => {
    const sanitized = sanitizeWorkflowFailureMessage(
      [
        'provider failed {"token":"json-secret-value"}',
        "AWS_SECRET_ACCESS_KEY=env-secret-value",
        "https://example.test/callback?access_token=url-secret-value&state=ok",
        "Authorization: Bearer headerSecretValue1234567890",
        "Authorization: Basic dXNlcjpwYXNz",
        "Authorization: Token tokenSecretValue1234567890",
        "Authorization: ApiKey apiKeySecretValue1234567890",
        "api_key='single-quoted-secret'",
      ].join(" "),
    );

    expect(sanitized).toBe(
      'provider failed {"token":"[redacted]"} AWS_SECRET_ACCESS_KEY=[redacted] https://example.test/callback?access_token=[redacted]&state=ok Authorization: [redacted] Authorization: [redacted] Authorization: [redacted] Authorization: [redacted] api_key=[redacted]',
    );
    expect(sanitized).not.toContain("json-secret-value");
    expect(sanitized).not.toContain("env-secret-value");
    expect(sanitized).not.toContain("url-secret-value");
    expect(sanitized).not.toContain("headerSecretValue");
    expect(sanitized).not.toContain("dXNlcjpwYXNz");
    expect(sanitized).not.toContain("tokenSecretValue");
    expect(sanitized).not.toContain("apiKeySecretValue");
    expect(sanitized).not.toContain("single-quoted-secret");
  });

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

  test("failure publication sends a sanitized chat control-status reply", async () => {
    const rootDataDir = await makeTempDir();
    const dispatched: ChatReplyDispatchRequest[] = [];
    const dispatcher = {
      async dispatchChatReply(request: ChatReplyDispatchRequest) {
        dispatched.push(request);
        return { status: "sent" as const, provider: "telegram" };
      },
    };

    const result = await publishWorkflowFailureExternalOutput({
      dispatcher,
      runtimeOptions: { rootDataDir },
      workflowId: "wf",
      workflowExecutionId: "sess",
      runtimeVariables: {
        eventBindingId: "binding-1",
        eventOutputDestinations: ["chat-output"],
        event: {
          sourceId: "telegram-source",
          eventId: "evt-1",
          provider: "telegram",
          eventType: "chat.message",
          receivedAt: "2026-04-30T00:00:00.000Z",
          dedupeKey: "dedupe-1",
          conversation: { id: "conv-1" },
          actor: { id: "actor-1" },
          input: {
            text: "hello",
            replyTarget: {
              sourceId: "telegram-source",
              provider: "telegram",
              eventId: "evt-1",
              conversationId: "conv-1",
              actorId: "actor-1",
            },
          },
        },
      },
      failedNodeId: "mika-claude",
      failedNodeExecId: "exec-4",
      failureMessage:
        "adapter failed: token=8902822519:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
      replyAs: "mika",
      createdAt: "2026-04-30T00:00:00.000Z",
    });

    expect(result).toEqual({ status: "sent", provider: "telegram" });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      outputDestinationIds: ["chat-output"],
      message: {
        text: "Workflow step 'mika-claude' failed: adapter failed: token=[redacted]",
        replyAs: "mika",
      },
      target: {
        sourceId: "telegram-source",
        provider: "telegram",
        eventId: "evt-1",
        conversationId: "conv-1",
        actorId: "actor-1",
      },
    });
    expect(dispatched[0]?.message.text).not.toContain(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    );
  });

  test("failure publication reuses one event-level reply across reruns", async () => {
    const rootDataDir = await makeTempDir();
    const dispatched: ChatReplyDispatchRequest[] = [];
    const dispatcher = {
      async dispatchChatReply(request: ChatReplyDispatchRequest) {
        dispatched.push(request);
        await saveEventReplyDispatchToRuntimeDb(
          {
            idempotencyKey: request.idempotencyKey,
            sourceId: request.target.sourceId,
            provider: request.target.provider,
            workflowId: request.workflowId,
            workflowExecutionId: request.workflowExecutionId,
            nodeId: request.nodeId,
            nodeExecId: request.nodeExecId,
            eventId: request.target.eventId ?? request.idempotencyKey,
            conversationId: request.target.conversationId ?? "none",
            status: "sent",
            requestJson: JSON.stringify(request),
            providerMessageId: "msg-1",
            createdAt: "2026-04-30T00:00:00.000Z",
            updatedAt: "2026-04-30T00:00:00.000Z",
          },
          { rootDataDir },
        );
        return {
          status: "sent" as const,
          provider: "telegram",
          providerMessageId: "msg-1",
        };
      },
    };

    const runtimeVariables = {
      eventBindingId: "binding-1",
      event: {
        sourceId: "telegram-source",
        eventId: "evt-1",
        provider: "telegram",
        eventType: "chat.message",
        receivedAt: "2026-04-30T00:00:00.000Z",
        dedupeKey: "dedupe-1",
        conversation: { id: "conv-1" },
        actor: { id: "actor-1" },
        input: {
          text: "hello",
          replyTarget: {
            sourceId: "telegram-source",
            provider: "telegram",
            eventId: "evt-1",
            conversationId: "conv-1",
            actorId: "actor-1",
          },
        },
      },
    };

    const first = await publishWorkflowFailureExternalOutput({
      dispatcher,
      runtimeOptions: { rootDataDir },
      workflowId: "wf",
      workflowExecutionId: "sess-1",
      runtimeVariables,
      failedNodeId: "mika-claude",
      failedNodeExecId: "exec-1",
      failureMessage: "claude auth failed",
      replyAs: "mika",
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    const second = await publishWorkflowFailureExternalOutput({
      dispatcher,
      runtimeOptions: { rootDataDir },
      workflowId: "wf",
      workflowExecutionId: "sess-2",
      runtimeVariables,
      failedNodeId: "mika-claude",
      failedNodeExecId: "exec-2",
      failureMessage: "claude auth failed",
      replyAs: "mika",
      createdAt: "2026-04-30T00:00:01.000Z",
    });

    expect(first).toEqual({
      status: "sent",
      provider: "telegram",
      providerMessageId: "msg-1",
    });
    expect(second).toEqual(first);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.idempotencyKey).toBe(
      "external-output:failure:event:telegram-source:dedupe-1:wf:mika-claude",
    );
  });
});
