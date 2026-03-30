import { runWorkflow, type WorkflowRunOptions } from "./workflow/engine";
import { callNode, type CallNodeInput } from "./workflow/call-node";
import {
  executeGraphqlRequest,
  type GraphqlClientRequest,
  type GraphqlClientResponse,
  type GraphqlResponseError,
} from "./graphql/client";
import { createGraphqlSchema } from "./graphql/schema";
import type {
  GraphqlRequestContext,
  GraphqlSchema,
  GraphqlSchemaDependencies,
} from "./graphql/types";
import {
  buildInspectionSummary,
  type WorkflowInspectionSummary,
} from "./workflow/inspect";
import { loadWorkflowFromDisk } from "./workflow/load";
import {
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  listRuntimeSessions,
} from "./workflow/runtime-db";
import {
  loadSession,
  type SessionStoreOptions,
} from "./workflow/session-store";
import type { WorkflowSessionState } from "./workflow/session";
import type { MockNodeScenario } from "./workflow/adapter";
import type { LoadOptions } from "./workflow/types";

export type DivedraOptions = LoadOptions & SessionStoreOptions;

export interface ExecuteWorkflowInput extends DivedraOptions {
  readonly workflowName: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
}

export interface ResumeWorkflowInput extends DivedraOptions {
  readonly sessionId: string;
  readonly mockScenario?: MockNodeScenario;
}

export interface RerunWorkflowInput extends DivedraOptions {
  readonly sourceSessionId: string;
  readonly fromNodeId: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly dryRun?: boolean;
}

export interface RuntimeSessionView {
  readonly session: WorkflowSessionState;
  readonly nodeExecutions: ReturnType<
    typeof listRuntimeNodeExecutions
  > extends Promise<infer T>
    ? T
    : never;
  readonly nodeLogs: ReturnType<typeof listRuntimeNodeLogs> extends Promise<
    infer T
  >
    ? T
    : never;
}

export interface CallWorkflowNodeInput extends CallNodeInput {}

export interface WorkflowExecutionClientOptions extends DivedraOptions {
  readonly workflowName: string;
  readonly endpoint?: string;
  readonly authToken?: string;
  readonly managerSessionId?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface WorkflowExecutionClientRequest {
  readonly input?: Readonly<Record<string, unknown>>;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly async?: boolean;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
}

export interface WorkflowExecutionClientResult {
  readonly workflowName: string;
  readonly workflowExecutionId: string;
  readonly sessionId: string;
  readonly status: string;
  readonly accepted?: boolean;
  readonly exitCode?: number;
}

export interface WorkflowExecutionClient {
  readonly workflowName: string;
  execute(
    request?: WorkflowExecutionClientRequest,
  ): Promise<WorkflowExecutionClientResult>;
}

function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObjectField(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireStringField(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalBooleanField(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function optionalNumberField(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function resolveRuntimeVariables(
  request: WorkflowExecutionClientRequest | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (
    request?.input !== undefined &&
    request.runtimeVariables !== undefined
  ) {
    throw new Error("use only one of input or runtimeVariables");
  }
  return request?.runtimeVariables ?? request?.input;
}

async function executeWorkflowThroughGraphqlClient(
  options: WorkflowExecutionClientOptions,
  request: WorkflowExecutionClientRequest | undefined,
): Promise<WorkflowExecutionClientResult> {
  if (options.endpoint === undefined) {
    throw new Error("endpoint is required for GraphQL execution");
  }
  const runtimeVariables = resolveRuntimeVariables(request);
  const response = await executeGraphqlRequest({
    endpoint: options.endpoint,
    document: `
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
        workflowName: options.workflowName,
        ...(runtimeVariables === undefined ? {} : { runtimeVariables }),
        ...(request?.mockScenario === undefined
          ? {}
          : { mockScenario: request.mockScenario }),
        ...(request?.async === undefined ? {} : { async: request.async }),
        ...(request?.dryRun === undefined ? {} : { dryRun: request.dryRun }),
        ...(request?.maxSteps === undefined ? {} : { maxSteps: request.maxSteps }),
        ...(request?.maxLoopIterations === undefined
          ? {}
          : { maxLoopIterations: request.maxLoopIterations }),
        ...(request?.defaultTimeoutMs === undefined
          ? {}
          : { defaultTimeoutMs: request.defaultTimeoutMs }),
      },
    },
    ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
    ...(options.managerSessionId === undefined
      ? {}
      : { managerSessionId: options.managerSessionId }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
  if (response.errors !== undefined && response.errors.length > 0) {
    throw new Error(response.errors.map((entry) => entry.message).join("; "));
  }

  const data = requireObjectField(response.data, "GraphQL response.data");
  const payload = requireObjectField(data["executeWorkflow"], "executeWorkflow");
  const accepted = optionalBooleanField(
    payload["accepted"],
    "executeWorkflow.accepted",
  );
  const exitCode = optionalNumberField(
    payload["exitCode"],
    "executeWorkflow.exitCode",
  );
  return {
    workflowName: options.workflowName,
    workflowExecutionId: requireStringField(
      payload["workflowExecutionId"],
      "executeWorkflow.workflowExecutionId",
    ),
    sessionId: requireStringField(
      payload["sessionId"],
      "executeWorkflow.sessionId",
    ),
    status: requireStringField(payload["status"], "executeWorkflow.status"),
    ...(accepted === undefined ? {} : { accepted }),
    ...(exitCode === undefined ? {} : { exitCode }),
  };
}

async function executeWorkflowThroughLibraryClient(
  options: WorkflowExecutionClientOptions,
  request: WorkflowExecutionClientRequest | undefined,
): Promise<WorkflowExecutionClientResult> {
  const runtimeVariables = resolveRuntimeVariables(request);
  if (request?.async === true) {
    const schema = createGraphqlSchema();
    const payload = await schema.mutation.executeWorkflow(
      {
        workflowName: options.workflowName,
        ...(runtimeVariables === undefined ? {} : { runtimeVariables }),
        ...(request.mockScenario === undefined
          ? {}
          : { mockScenario: request.mockScenario }),
        async: true,
        ...(request.dryRun === undefined ? {} : { dryRun: request.dryRun }),
        ...(request.maxSteps === undefined ? {} : { maxSteps: request.maxSteps }),
        ...(request.maxLoopIterations === undefined
          ? {}
          : { maxLoopIterations: request.maxLoopIterations }),
        ...(request.defaultTimeoutMs === undefined
          ? {}
          : { defaultTimeoutMs: request.defaultTimeoutMs }),
      },
      options,
    );
    return {
      workflowName: options.workflowName,
      workflowExecutionId: payload.workflowExecutionId,
      sessionId: payload.sessionId,
      status: payload.status,
      ...(payload.accepted === undefined ? {} : { accepted: payload.accepted }),
      ...(payload.exitCode === undefined ? {} : { exitCode: payload.exitCode }),
    };
  }

  const result = await executeWorkflow({
    ...options,
    workflowName: options.workflowName,
    ...(runtimeVariables === undefined ? {} : { runtimeVariables }),
    ...(request?.mockScenario === undefined
      ? {}
      : { mockScenario: request.mockScenario }),
    ...(request?.dryRun === undefined ? {} : { dryRun: request.dryRun }),
    ...(request?.maxSteps === undefined ? {} : { maxSteps: request.maxSteps }),
    ...(request?.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: request.maxLoopIterations }),
    ...(request?.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: request.defaultTimeoutMs }),
  });
  return {
    workflowName: options.workflowName,
    workflowExecutionId: result.sessionId,
    sessionId: result.sessionId,
    status: result.status,
    exitCode: result.exitCode,
  };
}

export function createWorkflowExecutionClient(
  options: WorkflowExecutionClientOptions,
): WorkflowExecutionClient {
  return {
    workflowName: options.workflowName,
    async execute(
      request: WorkflowExecutionClientRequest = {},
    ): Promise<WorkflowExecutionClientResult> {
      if (options.endpoint !== undefined) {
        return executeWorkflowThroughGraphqlClient(options, request);
      }
      return executeWorkflowThroughLibraryClient(options, request);
    },
  };
}

export async function inspectWorkflow(
  workflowName: string,
  options: DivedraOptions = {},
): Promise<WorkflowInspectionSummary> {
  const loaded = await loadWorkflowFromDisk(workflowName, options);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  return await buildInspectionSummary(loaded.value, options);
}

export async function executeWorkflow(input: ExecuteWorkflowInput): Promise<{
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
  readonly exitCode: number;
}> {
  const options: WorkflowRunOptions = {
    ...(input.workflowRoot === undefined
      ? {}
      : { workflowRoot: input.workflowRoot }),
    ...(input.artifactRoot === undefined
      ? {}
      : { artifactRoot: input.artifactRoot }),
    ...(input.rootDataDir === undefined ? {} : { rootDataDir: input.rootDataDir }),
    ...(input.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: input.sessionStoreRoot }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.runtimeVariables === undefined
      ? {}
      : { runtimeVariables: input.runtimeVariables }),
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
  };
  const result = await runWorkflow(input.workflowName, options);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    sessionId: result.value.session.sessionId,
    status: result.value.session.status,
    exitCode: result.value.exitCode,
  };
}

export async function resumeWorkflow(input: ResumeWorkflowInput): Promise<{
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
  readonly exitCode: number;
}> {
  const existing = await loadSession(input.sessionId, input);
  if (!existing.ok) {
    throw new Error(existing.error.message);
  }
  const result = await runWorkflow(existing.value.workflowName, {
    ...(input.workflowRoot === undefined
      ? {}
      : { workflowRoot: input.workflowRoot }),
    ...(input.artifactRoot === undefined
      ? {}
      : { artifactRoot: input.artifactRoot }),
    ...(input.rootDataDir === undefined ? {} : { rootDataDir: input.rootDataDir }),
    ...(input.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: input.sessionStoreRoot }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
    resumeSessionId: existing.value.sessionId,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    sessionId: result.value.session.sessionId,
    status: result.value.session.status,
    exitCode: result.value.exitCode,
  };
}

export async function rerunWorkflow(input: RerunWorkflowInput): Promise<{
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
  readonly exitCode: number;
}> {
  const source = await loadSession(input.sourceSessionId, input);
  if (!source.ok) {
    throw new Error(source.error.message);
  }
  const result = await runWorkflow(source.value.workflowName, {
    ...(input.workflowRoot === undefined
      ? {}
      : { workflowRoot: input.workflowRoot }),
    ...(input.artifactRoot === undefined
      ? {}
      : { artifactRoot: input.artifactRoot }),
    ...(input.rootDataDir === undefined ? {} : { rootDataDir: input.rootDataDir }),
    ...(input.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: input.sessionStoreRoot }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.runtimeVariables === undefined
      ? {}
      : { runtimeVariables: input.runtimeVariables }),
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
    rerunFromSessionId: source.value.sessionId,
    rerunFromNodeId: input.fromNodeId,
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    sessionId: result.value.session.sessionId,
    status: result.value.session.status,
    exitCode: result.value.exitCode,
  };
}

export async function getSession(
  sessionId: string,
  options: DivedraOptions = {},
): Promise<WorkflowSessionState> {
  const loaded = await loadSession(sessionId, options);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  return loaded.value;
}

export async function listSessions(options: DivedraOptions = {}) {
  return listRuntimeSessions(options);
}

export async function getRuntimeSessionView(
  sessionId: string,
  options: DivedraOptions = {},
): Promise<RuntimeSessionView> {
  const session = await getSession(sessionId, options);
  const nodeExecutions = await listRuntimeNodeExecutions(sessionId, options);
  const nodeLogs = await listRuntimeNodeLogs(sessionId, options);
  return { session, nodeExecutions, nodeLogs };
}

export async function callWorkflowNode(input: CallWorkflowNodeInput): Promise<{
  readonly sessionId: string;
  readonly nodeExecId: string;
  readonly status: "succeeded";
  readonly exitCode: number;
  readonly output: Readonly<Record<string, unknown>>;
}> {
  const result = await callNode(input);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    sessionId: result.value.session.sessionId,
    nodeExecId: result.value.nodeExecution.nodeExecId,
    status: "succeeded",
    exitCode: result.value.exitCode,
    output: result.value.output,
  };
}

export { runCli } from "./cli";
export { startServe } from "./server/serve";
export { handleApiRequest } from "./server/api";
export { handleGraphqlRequest, executeGraphqlDocument } from "./server/graphql";
export { createGraphqlSchema, executeGraphqlRequest };
export {
  resolveRuntimeDbPath,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  listRuntimeSessions,
} from "./workflow/runtime-db";
export {
  createCommunicationService,
  type CommunicationArtifactSnapshot,
  type CommunicationAttemptSnapshot,
  type CommunicationGraphqlView,
  type CommunicationLookupInput,
  type ReplayCommunicationInput,
  type ReplayCommunicationResult,
  type RetryCommunicationDeliveryInput,
  type RetryCommunicationDeliveryResult,
} from "./workflow/communication-service";
export {
  createManagerSessionStore,
  hashManagerAuthToken,
  verifyManagerAuthToken,
  resolveAmbientManagerExecutionContext,
  type AmbientManagerExecutionContext,
  type IdempotentMutationLookup,
  type IdempotentMutationRecord,
  type ManagerControlMode,
  type ManagerIntentSummary,
  type ManagerMessageRecord,
  type ManagerSessionRecord,
  type ManagerSessionStore,
} from "./workflow/manager-session-store";
export {
  createManagerMessageService,
  type DataDirFileRef,
  type ManagerMessageService,
  type SendManagerMessageInput,
  type SendManagerMessageResult,
} from "./workflow/manager-message-service";
export {
  parseManagerControlActions,
  parseManagerControlPayload,
  type ManagerControlAction,
  type ManagerControlActionType,
  type ParsedManagerControl,
} from "./workflow/manager-control";
export type {
  GraphqlClientRequest,
  GraphqlClientResponse,
  GraphqlResponseError,
  GraphqlRequestContext,
  GraphqlSchema,
  GraphqlSchemaDependencies,
};
export { loadWorkflowFromDisk } from "./workflow/load";
export { runWorkflow } from "./workflow/engine";
export { callNode } from "./workflow/call-node";
export { deriveWorkflowVisualization } from "./workflow/visualization";
