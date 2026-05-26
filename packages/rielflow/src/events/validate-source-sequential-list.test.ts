import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadAndValidateEventConfiguration } from "./validate";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rielflow-events-"));
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

describe("sequential-list source validation", () => {
  test("loads and validates sequential-list sources", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".rielflow");
    const eventRoot = path.join(root, ".rielflow-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "instructions.json"), {
      id: "nightly-instructions",
      kind: "sequential-list",
      entries: [
        {
          id: "summarize-backlog",
          prompt: "Summarize the current backlog.",
          metadata: { priority: "normal" },
        },
        {
          id: "identify-blockers",
          prompt: "Identify blockers from the summary.",
        },
      ],
      onItemFailure: "stop",
    });
    await writeJson(
      path.join(eventRoot, "bindings", "instructions-demo.json"),
      {
        id: "instructions-demo",
        sourceId: "nightly-instructions",
        workflowName: "demo",
        inputMapping: {
          mode: "template",
          template: {
            prompt: "{{event.input.prompt}}",
            itemId: "{{event.input.sequence.itemId}}",
          },
        },
      },
    );

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(true);
    expect(validation.configuration.sources[0]).toMatchObject({
      id: "nightly-instructions",
      kind: "sequential-list",
      configFilePath: path.join(eventRoot, "sources", "instructions.json"),
    });
  });

  test("reports malformed sequential-list source entries", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".rielflow");
    const eventRoot = path.join(root, ".rielflow-events");
    await writeJson(path.join(eventRoot, "sources", "instructions.json"), {
      id: "nightly-instructions",
      kind: "sequential-list",
      entries: [
        { id: "", prompt: "" },
        { id: "duplicate", prompt: "first" },
        { id: "duplicate", prompt: "second", metadata: [] },
        { id: "../unsafe", prompt: "unsafe" },
      ],
      startPolicy: "now",
      onItemFailure: "retry",
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "sources.nightly-instructions.entries[0].id",
        "sources.nightly-instructions.entries[0].prompt",
        "sources.nightly-instructions.entries[2].id",
        "sources.nightly-instructions.entries[2].metadata",
        "sources.nightly-instructions.entries[3].id",
        "sources.nightly-instructions.startPolicy",
        "sources.nightly-instructions.onItemFailure",
      ]),
    );
  });
});
