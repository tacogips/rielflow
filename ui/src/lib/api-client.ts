import type {
  CancelWorkflowExecutionResponse,
  CreateWorkflowRequest,
  ErrorResponse,
  ExecuteWorkflowRequest,
  ExecuteWorkflowResponse,
  SaveWorkflowRequest,
  SaveWorkflowResponse,
  SessionsResponse,
  UiConfigResponse,
  ValidateWorkflowRequest,
  ValidationResponse,
  WorkflowExecutionStateResponse,
  WorkflowListResponse,
  WorkflowResponse,
} from "../../../src/shared/ui-contract";
import type { ValidationIssue } from "../../../src/workflow/types";
import type { EditorWorkflowBundle } from "./editor-workflow";

interface GraphqlErrorResponse {
  readonly message: string;
}

interface GraphqlEnvelope<TData> {
  readonly data?: TData;
  readonly errors?: readonly GraphqlErrorResponse[];
}

interface WorkflowExecutionsGraphqlData {
  readonly workflowExecutions: {
    readonly items: readonly SessionsResponse["sessions"][number][];
  };
}

interface WorkflowsGraphqlData {
  readonly workflows: readonly string[];
}

interface WorkflowDefinitionGraphqlData {
  readonly workflowDefinition: WorkflowResponse | null;
}

interface CreateWorkflowDefinitionGraphqlData {
  readonly createWorkflowDefinition: WorkflowResponse;
}

interface SaveWorkflowDefinitionGraphqlData {
  readonly saveWorkflowDefinition: SaveWorkflowResponse &
    ErrorResponse & {
      readonly issues?: readonly ValidationIssue[];
    };
}

interface ValidateWorkflowDefinitionGraphqlData {
  readonly validateWorkflowDefinition: ValidationResponse;
}

interface WorkflowExecutionGraphqlData {
  readonly workflowExecution: {
    readonly workflowExecutionId: string;
    readonly session: Omit<
      WorkflowExecutionStateResponse,
      "workflowExecutionId"
    >;
  } | null;
}

interface ExecuteWorkflowGraphqlData {
  readonly executeWorkflow: ExecuteWorkflowResponse;
}

interface CancelWorkflowExecutionGraphqlData {
  readonly cancelWorkflowExecution: CancelWorkflowExecutionResponse;
}

const GRAPHQL_ENDPOINT = "/graphql";

const WORKFLOW_EXECUTION_SESSION_QUERY = `
  query WorkflowExecution($workflowExecutionId: String!) {
    workflowExecution(workflowExecutionId: $workflowExecutionId) {
      workflowExecutionId
      session {
        sessionId
        workflowName
        workflowId
        status
        startedAt
        endedAt
        queue
        currentNodeId
        nodeExecutionCounter
        nodeExecutionCounts
        loopIterationCounts
        restartCounts
        restartEvents
        transitions {
          from
          to
          when
        }
        nodeExecutions {
          nodeId
          nodeExecId
          status
          artifactDir
          startedAt
          endedAt
          attempt
          outputAttemptCount
          outputValidationErrors
          backendSessionId
          backendSessionMode
          restartedFromNodeExecId
        }
        communicationCounter
        communications
        conversationTurns
        nodeBackendSessions
        runtimeVariables
        lastError
      }
    }
  }
`;

const WORKFLOWS_QUERY = `
  query Workflows {
    workflows
  }
`;

const WORKFLOW_DEFINITION_QUERY = `
  query WorkflowDefinition($workflowName: String!) {
    workflowDefinition(workflowName: $workflowName) {
      workflowName
      workflowDirectory
      artifactWorkflowRoot
      revision
      bundle
      derivedVisualization
    }
  }
`;

const CREATE_WORKFLOW_DEFINITION_MUTATION = `
  mutation CreateWorkflowDefinition($input: CreateWorkflowDefinitionInput!) {
    createWorkflowDefinition(input: $input) {
      workflowName
      workflowDirectory
      artifactWorkflowRoot
      revision
      bundle
      derivedVisualization
    }
  }
`;

const SAVE_WORKFLOW_DEFINITION_MUTATION = `
  mutation SaveWorkflowDefinition($input: SaveWorkflowDefinitionInput!) {
    saveWorkflowDefinition(input: $input) {
      workflowName
      workflowDirectory
      revision
      error
      currentRevision
      issues
    }
  }
`;

const VALIDATE_WORKFLOW_DEFINITION_MUTATION = `
  mutation ValidateWorkflowDefinition($input: ValidateWorkflowDefinitionInput!) {
    validateWorkflowDefinition(input: $input) {
      valid
      workflowId
      warnings
      issues
      error
    }
  }
`;

const WORKFLOW_EXECUTIONS_QUERY = `
  query WorkflowExecutions($first: Int) {
    workflowExecutions(first: $first) {
      items
      totalCount
      nextCursor
    }
  }
`;

const EXECUTE_WORKFLOW_MUTATION = `
  mutation ExecuteWorkflow($input: ExecuteWorkflowInput!) {
    executeWorkflow(input: $input) {
      workflowExecutionId
      sessionId
      status
      accepted
      exitCode
    }
  }
`;

const CANCEL_WORKFLOW_EXECUTION_MUTATION = `
  mutation CancelWorkflowExecution($input: CancelWorkflowExecutionInput!) {
    cancelWorkflowExecution(input: $input) {
      accepted
      workflowExecutionId
      sessionId
      status
    }
  }
`;

export class ApiError extends Error {
  readonly status: number;
  readonly payload: ErrorResponse;

  constructor(status: number, payload: ErrorResponse) {
    super(
      typeof payload.error === "string"
        ? payload.error
        : `request failed: ${status}`,
    );
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export class WorkflowRevisionConflictError extends Error {
  readonly currentRevision: string;

  constructor(currentRevision: string) {
    super(
      `Workflow revision conflict. Current revision is ${currentRevision}. Reload and retry.`,
    );
    this.name = "WorkflowRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

export class WorkflowSaveValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[]) {
    super(message);
    this.name = "WorkflowSaveValidationError";
    this.issues = issues;
  }
}

async function readJsonResponse<T>(
  response: Response,
): Promise<T & ErrorResponse> {
  return (await response.json()) as T & ErrorResponse;
}

function throwApiError(response: Response, payload: ErrorResponse): never {
  throw new ApiError(response.status, payload);
}

async function fetchJson<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const payload = await readJsonResponse<T>(response);
  if (!response.ok) {
    throwApiError(response, payload);
  }
  return payload;
}

async function fetchGraphqlData<TData>(
  document: string,
  variables?: Readonly<Record<string, unknown>>,
  init?: RequestInit,
): Promise<TData> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers === undefined
        ? {}
        : Object.fromEntries(new Headers(init.headers).entries())),
    },
    body: JSON.stringify({
      query: document,
      ...(variables === undefined ? {} : { variables }),
    }),
  });
  const payload = await readJsonResponse<GraphqlEnvelope<TData>>(response);
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? "GraphQL request failed");
  }
  if (!response.ok) {
    throw new Error(
      `GraphQL request failed with HTTP ${String(response.status)} ${response.statusText}`,
    );
  }
  if (payload.data === undefined) {
    throw new Error("GraphQL response did not include data");
  }
  return payload.data;
}

export function loadConfig(): Promise<UiConfigResponse> {
  return fetchJson<UiConfigResponse>("/api/ui-config");
}

export function listWorkflows(): Promise<WorkflowListResponse> {
  return fetchGraphqlData<WorkflowsGraphqlData>(WORKFLOWS_QUERY).then(
    (data) => ({
      workflows: data.workflows,
    }),
  );
}

export function loadWorkflow(workflowName: string): Promise<WorkflowResponse> {
  return fetchGraphqlData<WorkflowDefinitionGraphqlData>(
    WORKFLOW_DEFINITION_QUERY,
    { workflowName },
  ).then((data) => {
    if (data.workflowDefinition === null) {
      throw new Error(`workflow '${workflowName}' was not found`);
    }
    return data.workflowDefinition;
  });
}

export function createWorkflow(
  workflowName: string,
): Promise<WorkflowResponse> {
  const input: CreateWorkflowRequest = { workflowName };
  return fetchGraphqlData<CreateWorkflowDefinitionGraphqlData>(
    CREATE_WORKFLOW_DEFINITION_MUTATION,
    { input },
  ).then((data) => data.createWorkflowDefinition);
}

export function validateWorkflowBundle(
  workflowName: string,
  bundle: EditorWorkflowBundle,
): Promise<ValidationResponse> {
  const input: ValidateWorkflowRequest<EditorWorkflowBundle> & {
    readonly workflowName: string;
  } = {
    workflowName,
    bundle,
  };
  return fetchGraphqlData<ValidateWorkflowDefinitionGraphqlData>(
    VALIDATE_WORKFLOW_DEFINITION_MUTATION,
    { input },
  ).then((data) => data.validateWorkflowDefinition);
}

export async function saveWorkflowBundle(input: {
  readonly workflowName: string;
  readonly bundle: EditorWorkflowBundle;
  readonly expectedRevision?: string;
}): Promise<SaveWorkflowResponse> {
  const mutationInput: SaveWorkflowRequest<EditorWorkflowBundle> & {
    readonly workflowName: string;
  } = {
    workflowName: input.workflowName,
    bundle: input.bundle,
    ...(input.expectedRevision === undefined
      ? {}
      : { expectedRevision: input.expectedRevision }),
  };

  const payload = (
    await fetchGraphqlData<SaveWorkflowDefinitionGraphqlData>(
      SAVE_WORKFLOW_DEFINITION_MUTATION,
      { input: mutationInput },
    )
  ).saveWorkflowDefinition;

  if (typeof payload.currentRevision === "string") {
    throw new WorkflowRevisionConflictError(payload.currentRevision);
  }
  if (typeof payload.error === "string") {
    if (Array.isArray(payload.issues) && payload.issues.length > 0) {
      throw new WorkflowSaveValidationError(payload.error, payload.issues);
    }
    throw new Error(payload.error);
  }
  if (typeof payload.revision !== "string") {
    throw new Error("saveWorkflowDefinition did not return a revision");
  }

  return payload;
}

export function listSessions(): Promise<SessionsResponse> {
  return fetchGraphqlData<WorkflowExecutionsGraphqlData>(
    WORKFLOW_EXECUTIONS_QUERY,
    { first: 500 },
  ).then((data) => ({
    sessions: data.workflowExecutions.items,
  }));
}

export function loadWorkflowExecution(
  workflowExecutionId: string,
): Promise<WorkflowExecutionStateResponse> {
  return fetchGraphqlData<WorkflowExecutionGraphqlData>(
    WORKFLOW_EXECUTION_SESSION_QUERY,
    { workflowExecutionId },
  ).then((data) => {
    if (data.workflowExecution === null) {
      throw new ApiError(404, {
        error: `workflow execution '${workflowExecutionId}' was not found`,
      });
    }
    return {
      workflowExecutionId: data.workflowExecution.workflowExecutionId,
      ...data.workflowExecution.session,
    };
  });
}

export function executeWorkflow(
  workflowName: string,
  request: ExecuteWorkflowRequest,
): Promise<ExecuteWorkflowResponse> {
  return fetchGraphqlData<ExecuteWorkflowGraphqlData>(
    EXECUTE_WORKFLOW_MUTATION,
    {
      input: {
        workflowName,
        runtimeVariables: request.runtimeVariables,
        async: request.async,
        ...(request.mockScenario === undefined
          ? {}
          : { mockScenario: request.mockScenario }),
        ...(request.maxSteps === undefined
          ? {}
          : { maxSteps: request.maxSteps }),
        ...(request.maxLoopIterations === undefined
          ? {}
          : { maxLoopIterations: request.maxLoopIterations }),
        ...(request.defaultTimeoutMs === undefined
          ? {}
          : { defaultTimeoutMs: request.defaultTimeoutMs }),
        ...(request.dryRun === undefined ? {} : { dryRun: request.dryRun }),
      },
    },
  ).then((data) => data.executeWorkflow);
}

export function cancelWorkflowExecution(
  workflowExecutionId: string,
): Promise<CancelWorkflowExecutionResponse> {
  return fetchGraphqlData<CancelWorkflowExecutionGraphqlData>(
    CANCEL_WORKFLOW_EXECUTION_MUTATION,
    {
      input: {
        workflowExecutionId,
      },
    },
  ).then((data) => data.cancelWorkflowExecution);
}
