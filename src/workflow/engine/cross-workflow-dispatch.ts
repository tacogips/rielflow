import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile as writeJsonFile } from "../../shared/fs";
import type { NodeAdapter } from "../adapter";
import type { CrossWorkflowDispatch } from "../cross-workflow-from-steps";
import {
  buildFanoutGroupRunId,
  buildFanoutJoinRuntimeVariables,
  buildFanoutRuntimeVariables,
  buildFanoutStepBudget,
  findPriorBranchWorkspaceRoot,
  itemAsWorkflowCallPayload,
  persistFanoutJoinOutputRef,
  prepareFanoutBranchWorkspace,
  resolveChildFanoutConcurrencyBudget,
  resolveFanoutConcurrency,
  resolveFanoutItems,
  runBoundedFanoutBranches,
} from "../engine-fanout";
import { loadWorkflowByIdFromDisk } from "../load";
import type { ParsedManagerControl } from "../manager-control";
import { err, ok, type Result } from "../result";
import { isWorkflowOutputKindNode } from "../runtime-addressing";
import { evaluateBranch } from "../semantics";
import {
  buildOutputRefForExecution,
  type CommunicationRecord,
  type FanoutBranchRecord,
  type FanoutGroupRunRecord,
  type NodeExecutionRecord,
  type OutputRef,
  type PendingOptionalNodeDecision,
  type WorkflowSessionState,
} from "../session";
import type { WorkflowJson } from "../types";
import { resolveWorkflowManagerStepId } from "../types";
import type {
  EngineExecutionGuards,
  NormalizedWorkflowRunOptions,
  WorkflowRunOptions,
} from "./types-and-session-state";
import {
  dedupeNodeIds,
  isOptionalNode,
  upsertPendingOptionalNodeDecision,
} from "./types-and-session-state";
import {
  persistCommunicationArtifact,
  runWorkflowInternal,
} from "./mailbox-and-communications";

export function applyOptionalManagerDecisions(input: {
  readonly managerControl: ParsedManagerControl | null;
  readonly session: WorkflowSessionState;
  readonly workflow: WorkflowJson;
  readonly managerStepId: string;
  readonly managerNodeExecId: string;
  readonly decidedAt: string;
}): Result<
  {
    readonly pendingOptionalNodeDecisions: readonly PendingOptionalNodeDecision[];
    readonly queuedNodeIds: readonly string[];
  },
  string
> {
  const optionalTargetNoun =
    input.workflow.steps !== undefined ? "step" : "node";
  const managerControl = input.managerControl;
  if (managerControl === null) {
    return ok({
      pendingOptionalNodeDecisions:
        input.session.pendingOptionalNodeDecisions ?? [],
      queuedNodeIds: [],
    });
  }

  const actionsByNodeId = new Map<
    string,
    { readonly status: "execute" | "skip"; readonly reason?: string }
  >();
  for (const action of managerControl.actions) {
    if (
      action.type !== "execute-optional-step" &&
      action.type !== "skip-optional-step"
    ) {
      continue;
    }
    const nextStatus =
      action.type === "execute-optional-step" ? "execute" : "skip";
    const existingAction = actionsByNodeId.get(action.stepId);
    if (existingAction !== undefined && existingAction.status !== nextStatus) {
      return err(
        `invalid manager control at '${input.managerStepId}': optional ${optionalTargetNoun} '${action.stepId}' cannot be both executed and skipped in one manager turn`,
      );
    }
    actionsByNodeId.set(action.stepId, {
      status: nextStatus,
      ...(action.type === "skip-optional-step" && action.reason !== undefined
        ? { reason: action.reason }
        : {}),
    });
  }

  let pendingOptionalNodeDecisions =
    input.session.pendingOptionalNodeDecisions ?? [];
  const queuedNodeIds: string[] = [];
  for (const [nodeId, action] of actionsByNodeId.entries()) {
    const currentDecision = pendingOptionalNodeDecisions.find(
      (entry) => entry.nodeId === nodeId,
    );
    if (currentDecision === undefined || currentDecision.status !== "pending") {
      return err(
        `invalid manager control at '${input.managerStepId}': optional ${optionalTargetNoun} '${nodeId}' is not currently pending`,
      );
    }
    if (currentDecision.owningManagerStepId !== input.managerStepId) {
      return err(
        `invalid manager control at '${input.managerStepId}': optional ${optionalTargetNoun} '${nodeId}' is owned by '${currentDecision.owningManagerStepId}'`,
      );
    }
    if (!isOptionalNode(input.workflow, nodeId)) {
      return err(
        `invalid manager control at '${input.managerStepId}': ${optionalTargetNoun} '${nodeId}' is not optional`,
      );
    }
    pendingOptionalNodeDecisions = upsertPendingOptionalNodeDecision(
      pendingOptionalNodeDecisions,
      {
        ...currentDecision,
        status: action.status,
        ...(action.status === "skip" && action.reason !== undefined
          ? { reason: action.reason }
          : {}),
        decidedAt: input.decidedAt,
        decidedByNodeExecId: input.managerNodeExecId,
      },
    );
    queuedNodeIds.push(nodeId);
  }

  return ok({
    pendingOptionalNodeDecisions,
    queuedNodeIds: dedupeNodeIds(queuedNodeIds),
  });
}
export function findLatestPublishedWorkflowResult(
  workflow: WorkflowJson,
  session: WorkflowSessionState,
): NodeExecutionRecord | undefined {
  return [...session.nodeExecutions]
    .reverse()
    .find(
      (entry) =>
        entry.status === "succeeded" &&
        isWorkflowOutputKindNode(workflow, entry.nodeId),
    );
}
export const CROSS_WORKFLOW_DISPATCH_TRANSITION_WHEN_PREFIX = "workflow-call:";
export function findLatestCrossWorkflowCalleeResultExecution(
  workflow: WorkflowJson,
  session: WorkflowSessionState,
): NodeExecutionRecord | undefined {
  const published = findLatestPublishedWorkflowResult(workflow, session);
  if (published !== undefined) {
    return published;
  }

  if (workflow.hasManagerNode !== false) {
    return undefined;
  }

  return [...session.nodeExecutions]
    .reverse()
    .find((entry) => entry.status === "succeeded");
}
export function buildCrossWorkflowCalleeRuntimeVariables(input: {
  readonly callerRuntimeVariables: Readonly<Record<string, unknown>>;
  readonly callerWorkflowId: string;
  readonly callerWorkflowExecutionId: string;
  readonly callerNodeRegistryId: string;
  readonly callerStepId: string;
  readonly crossWorkflowDispatchId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const filteredCallerRuntimeVariables = Object.fromEntries(
    Object.entries(input.callerRuntimeVariables).filter(
      ([key]) =>
        key !== "humanInput" &&
        key !== "workflowOutput" &&
        key !== "workflowCall",
    ),
  );

  return {
    ...filteredCallerRuntimeVariables,
    workflowCall: {
      id: input.crossWorkflowDispatchId,
      parentWorkflowId: input.callerWorkflowId,
      parentWorkflowExecutionId: input.callerWorkflowExecutionId,
      callerNodeId: input.callerNodeRegistryId,
      callerStepId: input.callerStepId,
      input: input.payload,
    },
  };
}
export function buildCrossWorkflowCalleeRunOptions(
  options: NormalizedWorkflowRunOptions,
  runtimeVariables: Readonly<Record<string, unknown>>,
  overrides: Pick<
    WorkflowRunOptions,
    | "fanoutBranchStartStepId"
    | "fanoutConcurrencyBudget"
    | "fanoutStepBudget"
    | "maxSteps"
    | "workflowWorkingDirectory"
  > = {},
): NormalizedWorkflowRunOptions {
  const maxSteps = overrides.maxSteps ?? options.maxSteps;
  const workflowWorkingDirectory =
    overrides.workflowWorkingDirectory ?? options.workflowWorkingDirectory;
  return {
    ...(options.workflowRoot === undefined
      ? {}
      : { workflowRoot: options.workflowRoot }),
    ...(options.workflowScope === undefined
      ? {}
      : { workflowScope: options.workflowScope }),
    ...(options.userRoot === undefined ? {} : { userRoot: options.userRoot }),
    ...(options.projectRoot === undefined
      ? {}
      : { projectRoot: options.projectRoot }),
    ...(options.addonRoot === undefined
      ? {}
      : { addonRoot: options.addonRoot }),
    ...(options.resolvedWorkflowSource === undefined
      ? {}
      : { resolvedWorkflowSource: options.resolvedWorkflowSource }),
    ...(options.artifactRoot === undefined
      ? {}
      : { artifactRoot: options.artifactRoot }),
    ...(options.rootDataDir === undefined
      ? {}
      : { rootDataDir: options.rootDataDir }),
    ...(options.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: options.sessionStoreRoot }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.nodeAddons === undefined
      ? {}
      : { nodeAddons: options.nodeAddons }),
    ...(options.asyncNodeAddonResolvers === undefined
      ? {}
      : { asyncNodeAddonResolvers: options.asyncNodeAddonResolvers }),
    ...(options.nodeAddonResolvers === undefined
      ? {}
      : { nodeAddonResolvers: options.nodeAddonResolvers }),
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    runtimeVariables,
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(options.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: options.maxLoopIterations }),
    ...(options.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: options.defaultTimeoutMs }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(options.mockScenario === undefined
      ? {}
      : { mockScenario: options.mockScenario }),
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
    ...(options.eventSink === undefined
      ? {}
      : { eventSink: options.eventSink }),
    ...(options.debug === undefined ? {} : { debug: options.debug }),
    ...(options.restartOnStuck === undefined
      ? {}
      : { restartOnStuck: options.restartOnStuck }),
    ...(options.maxStuckRestarts === undefined
      ? {}
      : { maxStuckRestarts: options.maxStuckRestarts }),
    ...(options.stuckRestartBackoffMs === undefined
      ? {}
      : { stuckRestartBackoffMs: options.stuckRestartBackoffMs }),
    ...(overrides.fanoutBranchStartStepId === undefined
      ? {}
      : { fanoutBranchStartStepId: overrides.fanoutBranchStartStepId }),
    ...(overrides.fanoutConcurrencyBudget === undefined
      ? {}
      : { fanoutConcurrencyBudget: overrides.fanoutConcurrencyBudget }),
    ...(overrides.fanoutStepBudget === undefined
      ? {}
      : { fanoutStepBudget: overrides.fanoutStepBudget }),
  };
}
export async function persistCrossWorkflowDispatchArtifact(input: {
  readonly artifactDir: string;
  readonly callId: string;
  readonly callerStepId: string;
  readonly calleeWorkflowName: string;
  readonly calleeWorkflowId: string;
  readonly calleeSession: WorkflowSessionState;
  readonly callerNodeExecId: string;
  readonly resumeStepId: string;
  readonly resultOutputRef?: OutputRef;
  readonly fanoutGroupRunId?: string;
  readonly branchIndex?: number;
  readonly branchWorkspaceRoot?: string;
}): Promise<void> {
  await mkdir(path.join(input.artifactDir, "workflow-calls"), {
    recursive: true,
  });
  const callerExecId = input.callerNodeExecId;
  const calleeName = input.calleeWorkflowName;
  const calleeId = input.calleeWorkflowId;
  const calleeSessionId = input.calleeSession.sessionId;
  const calleeSessionStatus = input.calleeSession.status;
  await writeJsonFile(
    path.join(input.artifactDir, "workflow-calls", `${input.callId}.json`),
    {
      crossWorkflowDispatchId: input.callId,
      callerStepId: input.callerStepId,
      callerNodeExecId: callerExecId,
      ...(input.fanoutGroupRunId === undefined
        ? {}
        : { fanoutGroupRunId: input.fanoutGroupRunId }),
      ...(input.branchIndex === undefined
        ? {}
        : { branchIndex: input.branchIndex }),
      ...(input.branchWorkspaceRoot === undefined
        ? {}
        : { branchWorkspaceRoot: input.branchWorkspaceRoot }),
      calleeWorkflowName: calleeName,
      calleeWorkflowId: calleeId,
      calleeSessionId,
      calleeSessionStatus,
      resumeStepId: input.resumeStepId,
      ...(input.resultOutputRef === undefined
        ? {}
        : { resultOutputRef: input.resultOutputRef }),
    },
  );
}
export interface CrossWorkflowDispatchExecutionResult {
  readonly communications: readonly CommunicationRecord[];
  readonly communicationCounter: number;
  readonly queuedNodeIds: readonly string[];
  readonly transitions: readonly {
    readonly from: string;
    readonly to: string;
    readonly when: string;
  }[];
  readonly fanoutGroups?: readonly FanoutGroupRunRecord[];
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly session?: WorkflowSessionState;
  readonly failureMessage?: string;
  readonly pausedMessage?: string;
}
export interface ExecuteCrossWorkflowDispatchesInput {
  readonly workflow: WorkflowJson;
  readonly workflowName: string;
  readonly session: WorkflowSessionState;
  readonly options: NormalizedWorkflowRunOptions;
  readonly artifactWorkflowRoot: string;
  readonly callerNodeId: string;
  readonly callerStepId: string;
  readonly callerNodeRegistryId: string;
  readonly callerNodeExecId: string;
  readonly callerArtifactDir: string;
  readonly callerOutputPayload: Readonly<Record<string, unknown>>;
  readonly callerOutputRaw: string;
  readonly createdAt: string;
  readonly communicationCounter: number;
  readonly currentCommunications: readonly CommunicationRecord[];
  readonly adapter: NodeAdapter;
  readonly guards: EngineExecutionGuards | undefined;
  readonly crossWorkflowInvocationStack: readonly string[];
}
export function crossWorkflowDispatchMatchesCallerExecution(input: {
  readonly entry: CrossWorkflowDispatch;
  readonly callerStepId: string;
  readonly callerOutputPayload: Readonly<Record<string, unknown>>;
}): boolean {
  const { entry } = input;
  if (entry.when !== undefined) {
    if (
      !evaluateBranch({
        when: entry.when,
        output: input.callerOutputPayload,
      })
    ) {
      return false;
    }
  }
  return entry.callerStepId === input.callerStepId;
}
export async function executeCrossWorkflowFanoutDispatch(input: {
  readonly base: ExecuteCrossWorkflowDispatchesInput;
  readonly dispatch: CrossWorkflowDispatch;
  readonly currentCommunications: readonly CommunicationRecord[];
  readonly communicationCounter: number;
}): Promise<Result<CrossWorkflowDispatchExecutionResult, string>> {
  const fanout = input.dispatch.fanout;
  if (fanout === undefined) {
    return err("internal: cross-workflow fanout dispatch missing fanout");
  }
  if (
    input.base.crossWorkflowInvocationStack.includes(
      input.dispatch.workflowId,
    ) ||
    input.base.workflow.workflowId === input.dispatch.workflowId
  ) {
    return err(
      `cross-workflow dispatch '${input.dispatch.id}' would recurse into '${input.dispatch.workflowId}', which is not supported`,
    );
  }
  const loadedCallee = await loadWorkflowByIdFromDisk(
    input.dispatch.workflowId,
    input.base.options,
  );
  if (!loadedCallee.ok) {
    return err(
      `cross-workflow dispatch '${input.dispatch.id}' target '${input.dispatch.workflowId}' could not be loaded: ${loadedCallee.error.message}`,
    );
  }
  const items = resolveFanoutItems({
    fanout,
    outputPayload: input.base.callerOutputPayload,
  });
  if (!items.ok) {
    return err(
      `cross-workflow dispatch '${input.dispatch.id}' fanout: ${items.error}`,
    );
  }
  const concurrency = resolveFanoutConcurrency({
    workflow: input.base.workflow,
    fanout,
    ...(input.base.options.fanoutConcurrencyBudget === undefined
      ? {}
      : { budget: input.base.options.fanoutConcurrencyBudget }),
  });
  const childFanoutConcurrencyBudget = resolveChildFanoutConcurrencyBudget({
    parentBudget: input.base.options.fanoutConcurrencyBudget,
    parentConcurrency: concurrency,
  });
  const fanoutGroupRunId = buildFanoutGroupRunId({
    groupId: fanout.groupId,
    sourceNodeExecId: input.base.callerNodeExecId,
  });
  const fanoutStepBudget = buildFanoutStepBudget({
    options: input.base.options,
    parentNodeExecutionCounter: input.base.session.nodeExecutionCounter,
  });
  const calleeWorkflow = loadedCallee.value.bundle.workflow;
  const failurePolicy = fanout.failurePolicy ?? "fail-fast";
  const resultOrder = fanout.resultOrder ?? "input";
  let firstFailure: string | undefined;

  const branchResults = await runBoundedFanoutBranches<FanoutBranchRecord>(
    items.value,
    concurrency,
    async (branchIndex, item) => {
      const supersededWorkspaceRoot = findPriorBranchWorkspaceRoot({
        priorGroups: input.base.session.fanoutGroups ?? [],
        groupId: fanout.groupId,
        branchIndex,
      });
      const supersededRef =
        supersededWorkspaceRoot === undefined
          ? {}
          : { supersededWorkspaceRoot };

      if (failurePolicy === "fail-fast" && firstFailure !== undefined) {
        return {
          branchIndex,
          item,
          status: "cancelled" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
          error: "fanout fail-fast stopped before branch launch",
          ...supersededRef,
        } satisfies FanoutBranchRecord;
      }
      const branchRuntimeVariables = buildFanoutRuntimeVariables({
        baseRuntimeVariables: input.base.session.runtimeVariables,
        fanout,
        branchIndex,
        item,
      });
      const branchWorkspace = await prepareFanoutBranchWorkspace({
        fanout,
        options: input.base.options,
        sessionId: input.base.session.sessionId,
        fanoutGroupRunId,
        branchIndex,
      });
      if (!branchWorkspace.ok) {
        const message = `branch ${branchIndex}: ${branchWorkspace.error}`;
        firstFailure = firstFailure ?? message;
        return {
          branchIndex,
          item,
          status: "failed" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
          error: message,
          ...supersededRef,
        } satisfies FanoutBranchRecord;
      }
      const calleeRun = await runWorkflowInternal(
        loadedCallee.value.workflowName,
        buildCrossWorkflowCalleeRunOptions(
          input.base.options,
          buildCrossWorkflowCalleeRuntimeVariables({
            callerRuntimeVariables: branchRuntimeVariables,
            callerWorkflowId: input.base.workflow.workflowId,
            callerWorkflowExecutionId: input.base.session.sessionId,
            callerNodeRegistryId: input.base.callerNodeRegistryId,
            callerStepId: input.base.callerStepId,
            crossWorkflowDispatchId: input.dispatch.id,
            payload: itemAsWorkflowCallPayload(item),
          }),
          {
            fanoutConcurrencyBudget: childFanoutConcurrencyBudget,
            ...(fanoutStepBudget === undefined ? {} : { fanoutStepBudget }),
            ...(branchWorkspace.value === undefined
              ? {}
              : { workflowWorkingDirectory: branchWorkspace.value }),
          },
        ),
        input.base.adapter,
        input.base.guards,
        [
          ...input.base.crossWorkflowInvocationStack,
          input.base.workflow.workflowId,
        ],
      );
      if (!calleeRun.ok) {
        const message = `branch ${branchIndex}: ${calleeRun.error.message}`;
        firstFailure = firstFailure ?? message;
        return {
          branchIndex,
          item,
          status: "failed" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
          ...(branchWorkspace.value === undefined
            ? {}
            : { workspaceRoot: branchWorkspace.value }),
          error: message,
          ...supersededRef,
        } satisfies FanoutBranchRecord;
      }
      if (calleeRun.value.exitCode !== 0) {
        const message = `branch ${branchIndex}: callee workflow exited with ${calleeRun.value.exitCode}${
          calleeRun.value.session.lastError === undefined
            ? ""
            : `: ${calleeRun.value.session.lastError}`
        }`;
        firstFailure = firstFailure ?? message;
        return {
          branchIndex,
          item,
          status: "failed" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
          ...(branchWorkspace.value === undefined
            ? {}
            : { workspaceRoot: branchWorkspace.value }),
          error: message,
          ...supersededRef,
        } satisfies FanoutBranchRecord;
      }
      const calleeResultExecution =
        findLatestCrossWorkflowCalleeResultExecution(
          calleeWorkflow,
          calleeRun.value.session,
        );
      const calleeOutputRef =
        calleeResultExecution === undefined
          ? undefined
          : buildOutputRefForExecution({
              workflow: calleeWorkflow,
              session: calleeRun.value.session,
              execution: calleeResultExecution,
            });
      await persistCrossWorkflowDispatchArtifact({
        artifactDir: input.base.callerArtifactDir,
        callId: `${input.dispatch.id}-${branchIndex}`,
        callerStepId: input.dispatch.callerStepId,
        calleeWorkflowName: loadedCallee.value.workflowName,
        calleeWorkflowId: calleeWorkflow.workflowId,
        calleeSession: calleeRun.value.session,
        callerNodeExecId: input.base.callerNodeExecId,
        resumeStepId: input.dispatch.resumeStepId,
        fanoutGroupRunId,
        branchIndex,
        ...(calleeOutputRef === undefined
          ? {}
          : { resultOutputRef: calleeOutputRef }),
        ...(branchWorkspace.value === undefined
          ? {}
          : { branchWorkspaceRoot: branchWorkspace.value }),
      });
      if (
        calleeResultExecution === undefined ||
        calleeOutputRef === undefined
      ) {
        const message = `branch ${branchIndex}: cross-workflow dispatch '${input.dispatch.id}' completed without a result execution for '${input.dispatch.resumeStepId}'`;
        firstFailure = firstFailure ?? message;
        return {
          branchIndex,
          item,
          status: "failed" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
          ...(branchWorkspace.value === undefined
            ? {}
            : { workspaceRoot: branchWorkspace.value }),
          error: message,
          ...supersededRef,
        } satisfies FanoutBranchRecord;
      }
      return {
        branchIndex,
        item,
        status: "succeeded" as const,
        workItemId: `${fanoutGroupRunId}:${branchIndex}`,
        nodeExecIds: [calleeResultExecution.nodeExecId],
        outputRef: calleeOutputRef,
        ...(branchWorkspace.value === undefined
          ? {}
          : { workspaceRoot: branchWorkspace.value }),
        ...supersededRef,
      } satisfies FanoutBranchRecord;
    },
  );

  const completedBranches = branchResults.map((branch) => branch);
  const group: FanoutGroupRunRecord = {
    fanoutGroupRunId,
    groupId: fanout.groupId,
    sourceStepId: input.base.callerStepId,
    sourceNodeExecId: input.base.callerNodeExecId,
    ...(input.dispatch.when === undefined
      ? {}
      : { transitionLabel: input.dispatch.when }),
    targetStepId: input.dispatch.resumeStepId,
    targetWorkflowId: input.dispatch.workflowId,
    joinStepId: fanout.joinStepId,
    concurrency,
    failurePolicy,
    resultOrder,
    branches: completedBranches,
  };

  const failedBranches = completedBranches.filter(
    (branch) => branch.status === "failed" || branch.status === "cancelled",
  );
  if (failedBranches.length > 0) {
    return ok({
      communications: input.currentCommunications,
      communicationCounter: input.communicationCounter,
      queuedNodeIds: [],
      transitions: [],
      fanoutGroups: [...(input.base.session.fanoutGroups ?? []), group],
      failureMessage: `fanout group '${fanoutGroupRunId}' failed: ${failedBranches
        .map(
          (branch) =>
            `branch ${branch.branchIndex}: ${branch.error ?? branch.status}`,
        )
        .join("; ")}`,
    });
  }

  const aggregate = {
    fanoutGroupRunId,
    groupId: fanout.groupId,
    sourceStepId: input.base.callerStepId,
    resultOrder,
    results: completedBranches.map((branch) => ({
      branchIndex: branch.branchIndex,
      item: branch.item,
      status: branch.status,
      ...(branch.outputRef === undefined
        ? {}
        : { outputRef: branch.outputRef }),
      ...(branch.workspaceRoot === undefined
        ? {}
        : { workspaceRoot: branch.workspaceRoot }),
    })),
  };
  const aggregateOutput = await persistFanoutJoinOutputRef({
    artifactDir: input.base.callerArtifactDir,
    workflow: input.base.workflow,
    session: input.base.session,
    sourceStepId: input.base.callerStepId,
    sourceNodeExecId: input.base.callerNodeExecId,
    fanoutGroupRunId,
    aggregate,
  });
  const communication = await persistCommunicationArtifact({
    artifactWorkflowRoot: input.base.artifactWorkflowRoot,
    runtimeLogOptions: input.base.options,
    workflowId: input.base.workflow.workflowId,
    workflowExecutionId: input.base.session.sessionId,
    communicationCounter: input.communicationCounter,
    fromNodeId: input.base.callerNodeId,
    toNodeId: fanout.joinStepId,
    routingScope: "intra-workflow",
    deliveryKind: "edge-transition",
    transitionWhen: `fanout-join:${fanoutGroupRunId}`,
    sourceNodeExecId: input.base.callerNodeExecId,
    payloadRef: aggregateOutput.outputRef,
    outputRaw: aggregateOutput.outputRaw,
    deliveredByNodeId: resolveWorkflowManagerStepId(input.base.workflow),
    createdAt: input.base.createdAt,
  });

  return ok({
    communications: [...input.currentCommunications, communication],
    communicationCounter: input.communicationCounter + 1,
    queuedNodeIds: [fanout.joinStepId],
    transitions: [
      {
        from: input.dispatch.callerStepId,
        to: fanout.joinStepId,
        when: `fanout-join:${fanoutGroupRunId}`,
      },
    ],
    fanoutGroups: [...(input.base.session.fanoutGroups ?? []), group],
    runtimeVariables: buildFanoutJoinRuntimeVariables({
      baseRuntimeVariables: input.base.session.runtimeVariables,
      aggregate,
    }),
  });
}
