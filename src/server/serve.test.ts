import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowTemplate } from "../workflow/create";
import { createSessionState } from "../workflow/session";
import { saveSession } from "../workflow/session-store";
import { BROWSER_WORKFLOW_OVERVIEW_RECENT_LIMIT, handleApiRequest } from "./api";
import { startServe } from "./serve";

describe("startServe", () => {
  test("uses 43173 as the default serve port", async () => {
    let capturedPort = -1;

    const started = await startServe(
      {
        host: "127.0.0.1",
      },
      {
        serve: ({ port }) => {
          capturedPort = port;
          return {
            port,
            stop: () => {},
          };
        },
      },
    );

    expect(started.host).toBe("127.0.0.1");
    expect(capturedPort).toBe(43173);
    expect(started.port).toBe(43173);
  });

  test("allocates a concrete port when port 0 is requested", async () => {
    let capturedPort = -1;

    const started = await startServe(
      {
        host: "127.0.0.1",
        port: 0,
      },
      {
        serve: ({ port }) => {
          capturedPort = port;
          return {
            port: 48321,
            stop: () => {},
          };
        },
      },
    );

    expect(started.host).toBe("127.0.0.1");
    expect(capturedPort).toBe(0);
    expect(started.port).toBe(48321);
  });

  test("surfaces runtime listen failures for port-0 binds without masking them", async () => {
    await expect(
      startServe(
        {
          host: "127.0.0.1",
          port: 0,
        },
        {
          serve: () => {
            throw new Error("Failed to listen at 127.0.0.1");
          },
        },
      ),
    ).rejects.toThrow("Failed to listen at 127.0.0.1");
  });

  test("retries port-0 serve startup with a concrete ephemeral port when the runtime rejects port 0", async () => {
    const attemptedPorts: number[] = [];

    const started = await startServe(
      {
        host: "127.0.0.1",
        port: 0,
      },
      {
        serve: ({ port }) => {
          attemptedPorts.push(port);
          if (port === 0) {
            const error = new Error(
              "Failed to start server. Is port 0 in use?",
            ) as Error & { code?: string };
            error.code = "EADDRINUSE";
            throw error;
          }

          return {
            port,
            stop: () => {},
          };
        },
        reservePort: async () => 48321,
      },
    );

    expect(attemptedPorts[0]).toBe(0);
    expect(attemptedPorts[1]).toBe(48321);
    expect(started.port).toBe(48321);
  });

  test("reports the actual bound port from the server", async () => {
    const started = await startServe(
      {
        host: "127.0.0.1",
        port: 41000,
      },
      {
        serve: () => ({
          port: 41001,
          stop: () => {},
        }),
      },
    );

    expect(started.port).toBe(41001);
  });

  test("rejects negative ports", async () => {
    await expect(
      startServe(
        {
          host: "127.0.0.1",
          port: -1,
        },
        {
          serve: ({ port }) => ({
            port,
            stop: () => {},
          }),
        },
      ),
    ).rejects.toThrow("invalid serve port '-1'");
  });

  test("rejects invalid serve port values coming from the environment", async () => {
    await expect(
      startServe(
        {
          host: "127.0.0.1",
          env: {
            DIVEDRA_SERVE_PORT: "abc",
          },
        },
        {
          serve: ({ port }) => ({
            port,
            stop: () => {},
          }),
        },
      ),
    ).rejects.toThrow("invalid serve port 'abc'");
  });

  test("rejects non-integer ports", async () => {
    await expect(
      startServe(
        {
          host: "127.0.0.1",
          port: 5173.5,
        },
        {
          serve: ({ port }) => ({
            port,
            stop: () => {},
          }),
        },
      ),
    ).rejects.toThrow("invalid serve port '5173.5'");
  });
});

describe("handleApiRequest workflow overview routes", () => {
  const tempDirs: string[] = [];

  async function makeTempDir(): Promise<string> {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "divedra-serve-overview-"),
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

  test("GET /overview returns workflow overview JSON without runtime detail fields", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }
    const sessionStoreRoot = path.join(root, "sessions");
    const response = await handleApiRequest(
      new Request("http://127.0.0.1/overview"),
      {
        workflowRoot: root,
        sessionStoreRoot,
        cwd: root,
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly workflows: readonly { readonly workflowName: string }[];
      readonly selectedWorkflow: { readonly recentExecutions: unknown[] } | null;
    };
    expect(body.workflows.length).toBeGreaterThanOrEqual(1);
    expect(body.selectedWorkflow).not.toBeNull();
    expect(Array.isArray(body.selectedWorkflow?.recentExecutions)).toBe(true);
  });

  test("GET / serves HTML overview page that reads JSON from /overview", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }
    const page = await handleApiRequest(new Request("http://127.0.0.1/"), {
      workflowRoot: root,
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("/overview");
    expect(html).toContain("workflow overview");
  });

  test("overview JSON caps recent executions at the browser default limit", async () => {
    const root = await makeTempDir();
    const workflowName = "demo";
    const created = await createWorkflowTemplate(workflowName, {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }
    const sessionStoreRoot = path.join(root, "sessions");
    const workflowId = workflowName;
    const extras = BROWSER_WORKFLOW_OVERVIEW_RECENT_LIMIT + 2;
    const baseOpts = {
      workflowRoot: root,
      sessionStoreRoot,
      cwd: root,
    };
    for (let i = 0; i < extras; i += 1) {
      const sessionId = `sess-${String(i).padStart(3, "0")}`;
      await saveSession(
        {
          ...createSessionState({
            sessionId,
            workflowName,
            workflowId,
            initialNodeId: "divedra-manager",
            runtimeVariables: {},
          }),
          startedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
          status: "completed",
          endedAt: new Date(Date.UTC(2026, 0, 2 + i)).toISOString(),
        },
        baseOpts,
      );
    }
    const response = await handleApiRequest(
      new Request("http://127.0.0.1/overview"),
      baseOpts,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly selectedWorkflow: { readonly recentExecutions: readonly unknown[] };
    };
    expect(body.selectedWorkflow.recentExecutions).toHaveLength(
      BROWSER_WORKFLOW_OVERVIEW_RECENT_LIMIT,
    );
  });

  test("normalizes trailing slash on /overview path", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("solo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    const response = await handleApiRequest(
      new Request("http://127.0.0.1/overview/"),
      {
        workflowRoot: root,
        sessionStoreRoot: path.join(root, "sessions"),
        cwd: root,
      },
    );
    expect(response.status).toBe(200);
  });

  test("rejects non-GET methods for overview route", async () => {
    const root = await makeTempDir();
    const response = await handleApiRequest(
      new Request("http://127.0.0.1/", { method: "POST" }),
      {
        workflowRoot: root,
        cwd: root,
      },
    );
    expect(response.status).toBe(405);
  });
});