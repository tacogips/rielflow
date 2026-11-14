import path from "node:path";
import {
  createAsyncNodeAddonRegistry,
  createNodeAddonRegistry,
} from "../node-addons";
import { isSafeWorkflowName } from "../paths";
import {
  DEFAULT_MAX_LOOP_ITERATIONS,
  DEFAULT_NODE_TIMEOUT_MS,
  getNormalizedNodePayload,
  getStructuralEdges,
  getStructuralLoops,
  type AsyncNodeAddonPayloadResolver,
  type NodeAddonPayloadResolver,
  type NodePayload,
  type NormalizedWorkflowBundle,
  type ValidationIssue,
  type WorkflowJson,
  type WorkflowStepRef,
} from "../types";
import type { WorkflowValidationOptions } from "./validation-types-and-runtime-options";
import { isRecord, makeIssue } from "./validation-types-and-runtime-options";
import {
  applyPromptVariantTemplateOverride,
  resolveWorkflowStepExecutionRole,
} from "./node-payload-validation";
import {
  inferSingleManagerStepIdFromRawAsync,
  inferSingleManagerStepIdFromRawSync,
  intervalsPartiallyOverlap,
  pushCrossingIntervalIssue,
  resolveCalleeWorkflowEntry,
  resolveCalleeWorkflowJsonByIdAsync,
  resolveCalleeWorkflowJsonByIdSync,
} from "./output-contracts-and-callees";

export function validateCrossWorkflowCalleeEntryAlignmentSync(
  bundle: NormalizedWorkflowBundle,
  options: WorkflowValidationOptions,
  issues: ValidationIssue[],
): void {
  const workflowRoot = options.workflowRoot;
  if (workflowRoot === undefined || workflowRoot === "") {
    return;
  }
  const steps = bundle.workflow.steps;
  if (steps === undefined) {
    return;
  }

  const cwd = options.cwd ?? process.cwd();
  const resolvedRoot = path.isAbsolute(workflowRoot)
    ? workflowRoot
    : path.resolve(cwd, workflowRoot);

  const calleeEntryById = new Map<
    string,
    { status: "ok"; entry: string } | { status: "error"; message: string }
  >();

  function resolveCalleeEntry(
    calleeId: string,
  ): { ok: true; entry: string } | { ok: false; message: string } {
    const cached = calleeEntryById.get(calleeId);
    if (cached !== undefined) {
      return cached.status === "ok"
        ? { ok: true, entry: cached.entry }
        : { ok: false, message: cached.message };
    }

    try {
      const resolvedWorkflow = resolveCalleeWorkflowJsonByIdSync({
        workflowRoot: resolvedRoot,
        workflowId: calleeId,
      });
      if (!resolvedWorkflow.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: resolvedWorkflow.message,
        });
        return { ok: false, message: resolvedWorkflow.message };
      }
      const inferred = inferSingleManagerStepIdFromRawSync({
        raw: resolvedWorkflow.raw,
        workflowDirectory: resolvedWorkflow.workflowDirectory,
      });
      if (!inferred.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: inferred.message,
        });
        return { ok: false, message: inferred.message };
      }
      const resolved = resolveCalleeWorkflowEntry({
        raw: resolvedWorkflow.raw,
        ...(inferred.managerStepId === undefined
          ? {}
          : { inferredManagerStepId: inferred.managerStepId }),
      });
      if (!resolved.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: resolved.message,
        });
        return { ok: false, message: resolved.message };
      }
      calleeEntryById.set(calleeId, { status: "ok", entry: resolved.entry });
      return { ok: true, entry: resolved.entry };
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "failed to read callee workflow.json";
      calleeEntryById.set(calleeId, { status: "error", message });
      return { ok: false, message };
    }
  }

  for (const [stepIndex, step] of steps.entries()) {
    const transitions = step.transitions ?? [];
    for (const [ti, transition] of transitions.entries()) {
      if (transition.toWorkflowId === undefined) {
        continue;
      }
      const calleeId = transition.toWorkflowId;
      if (!isSafeWorkflowName(calleeId)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toWorkflowId`,
            `must be a safe workflow directory name (got '${calleeId}')`,
          ),
        );
        continue;
      }
      const resolved = resolveCalleeEntry(calleeId);
      if (!resolved.ok) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toWorkflowId`,
            `cannot load callee workflow '${calleeId}': ${resolved.message}`,
          ),
        );
        continue;
      }
      if (transition.toStepId !== resolved.entry) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toStepId`,
            `must match callee start step '${resolved.entry}' (callee '${calleeId}': managerStepId, else entryStepId); cross-workflow step calls use the callee's step-addressed start target`,
          ),
        );
      }
    }
  }
}
export async function validateCrossWorkflowCalleeEntryAlignment(
  bundle: NormalizedWorkflowBundle,
  options: WorkflowValidationOptions,
  issues: ValidationIssue[],
): Promise<void> {
  const workflowRoot = options.workflowRoot;
  if (workflowRoot === undefined || workflowRoot === "") {
    return;
  }
  const steps = bundle.workflow.steps;
  if (steps === undefined) {
    return;
  }

  const cwd = options.cwd ?? process.cwd();
  const resolvedRoot = path.isAbsolute(workflowRoot)
    ? workflowRoot
    : path.resolve(cwd, workflowRoot);

  const calleeEntryById = new Map<
    string,
    { status: "ok"; entry: string } | { status: "error"; message: string }
  >();

  async function resolveCalleeEntry(
    calleeId: string,
  ): Promise<{ ok: true; entry: string } | { ok: false; message: string }> {
    const cached = calleeEntryById.get(calleeId);
    if (cached !== undefined) {
      return cached.status === "ok"
        ? { ok: true, entry: cached.entry }
        : { ok: false, message: cached.message };
    }

    try {
      const resolvedWorkflow = await resolveCalleeWorkflowJsonByIdAsync({
        workflowRoot: resolvedRoot,
        workflowId: calleeId,
      });
      if (!resolvedWorkflow.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: resolvedWorkflow.message,
        });
        return { ok: false, message: resolvedWorkflow.message };
      }
      const inferred = await inferSingleManagerStepIdFromRawAsync({
        raw: resolvedWorkflow.raw,
        workflowDirectory: resolvedWorkflow.workflowDirectory,
      });
      if (!inferred.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: inferred.message,
        });
        return { ok: false, message: inferred.message };
      }
      const resolved = resolveCalleeWorkflowEntry({
        raw: resolvedWorkflow.raw,
        ...(inferred.managerStepId === undefined
          ? {}
          : { inferredManagerStepId: inferred.managerStepId }),
      });
      if (!resolved.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: resolved.message,
        });
        return { ok: false, message: resolved.message };
      }
      calleeEntryById.set(calleeId, { status: "ok", entry: resolved.entry });
      return { ok: true, entry: resolved.entry };
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "failed to read callee workflow.json";
      calleeEntryById.set(calleeId, { status: "error", message });
      return { ok: false, message };
    }
  }

  for (const [stepIndex, step] of steps.entries()) {
    const transitions = step.transitions ?? [];
    for (const [ti, transition] of transitions.entries()) {
      if (transition.toWorkflowId === undefined) {
        continue;
      }
      const calleeId = transition.toWorkflowId;
      if (!isSafeWorkflowName(calleeId)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toWorkflowId`,
            `must be a safe workflow directory name (got '${calleeId}')`,
          ),
        );
        continue;
      }
      const resolved = await resolveCalleeEntry(calleeId);
      if (!resolved.ok) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toWorkflowId`,
            `cannot load callee workflow '${calleeId}': ${resolved.message}`,
          ),
        );
        continue;
      }
      if (transition.toStepId !== resolved.entry) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toStepId`,
            `must match callee start step '${resolved.entry}' (callee '${calleeId}': managerStepId, else entryStepId); cross-workflow step calls use the callee's step-addressed start target`,
          ),
        );
      }
    }
  }
}
export function runSemanticValidation(
  bundle: NormalizedWorkflowBundle,
  issues: ValidationIssue[],
): void {
  const structuralEdges = getStructuralEdges(bundle.workflow);
  const structuralLoops = getStructuralLoops(bundle.workflow);
  const nodeIdSet = new Set(bundle.workflow.nodes.map((node) => node.id));
  const nodeOrderByNodeId = new Map(
    bundle.workflow.nodes.map((node, order) => [node.id, order]),
  );

  const seenNodeIds = new Set<string>();
  bundle.workflow.nodes.forEach((node, index) => {
    if (seenNodeIds.has(node.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.nodes[${index}].id`,
          `duplicate node id '${node.id}'`,
        ),
      );
      return;
    }
    seenNodeIds.add(node.id);

    const payload = getNormalizedNodePayload(bundle, node.id);
    if (!payload) {
      issues.push(
        makeIssue(
          "error",
          `nodePayloads.${node.nodeFile}`,
          "node payload file is missing",
        ),
      );
      return;
    }

    if (
      node.role === "manager" &&
      (payload.nodeType === "command" ||
        payload.nodeType === "container" ||
        payload.nodeType === "user-action" ||
        payload.nodeType === "addon")
    ) {
      issues.push(
        makeIssue(
          "error",
          `nodePayloads.${node.nodeFile}.nodeType`,
          "manager-role nodes must stay on the agent execution path",
        ),
      );
    }
    if (node.role !== "manager" && payload.managerType !== undefined) {
      issues.push(
        makeIssue(
          "error",
          `nodePayloads.${node.nodeFile}.managerType`,
          "managerType is valid only for manager-role nodes",
        ),
      );
    }

    if (
      payload.timeoutMs === undefined &&
      bundle.workflow.defaults.nodeTimeoutMs === DEFAULT_NODE_TIMEOUT_MS
    ) {
      issues.push(
        makeIssue(
          "warning",
          `nodePayloads.${node.nodeFile}.timeoutMs`,
          "not set; workflow default timeout will be applied",
        ),
      );
    }
  });

  structuralEdges.forEach((edge, index) => {
    if (!nodeIdSet.has(edge.from)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}].transitions`,
          "must reference an existing step id",
        ),
      );
    }
    if (!nodeIdSet.has(edge.to)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}].transitions`,
          "must reference an existing step id",
        ),
      );
    }
  });

  structuralLoops.forEach((loop, index) => {
    if (!nodeIdSet.has(loop.judgeNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.loops[${index}].judgeNodeId`,
          "must reference an existing node id",
        ),
      );
      return;
    }
    const judgeNode = bundle.workflow.nodes.find(
      (node) => node.id === loop.judgeNodeId,
    );
    if (judgeNode?.kind !== "loop-judge") {
      issues.push(
        makeIssue(
          "error",
          `workflow.loops[${index}].judgeNodeId`,
          "must reference a loop-judge node",
        ),
      );
    }
  });

  const loopIntervals: Array<{
    readonly id: string;
    readonly startOrder: number;
    readonly endOrder: number;
  }> = [];
  structuralLoops.forEach((loop, index) => {
    const judgeOrder = nodeOrderByNodeId.get(loop.judgeNodeId);
    if (judgeOrder === undefined) {
      return;
    }

    const continueTargets = structuralEdges.filter(
      (edge) =>
        edge.from === loop.judgeNodeId && edge.when === loop.continueWhen,
    );
    if (continueTargets.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `workflow.loops[${index}].continueWhen`,
          "must have at least one matching continue edge from the loop judge",
        ),
      );
    }
    continueTargets.forEach((edge, continueIndex) => {
      const targetOrder = nodeOrderByNodeId.get(edge.to);
      if (targetOrder === undefined) {
        return;
      }
      if (targetOrder <= judgeOrder) {
        loopIntervals.push({
          id: loop.id,
          startOrder: targetOrder,
          endOrder: judgeOrder,
        });
      }
      if (targetOrder > judgeOrder) {
        issues.push(
          makeIssue(
            "error",
            `workflow.loops[${index}].continueWhen`,
            `continue edge target '${edge.to}' must appear before loop judge '${loop.judgeNodeId}' in vertical order`,
          ),
        );
      }
      if (
        continueIndex > 0 &&
        targetOrder !== undefined &&
        targetOrder !== nodeOrderByNodeId.get(continueTargets[0]?.to ?? "")
      ) {
        issues.push(
          makeIssue(
            "warning",
            `workflow.loops[${index}].continueWhen`,
            "multiple continue targets produce a shared visual loop block based on the earliest target",
          ),
        );
      }
    });

    structuralEdges
      .filter(
        (edge) => edge.from === loop.judgeNodeId && edge.when === loop.exitWhen,
      )
      .forEach((edge) => {
        const targetOrder = nodeOrderByNodeId.get(edge.to);
        if (targetOrder === undefined) {
          return;
        }
        if (targetOrder <= judgeOrder) {
          issues.push(
            makeIssue(
              "error",
              `workflow.loops[${index}].exitWhen`,
              `exit edge target '${edge.to}' must appear after loop judge '${loop.judgeNodeId}' in vertical order`,
            ),
          );
        }
      });
  });

  for (let index = 0; index < loopIntervals.length; index += 1) {
    const current = loopIntervals[index];
    if (current === undefined) {
      continue;
    }
    for (
      let compareIndex = index + 1;
      compareIndex < loopIntervals.length;
      compareIndex += 1
    ) {
      const other = loopIntervals[compareIndex];
      if (other === undefined || current.id === other.id) {
        continue;
      }
      if (intervalsPartiallyOverlap(current, other)) {
        pushCrossingIntervalIssue(issues, bundle, {
          path: "workflow.loops",
          leftId: current.id,
          leftStartOrder: current.startOrder,
          rightId: other.id,
          rightStartOrder: other.startOrder,
          messagePrefix: "vertical loop scopes",
        });
      }
    }
  }

  if (
    bundle.workflow.defaults.maxLoopIterations === DEFAULT_MAX_LOOP_ITERATIONS
  ) {
    issues.push(
      makeIssue(
        "warning",
        "workflow.defaults.maxLoopIterations",
        "using default loop iteration value; consider explicit value per workflow",
      ),
    );
  }
}
export function validateResolvedAddonPayload(input: {
  readonly authoredAddonName: string;
  readonly expectedNodeId: string;
  readonly payload: unknown;
  readonly path: string;
  readonly issues: ValidationIssue[];
}): boolean {
  const payload = input.payload;
  let valid = true;
  if (!isRecord(payload)) {
    input.issues.push(
      makeIssue("error", `${input.path}.payload`, "must be an object"),
    );
    return false;
  }
  if (payload["id"] !== input.expectedNodeId) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.path}.payload.id`,
        `resolved add-on payload id must be '${input.expectedNodeId}'`,
      ),
    );
    valid = false;
  }
  if (
    !input.authoredAddonName.startsWith("divedra/") &&
    payload["nodeType"] === "addon"
  ) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.path}.payload.nodeType`,
        "third-party add-on resolvers must return an ordinary agent, command, container, or user-action payload",
      ),
    );
    valid = false;
  }
  if (
    !input.authoredAddonName.startsWith("divedra/") &&
    payload["addon"] !== undefined
  ) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.path}.payload.addon`,
        "third-party add-on resolvers must not return runtime add-on metadata",
      ),
    );
    valid = false;
  }
  return valid;
}
export function resolveSyncNodeAddonResolvers(
  options: WorkflowValidationOptions,
  issues: ValidationIssue[],
): readonly NodeAddonPayloadResolver[] | undefined {
  if (
    options.asyncNodeAddonResolvers !== undefined &&
    options.asyncNodeAddonResolvers.length > 0
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.nodes",
        "async node add-on resolvers require validateWorkflowBundleAsync or loadWorkflowFromDisk",
      ),
    );
  }

  return options.nodeAddons === undefined || options.nodeAddons.length === 0
    ? options.nodeAddonResolvers
    : [
        ...(options.nodeAddonResolvers ?? []),
        createNodeAddonRegistry(options.nodeAddons),
      ];
}
export function resolveAsyncNodeAddonResolvers(
  options: WorkflowValidationOptions,
): readonly AsyncNodeAddonPayloadResolver[] | undefined {
  const resolvers: AsyncNodeAddonPayloadResolver[] = [
    ...(options.nodeAddonResolvers ?? []),
    ...(options.asyncNodeAddonResolvers ?? []),
  ];
  if (options.nodeAddons !== undefined && options.nodeAddons.length > 0) {
    resolvers.push(createAsyncNodeAddonRegistry(options.nodeAddons));
  }
  return resolvers.length === 0 ? undefined : resolvers;
}
export function applyStepPromptVariant(input: {
  readonly basePayload: NodePayload;
  readonly workflow: Pick<WorkflowJson, "managerStepId">;
  readonly step: WorkflowStepRef;
  readonly issues: ValidationIssue[];
  readonly stepPath: string;
}): NodePayload {
  const { basePayload, step } = input;
  const stepRole = resolveWorkflowStepExecutionRole(input.workflow, step);
  if (stepRole !== "manager" && basePayload.managerType !== undefined) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.stepPath}.nodeId`,
        `references node '${step.nodeId}' whose payload declares managerType; managerType is valid only for manager-role steps`,
      ),
    );
  }

  const resolvedPayload: NodePayload = {
    ...basePayload,
    id: step.id,
    ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
    ...(step.stallTimeoutMs === undefined
      ? {}
      : { stallTimeoutMs: step.stallTimeoutMs }),
    ...(step.sessionPolicy?.mode === undefined
      ? {}
      : { sessionPolicy: { mode: step.sessionPolicy.mode } }),
  };
  const payloadWithResolvedManagerType =
    stepRole === "manager"
      ? {
          ...resolvedPayload,
          managerType: basePayload.managerType ?? "code",
        }
      : (() => {
          const { managerType: _managerType, ...payloadWithoutManagerType } =
            resolvedPayload;
          return payloadWithoutManagerType;
        })();

  if (step.promptVariant === undefined) {
    return payloadWithResolvedManagerType;
  }

  const variant = basePayload.promptVariants?.[step.promptVariant];
  if (variant === undefined) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.stepPath}.promptVariant`,
        `must reference a promptVariants entry on node '${step.nodeId}'`,
      ),
    );
    return payloadWithResolvedManagerType;
  }

  return [
    {
      templateField: "systemPromptTemplate" as const,
      templateFileField: "systemPromptTemplateFile" as const,
    },
    {
      templateField: "promptTemplate" as const,
      templateFileField: "promptTemplateFile" as const,
    },
    {
      templateField: "sessionStartPromptTemplate" as const,
      templateFileField: "sessionStartPromptTemplateFile" as const,
    },
  ].reduce(
    (payload, templatePair) =>
      applyPromptVariantTemplateOverride({
        payload,
        variant,
        templateField: templatePair.templateField,
        templateFileField: templatePair.templateFileField,
      }),
    payloadWithResolvedManagerType,
  );
}
