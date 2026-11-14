import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MockNodeScenario } from "../workflow/scenario-adapter";
import { createWorkflowTemplate } from "../workflow/create";
import { runWorkflow } from "../workflow/engine";
import {
  createManagerSessionStore,
  hashManagerAuthToken,
} from "../workflow/manager-session-store";
import { handleApiRequest } from "./api";
import { executeGraphqlDocument, handleGraphqlRequest } from "./graphql";
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-server-graphql-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function makeDefaultTemplateScenario(): MockNodeScenario {
  return {
    "divedra-manager": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "design" },
    },
    "main-worker": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "implement" },
    },
  };
}
async function createCompletedWorkflowFixture(root: string) {
  const created = await createWorkflowTemplate("demo", {
    workflowRoot: root,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) {
    throw new Error(created.error.message);
  }

  const options = {
    workflowRoot: root,
    artifactRoot: path.join(root, "artifacts"),
    rootDataDir: path.join(root, "data"),
    cwd: root,
  };
  const result = await runWorkflow("demo", {
    ...options,
    runtimeVariables: {
      humanInput: {
        request: "start demo workflow",
      },
    },
    mockScenario: makeDefaultTemplateScenario(),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return { options, session: result.value.session };
}
async function createManagerSession(root: string, workflowExecutionId: string) {
  const store = createManagerSessionStore({
    cwd: root,
    rootDataDir: path.join(root, "data"),
  });
  await store.createOrResumeSession({
    managerSessionId: "mgrsess-000001",
    workflowId: "demo",
    workflowExecutionId,
    managerStepId: "divedra-manager",
    managerNodeExecId: "exec-000001",
    status: "active",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    authTokenHash: hashManagerAuthToken("secret"),
    authTokenExpiresAt: "2099-03-16T00:00:00.000Z",
  });
}
describe("GraphQL HTTP transport", () => {
  test("authenticates manager mutations over /graphql with bearer auth", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer secret",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
                managerSessionId
                queuedNodeIds
                parsedIntent {
                  kind
                  targetId
                }
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              managerSessionId: "mgrsess-000001",
              message: "Retry the main worker node.",
              actions: [{ type: "retry-step", stepId: "main-worker" }],
              idempotencyKey: "idem-http-send",
            },
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        sendManagerMessage: {
          accepted: true,
          managerSessionId: "mgrsess-000001",
          queuedNodeIds: ["main-worker"],
          parsedIntent: [
            {
              kind: "retry-step",
              targetId: "main-worker",
            },
          ],
        },
      },
    });
  });

  test("uses forwarded ambient manager session context for manager mutations", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer secret",
          "x-divedra-manager-session-id": "mgrsess-000001",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
                managerSessionId
                queuedNodeIds
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              message: "Retry the main worker node.",
              actions: [{ type: "retry-step", stepId: "main-worker" }],
              idempotencyKey: "idem-http-ambient-send",
            },
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        sendManagerMessage: {
          accepted: true,
          managerSessionId: "mgrsess-000001",
          queuedNodeIds: ["main-worker"],
        },
      },
    });
  });

  test("does not inherit manager auth from server-local ambient env for HTTP requests", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              message: "Retry the main worker node.",
              actions: [{ type: "retry-step", stepId: "main-worker" }],
              idempotencyKey: "idem-http-no-env-fallback",
            },
          },
        }),
      }),
      {
        ...options,
        env: {
          DIVEDRA_MANAGER_AUTH_TOKEN: "secret",
          DIVEDRA_MANAGER_SESSION_ID: "mgrsess-000001",
          DIVEDRA_WORKFLOW_ID: "demo",
          DIVEDRA_WORKFLOW_EXECUTION_ID: session.sessionId,
          DIVEDRA_MANAGER_STEP_ID: "divedra-manager",
          DIVEDRA_MANAGER_NODE_EXEC_ID: "exec-000001",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      errors: [
        {
          message:
            "managerSessionId is required for manager-scoped GraphQL operations",
        },
      ],
    });
  });

  test("does not trust caller-provided GraphQL context auth fallback for HTTP requests", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              message: "Retry the main worker node.",
              actions: [{ type: "retry-step", stepId: "main-worker" }],
              idempotencyKey: "idem-http-no-context-fallback",
            },
          },
        }),
      }),
      {
        ...options,
        authToken: "secret",
        managerSessionId: "mgrsess-000001",
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      errors: [
        {
          message:
            "managerSessionId is required for manager-scoped GraphQL operations",
        },
      ],
    });
  });

  test("preserves direct in-process manager auth context for executeGraphqlDocument", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const result = await executeGraphqlDocument(
      `
        mutation SendMessage($input: SendManagerMessageInput!) {
          sendManagerMessage(input: $input) {
            accepted
            managerSessionId
            queuedNodeIds
          }
        }
      `,
      {
        ...options,
        authToken: "secret",
        managerSessionId: "mgrsess-000001",
      },
      {
        variables: {
          input: {
            workflowId: "demo",
            workflowExecutionId: session.sessionId,
            message: "Retry the main worker node.",
            actions: [{ type: "retry-step", stepId: "main-worker" }],
            idempotencyKey: "idem-direct-context-auth",
          },
        },
      },
    );

    expect(result).toMatchObject({
      sendManagerMessage: {
        accepted: true,
        managerSessionId: "mgrsess-000001",
        queuedNodeIds: ["main-worker"],
      },
    });
  });

  test("rejects removed managerRuntimeId field on sendManagerMessage GraphQL input", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer secret",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              managerSessionId: "mgrsess-000001",
              managerRuntimeId: "divedra-manager",
              message: "Retry the main worker node.",
              actions: [{ type: "retry-step", stepId: "main-worker" }],
            },
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toBeNull();
    expect(payload.errors).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          'Field "managerRuntimeId" is not defined by type "SendManagerMessageInput"',
        ),
      }),
    ]);
  });

  test("rejects manager attachments outside the authenticated workflow execution namespace", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const foreignAttachmentDir = path.join(
      options.rootDataDir,
      "files",
      "demo",
      "wfexec-foreign",
      "attachments",
    );
    await mkdir(foreignAttachmentDir, { recursive: true });
    await writeFile(
      path.join(foreignAttachmentDir, "foreign.txt"),
      "foreign",
      "utf8",
    );

    const response = await handleApiRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer secret",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              managerSessionId: "mgrsess-000001",
              message: "Inspect the unrelated file.",
              attachments: [
                {
                  path: "files/demo/wfexec-foreign/attachments/foreign.txt",
                  mediaType: "text/plain",
                },
              ],
            },
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      errors: [
        {
          message: `attachment path must stay within files/demo/${session.sessionId}/`,
        },
      ],
    });
  });
});
