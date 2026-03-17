import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  CancelWorkflowExecutionResponse,
  ExecuteWorkflowRequest,
  SaveWorkflowResponse,
  ValidationResponse,
  WorkflowExecutionStateResponse,
  WorkflowExecutionSummary,
  WorkflowResponse,
} from "../../../src/shared/ui-contract";
import type { ValidationIssue } from "../../../src/workflow/types";
import type { EditorWorkflowBundle } from "./editor-workflow";
import {
  cancelWorkflowExecution,
  createWorkflow,
  executeWorkflow,
  listSessions,
  listWorkflows,
  loadWorkflowExecution,
  loadWorkflow,
  saveWorkflowBundle,
  validateWorkflowBundle,
  WorkflowRevisionConflictError,
  WorkflowSaveValidationError,
} from "./api-client";

const originalFetch = globalThis.fetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function makeWorkflowResponse(workflowName = "demo"): WorkflowResponse {
  return {
    workflowName,
    workflowDirectory: `/virtual/workflows/${workflowName}`,
    artifactWorkflowRoot: `/virtual/artifacts/${workflowName}`,
    revision: `sha256:${workflowName}-rev-1`,
    bundle: {
      workflow: {
        workflowId: workflowName,
        description: "Demo workflow",
        defaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        managerNodeId: "oyakata-manager",
        subWorkflows: [],
        nodes: [
          {
            id: "oyakata-manager",
            nodeFile: "node-oyakata-manager.json",
            kind: "root-manager",
            completion: { type: "none" },
          },
        ],
        edges: [],
        loops: [],
        branching: { mode: "fan-out" },
      },
      workflowVis: {
        nodes: [{ id: "oyakata-manager", order: 0 }],
      },
      nodePayloads: {
        "oyakata-manager": {
          id: "oyakata-manager",
          model: "gpt-5",
          promptTemplate: "Coordinate",
          variables: {},
        },
      },
    },
    derivedVisualization: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

describe("api-client GraphQL session transport", () => {
  test("lists workflows through GraphQL", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: {
          workflows: ["alpha", "demo"],
        },
      }),
    );
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const result = await listWorkflows();

    expect(result).toEqual({ workflows: ["alpha", "demo"] });
    const call = fetchMock.mock.calls[0] as
      | [string, RequestInit | undefined]
      | undefined;
    expect(call).toBeDefined();
    if (call === undefined) {
      return;
    }
    const body = JSON.parse(String(call[1]?.body)) as {
      readonly query: string;
    };
    expect(body.query).toContain("workflows");
  });

  test("loads and creates workflow definitions through GraphQL", async () => {
    const workflow = makeWorkflowResponse();
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        readonly query: string;
      };
      if (body.query.includes("createWorkflowDefinition")) {
        return jsonResponse({
          data: {
            createWorkflowDefinition: workflow,
          },
        });
      }
      return jsonResponse({
        data: {
          workflowDefinition: workflow,
        },
      });
    });
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    await expect(loadWorkflow("demo")).resolves.toEqual(workflow);
    await expect(createWorkflow("demo")).resolves.toEqual(workflow);
  });

  test("validates workflow bundles through GraphQL", async () => {
    const payload: ValidationResponse = {
      valid: true,
      workflowId: "demo",
      warnings: [],
      issues: [],
    };
    const workflow = makeWorkflowResponse();
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      jsonResponse({
        data: {
          validateWorkflowDefinition: payload,
        },
      }),
    ) as unknown as typeof fetch;

    await expect(
      validateWorkflowBundle(
        "demo",
        workflow.bundle as unknown as EditorWorkflowBundle,
      ),
    ).resolves.toEqual(payload);
  });

  test("saves workflow bundles through GraphQL and preserves conflict handling", async () => {
    const successPayload: SaveWorkflowResponse = {
      workflowName: "demo",
      workflowDirectory: "/virtual/workflows/demo",
      revision: "sha256:demo-rev-2",
    };
    const workflow = makeWorkflowResponse();
    let conflict = false;
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: {
          saveWorkflowDefinition: conflict
            ? {
                workflowName: "demo",
                error: "workflow revision conflict",
                currentRevision: "sha256:demo-rev-3",
              }
            : successPayload,
        },
      }),
    );
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    await expect(
      saveWorkflowBundle({
        workflowName: "demo",
        bundle: workflow.bundle as unknown as EditorWorkflowBundle,
        ...(workflow.revision === null
          ? {}
          : { expectedRevision: workflow.revision }),
      }),
    ).resolves.toEqual(successPayload);

    conflict = true;
    await expect(
      saveWorkflowBundle({
        workflowName: "demo",
        bundle: workflow.bundle as unknown as EditorWorkflowBundle,
        ...(workflow.revision === null
          ? {}
          : { expectedRevision: workflow.revision }),
      }),
    ).rejects.toBeInstanceOf(WorkflowRevisionConflictError);
  });

  test("surfaces save validation issues through GraphQL", async () => {
    const workflow = makeWorkflowResponse();
    const issues: readonly ValidationIssue[] = [
      {
        severity: "error",
        path: "workflow.nodes[0].id",
        message: "duplicate node id",
      },
    ];
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: {
          saveWorkflowDefinition: {
            workflowName: "demo",
            error: "workflow bundle is invalid",
            issues,
          },
        },
      }),
    );
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    await expect(
      saveWorkflowBundle({
        workflowName: "demo",
        bundle: workflow.bundle as unknown as EditorWorkflowBundle,
        ...(workflow.revision === null
          ? {}
          : { expectedRevision: workflow.revision }),
      }),
    ).rejects.toMatchObject({
      name: "WorkflowSaveValidationError",
      message: "workflow bundle is invalid",
      issues,
    } satisfies Partial<WorkflowSaveValidationError>);

    const call = fetchMock.mock.calls[0] as
      | [string, RequestInit | undefined]
      | undefined;
    expect(call).toBeDefined();
    if (call === undefined) {
      return;
    }
    const body = JSON.parse(String(call[1]?.body)) as {
      readonly query: string;
    };
    expect(body.query).toContain("issues");
  });

  test("lists sessions through GraphQL", async () => {
    const summary: WorkflowExecutionSummary = {
      workflowExecutionId: "exec-1",
      sessionId: "exec-1",
      workflowName: "demo",
      status: "running",
      currentNodeId: "worker-1",
      nodeExecutionCounter: 1,
      startedAt: "2026-03-15T01:00:00.000Z",
      endedAt: null,
    };
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: {
          workflowExecutions: {
            items: [summary],
            totalCount: 1,
          },
        },
      }),
    );
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const result = await listSessions();

    expect(result).toEqual({ sessions: [summary] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as
      | [string, RequestInit | undefined]
      | undefined;
    expect(call).toBeDefined();
    if (call === undefined) {
      return;
    }
    const [input, init] = call;
    expect(input).toBe("/graphql");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as {
      readonly query: string;
      readonly variables: { readonly first: number };
    };
    expect(body.query).toContain("workflowExecutions");
    expect(body.variables.first).toBe(500);
  });

  test("loads a workflow execution through GraphQL and preserves the browser shape", async () => {
    const session: Omit<WorkflowExecutionStateResponse, "workflowExecutionId"> =
      {
        sessionId: "exec-1",
        workflowName: "demo",
        workflowId: "demo",
        status: "paused",
        startedAt: "2026-03-15T01:00:00.000Z",
        queue: [],
        currentNodeId: "worker-1",
        nodeExecutionCounter: 1,
        nodeExecutionCounts: {},
        transitions: [],
        nodeExecutions: [],
        communicationCounter: 0,
        communications: [],
        runtimeVariables: {},
      };
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      jsonResponse({
        data: {
          workflowExecution: {
            workflowExecutionId: "exec-1",
            session,
          },
        },
      }),
    ) as unknown as typeof fetch;

    const result = await loadWorkflowExecution("exec-1");

    expect(result).toEqual({
      workflowExecutionId: "exec-1",
      ...session,
    });
  });

  test("raises ApiError when the GraphQL workflow execution lookup returns null", async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () =>
      jsonResponse({
        data: {
          workflowExecution: null,
        },
      }),
    ) as unknown as typeof fetch;

    await expect(loadWorkflowExecution("missing-exec")).rejects.toMatchObject({
      status: 404,
      payload: {
        error: "workflow execution 'missing-exec' was not found",
      },
    });
  });

  test("executes and cancels workflows through GraphQL", async () => {
    const executeRequest: ExecuteWorkflowRequest = {
      runtimeVariables: {
        topic: "demo",
      },
      async: true,
      mockScenario: {
        "oyakata-manager": {
          provider: "scenario-mock",
          when: {
            always: true,
          },
          payload: {
            stage: "design",
          },
        },
      },
      maxSteps: 1,
      defaultTimeoutMs: 2000,
    };
    const cancelPayload: CancelWorkflowExecutionResponse = {
      accepted: true,
      workflowExecutionId: "exec-2",
      sessionId: "exec-2",
      status: "cancelled",
    };
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        readonly query: string;
      };
      if (body.query.includes("executeWorkflow")) {
        return jsonResponse({
          data: {
            executeWorkflow: {
              workflowExecutionId: "exec-2",
              sessionId: "exec-2",
              status: "running",
              accepted: true,
            },
          },
        });
      }
      return jsonResponse({
        data: {
          cancelWorkflowExecution: cancelPayload,
        },
      });
    });
    (globalThis as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;

    const executeResult = await executeWorkflow("demo", executeRequest);
    const cancelResult = await cancelWorkflowExecution("exec-2");

    expect(executeResult).toEqual({
      workflowExecutionId: "exec-2",
      sessionId: "exec-2",
      status: "running",
      accepted: true,
    });
    expect(cancelResult).toEqual(cancelPayload);

    const executeBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as {
      readonly variables: {
        readonly input: Readonly<Record<string, unknown>>;
      };
    };
    expect(executeBody.variables.input).toMatchObject({
      workflowName: "demo",
      async: true,
      mockScenario: executeRequest.mockScenario,
      maxSteps: 1,
      defaultTimeoutMs: 2000,
    });

    const cancelBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as {
      readonly query: string;
      readonly variables: {
        readonly input: {
          readonly workflowExecutionId: string;
        };
      };
    };
    expect(cancelBody.query).toContain("cancelWorkflowExecution");
    expect(cancelBody.variables.input.workflowExecutionId).toBe("exec-2");
  });
});
