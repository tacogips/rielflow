import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildSupervisorChatConversation,
  dispatchSupervisorChat,
} from "./dispatch-supervisor-chat";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-dispatch-supervisor-chat-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("dispatchSupervisorChat", () => {
  test("rejects blank text before loading configuration", async () => {
    await expect(
      dispatchSupervisorChat({
        workflowRoot: path.join(os.tmpdir(), "missing-workflow-root"),
        eventRoot: path.join(os.tmpdir(), "missing-event-root"),
        cwd: os.tmpdir(),
        sourceId: "any",
        text: "   ",
      }),
    ).rejects.toThrow(/non-empty text/);
  });

  test("rejects unknown or disabled source id after validation", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "listed.json"), {
      id: "listed",
      kind: "webhook",
      path: "/events/x",
    });
    await writeJson(path.join(eventRoot, "bindings", "to-demo.json"), {
      id: "to-demo",
      sourceId: "listed",
      workflowName: "demo",
      inputMapping: { mode: "event-input" },
    });

    await expect(
      dispatchSupervisorChat({
        workflowRoot,
        eventRoot,
        cwd: root,
        sourceId: "not-listed",
        text: "hello",
      }),
    ).rejects.toThrow(/not found or disabled/);
  });

  test("rejects disabled source id", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "listed.json"), {
      id: "listed",
      kind: "webhook",
      path: "/events/x",
      enabled: false,
    });
    await writeJson(path.join(eventRoot, "bindings", "to-demo.json"), {
      id: "to-demo",
      sourceId: "listed",
      workflowName: "demo",
      inputMapping: { mode: "event-input" },
    });

    await expect(
      dispatchSupervisorChat({
        workflowRoot,
        eventRoot,
        cwd: root,
        sourceId: "listed",
        text: "hello",
      }),
    ).rejects.toThrow(/not found or disabled/);
  });
});

describe("buildSupervisorChatConversation", () => {
  test("returns undefined when neither conversationId nor threadId is set", () => {
    expect(
      buildSupervisorChatConversation({ sourceId: "src-1" }),
    ).toBeUndefined();
  });

  test("uses explicit conversationId without threadId", () => {
    expect(
      buildSupervisorChatConversation({
        sourceId: "src-1",
        conversationId: "chan-a",
      }),
    ).toEqual({ id: "chan-a" });
  });

  test("uses sourceId as conversation id when only threadId is provided", () => {
    expect(
      buildSupervisorChatConversation({
        sourceId: "src-1",
        threadId: "thread-z",
      }),
    ).toEqual({ id: "src-1", threadId: "thread-z" });
  });

  test("keeps distinct channel and thread when both are provided", () => {
    expect(
      buildSupervisorChatConversation({
        sourceId: "src-1",
        conversationId: "chan-a",
        threadId: "thread-z",
      }),
    ).toEqual({ id: "chan-a", threadId: "thread-z" });
  });
});
