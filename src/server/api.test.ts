import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { handleApiRequest, resolveDefaultUiDistRoot } from "./api";
import { createWorkflowTemplate } from "../workflow/create";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-api-test-"));
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

describe("handleApiRequest", () => {
  test("returns a clear unavailable page when built UI assets are missing", async () => {
    const root = await makeTempDir();
    await createWorkflowTemplate("demo", { workflowRoot: root });

    const uiRes = await handleApiRequest(new Request("http://localhost/"), {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      uiDistRoot: path.join(root, "missing-ui-dist"),
    });
    expect(uiRes.status).toBe(503);
    expect(uiRes.headers.get("content-type")).toContain("text/html");
    await expect(uiRes.text()).resolves.toContain("divedra UI is unavailable");

    const healthRes = await handleApiRequest(
      new Request("http://localhost/healthz"),
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
    );
    expect(healthRes.status).toBe(200);
  });

  test("serves built UI assets and bootstrap config", async () => {
    const root = await makeTempDir();
    const uiDistRoot = path.join(root, "ui-dist");
    await mkdir(path.join(uiDistRoot, "assets"), { recursive: true });
    await writeFile(
      path.join(uiDistRoot, "index.html"),
      "<!doctype html><html><body><div id='app'>solid-ui</div></body></html>",
      "utf8",
    );
    await writeFile(
      path.join(uiDistRoot, "assets", "entry.js"),
      "console.log('ui asset');",
      "utf8",
    );
    await writeFile(
      path.join(uiDistRoot, "frontend-mode.json"),
      JSON.stringify({ frontend: "solid-dist" }),
      "utf8",
    );

    const rootRes = await handleApiRequest(new Request("http://localhost/"), {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      uiDistRoot,
    });
    expect(rootRes.status).toBe(200);
    await expect(rootRes.text()).resolves.toContain("solid-ui");

    const assetRes = await handleApiRequest(
      new Request("http://localhost/assets/entry.js"),
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        uiDistRoot,
      },
    );
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get("content-type")).toContain("text/javascript");

    const configRes = await handleApiRequest(
      new Request("http://localhost/api/ui-config"),
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
        uiDistRoot,
      },
    );
    expect(configRes.status).toBe(200);
    await expect(configRes.json()).resolves.toMatchObject({
      fixedWorkflowName: null,
      readOnly: false,
      noExec: false,
      frontend: "solid-dist",
    });
  });

  test("routes GraphQL requests through the served control plane", async () => {
    const root = await makeTempDir();
    await createWorkflowTemplate("demo", { workflowRoot: root });

    const response = await handleApiRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query Workflows {
              workflows
            }
          `,
        }),
      }),
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        workflows: ["demo"],
      },
    });
  });

  test("returns 404 for removed REST workflow and session routes", async () => {
    const root = await makeTempDir();
    const context = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };

    for (const url of [
      "http://localhost/api/workflows",
      "http://localhost/api/workflows/demo",
      "http://localhost/api/workflows/demo/execute",
      "http://localhost/api/sessions",
      "http://localhost/api/sessions/sess-1",
      "http://localhost/api/workflow-executions/sess-1",
    ]) {
      const response = await handleApiRequest(new Request(url), context);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: "not found",
      });
    }
  });
});

describe("resolveDefaultUiDistRoot", () => {
  test("resolves dist relative to built server modules", () => {
    const fakeBuiltModuleUrl = "file:///tmp/project/dist/server/api.js";
    expect(resolveDefaultUiDistRoot(fakeBuiltModuleUrl)).toBe(
      "/tmp/project/ui/dist",
    );
  });

  test("resolves dist relative to source server modules", () => {
    const fakeSourceModuleUrl = "file:///tmp/project/src/server/api.ts";
    expect(resolveDefaultUiDistRoot(fakeSourceModuleUrl)).toBe(
      "/tmp/project/ui/dist",
    );
  });
});
