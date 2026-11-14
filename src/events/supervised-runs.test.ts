import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createEventSupervisedRunRepository,
  supervisedInProcessCorrelationQueueSize,
} from "./supervised-runs";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-supervised-runs-test-"),
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

describe("event supervised run repository in-process queue", () => {
  test("clears the per-correlation queue entry when work finishes", async () => {
    const root = await makeTempDir();
    const repo = createEventSupervisedRunRepository({
      rootDataDir: path.join(root, "data"),
    });
    const key = { sourceId: "s1", bindingId: "b1", correlationKey: "c1" };
    for (let i = 0; i < 20; i++) {
      await repo.withCorrelationLock(key, async () => {
        return i;
      });
    }
    expect(supervisedInProcessCorrelationQueueSize()).toBe(0);
  });

  test("rejects duplicate pending command claims for the same command id", async () => {
    const root = await makeTempDir();
    const repo = createEventSupervisedRunRepository({
      rootDataDir: path.join(root, "data"),
    });

    const command = {
      commandId: "pending-command",
      sourceId: "source-1",
      bindingId: "binding-1",
      correlationKey: "corr-1",
      action: "start" as const,
      targetWorkflowName: "demo",
      receivedEventReceiptId: "receipt-1",
    };

    const first = await repo.claimCommandSlot({
      command,
      supervisedRunId: "esv-1",
    });
    expect(first).toEqual({ outcome: "execute" });

    await expect(
      repo.claimCommandSlot({
        command,
        supervisedRunId: "esv-1",
      }),
    ).rejects.toThrow(/already in progress/i);
  });
});
