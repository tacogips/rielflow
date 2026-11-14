import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeNodeExecutionBackend } from "./backend";
import { err, ok, type Result } from "./result";
import type {
  NodePayload,
  NormalizedWorkflowBundle,
  ValidationIssue,
  WorkflowJson,
  WorkflowNodePatch,
  WorkflowNodePatchMap,
  WorkflowNodeRegistryRef,
} from "./types";

export type { WorkflowNodePatch, WorkflowNodePatchMap } from "./types";

const ALLOWED_PATCH_FIELDS = ["executionBackend", "model", "effort"] as const;
const ALLOWED_PATCH_FIELD_SET: ReadonlySet<string> = new Set(
  ALLOWED_PATCH_FIELDS,
);

const PATCHABLE_BACKENDS =
  "codex-agent, claude-code-agent, cursor-cli-agent, official/openai-sdk, or official/anthropic-sdk";

export interface ParseWorkflowNodePatchInput {
  readonly value: string;
  readonly invocationCwd: string;
  readonly optionName: "--node-patch" | "nodePatch";
}

export interface ApplyWorkflowNodePatchInput {
  readonly bundle: NormalizedWorkflowBundle;
  readonly patch: WorkflowNodePatchMap;
  readonly sourceLabel: string;
}

export interface ApplyWorkflowNodePatchToRawPayloadsInput {
  readonly workflow: WorkflowJson;
  readonly nodePayloadsRaw: Readonly<Record<string, unknown>>;
  readonly patch: WorkflowNodePatchMap;
  readonly sourceLabel: string;
}

interface PatchSource {
  readonly displayValue: string;
  readonly content: string;
}

function makeIssue(pathValue: string, message: string): ValidationIssue {
  return {
    severity: "error",
    path: pathValue,
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createNullPrototypeRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function cloneToNullPrototypeRecord<T>(
  value: Readonly<Record<string, T>>,
): Record<string, T> {
  return Object.assign(createNullPrototypeRecord<T>(), value);
}

function issuePrefix(sourceLabel: string): string {
  return sourceLabel.length === 0 ? "node patch" : sourceLabel;
}

function isJsonScalarLiteralCandidate(value: string): boolean {
  return (
    value === "true" ||
    value === "false" ||
    value === "null" ||
    value.startsWith('"') ||
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(value)
  );
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveInvocationPath(
  invocationCwd: string,
  filePath: string,
): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(invocationCwd, filePath);
}

async function readPatchSource(
  input: ParseWorkflowNodePatchInput,
): Promise<PatchSource> {
  const trimmed = input.value.trim();
  if (input.value.startsWith("@")) {
    const filePath = input.value.slice(1);
    if (filePath.length === 0) {
      throw new Error(
        `${input.optionName} explicit @file reference must include a file path`,
      );
    }
    const resolvedPath = resolveInvocationPath(input.invocationCwd, filePath);
    return {
      displayValue: input.value,
      content: await readFile(resolvedPath, "utf8"),
    };
  }

  const resolvedPath = resolveInvocationPath(input.invocationCwd, input.value);
  if (await isReadableFile(resolvedPath)) {
    return {
      displayValue: input.value,
      content: await readFile(resolvedPath, "utf8"),
    };
  }

  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    isJsonScalarLiteralCandidate(trimmed)
  ) {
    return {
      displayValue: "inline JSON",
      content: trimmed,
    };
  }

  return {
    displayValue: input.value,
    content: await readFile(resolvedPath, "utf8"),
  };
}

function formatPatchIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

export function normalizeWorkflowNodePatchMap(
  value: unknown,
  sourceLabel = "nodePatch",
): Result<WorkflowNodePatchMap, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const prefix = issuePrefix(sourceLabel);
  if (!isRecord(value)) {
    return err([
      makeIssue(
        "nodePatch",
        `${prefix} must resolve to a JSON object keyed by workflow node id`,
      ),
    ]);
  }

  const patch = createNullPrototypeRecord<WorkflowNodePatch>();
  for (const [nodeId, nodePatchRaw] of Object.entries(value)) {
    const nodePath = `nodePatch.${nodeId}`;
    if (!isRecord(nodePatchRaw)) {
      issues.push(
        makeIssue(nodePath, "must be an object with node patch fields"),
      );
      continue;
    }

    const disallowedFields = Object.keys(nodePatchRaw).filter(
      (field) => !ALLOWED_PATCH_FIELD_SET.has(field),
    );
    for (const field of disallowedFields) {
      issues.push(
        makeIssue(
          `${nodePath}.${field}`,
          `is not allowed; accepted fields are ${ALLOWED_PATCH_FIELDS.join(", ")}`,
        ),
      );
    }

    const normalizedPatch: WorkflowNodePatch = {};
    const executionBackendRaw = nodePatchRaw["executionBackend"];
    if (executionBackendRaw !== undefined) {
      const executionBackend =
        normalizeNodeExecutionBackend(executionBackendRaw);
      if (executionBackend === null) {
        issues.push(
          makeIssue(
            `${nodePath}.executionBackend`,
            `must be ${PATCHABLE_BACKENDS}`,
          ),
        );
      } else {
        Object.assign(normalizedPatch, { executionBackend });
      }
    }

    const modelRaw = nodePatchRaw["model"];
    if (modelRaw !== undefined) {
      if (typeof modelRaw !== "string" || modelRaw.length === 0) {
        issues.push(
          makeIssue(`${nodePath}.model`, "must be a non-empty string"),
        );
      } else {
        Object.assign(normalizedPatch, { model: modelRaw });
      }
    }

    const effortRaw = nodePatchRaw["effort"];
    if (effortRaw !== undefined) {
      if (typeof effortRaw !== "string" || effortRaw.length === 0) {
        issues.push(
          makeIssue(`${nodePath}.effort`, "must be a non-empty string"),
        );
      } else {
        Object.assign(normalizedPatch, { effort: effortRaw });
      }
    }

    patch[nodeId] = normalizedPatch;
  }

  return issues.length > 0 ? err(issues) : ok(patch);
}

export async function readWorkflowNodePatch(
  input: ParseWorkflowNodePatchInput,
): Promise<WorkflowNodePatchMap> {
  const source = await readPatchSource(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.content) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `${source.displayValue} must contain valid JSON: ${message}`,
    );
  }

  const normalized = normalizeWorkflowNodePatchMap(parsed, input.optionName);
  if (!normalized.ok) {
    throw new Error(formatPatchIssues(normalized.error));
  }
  return normalized.value;
}

function registryNodes(
  workflow: WorkflowJson,
): readonly WorkflowNodeRegistryRef[] {
  return workflow.nodeRegistry.length > 0
    ? workflow.nodeRegistry
    : workflow.nodes;
}

function stepIdsForNode(
  workflow: WorkflowJson,
  nodeId: string,
): readonly string[] {
  const stepIds = workflow.steps
    .filter((step) => step.nodeId === nodeId)
    .map((step) => step.id);
  return stepIds.length === 0 ? [nodeId] : stepIds;
}

function unsupportedEffortIssue(input: {
  readonly nodeId: string;
  readonly backend: string | undefined;
}): ValidationIssue {
  return makeIssue(
    `nodePatch.${input.nodeId}.effort`,
    input.backend === undefined
      ? "is not supported because the selected backend does not expose a concrete effort capability"
      : `is not supported for executionBackend '${input.backend}' until that backend exposes a concrete effort capability`,
  );
}

export function applyWorkflowNodePatchToRawPayloads(
  input: ApplyWorkflowNodePatchToRawPayloadsInput,
): Result<Readonly<Record<string, unknown>>, readonly ValidationIssue[]> {
  const normalized = normalizeWorkflowNodePatchMap(
    input.patch,
    input.sourceLabel,
  );
  if (!normalized.ok) {
    return err(normalized.error);
  }

  const patchEntries = Object.entries(normalized.value);
  if (patchEntries.length === 0) {
    return ok(input.nodePayloadsRaw);
  }

  const nodesById = new Map(
    registryNodes(input.workflow).map((node) => [node.id, node]),
  );
  const patchedPayloads = cloneToNullPrototypeRecord(input.nodePayloadsRaw);
  const issues: ValidationIssue[] = [];

  for (const [nodeId, patch] of patchEntries) {
    const node = nodesById.get(nodeId);
    if (node === undefined) {
      issues.push(
        makeIssue(
          `nodePatch.${nodeId}`,
          `unknown workflow node id '${nodeId}' in ${input.sourceLabel}`,
        ),
      );
      continue;
    }
    if (node.addon !== undefined || node.nodeFile === undefined) {
      issues.push(
        makeIssue(
          `nodePatch.${nodeId}`,
          "can only target file-backed agent node payloads",
        ),
      );
      continue;
    }

    const payload = input.nodePayloadsRaw[node.nodeFile];
    if (!isRecord(payload)) {
      issues.push(
        makeIssue(
          `nodePatch.${nodeId}`,
          `cannot apply patch because node payload '${node.nodeFile}' is not an object`,
        ),
      );
      continue;
    }

    const patchedPayload = {
      ...payload,
      ...(patch.executionBackend === undefined
        ? {}
        : { executionBackend: patch.executionBackend }),
      ...(patch.model === undefined ? {} : { model: patch.model }),
    };
    patchedPayloads[node.nodeFile] = patchedPayload;
    patchedPayloads[nodeId] = patchedPayload;
    for (const stepId of stepIdsForNode(input.workflow, nodeId)) {
      patchedPayloads[stepId] = patchedPayload;
    }

    if (patch.effort !== undefined) {
      const backend =
        patch.executionBackend ??
        (typeof payload["executionBackend"] === "string"
          ? payload["executionBackend"]
          : undefined);
      issues.push(unsupportedEffortIssue({ nodeId, backend }));
    }
  }

  return issues.length > 0 ? err(issues) : ok(patchedPayloads);
}

export function applyWorkflowNodePatch(
  input: ApplyWorkflowNodePatchInput,
): Result<NormalizedWorkflowBundle, readonly ValidationIssue[]> {
  const normalized = normalizeWorkflowNodePatchMap(
    input.patch,
    input.sourceLabel,
  );
  if (!normalized.ok) {
    return err(normalized.error);
  }

  const patchEntries = Object.entries(normalized.value);
  if (patchEntries.length === 0) {
    return ok(input.bundle);
  }

  const nodesById = new Map(
    registryNodes(input.bundle.workflow).map((node) => [node.id, node]),
  );
  const patchedPayloads = cloneToNullPrototypeRecord(input.bundle.nodePayloads);
  const issues: ValidationIssue[] = [];

  for (const [nodeId, patch] of patchEntries) {
    const node = nodesById.get(nodeId);
    if (node === undefined) {
      issues.push(
        makeIssue(
          `nodePatch.${nodeId}`,
          `unknown workflow node id '${nodeId}' in ${input.sourceLabel}`,
        ),
      );
      continue;
    }
    if (node.addon !== undefined) {
      issues.push(
        makeIssue(
          `nodePatch.${nodeId}`,
          "can only target file-backed agent node payloads",
        ),
      );
      continue;
    }

    const payload =
      patchedPayloads[nodeId] ??
      (node.nodeFile === undefined
        ? undefined
        : patchedPayloads[node.nodeFile]);
    if (payload === undefined) {
      issues.push(
        makeIssue(
          `nodePatch.${nodeId}`,
          "cannot apply patch because node payload is missing",
        ),
      );
      continue;
    }

    const patchedPayload: NodePayload = {
      ...payload,
      ...(patch.executionBackend === undefined
        ? {}
        : { executionBackend: patch.executionBackend }),
      ...(patch.model === undefined ? {} : { model: patch.model }),
    };
    patchedPayloads[nodeId] = patchedPayload;
    if (node.nodeFile !== undefined) {
      patchedPayloads[node.nodeFile] = patchedPayload;
    }
    for (const stepId of stepIdsForNode(input.bundle.workflow, nodeId)) {
      patchedPayloads[stepId] = patchedPayload;
    }

    if (patch.effort !== undefined) {
      issues.push(
        unsupportedEffortIssue({
          nodeId,
          backend: patch.executionBackend ?? payload.executionBackend,
        }),
      );
    }
  }

  return issues.length > 0
    ? err(issues)
    : ok({
        ...input.bundle,
        nodePayloads: patchedPayloads,
      });
}
