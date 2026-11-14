import path from "node:path";
import {
  resolveAttachmentRoot,
  resolveSafeScopedPath,
  resolveWorkflowScopedPath,
} from "./paths";
import type { LoadOptions } from "./types";
import type {
  WorkflowMessageArtifactPathBase,
  WorkflowMessageArtifactRef,
} from "./runtime-db";

export interface MessageAttachmentScope {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationId: string;
}

export interface NormalizedMessageAttachmentPath {
  readonly pathBase: "attachment-root";
  readonly relativePath: string;
  readonly absolutePath: string;
}

function assertSafeIdentifier(label: string, value: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error(`${label} is not a safe message attachment path segment`);
  }
}

function normalizeRelativeMessagePath(relativePath: string): readonly string[] {
  const candidate = relativePath.trim();
  if (candidate.length === 0 || path.isAbsolute(candidate)) {
    throw new Error("message attachment path must be a relative path");
  }
  if (candidate.includes("\\")) {
    throw new Error("message attachment path must use forward slashes");
  }
  const segments = candidate.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new Error("message attachment path must not contain traversal");
  }
  return segments;
}

export function normalizeMessageAttachmentPath(
  scope: MessageAttachmentScope,
  relativePath: string,
  options: LoadOptions = {},
): NormalizedMessageAttachmentPath {
  assertSafeIdentifier("workflow execution id", scope.workflowExecutionId);
  assertSafeIdentifier("communication id", scope.communicationId);
  const segments = normalizeRelativeMessagePath(relativePath);
  const attachmentRoot = resolveAttachmentRoot(options);
  const workflowRoot = resolveWorkflowScopedPath(
    attachmentRoot,
    scope.workflowId,
    scope.workflowExecutionId,
  );
  if (workflowRoot === undefined) {
    throw new Error("workflow id is not safe for message attachment paths");
  }
  const absolutePath = resolveSafeScopedPath(
    workflowRoot,
    "messages",
    scope.communicationId,
    ...segments,
  );
  if (absolutePath === undefined) {
    throw new Error("message attachment path escapes its workflow scope");
  }
  return {
    pathBase: "attachment-root",
    relativePath: [
      scope.workflowId,
      scope.workflowExecutionId,
      "messages",
      scope.communicationId,
      ...segments,
    ].join("/"),
    absolutePath,
  };
}

export function resolveWorkflowMessageArtifactRef(
  ref: WorkflowMessageArtifactRef,
  options: LoadOptions = {},
): NormalizedMessageAttachmentPath {
  const root = resolveAttachmentRoot(options);
  const segments = normalizeRelativeMessagePath(ref.path);
  const absolutePath = path.resolve(root, ...segments);
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  if (
    absolutePath !== path.resolve(root) &&
    !absolutePath.startsWith(rootPrefix)
  ) {
    throw new Error("message artifact path escapes its configured root");
  }
  return {
    pathBase: "attachment-root",
    relativePath: ref.path,
    absolutePath,
  };
}

export function toWorkflowMessageArtifactRef(input: {
  readonly pathBase: WorkflowMessageArtifactPathBase;
  readonly path: string;
  readonly mediaType?: string;
  readonly byteLength?: number;
  readonly sourcePath?: string;
}): WorkflowMessageArtifactRef {
  return {
    pathBase: input.pathBase,
    path: input.path,
    ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    ...(input.byteLength === undefined ? {} : { byteLength: input.byteLength }),
    ...(input.sourcePath === undefined ? {} : { sourcePath: input.sourcePath }),
  };
}
