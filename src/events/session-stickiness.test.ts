import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  loadEventWorkflowSessionStickiness,
  saveEventWorkflowSessionStickiness,
} from "./session-stickiness";

const tempDirs: string[] = [];

async function makeTempDataRoot(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-session-stickiness-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

const baseRecord = {
  workflowName: "wf",
  sourceId: "src",
  bindingId: "b1",
  conversationId: "c1",
  sessionId: "sess-1",
} as const;

describe("event workflow session stickiness", () => {
  test("roundtrips a stickiness record", async () => {
    const rootDataDir = await makeTempDataRoot();
    const key = {
      workflowId: "wf-id",
      ...baseRecord,
    };
    await saveEventWorkflowSessionStickiness(
      { ...key, updatedAt: "2026-04-22T00:00:00.000Z" },
      { rootDataDir },
    );
    const loaded = await loadEventWorkflowSessionStickiness(
      {
        workflowId: "wf-id",
        sourceId: "src",
        bindingId: "b1",
        conversationId: "c1",
      },
      { rootDataDir },
    );
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe("sess-1");
  });

  test("removes a corrupt file on load and returns null", async () => {
    const rootDataDir = await makeTempDataRoot();
    const key = {
      workflowId: "wf-id",
      ...baseRecord,
    };
    await saveEventWorkflowSessionStickiness(
      { ...key, updatedAt: "2026-04-22T00:00:00.000Z" },
      { rootDataDir },
    );
    const dir = path.join(rootDataDir, "events", "session-stickiness");
    const file = (await readdir(dir)).find((f) => f.endsWith(".json"));
    expect(file).toBeDefined();
    if (file === undefined) {
      throw new Error("expected stickiness file to be written");
    }
    await writeFile(path.join(dir, file), "not json {", "utf8");

    const loaded = await loadEventWorkflowSessionStickiness(
      {
        workflowId: "wf-id",
        sourceId: "src",
        bindingId: "b1",
        conversationId: "c1",
      },
      { rootDataDir },
    );
    expect(loaded).toBeNull();
    const remaining = await readdir(dir).catch(() => []);
    expect(remaining.filter((f) => f === file).length).toBe(0);
  });

  test("removes a file whose JSON omits required fields", async () => {
    const rootDataDir = await makeTempDataRoot();
    const key = {
      workflowId: "wf-id",
      ...baseRecord,
    };
    await saveEventWorkflowSessionStickiness(
      { ...key, updatedAt: "2026-04-22T00:00:00.000Z" },
      { rootDataDir },
    );
    const dir = path.join(rootDataDir, "events", "session-stickiness");
    const file = (await readdir(dir)).find((f) => f.endsWith(".json"));
    expect(file).toBeDefined();
    if (file === undefined) {
      throw new Error("expected stickiness file to be written");
    }
    await writeFile(
      path.join(dir, file),
      JSON.stringify({
        workflowId: "wf-id",
        workflowName: "wf",
        sourceId: "src",
        conversationId: "c1",
        sessionId: "sess-1",
        updatedAt: "2026-04-22T00:00:00.000Z",
      }),
      "utf8",
    );

    const loaded = await loadEventWorkflowSessionStickiness(
      {
        workflowId: "wf-id",
        sourceId: "src",
        bindingId: "b1",
        conversationId: "c1",
      },
      { rootDataDir },
    );
    expect(loaded).toBeNull();
  });

  test("removes a file when the stored record bindingId does not match the lookup", async () => {
    const rootDataDir = await makeTempDataRoot();
    const key = {
      workflowId: "wf-id",
      ...baseRecord,
    };
    await saveEventWorkflowSessionStickiness(
      { ...key, updatedAt: "2026-04-22T00:00:00.000Z" },
      { rootDataDir },
    );
    const dir = path.join(rootDataDir, "events", "session-stickiness");
    const file = (await readdir(dir)).find((f) => f.endsWith(".json"));
    expect(file).toBeDefined();
    if (file === undefined) {
      throw new Error("expected stickiness file to be written");
    }
    await writeFile(
      path.join(dir, file),
      JSON.stringify({
        workflowId: "wf-id",
        workflowName: "wf",
        sourceId: "src",
        bindingId: "other-binding",
        conversationId: "c1",
        sessionId: "sess-1",
        updatedAt: "2026-04-22T00:00:00.000Z",
      }),
      "utf8",
    );

    const loaded = await loadEventWorkflowSessionStickiness(
      {
        workflowId: "wf-id",
        sourceId: "src",
        bindingId: "b1",
        conversationId: "c1",
      },
      { rootDataDir },
    );
    expect(loaded).toBeNull();
    const remaining = await readdir(dir).catch(() => []);
    expect(remaining.filter((f) => f === file).length).toBe(0);
  });

  test("treats threadId as part of the key", async () => {
    const rootDataDir = await makeTempDataRoot();
    await saveEventWorkflowSessionStickiness(
      {
        workflowId: "wf-id",
        ...baseRecord,
        threadId: "t1",
        updatedAt: "2026-04-22T00:00:00.000Z",
      },
      { rootDataDir },
    );
    const withoutThread = await loadEventWorkflowSessionStickiness(
      {
        workflowId: "wf-id",
        sourceId: "src",
        bindingId: "b1",
        conversationId: "c1",
      },
      { rootDataDir },
    );
    expect(withoutThread).toBeNull();

    const withThread = await loadEventWorkflowSessionStickiness(
      {
        workflowId: "wf-id",
        sourceId: "src",
        bindingId: "b1",
        conversationId: "c1",
        threadId: "t1",
      },
      { rootDataDir },
    );
    expect(withThread?.sessionId).toBe("sess-1");
  });
});
