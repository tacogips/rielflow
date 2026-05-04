import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createWorkflowTemplate } from "./create";
import {
  DEFAULT_MAX_LOOP_ITERATIONS,
  DEFAULT_NODE_TIMEOUT_MS,
  type AuthoredWorkflowJson,
} from "./types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "divedra-create-test-"));
  tempDirs.push(directory);
  return directory;
}

test("createWorkflowTemplate writes shared workflow defaults", async () => {
  const workflowRoot = makeTempDir();
  const created = await createWorkflowTemplate("demo", { workflowRoot });

  expect(created.ok).toBe(true);
  if (!created.ok) {
    throw new Error(created.error.message);
  }

  const workflowJson = JSON.parse(
    readFileSync(
      path.join(created.value.workflowDirectory, "workflow.json"),
      "utf8",
    ),
  ) as AuthoredWorkflowJson;

  expect(workflowJson.defaults).toEqual({
    maxLoopIterations: DEFAULT_MAX_LOOP_ITERATIONS,
    nodeTimeoutMs: DEFAULT_NODE_TIMEOUT_MS,
  });
});
