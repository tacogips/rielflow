import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { MockNodeScenario } from "../workflow/adapter";
import { createWorkflowTemplate } from "../workflow/create";
import { runWorkflow } from "../workflow/engine";
import {
  createManagerSessionStore,
  hashManagerAuthToken,
} from "../workflow/manager-session-store";
import {
  saveEventReplyDispatchToRuntimeDb,
  saveHookEventToRuntimeDb,
} from "../workflow/runtime-db";
import { handleApiRequest } from "./api";
import { executeGraphqlDocument, handleGraphqlRequest } from "./graphql";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-server-graphql-test-"),
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

async function createWorkerOnlyWorkflowFixture(root: string) {
  const created = await createWorkflowTemplate("solo", {
    workflowRoot: root,
    templateMode: "worker-only",
  });
  expect(created.ok).toBe(true);
  if (!created.ok) {
    throw new Error(created.error.message);
  }

  return {
    options: {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    },
  };
}

async function createWorkflowCallWorkflowFixture(root: string) {
  const workflowDir = path.join(root, "workflow-calls");
  await mkdir(path.join(workflowDir, "nodes"), { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: "workflow-calls",
        description: "workflow-call http fixture",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        managerNodeId: "divedra-manager",
        workflowCalls: [
          {
            id: "review-call",
            workflowId: "review",
            callerNodeId: "main-worker",
          },
        ],
        nodes: [
          {
            id: "divedra-manager",
            role: "manager",
            nodeFile: "nodes/node-divedra-manager.json",
          },
          {
            id: "main-worker",
            role: "worker",
            nodeFile: "nodes/node-main-worker.json",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(workflowDir, "nodes", "node-divedra-manager.json"),
    `${JSON.stringify(
      {
        id: "divedra-manager",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "manager",
        variables: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(workflowDir, "nodes", "node-main-worker.json"),
    `${JSON.stringify(
      {
        id: "main-worker",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "worker",
        variables: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const reviewDir = path.join(root, "review");
  await mkdir(path.join(reviewDir, "nodes"), { recursive: true });
  await writeFile(
    path.join(reviewDir, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: "review",
        description: "workflow-call http callee fixture",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryNodeId: "reviewer",
        nodes: [
          {
            id: "reviewer",
            role: "worker",
            nodeFile: "nodes/node-reviewer.json",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(reviewDir, "nodes", "node-reviewer.json"),
    `${JSON.stringify(
      {
        id: "reviewer",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "review",
        variables: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    options: {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    },
  };
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
    managerNodeId: "divedra-manager",
    managerNodeExecId: "exec-000001",
    status: "active",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    authTokenHash: hashManagerAuthToken("secret"),
    authTokenExpiresAt: "2099-03-16T00:00:00.000Z",
  });
}

describe("GraphQL HTTP transport", () => {
  test("routes /graphql queries through the GraphQL control-plane handler", async () => {
    const root = await makeTempDir();
    const { options } = await createCompletedWorkflowFixture(root);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowByName($workflowName: String!) {
              workflow(workflowName: $workflowName) {
                workflowId
                hasManagerNode
                managerNodeId
                entryNodeId
                workflowCallIds
                counts {
                  nodes
                  workflowCalls
                }
              }
            }
          `,
          variables: {
            workflowName: "demo",
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        workflow: {
          workflowId: "demo",
          hasManagerNode: true,
          managerNodeId: "divedra-manager",
          entryNodeId: "divedra-manager",
          workflowCallIds: [],
          counts: {
            nodes: 2,
            workflowCalls: 0,
          },
        },
      },
    });
  });

  test("returns nullable managerNodeId for worker-only workflows over /graphql", async () => {
    const root = await makeTempDir();
    const { options } = await createWorkerOnlyWorkflowFixture(root);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowByName($workflowName: String!) {
              workflow(workflowName: $workflowName) {
                workflowId
                hasManagerNode
                managerNodeId
                entryNodeId
                workflowCallIds
                counts {
                  nodes
                  workflowCalls
                }
              }
            }
          `,
          variables: {
            workflowName: "solo",
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        workflow: {
          workflowId: "solo",
          hasManagerNode: false,
          managerNodeId: null,
          entryNodeId: "main-worker",
          workflowCallIds: [],
          counts: {
            nodes: 1,
            workflowCalls: 0,
          },
        },
      },
    });
  });

  test("exposes authored workflowCalls over /graphql workflow inspection", async () => {
    const root = await makeTempDir();
    const { options } = await createWorkflowCallWorkflowFixture(root);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowByName($workflowName: String!) {
              workflow(workflowName: $workflowName) {
                workflowId
                workflowCallIds
                counts {
                  workflowCalls
                  legacySubWorkflows
                }
              }
            }
          `,
          variables: {
            workflowName: "workflow-calls",
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        workflow: {
          workflowId: "workflow-calls",
          workflowCallIds: ["review-call"],
          counts: {
            workflowCalls: 1,
            legacySubWorkflows: 0,
          },
        },
      },
    });
  });

  test("exposes workflow execution summaries and async execute over /graphql", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);

    const listResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowExecutions($workflowName: String!, $first: Int!) {
              workflowExecutions(workflowName: $workflowName, first: $first) {
                totalCount
                items
              }
            }
          `,
          variables: {
            workflowName: "demo",
            first: 10,
          },
        }),
      }),
      options,
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      data: {
        workflowExecutions: {
          totalCount: 1,
          items: [
            {
              workflowExecutionId: session.sessionId,
              sessionId: session.sessionId,
              workflowName: "demo",
            },
          ],
        },
      },
    });

    const executeResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation ExecuteWorkflow($input: ExecuteWorkflowInput!) {
              executeWorkflow(input: $input) {
                workflowExecutionId
                sessionId
                status
                accepted
                exitCode
              }
            }
          `,
          variables: {
            input: {
              workflowName: "demo",
              async: true,
              runtimeVariables: {
                humanInput: {
                  request: "start demo workflow",
                },
              },
              mockScenario: makeDefaultTemplateScenario(),
            },
          },
        }),
      }),
      options,
    );

    expect(executeResponse.status).toBe(200);
    await expect(executeResponse.json()).resolves.toMatchObject({
      data: {
        executeWorkflow: {
          workflowExecutionId: expect.any(String),
          sessionId: expect.any(String),
          status: "running",
          accepted: true,
          exitCode: null,
        },
      },
    });
  });

  test("exposes workingDirectory on resume workflow execution GraphQL input", async () => {
    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query ResumeWorkflowExecutionInputFields {
              __type(name: "ResumeWorkflowExecutionInput") {
                inputFields {
                  name
                }
              }
            }
          `,
        }),
      }),
      {},
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        __type: {
          inputFields: expect.arrayContaining([
            { name: "workflowExecutionId" },
            { name: "workingDirectory" },
          ]),
        },
      },
    });
  });

  test("exposes workflow execution overview over /graphql", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await saveHookEventToRuntimeDb(
      {
        hookEventId: "hook-http-1",
        workflowId: session.workflowId,
        workflowExecutionId: session.sessionId,
        nodeId: "manager",
        nodeExecId: "manager-exec-1",
        vendor: "claude-code",
        agentSessionId: "agent-session-http",
        rawEventName: "SessionStart",
        eventName: "SessionStart",
        cwd: root,
        payloadHash: "b".repeat(64),
        status: "recorded",
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
      options,
    );
    await saveEventReplyDispatchToRuntimeDb(
      {
        idempotencyKey: "reply-http-key",
        sourceId: "webhook",
        provider: "webhook",
        workflowId: session.workflowId,
        workflowExecutionId: session.sessionId,
        nodeId: "reply-node",
        nodeExecId: "reply-exec-1",
        eventId: "event-http-1",
        conversationId: "conversation-http",
        status: "sent",
        providerMessageId: "message-http",
        requestJson: JSON.stringify({ message: { text: "hello" } }),
        responseJson: JSON.stringify({ providerMessageId: "message-http" }),
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
      options,
    );

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowExecutionOverview($workflowExecutionId: String!) {
              workflowExecutionOverview(workflowExecutionId: $workflowExecutionId) {
                workflowExecutionId
                workflowId
                workflowName
                status
                nodes {
                  nodeId
                  nodeExecId
                  backendSessionId
                  backendSessionMode
                  output
                  recentLogs {
                    message
                  }
                }
                communications {
                  totalCount
                  items {
                    record {
                      communicationId
                      fromNodeId
                      toNodeId
                      status
                    }
                    artifactSnapshot {
                      outboxMessageJson
                      outboxOutputRaw
                      inboxMessageJson
                    }
                  }
                }
                hookEvents {
                  agentSessionId
                  rawEventName
                  status
                }
                replyDispatches {
                  idempotencyKey
                  providerMessageId
                  status
                }
              }
            }
          `,
          variables: {
            workflowExecutionId: session.sessionId,
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      readonly data?: {
        readonly workflowExecutionOverview?: {
          readonly workflowExecutionId: string;
          readonly workflowId: string;
          readonly workflowName: string;
          readonly status: string;
          readonly nodes: readonly {
            readonly output: string | null;
            readonly recentLogs: readonly { readonly message: string }[];
          }[];
          readonly communications: {
            readonly totalCount: number;
            readonly items: readonly {
              readonly artifactSnapshot: {
                readonly outboxMessageJson: string | null;
                readonly outboxOutputRaw: string | null;
                readonly inboxMessageJson: string | null;
              };
            }[];
          };
          readonly hookEvents: readonly {
            readonly agentSessionId: string;
            readonly rawEventName: string;
            readonly status: string;
          }[];
          readonly replyDispatches: readonly {
            readonly idempotencyKey: string;
            readonly providerMessageId: string | null;
            readonly status: string;
          }[];
        };
      };
    };

    expect(payload.data?.workflowExecutionOverview?.workflowExecutionId).toBe(
      session.sessionId,
    );
    expect(payload.data?.workflowExecutionOverview?.workflowId).toBe("demo");
    expect(payload.data?.workflowExecutionOverview?.workflowName).toBe("demo");
    expect(payload.data?.workflowExecutionOverview?.status).toBe(
      session.status,
    );
    expect(
      payload.data?.workflowExecutionOverview?.communications.totalCount,
    ).toBeGreaterThan(0);
    expect(payload.data?.workflowExecutionOverview?.hookEvents).toEqual([
      {
        agentSessionId: "agent-session-http",
        rawEventName: "SessionStart",
        status: "recorded",
      },
    ]);
    expect(payload.data?.workflowExecutionOverview?.replyDispatches).toEqual([
      {
        idempotencyKey: "reply-http-key",
        providerMessageId: "message-http",
        status: "sent",
      },
    ]);
    expect(
      payload.data?.workflowExecutionOverview?.nodes.some(
        (node) =>
          node.output !== null &&
          node.output.includes("stage") &&
          node.recentLogs.length > 0,
      ),
    ).toBe(true);
    expect(
      payload.data?.workflowExecutionOverview?.communications.items.some(
        (item) =>
          item.artifactSnapshot.outboxOutputRaw !== null &&
          item.artifactSnapshot.inboxMessageJson !== null,
      ),
    ).toBe(true);
  });

  test("exposes workflow-definition list/load/create/save/validate over /graphql", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const createResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation CreateWorkflowDefinition($input: CreateWorkflowDefinitionInput!) {
              createWorkflowDefinition(input: $input) {
                workflowName
                revision
                bundle
              }
            }
          `,
          variables: {
            input: {
              workflowName: "demo",
            },
          },
        }),
      }),
      options,
    );
    expect(createResponse.status).toBe(200);
    const createJson = (await createResponse.json()) as {
      readonly data: {
        readonly createWorkflowDefinition: {
          readonly workflowName: string;
          readonly revision: string;
          readonly bundle: Record<string, unknown>;
        };
      };
    };
    expect(createJson).toMatchObject({
      data: {
        createWorkflowDefinition: {
          workflowName: "demo",
          revision: expect.any(String),
        },
      },
    });

    const listResponse = await handleGraphqlRequest(
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
      options,
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      data: {
        workflows: ["demo"],
      },
    });

    const loadResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowDefinition($workflowName: String!) {
              workflowDefinition(workflowName: $workflowName) {
                workflowName
                revision
                bundle
              }
            }
          `,
          variables: {
            workflowName: "demo",
          },
        }),
      }),
      options,
    );
    expect(loadResponse.status).toBe(200);
    const loadJson = (await loadResponse.json()) as {
      readonly data: {
        readonly workflowDefinition: {
          readonly workflowName: string;
          readonly revision: string;
          readonly bundle: Record<string, unknown>;
        };
      };
    };
    expect(loadJson).toMatchObject({
      data: {
        workflowDefinition: {
          workflowName: "demo",
          revision: expect.any(String),
        },
      },
    });

    const validBundle = cloneJson(loadJson.data.workflowDefinition.bundle) as {
      workflow: {
        description: string;
        nodes: unknown[];
      };
    } & Record<string, unknown>;
    validBundle.workflow.description = "Updated through GraphQL";
    const saveResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation SaveWorkflowDefinition($input: SaveWorkflowDefinitionInput!) {
              saveWorkflowDefinition(input: $input) {
                workflowName
                workflowDirectory
                revision
                error
                currentRevision
              }
            }
          `,
          variables: {
            input: {
              workflowName: "demo",
              bundle: validBundle,
            },
          },
        }),
      }),
      options,
    );
    expect(saveResponse.status).toBe(200);
    await expect(saveResponse.json()).resolves.toMatchObject({
      data: {
        saveWorkflowDefinition: {
          workflowName: "demo",
          revision: expect.any(String),
          error: null,
        },
      },
    });

    const savedWorkflowJson = await readFile(
      path.join(root, "demo", "workflow.json"),
      "utf8",
    );
    expect(savedWorkflowJson).toContain(
      '"description": "Updated through GraphQL"',
    );

    const invalidBundle = cloneJson(validBundle) as typeof validBundle;
    invalidBundle.workflow.nodes = [];
    const validateResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation ValidateWorkflowDefinition($input: ValidateWorkflowDefinitionInput!) {
              validateWorkflowDefinition(input: $input) {
                valid
                issues
              }
            }
          `,
          variables: {
            input: {
              workflowName: "demo",
              bundle: invalidBundle,
            },
          },
        }),
      }),
      options,
    );
    expect(validateResponse.status).toBe(200);
    await expect(validateResponse.json()).resolves.toMatchObject({
      data: {
        validateWorkflowDefinition: {
          valid: false,
          issues: expect.any(Array),
        },
      },
    });
  });

  test("creates worker-only workflow definitions over /graphql", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const createResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation CreateWorkflowDefinition($input: CreateWorkflowDefinitionInput!) {
              createWorkflowDefinition(input: $input) {
                workflowName
                bundle
              }
            }
          `,
          variables: {
            input: {
              workflowName: "solo",
              templateMode: "WORKER_ONLY",
            },
          },
        }),
      }),
      options,
    );
    expect(createResponse.status).toBe(200);
    const createJson = (await createResponse.json()) as {
      readonly data: {
        readonly createWorkflowDefinition: {
          readonly workflowName: string;
          readonly bundle: {
            readonly workflow: {
              readonly hasManagerNode: boolean;
              readonly managerNodeId: string;
              readonly entryNodeId: string;
            };
          };
        };
      };
    };
    expect(createJson).toMatchObject({
      data: {
        createWorkflowDefinition: {
          workflowName: "solo",
          bundle: {
            workflow: {
              hasManagerNode: false,
              managerNodeId: "main-worker",
              entryNodeId: "main-worker",
            },
          },
        },
      },
    });

    const workflowJsonText = await readFile(
      path.join(root, "solo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerNodeId"');
    expect(workflowJsonText).toContain('"entryNodeId": "main-worker"');
  });

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
              actions: [{ type: "retry-node", nodeId: "main-worker" }],
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
              kind: "retry-node",
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
              actions: [{ type: "retry-node", nodeId: "main-worker" }],
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
              actions: [{ type: "retry-node", nodeId: "main-worker" }],
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
          DIVEDRA_MANAGER_NODE_ID: "divedra-manager",
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
              actions: [{ type: "retry-node", nodeId: "main-worker" }],
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
            actions: [{ type: "retry-node", nodeId: "main-worker" }],
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
