import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { handleApiRequest } from "./api";
import {
  WORKFLOW_VIEWER_DOCUMENT_PATHS,
  WORKFLOW_VIEWER_SCRIPT_PATH,
} from "./web-viewer";
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

  test("serves the read-only workflow viewer shell from web document paths", async () => {
    const root = await makeTempDir();
    await createWorkflowTemplate("demo", { workflowRoot: root });
    const context = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      fixedWorkflowName: "demo",
      readOnly: true,
      noExec: true,
    };

    for (const pathname of [...WORKFLOW_VIEWER_DOCUMENT_PATHS, "/web/"]) {
      const response = await handleApiRequest(
        new Request(`http://localhost${pathname}`),
        context,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const html = await response.text();
      expect(html).toContain(
        `<script type="module" src="${WORKFLOW_VIEWER_SCRIPT_PATH}">`,
      );
      expect(html).toContain('"fixedWorkflowName":"demo"');
      expect(html).toContain('"readOnly":true');
    }
  });

  test("serves the bundled workflow viewer browser script", async () => {
    const root = await makeTempDir();
    await createWorkflowTemplate("demo", { workflowRoot: root });

    const response = await handleApiRequest(
      new Request(`http://localhost${WORKFLOW_VIEWER_SCRIPT_PATH}`),
      {
        workflowRoot: root,
        artifactRoot: path.join(root, "artifacts"),
        sessionStoreRoot: path.join(root, "sessions"),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const script = await response.text();
    expect(script).toContain("document.getElementById");
    expect(script).toContain("Workflow node graph");
    expect(script).not.toContain("React.createElement");
    expect(script).not.toContain("workflow viewer failed to load");
  });

  test("returns 404 for removed REST routes", async () => {
    const root = await makeTempDir();
    const context = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
    };

    for (const url of [
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
