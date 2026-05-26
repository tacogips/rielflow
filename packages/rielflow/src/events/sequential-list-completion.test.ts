import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createSequentialListCompletionObserver } from "./sequential-list-completion";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rielflow-seq-list-"));
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

describe("sequential-list completion observer", () => {
  test("fails unobservable workflow executions instead of waiting forever", async () => {
    const observer = createSequentialListCompletionObserver({
      rootDataDir: await makeTempDir(),
    });

    const result = await observer.waitForTerminal({
      sourceId: "nightly-instructions",
      itemId: "first",
      workflowExecutionId: "missing-workflow-execution",
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "failed",
      workflowExecutionId: "missing-workflow-execution",
      error: "sequential-list item completion could not be observed",
    });
  });
});
