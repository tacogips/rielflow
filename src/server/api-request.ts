import type { MockNodeResponse, MockNodeScenario } from "../workflow/adapter";
import { isJsonObject, type JsonObject } from "../shared/json";
import type {
  ExecuteWorkflowRequest,
  RerunWorkflowRequest,
  WorkflowRunRequest,
} from "../shared/ui-contract";

export interface WorkflowRunRequestOptions
  extends Omit<WorkflowRunRequest, "mockScenario"> {
  readonly mockScenario?: MockNodeScenario;
}

export interface WorkflowExecuteRequestOptions
  extends Omit<ExecuteWorkflowRequest, "async" | "mockScenario"> {
  readonly asyncMode: boolean;
  readonly mockScenario?: MockNodeScenario;
}

export interface WorkflowRerunRequestOptions
  extends Omit<RerunWorkflowRequest, "mockScenario"> {
  readonly mockScenario?: MockNodeScenario;
}

function isBooleanRecord(
  value: unknown,
): value is Readonly<Record<string, boolean>> {
  return (
    isJsonObject(value) &&
    Object.values(value).every((entry) => typeof entry === "boolean")
  );
}

function isMockNodeResponse(value: unknown): value is MockNodeResponse {
  if (!isJsonObject(value)) {
    return false;
  }

  const provider = value["provider"];
  const model = value["model"];
  const promptText = value["promptText"];
  const completionPassed = value["completionPassed"];
  const when = value["when"];
  const payload = value["payload"];
  const fail = value["fail"];

  return (
    (provider === undefined || typeof provider === "string") &&
    (model === undefined || typeof model === "string") &&
    (promptText === undefined || typeof promptText === "string") &&
    (completionPassed === undefined || typeof completionPassed === "boolean") &&
    (when === undefined || isBooleanRecord(when)) &&
    (payload === undefined || isJsonObject(payload)) &&
    (fail === undefined || typeof fail === "boolean")
  );
}

function readMockScenario(
  body: JsonObject,
  field: string,
): MockNodeScenario | undefined {
  const value = body[field];
  if (!isJsonObject(value)) {
    return undefined;
  }

  const normalizedEntries: Record<string, MockNodeScenario[string]> = {};
  for (const [nodeId, scenarioEntry] of Object.entries(value)) {
    if (Array.isArray(scenarioEntry)) {
      const normalizedSequence = scenarioEntry.filter(isMockNodeResponse);
      if (normalizedSequence.length > 0) {
        normalizedEntries[nodeId] = normalizedSequence;
      }
      continue;
    }

    if (isMockNodeResponse(scenarioEntry)) {
      normalizedEntries[nodeId] = scenarioEntry;
    }
  }

  return Object.keys(normalizedEntries).length > 0
    ? normalizedEntries
    : undefined;
}

export function jsonBodyObject(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

export function optionalStringField(
  body: JsonObject,
  field: string,
): string | undefined {
  return typeof body[field] === "string" ? body[field] : undefined;
}

export function optionalTrimmedStringField(
  body: JsonObject,
  field: string,
): string | undefined {
  const value = optionalStringField(body, field);
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumberField(
  body: JsonObject,
  field: string,
): number | undefined {
  return typeof body[field] === "number" ? body[field] : undefined;
}

function optionalObjectField(
  body: JsonObject,
  field: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = body[field];
  return isJsonObject(value) ? value : undefined;
}

function workflowRunRequestOptionsFromBody(
  body: JsonObject,
): WorkflowRunRequestOptions {
  const runtimeVariables = optionalObjectField(body, "runtimeVariables") ?? {};
  const mockScenario = readMockScenario(body, "mockScenario");
  const maxSteps = optionalNumberField(body, "maxSteps");
  const maxLoopIterations = optionalNumberField(body, "maxLoopIterations");
  const defaultTimeoutMs = optionalNumberField(body, "defaultTimeoutMs");

  return {
    runtimeVariables,
    ...(mockScenario === undefined ? {} : { mockScenario }),
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(maxLoopIterations === undefined ? {} : { maxLoopIterations }),
    ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
    ...(body["dryRun"] === true ? { dryRun: true } : {}),
  };
}

export function readWorkflowExecuteRequestOptions(
  body: unknown,
): WorkflowExecuteRequestOptions {
  const bodyObject = jsonBodyObject(body);
  return {
    asyncMode: bodyObject["async"] === true,
    ...workflowRunRequestOptionsFromBody(bodyObject),
  };
}

export function readWorkflowRerunRequestOptions(
  body: unknown,
): WorkflowRerunRequestOptions {
  const bodyObject = jsonBodyObject(body);
  const fromNodeId = optionalTrimmedStringField(bodyObject, "fromNodeId");
  return {
    ...(fromNodeId === undefined ? {} : { fromNodeId }),
    ...workflowRunRequestOptionsFromBody(bodyObject),
  };
}
