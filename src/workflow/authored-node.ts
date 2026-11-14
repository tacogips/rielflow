import path from "node:path";
import { NODE_TEMPLATE_FIELD_SPECS } from "./node-template-fields";
import { err, ok, type Result } from "./result";
import { isSafeWorkflowRelativePath } from "./prompt-template-file";

export const INLINE_NODE_FIELD = "node";
const DEFAULT_NODE_DIRECTORY = "nodes";

function splitWorkflowRelativePath(relativePath: string): readonly string[] {
  return relativePath
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
}

export function normalizeWorkflowRelativeJsonPath(relativePath: string): string {
  return splitWorkflowRelativePath(relativePath).join("/");
}

export function expectedNodeFileName(nodeId: string): string {
  return `node-${nodeId}.json`;
}

export function synthesizeInlineNodeFile(nodeId: string): string {
  return `${DEFAULT_NODE_DIRECTORY}/${expectedNodeFileName(nodeId)}`;
}

export function getWorkflowRelativeBaseName(relativePath: string): string {
  const normalizedPath = normalizeWorkflowRelativeJsonPath(relativePath);
  return path.posix.basename(normalizedPath);
}

export function isSupportedNodeFilePath(
  nodeId: string,
  nodeFile: string,
): boolean {
  return (
    isSafeWorkflowRelativePath(nodeFile) &&
    getWorkflowRelativeBaseName(nodeFile) === expectedNodeFileName(nodeId)
  );
}

export interface WorkflowRelativeNodeFileFailure {
  readonly message: string;
}

export function resolveWorkflowRelativeNodeFilePath(
  workflowDirectory: string,
  relativePath: string,
): Result<string, WorkflowRelativeNodeFileFailure> {
  if (!isSafeWorkflowRelativePath(relativePath)) {
    return err({
      message:
        `nodeFile '${relativePath}' must be a workflow-relative path without '.' or '..' segments`,
    });
  }

  const resolved = path.resolve(workflowDirectory, relativePath);
  const relative = path.relative(workflowDirectory, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return err({
      message:
        `nodeFile '${relativePath}' must stay within workflow directory '${workflowDirectory}'`,
    });
  }

  return ok(resolved);
}

export function resolveAuthoredNodeFileReference(
  node: Readonly<Record<string, unknown>>,
): string | undefined {
  const nodeFileRaw = node["nodeFile"];
  if (typeof nodeFileRaw === "string" && nodeFileRaw.length > 0) {
    return normalizeWorkflowRelativeJsonPath(nodeFileRaw);
  }

  const nodeId = typeof node["id"] === "string" ? node["id"] : undefined;
  if (node[INLINE_NODE_FIELD] === undefined || nodeId === undefined || nodeId.length === 0) {
    return undefined;
  }

  return synthesizeInlineNodeFile(nodeId);
}

function mergeResolvedInlineTemplateFields(
  inlinePayload: unknown,
  existingPayload: unknown,
): unknown {
  if (
    typeof inlinePayload !== "object" ||
    inlinePayload === null ||
    typeof existingPayload !== "object" ||
    existingPayload === null
  ) {
    return inlinePayload;
  }

  const inlinePayloadRecord = inlinePayload as Record<string, unknown>;
  const existingPayloadRecord = existingPayload as Record<string, unknown>;
  const mergedPayload: Record<string, unknown> = { ...inlinePayloadRecord };

  for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
    const inlineTemplateFile = inlinePayloadRecord[spec.fileField];
    const existingTemplateFile = existingPayloadRecord[spec.fileField];
    const existingTemplateText = existingPayloadRecord[spec.textField];
    if (
      typeof inlineTemplateFile !== "string" ||
      inlineTemplateFile.length === 0 ||
      typeof existingTemplateFile !== "string" ||
      existingTemplateFile !== inlineTemplateFile ||
      typeof existingTemplateText !== "string" ||
      existingTemplateText.length === 0 ||
      mergedPayload[spec.textField] !== undefined
    ) {
      continue;
    }

    mergedPayload[spec.textField] = existingTemplateText;
  }

  return mergedPayload;
}

export function remapAuthoredNodePayloadsByNodeFile(
  workflow: unknown,
  nodePayloads: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (typeof workflow !== "object" || workflow === null) {
    return nodePayloads;
  }

  const workflowRecord = workflow as Record<string, unknown>;
  const nodesRaw = workflowRecord["nodes"];
  if (!Array.isArray(nodesRaw)) {
    return nodePayloads;
  }

  const remappedPayloads: Record<string, unknown> = { ...nodePayloads };
  for (const node of nodesRaw) {
    if (typeof node !== "object" || node === null) {
      continue;
    }

    const nodeRecord = node as Record<string, unknown>;
    const nodeId =
      typeof nodeRecord["id"] === "string" ? nodeRecord["id"] : undefined;
    const nodeFile = resolveAuthoredNodeFileReference(nodeRecord);
    if (!nodeId || nodeFile === undefined) {
      continue;
    }

    if (typeof nodeRecord["nodeFile"] !== "string") {
      const inlinePayload = nodeRecord[INLINE_NODE_FIELD];
      if (inlinePayload !== undefined) {
        remappedPayloads[nodeFile] = mergeResolvedInlineTemplateFields(
          inlinePayload,
          nodePayloads[nodeFile] ?? nodePayloads[nodeId],
        );
      }
      continue;
    }

    const payload = nodePayloads[nodeFile] ?? nodePayloads[nodeId];
    if (payload !== undefined) {
      remappedPayloads[nodeFile] = payload;
    }
  }

  return remappedPayloads;
}
