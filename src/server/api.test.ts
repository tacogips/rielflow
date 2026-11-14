import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { handleApiRequest } from "./api";
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
  test("returns health information from the local control plane", async () => {
    const root = await makeTempDir();
    await createWorkflowTemplate("demo", { workflowRoot: root });

    const response = await handleApiRequest(
      new Request("http://localhost/healthz"),
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "divedra-serve",
      status: "ok",
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

  test("returns 404 for removed REST routes", async () => {
    const root = await makeTempDir();
    await createWorkflowTemplate("demo", { workflowRoot: root });
    const context = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };

    const overviewResponse = await handleApiRequest(
      new Request("http://localhost/overview"),
      context,
    );
    expect(overviewResponse.status).toBe(200);
    await expect(overviewResponse.json()).resolves.toMatchObject({
      workflows: expect.any(Array),
      selectedWorkflow: expect.anything(),
    });

    const rootPage = await handleApiRequest(new Request("http://localhost/"), context);
    expect(rootPage.status).toBe(200);
    expect(rootPage.headers.get("content-type")).toContain("text/html");
    await expect(rootPage.text()).resolves.toContain("workflow overview");

    for (const url of [
      "http://localhost/web",
      "http://localhost/web/",
      "http://localhost/ui",
      "http://localhost/api/ui-config",
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
