import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  collectPromptTemplateFiles,
  computeWorkflowRevisionFromFiles,
} from "./revision";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-revision-test-"),
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

describe("workflow revision prompt file tracking", () => {
  test("includes system and session-start template files in revision inputs", async () => {
    const workflowDirectory = await makeTempDir();
    await mkdir(path.join(workflowDirectory, "prompts"), { recursive: true });

    await writeFile(
      path.join(workflowDirectory, "workflow.json"),
      '{"workflowId":"wf"}\n',
      "utf8",
    );
    await writeFile(
      path.join(workflowDirectory, "node-manager.json"),
      '{"id":"manager"}\n',
      "utf8",
    );
    await writeFile(
      path.join(workflowDirectory, "prompts", "system.md"),
      "system v1\n",
      "utf8",
    );
    await writeFile(
      path.join(workflowDirectory, "prompts", "session-start.md"),
      "session start v1\n",
      "utf8",
    );

    const extraFiles = collectPromptTemplateFiles({
      "node-manager.json": {
        systemPromptTemplateFile: "prompts/system.md",
        sessionStartPromptTemplateFile: "prompts/session-start.md",
      },
    });
    expect(extraFiles).toEqual([
      "prompts/session-start.md",
      "prompts/system.md",
    ]);

    const firstRevision = await computeWorkflowRevisionFromFiles(
      workflowDirectory,
      ["node-manager.json"],
      extraFiles,
    );
    expect(firstRevision.ok).toBe(true);
    if (!firstRevision.ok) {
      return;
    }

    await writeFile(
      path.join(workflowDirectory, "prompts", "system.md"),
      "system v2\n",
      "utf8",
    );

    const secondRevision = await computeWorkflowRevisionFromFiles(
      workflowDirectory,
      ["node-manager.json"],
      extraFiles,
    );
    expect(secondRevision.ok).toBe(true);
    if (!secondRevision.ok) {
      return;
    }

    expect(secondRevision.value).not.toBe(firstRevision.value);
  });

  test("includes prompt variant template files in revision inputs", async () => {
    const workflowDirectory = await makeTempDir();
    await mkdir(path.join(workflowDirectory, "prompts"), { recursive: true });

    await writeFile(
      path.join(workflowDirectory, "workflow.json"),
      '{"workflowId":"wf"}\n',
      "utf8",
    );
    await writeFile(
      path.join(workflowDirectory, "node-worker.json"),
      '{"id":"worker"}\n',
      "utf8",
    );
    await writeFile(
      path.join(workflowDirectory, "prompts", "review.md"),
      "review v1\n",
      "utf8",
    );

    const extraFiles = collectPromptTemplateFiles({
      "node-worker.json": {
        promptVariants: {
          review: {
            promptTemplateFile: "prompts/review.md",
          },
        },
      },
    });
    expect(extraFiles).toEqual(["prompts/review.md"]);

    const firstRevision = await computeWorkflowRevisionFromFiles(
      workflowDirectory,
      ["node-worker.json"],
      extraFiles,
    );
    expect(firstRevision.ok).toBe(true);
    if (!firstRevision.ok) {
      return;
    }

    await writeFile(
      path.join(workflowDirectory, "prompts", "review.md"),
      "review v2\n",
      "utf8",
    );

    const secondRevision = await computeWorkflowRevisionFromFiles(
      workflowDirectory,
      ["node-worker.json"],
      extraFiles,
    );
    expect(secondRevision.ok).toBe(true);
    if (!secondRevision.ok) {
      return;
    }

    expect(secondRevision.value).not.toBe(firstRevision.value);
  });

  test("supports workflow-relative node payload paths under nodes/", async () => {
    const workflowDirectory = await makeTempDir();
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });

    await writeFile(
      path.join(workflowDirectory, "workflow.json"),
      '{"workflowId":"wf"}\n',
      "utf8",
    );
    await writeFile(
      path.join(workflowDirectory, "nodes", "node-manager.json"),
      '{"id":"manager"}\n',
      "utf8",
    );

    const revision = await computeWorkflowRevisionFromFiles(workflowDirectory, [
      "nodes/node-manager.json",
    ]);
    expect(revision.ok).toBe(true);
  });

  test("rejects node payload paths that escape the workflow directory", async () => {
    const workflowDirectory = await makeTempDir();
    await writeFile(
      path.join(workflowDirectory, "workflow.json"),
      '{"workflowId":"wf"}\n',
      "utf8",
    );
    const revision = await computeWorkflowRevisionFromFiles(workflowDirectory, [
      "../nodes/node-manager.json",
    ]);
    expect(revision.ok).toBe(false);
    if (revision.ok) {
      return;
    }

    expect(revision.error.code).toBe("IO");
    expect(revision.error.message).toContain(
      "must be a workflow-relative path without '.' or '..' segments",
    );
  });
});