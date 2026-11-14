import { buildPromptTemplateVariables } from "./prompt-template-context";
import { renderPromptTemplate } from "./render";
import type { ArgumentBinding, NodePayload } from "./types";

export interface InputAssemblyContext {
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly node: NodePayload;
  readonly workflowId?: string;
  readonly workflowDescription?: string;
  readonly nodeKind?: string;
  readonly upstream: readonly Readonly<Record<string, unknown>>[];
  readonly transcript: readonly Readonly<Record<string, unknown>>[];
}

export interface AssembledNodeInput {
  readonly promptText: string;
  readonly arguments: Readonly<Record<string, unknown>> | null;
}

function deepCloneRecord(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function parsePath(pathValue: string): readonly string[] {
  return pathValue
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function getAtPath(value: unknown, pathValue: string | undefined): unknown {
  if (pathValue === undefined || pathValue.length === 0) {
    return value;
  }
  const segments = parsePath(pathValue);
  let current: unknown = value;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setAtPath(
  target: Record<string, unknown>,
  pathValue: string,
  value: unknown,
): void {
  const segments = parsePath(pathValue);
  if (segments.length === 0) {
    throw new Error("binding targetPath must be non-empty");
  }

  let current: Record<string, unknown> = target;
  const last = segments[segments.length - 1];
  if (last === undefined) {
    throw new Error("binding targetPath must be non-empty");
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment === undefined) {
      continue;
    }
    const existing = current[segment];
    if (typeof existing === "object" && existing !== null) {
      current = existing as Record<string, unknown>;
      continue;
    }
    const next: Record<string, unknown> = {};
    current[segment] = next;
    current = next;
  }

  current[last] = value;
}

function pickUpstreamEntry(
  upstream: readonly Readonly<Record<string, unknown>>[],
  sourceRef: Readonly<Record<string, unknown>> | string | undefined,
): Readonly<Record<string, unknown>> | null {
  if (upstream.length === 0) {
    return null;
  }

  if (sourceRef === undefined) {
    return upstream[upstream.length - 1] ?? null;
  }

  if (typeof sourceRef === "string") {
    const byNodeId = [...upstream]
      .reverse()
      .find((entry) => entry["fromNodeId"] === sourceRef);
    return byNodeId ?? null;
  }

  const nodeId = sourceRef["nodeId"];
  if (typeof nodeId === "string" && nodeId.length > 0) {
    const byNodeId = [...upstream]
      .reverse()
      .find((entry) => entry["fromNodeId"] === nodeId);
    return byNodeId ?? null;
  }

  return upstream[upstream.length - 1] ?? null;
}

function resolveBindingSource(
  source: ArgumentBinding["source"],
  ctx: InputAssemblyContext,
  sourceRef: Readonly<Record<string, unknown>> | string | undefined,
): unknown {
  if (source === "variables") {
    return ctx.runtimeVariables;
  }
  if (source === "conversation-transcript") {
    return ctx.transcript;
  }
  if (source === "human-input") {
    return ctx.runtimeVariables["humanInput"];
  }
  if (
    source === "node-output" ||
    source === "sub-workflow-output" ||
    source === "workflow-output"
  ) {
    return pickUpstreamEntry(ctx.upstream, sourceRef);
  }
  return undefined;
}

export function assembleNodeInput(
  ctx: InputAssemblyContext,
): AssembledNodeInput {
  const mergedVariables = buildPromptTemplateVariables({
    nodeVariables: ctx.node.variables,
    runtimeVariables: ctx.runtimeVariables,
    ...(ctx.workflowId === undefined ? {} : { workflowId: ctx.workflowId }),
    ...(ctx.workflowDescription === undefined
      ? {}
      : { workflowDescription: ctx.workflowDescription }),
    nodeId: ctx.node.id,
    ...(ctx.nodeKind === undefined ? {} : { nodeKind: ctx.nodeKind }),
    upstream: ctx.upstream.map((entry) => ({
      fromNodeId:
        typeof entry["fromNodeId"] === "string" ? entry["fromNodeId"] : "",
      ...(typeof entry["fromSubWorkflowId"] === "string"
        ? { fromSubWorkflowId: entry["fromSubWorkflowId"] }
        : {}),
      ...(typeof entry["toSubWorkflowId"] === "string"
        ? { toSubWorkflowId: entry["toSubWorkflowId"] }
        : {}),
      ...(typeof entry["transitionWhen"] === "string"
        ? { transitionWhen: entry["transitionWhen"] }
        : {}),
      ...(typeof entry["communicationId"] === "string"
        ? { communicationId: entry["communicationId"] }
        : {}),
      ...(typeof entry["status"] === "string"
        ? { status: entry["status"] }
        : {}),
      output:
        typeof entry["output"] === "object" &&
        entry["output"] !== null &&
        !Array.isArray(entry["output"])
          ? (entry["output"] as Readonly<Record<string, unknown>>)
          : {},
      ...(typeof entry["outputRaw"] === "string"
        ? { outputRaw: entry["outputRaw"] }
        : {}),
    })),
  });
  const promptText = renderPromptTemplate(
    ctx.node.promptTemplate ?? "",
    mergedVariables,
  );

  if (
    ctx.node.argumentsTemplate === undefined &&
    ctx.node.argumentBindings === undefined
  ) {
    return { promptText, arguments: null };
  }

  const base: Record<string, unknown> =
    ctx.node.argumentsTemplate === undefined
      ? {}
      : deepCloneRecord(ctx.node.argumentsTemplate);
  const bindings = ctx.node.argumentBindings ?? [];

  for (const binding of bindings) {
    const sourceRoot = resolveBindingSource(
      binding.source,
      ctx,
      binding.sourceRef,
    );
    const value = getAtPath(sourceRoot, binding.sourcePath);
    if (value === undefined) {
      if (binding.required === true) {
        throw new Error(
          `required binding resolution failed for target '${binding.targetPath}' from source '${binding.source}'`,
        );
      }
      continue;
    }
    setAtPath(base, binding.targetPath, value);
  }

  return { promptText, arguments: base };
}
