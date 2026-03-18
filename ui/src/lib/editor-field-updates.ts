import type {
  CompletionType,
  NodeKind,
  NodeType,
} from "../../../src/workflow/types";
import type {
  EditorNodePayload,
  EditorWorkflowBundle,
  EditorWorkflowEdge,
} from "./editor-workflow";
import {
  parseJsonObject,
  parseRequiredPositiveInteger,
} from "./editor-support";

export const RESERVED_STRUCTURE_KINDS = new Set<NodeKind>([
  "root-manager",
  "sub-divedra-manager",
  "input",
  "output",
]);

export interface FieldUpdateSuccess {
  readonly ok: true;
}

export interface FieldUpdateError {
  readonly ok: false;
  readonly error: string;
}

export type FieldUpdateResult = FieldUpdateSuccess | FieldUpdateError;
type ParsedPositiveInteger =
  | { readonly ok: true; readonly value: number }
  | FieldUpdateError;
type ParsedOptionalObject =
  | { readonly ok: true; readonly value: Record<string, unknown> | undefined }
  | FieldUpdateError;

function ok(): FieldUpdateSuccess {
  return { ok: true };
}

function fail(error: string): FieldUpdateError {
  return { ok: false, error };
}

function parsePositiveInteger(
  rawValue: string,
  fieldName: string,
): ParsedPositiveInteger {
  try {
    return {
      ok: true,
      value: parseRequiredPositiveInteger(rawValue, fieldName),
    };
  } catch (error) {
    return fail(
      error instanceof Error
        ? error.message
        : `${fieldName} must be a positive integer.`,
    );
  }
}

function parseOptionalObject(
  rawValue: string,
  fieldName: string,
): ParsedOptionalObject {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: undefined };
  }
  try {
    return {
      ok: true,
      value: parseJsonObject(trimmed, fieldName),
    };
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : `${fieldName} must be JSON.`,
    );
  }
}

export function updateWorkflowDescriptionValue(
  bundle: EditorWorkflowBundle | null | undefined,
  description: string,
): boolean {
  if (!bundle) {
    return false;
  }

  bundle.workflow.description = description;
  return true;
}

export function updateWorkflowManagerNodeValue(
  bundle: EditorWorkflowBundle | null | undefined,
  managerNodeId: string,
): boolean {
  if (!bundle) {
    return false;
  }

  bundle.workflow.managerNodeId = managerNodeId;
  return true;
}

export function updateNodeKindValue(
  bundle: EditorWorkflowBundle | null | undefined,
  nodeId: string,
  nextKind: NodeKind,
): FieldUpdateResult {
  const node = bundle?.workflow.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return fail(`Node '${nodeId}' was not found.`);
  }

  if (RESERVED_STRUCTURE_KINDS.has(nextKind)) {
    return fail(
      `Node kind '${nextKind}' is assigned by workflow structure. Edit the manager or sub-workflow boundaries instead.`,
    );
  }

  node.kind = nextKind;
  return ok();
}

export function updateNodeCompletionValue(
  bundle: EditorWorkflowBundle | null | undefined,
  nodeId: string,
  completionType: CompletionType,
): boolean {
  const node = bundle?.workflow.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return false;
  }

  node.completion = { type: completionType };
  return true;
}

export function updateEdgeFieldValue(
  bundle: EditorWorkflowBundle | null | undefined,
  index: number,
  field: keyof EditorWorkflowEdge,
  rawValue: string,
): FieldUpdateResult {
  const edge = bundle?.workflow.edges[index];
  if (!edge) {
    return fail("edge was not found.");
  }

  if (field === "priority") {
    const trimmed = rawValue.trim();
    if (trimmed.length === 0) {
      delete edge.priority;
      return ok();
    }

    if (!/^-?[0-9]+$/.test(trimmed)) {
      return fail("Edge priority must be an integer.");
    }

    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed)) {
      return fail("Edge priority must be an integer.");
    }

    edge.priority = parsed;
    return ok();
  }

  edge[field] = rawValue;
  return ok();
}

export function updateWorkflowDefaultValue(
  bundle: EditorWorkflowBundle | null | undefined,
  field: "maxLoopIterations" | "nodeTimeoutMs",
  rawValue: string,
): FieldUpdateResult {
  if (!bundle) {
    return fail("workflow is not loaded.");
  }

  const parsed = parsePositiveInteger(rawValue, `Workflow default '${field}'`);
  if (!parsed.ok) {
    return parsed;
  }

  bundle.workflow.defaults[field] = parsed.value;
  return ok();
}

export function updateWorkflowContainerRuntimeValue(
  bundle: EditorWorkflowBundle | null | undefined,
  rawValue: string,
): FieldUpdateResult {
  if (!bundle) {
    return fail("workflow is not loaded.");
  }

  const parsed = parseOptionalObject(
    rawValue,
    "Workflow default 'containerRuntime'",
  );
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.value === undefined) {
    delete bundle.workflow.defaults.containerRuntime;
    return ok();
  }

  bundle.workflow.defaults.containerRuntime = parsed.value as NonNullable<
    EditorWorkflowBundle["workflow"]["defaults"]["containerRuntime"]
  >;
  return ok();
}

export function updateNodePayloadStringValue(
  payload: EditorNodePayload | null | undefined,
  field: "executionBackend" | "model" | "promptTemplate",
  value: string,
): boolean {
  if (!payload) {
    return false;
  }

  if (field === "executionBackend") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      delete payload.executionBackend;
    } else {
      payload.executionBackend = trimmed;
    }
    return true;
  }

  if (field === "model") {
    payload.model = value;
  } else {
    payload.promptTemplate = value;
  }
  return true;
}

export function updateNodePayloadTypeValue(
  payload: EditorNodePayload | null | undefined,
  nodeType: NodeType,
): boolean {
  if (!payload) {
    return false;
  }

  if (nodeType === "agent") {
    delete payload.nodeType;
    return true;
  }

  payload.nodeType = nodeType;
  return true;
}

export function updateNodePayloadObjectValue(
  payload: EditorNodePayload | null | undefined,
  field: "command" | "container" | "durability",
  rawValue: string,
): FieldUpdateResult {
  if (!payload) {
    return fail("node payload is not loaded.");
  }

  const parsed = parseOptionalObject(rawValue, `Node field '${field}'`);
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.value === undefined) {
    delete payload[field];
    return ok();
  }

  switch (field) {
    case "command":
      payload.command = parsed.value as NonNullable<
        EditorNodePayload["command"]
      >;
      break;
    case "container":
      payload.container = parsed.value as NonNullable<
        EditorNodePayload["container"]
      >;
      break;
    case "durability":
      payload.durability = parsed.value as NonNullable<
        EditorNodePayload["durability"]
      >;
      break;
  }
  return ok();
}

export function updateNodeTimeoutValue(
  payload: EditorNodePayload | null | undefined,
  rawValue: string,
): FieldUpdateResult {
  if (!payload) {
    return fail("node payload is not loaded.");
  }

  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    delete payload.timeoutMs;
    return ok();
  }

  const parsed = parsePositiveInteger(trimmed, "Node timeout");
  if (!parsed.ok) {
    return parsed;
  }

  payload.timeoutMs = parsed.value;
  return ok();
}

export function syncNodeVariablesTextValue(
  payload: EditorNodePayload | null | undefined,
  nodeVariablesText: string,
): FieldUpdateResult {
  if (!payload) {
    return fail("node payload is not loaded.");
  }

  payload.variables = parseJsonObject(nodeVariablesText, "Node variables");
  return ok();
}
