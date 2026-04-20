import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadEventConfiguration, resolveEventRoot } from "./config";
import { loadAndValidateEventConfiguration } from "./validate";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-events-"));
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

describe("event configuration", () => {
  test("resolves default event root next to workflow root", () => {
    const root = path.join(os.tmpdir(), "event-root-project");
    expect(
      resolveEventRoot({
        workflowRoot: path.join(root, ".divedra"),
        cwd: root,
      }),
    ).toBe(path.join(root, ".divedra-events"));
  });

  test("loads and validates source and binding configuration", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
      workflowId: "demo",
    });
    await writeJson(path.join(eventRoot, "sources", "local-webhook.json"), {
      id: "local-webhook",
      kind: "webhook",
      path: "/events/local",
    });
    await writeJson(path.join(eventRoot, "bindings", "to-demo.json"), {
      id: "to-demo",
      sourceId: "local-webhook",
      workflowName: "demo",
      inputMapping: {
        mode: "event-input",
      },
    });

    const loaded = await loadEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });
    expect(loaded.sources.map((source) => source.id)).toEqual([
      "local-webhook",
    ]);
    expect(loaded.bindings.map((binding) => binding.id)).toEqual(["to-demo"]);

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });
    expect(validation.valid).toBe(true);
    expect(
      validation.issues.filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });

  test("reports invalid binding and unsafe webhook sync execution", async () => {
    const root = await makeTempDir();
    const workflowRoot = path.join(root, ".divedra");
    const eventRoot = path.join(root, ".divedra-events");
    await writeJson(path.join(eventRoot, "sources", "local-webhook.json"), {
      id: "local-webhook",
      kind: "webhook",
      path: "/events/local",
      replyEndpointEnv: "not-loud-enough",
    });
    await writeJson(path.join(eventRoot, "bindings", "to-missing.json"), {
      id: "to-missing",
      sourceId: "missing",
      workflowName: "missing-workflow",
      inputMapping: {
        mode: "template",
        template: {
          request: "{{bad.scope}}",
        },
      },
      execution: {
        async: false,
      },
    });

    const validation = await loadAndValidateEventConfiguration({
      workflowRoot,
      eventRoot,
      cwd: root,
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "bindings.to-missing.sourceId",
        "bindings.to-missing.workflowName",
        "bindings.to-missing.inputMapping.template.request",
        "sources.local-webhook.replyEndpointEnv",
      ]),
    );
  });
});
