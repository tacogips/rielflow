import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildUserBackendSessionKey,
  deleteUserBackendSession,
  loadUserBackendSession,
  saveUserBackendSession,
  type UserBackendSessionRecord,
} from "./user-backend-session-store";

const tempDirs: string[] = [];

async function makeTempDataRoot(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-user-backend-session-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

const baseRecord: UserBackendSessionRecord = {
  workflowId: "my-workflow",
  nodeId: "step-1",
  backend: "cursor-cli-agent",
  provider: "cursor",
  sessionId: "cursor-sess-abc123",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

const baseKeyInput = {
  workflowId: "my-workflow",
  nodeId: "step-1",
  backend: "cursor-cli-agent",
};

describe("buildUserBackendSessionKey", () => {
  test("builds a stable key from workflowId, nodeId, backend", () => {
    const key = buildUserBackendSessionKey(baseKeyInput);
    expect(key).toContain("my-workflow");
    expect(key).toContain("step-1");
    expect(key).toContain("cursor-cli-agent");
  });

  test("includes nodeRegistryId when provided", () => {
    const keyWithRegistry = buildUserBackendSessionKey({
      ...baseKeyInput,
      nodeRegistryId: "registry-node-1",
    });
    const keyWithout = buildUserBackendSessionKey(baseKeyInput);
    expect(keyWithRegistry).not.toBe(keyWithout);
  });
});

describe("user backend session store", () => {
  test("roundtrips a session record", async () => {
    const rootDataDir = await makeTempDataRoot();
    await saveUserBackendSession(baseRecord, { rootDataDir });
    const loaded = await loadUserBackendSession(baseKeyInput, { rootDataDir });
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe("cursor-sess-abc123");
    expect(loaded?.workflowId).toBe("my-workflow");
    expect(loaded?.nodeId).toBe("step-1");
    expect(loaded?.backend).toBe("cursor-cli-agent");
  });

  test("roundtrips a record with optional fields", async () => {
    const rootDataDir = await makeTempDataRoot();
    const recordWithOptionals: UserBackendSessionRecord = {
      ...baseRecord,
      nodeRegistryId: "registry-node-1",
      workingDirectory: "/project/workspace",
    };
    const keyInput = { ...baseKeyInput, nodeRegistryId: "registry-node-1" };
    await saveUserBackendSession(recordWithOptionals, { rootDataDir });
    const loaded = await loadUserBackendSession(keyInput, { rootDataDir });
    expect(loaded).not.toBeNull();
    expect(loaded?.nodeRegistryId).toBe("registry-node-1");
    expect(loaded?.workingDirectory).toBe("/project/workspace");
  });

  test("returns null for missing record", async () => {
    const rootDataDir = await makeTempDataRoot();
    const loaded = await loadUserBackendSession(baseKeyInput, { rootDataDir });
    expect(loaded).toBeNull();
  });

  test("removes corrupt file on load and returns null", async () => {
    const rootDataDir = await makeTempDataRoot();
    await saveUserBackendSession(baseRecord, { rootDataDir });
    const dir = path.join(rootDataDir, "backend-sessions", "user");
    const file = (await readdir(dir)).find((f) => f.endsWith(".json"));
    expect(file).toBeDefined();
    if (file === undefined) {
      throw new Error("expected session file to be written");
    }
    await writeFile(path.join(dir, file), "not json {", "utf8");
    const loaded = await loadUserBackendSession(baseKeyInput, { rootDataDir });
    expect(loaded).toBeNull();
  });

  test("deletes a stored record", async () => {
    const rootDataDir = await makeTempDataRoot();
    await saveUserBackendSession(baseRecord, { rootDataDir });
    await deleteUserBackendSession(baseKeyInput, { rootDataDir });
    const loaded = await loadUserBackendSession(baseKeyInput, { rootDataDir });
    expect(loaded).toBeNull();
  });

  test("rejects expired records based on TTL", async () => {
    const rootDataDir = await makeTempDataRoot();
    const oldRecord: UserBackendSessionRecord = {
      ...baseRecord,
      updatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await saveUserBackendSession(oldRecord, { rootDataDir });
    const loaded = await loadUserBackendSession(baseKeyInput, { rootDataDir });
    expect(loaded).toBeNull();
  });

  test("accepts records within TTL", async () => {
    const rootDataDir = await makeTempDataRoot();
    const recentRecord: UserBackendSessionRecord = {
      ...baseRecord,
      updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await saveUserBackendSession(recentRecord, { rootDataDir });
    const loaded = await loadUserBackendSession(baseKeyInput, { rootDataDir });
    expect(loaded).not.toBeNull();
  });

  test("respects RIELFLOW_USER_BACKEND_SESSION_MAX_AGE_MS env override", async () => {
    const rootDataDir = await makeTempDataRoot();
    const slightlyOldRecord: UserBackendSessionRecord = {
      ...baseRecord,
      updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    };
    await saveUserBackendSession(slightlyOldRecord, { rootDataDir });
    // 1 minute max age - record is 2 minutes old, so should be rejected
    const loaded = await loadUserBackendSession(baseKeyInput, {
      rootDataDir,
      env: { RIELFLOW_USER_BACKEND_SESSION_MAX_AGE_MS: String(60 * 1000) },
    });
    expect(loaded).toBeNull();
  });

  test("overwrites an existing record with a newer one", async () => {
    const rootDataDir = await makeTempDataRoot();
    await saveUserBackendSession(baseRecord, { rootDataDir });
    const updatedRecord: UserBackendSessionRecord = {
      ...baseRecord,
      sessionId: "cursor-sess-new456",
      updatedAt: new Date().toISOString(),
    };
    await saveUserBackendSession(updatedRecord, { rootDataDir });
    const loaded = await loadUserBackendSession(baseKeyInput, { rootDataDir });
    expect(loaded?.sessionId).toBe("cursor-sess-new456");
  });
});
