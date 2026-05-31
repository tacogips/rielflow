import { workflowRunSetupPort } from "./workflow-runner-deps";
import type { NodeAdapter } from "../adapter";
import { DispatchingNodeAdapter } from "../adapters/dispatch";
import type { LoadedWorkflow, LoadFailure } from "../load";
import type { ManagerSessionStore } from "../manager-session-store";
import type { Result } from "../result";
import type { WorkflowSessionState } from "../session";
import type { LoadedTemporaryWorkflow } from "../temporary-workflow";
import type {
  LoopRule,
  NodePayload,
  WorkflowJson,
  WorkflowNodeRef,
} from "../types";
import type { SupervisionRunState } from "../types-supervision";
import type {
  CancellationProbe,
  EngineExecutionGuards,
  NormalizedWorkflowRunOptions,
  WorkflowRunFailure,
} from "./types-and-session-state";

const {
  loadWorkflowFromDisk,
  createManagerSessionStore,
  createExecutionCopyMutableWorkspace,
  resolveEffectiveRoots,
  resolveWorkflowScopedPath,
  err,
  ok,
  inspectWorkflowRuntimeReadiness,
  ScenarioNodeAdapter,
  loadSession,
  loadPersistedTemporaryWorkflowPayload,
  getStructuralLoops,
  resolveWorkflowExecutionWorkingDirectory,
  createInitialSupervisionRunState,
} = workflowRunSetupPort;

export interface PrepareWorkflowRunInput {
  readonly workflowName: string;
  readonly options: NormalizedWorkflowRunOptions;
  readonly adapter: NodeAdapter | undefined;
  readonly guards: EngineExecutionGuards | undefined;
  readonly crossWorkflowInvocationStack: readonly string[];
}

export type LoadedWorkflowSuccess = {
  readonly ok: true;
  readonly value: LoadedWorkflow;
};

interface WorkflowForPreparedRun {
  readonly loaded: Result<LoadedWorkflow, LoadFailure>;
  readonly temporaryWorkflow?: LoadedTemporaryWorkflow;
}

async function loadWorkflowForPreparedRun(
  workflowName: string,
  options: NormalizedWorkflowRunOptions,
  preloadedSession: WorkflowSessionState | undefined,
): Promise<WorkflowForPreparedRun> {
  if (options.temporaryWorkflow !== undefined) {
    return {
      loaded: ok(options.temporaryWorkflow.loadedWorkflow),
      temporaryWorkflow: options.temporaryWorkflow,
    };
  }
  if (preloadedSession?.temporaryWorkflowSource !== undefined) {
    const roots = resolveEffectiveRoots(options);
    const artifactWorkflowRoot = resolveWorkflowScopedPath(
      roots.artifactRoot,
      preloadedSession.workflowId,
    );
    if (artifactWorkflowRoot === undefined) {
      return {
        loaded: err({
          code: "VALIDATION",
          message: "temporary workflow source session has invalid workflowId",
        }),
      };
    }
    const persisted = await loadPersistedTemporaryWorkflowPayload({
      artifactWorkflowRoot,
      workflowExecutionId: preloadedSession.sessionId,
      options,
    });
    return persisted.ok
      ? {
          loaded: ok(persisted.value.loadedWorkflow),
          temporaryWorkflow: persisted.value,
        }
      : { loaded: err(persisted.error) };
  }
  return { loaded: await loadWorkflowFromDisk(workflowName, options) };
}

export interface PreparedWorkflowRun {
  readonly workflowName: string;
  readonly options: NormalizedWorkflowRunOptions;
  readonly adapter: NodeAdapter | undefined;
  readonly guards: EngineExecutionGuards | undefined;
  readonly crossWorkflowInvocationStack: readonly string[];
  readonly workflowWorkingDirectory: string;
  readonly resumeRequested: boolean;
  readonly rerunRequested: boolean;
  readonly continuationRequested: boolean;
  readonly isFreshAutoImproveSeed: boolean;
  readonly preloadedForBundlePath: WorkflowSessionState | undefined;
  readonly precomputedSupervision: SupervisionRunState | undefined;
  readonly temporaryWorkflowForRun: LoadedTemporaryWorkflow | undefined;
  readonly loaded: LoadedWorkflowSuccess;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly workflow: WorkflowJson;
  readonly stepAddressedExecution: true;
  readonly executionTargetNoun: "step";
  readonly nodeMap: Readonly<Record<string, NodePayload>>;
  readonly workflowNodes: ReadonlyMap<string, WorkflowNodeRef>;
  readonly loopRuleByJudgeNodeId: ReadonlyMap<string, LoopRule>;
  readonly effectiveAdapter: NodeAdapter;
  readonly cancellationProbe: CancellationProbe;
  readonly managerSessionStore: ManagerSessionStore;
}

export async function prepareWorkflowRun(
  input: PrepareWorkflowRunInput,
): Promise<Result<PreparedWorkflowRun, WorkflowRunFailure>> {
  const {
    workflowName,
    options,
    adapter,
    guards,
    crossWorkflowInvocationStack,
  } = input;
  let workflowWorkingDirectory: string;
  try {
    workflowWorkingDirectory = resolveWorkflowExecutionWorkingDirectory({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.workflowWorkingDirectory === undefined
        ? {}
        : { workflowWorkingDirectory: options.workflowWorkingDirectory }),
    });
  } catch (error: unknown) {
    return err({
      exitCode: 2,
      message:
        error instanceof Error
          ? error.message
          : "workingDirectory must be a non-empty path when provided",
    });
  }
  const resumeRequested = options.resumeSessionId !== undefined;
  const rerunRequested = options.rerunFromSessionId !== undefined;
  const continuationRequested =
    options.continueFromWorkflowExecutionId !== undefined;
  if (
    [resumeRequested, rerunRequested, continuationRequested].filter(Boolean)
      .length > 1
  ) {
    return err({
      exitCode: 2,
      message:
        "resumeSessionId, rerunFromSessionId, and continueFromWorkflowExecutionId are mutually exclusive",
    });
  }
  const isFreshAutoImproveSeed =
    !resumeRequested && !rerunRequested && !continuationRequested;
  let preloadedForBundlePath: WorkflowSessionState | undefined;
  if (options.resumeSessionId !== undefined) {
    const pre = await loadSession(options.resumeSessionId, options);
    if (!pre.ok) {
      return err({ exitCode: 1, message: pre.error.message });
    }
    if (pre.value.workflowName !== workflowName) {
      return err({
        exitCode: 1,
        message: "session workflow does not match command workflow",
      });
    }
    preloadedForBundlePath = pre.value;
  } else if (options.rerunFromSessionId !== undefined) {
    const pre = await loadSession(options.rerunFromSessionId, options);
    if (!pre.ok) {
      return err({ exitCode: 1, message: pre.error.message });
    }
    if (pre.value.workflowName !== workflowName) {
      return err({
        exitCode: 1,
        message: "source session workflow does not match command workflow",
      });
    }
    preloadedForBundlePath = pre.value;
  } else if (options.continueFromWorkflowExecutionId !== undefined) {
    const pre = await loadSession(
      options.continueFromWorkflowExecutionId,
      options,
    );
    if (!pre.ok) {
      return err({ exitCode: 1, message: pre.error.message });
    }
    if (pre.value.workflowName !== workflowName) {
      return err({
        exitCode: 1,
        message:
          "source workflow execution workflow does not match command workflow",
      });
    }
    preloadedForBundlePath = pre.value;
  }
  const bundlePathOverrideFromSession =
    preloadedForBundlePath?.supervision?.mutableWorkflowDir;
  const firstLoadOptions: NormalizedWorkflowRunOptions = {
    ...options,
    ...(options.workflowBundleDirectoryOverride === undefined &&
    bundlePathOverrideFromSession !== undefined
      ? { workflowBundleDirectoryOverride: bundlePathOverrideFromSession }
      : {}),
  };
  const initialLoad = await loadWorkflowForPreparedRun(
    workflowName,
    firstLoadOptions,
    preloadedForBundlePath,
  );
  let loaded = initialLoad.loaded;
  if (!loaded.ok) {
    return err({
      exitCode:
        loaded.error.code === "VALIDATION" ||
        loaded.error.code === "INVALID_WORKFLOW_NAME"
          ? 2
          : 1,
      message: loaded.error.message,
    });
  }
  let precomputedSupervision: SupervisionRunState | undefined;
  if (isFreshAutoImproveSeed && options.autoImprove !== undefined) {
    const policy = options.autoImprove;
    const initial = createInitialSupervisionRunState({
      policy,
      targetWorkflowId: loaded.value.bundle.workflow.workflowId,
    });
    const roots = resolveEffectiveRoots(options);
    if (
      loaded.value.source?.scope === "temporary" &&
      policy.maxWorkflowPatches > 0
    ) {
      return err({
        exitCode: 2,
        message:
          "temporary workflows do not support auto-improve workflow patching; use --no-auto-improve or omit --auto-improve",
      });
    }
    if (loaded.value.source?.scope === "temporary") {
      precomputedSupervision = initial;
    } else {
      const workspace = await createExecutionCopyMutableWorkspace({
        workflowId: loaded.value.bundle.workflow.workflowId,
        sourceWorkflowDir: loaded.value.workflowDirectory,
        artifactRoot: roots.artifactRoot,
        supervisionRunId: initial.supervisionRunId,
        mutationMode: policy.workflowMutationMode,
      });
      if (!workspace.ok) {
        return err({
          exitCode: 1,
          message: `supervision workspace: ${workspace.error.message}`,
        });
      }
      precomputedSupervision = {
        ...initial,
        mutableWorkflowDir: workspace.value.mutableWorkflowDir,
      };
      if (workspace.value.mutationMode === "execution-copy") {
        const reloaded = await loadWorkflowFromDisk(workflowName, {
          ...options,
          workflowBundleDirectoryOverride: workspace.value.mutableWorkflowDir,
        });
        if (!reloaded.ok) {
          return err({
            exitCode:
              reloaded.error.code === "VALIDATION" ||
              reloaded.error.code === "INVALID_WORKFLOW_NAME"
                ? 2
                : 1,
            message: reloaded.error.message,
          });
        }
        loaded = reloaded;
      }
    }
  }
  const runtimeVariables = options.runtimeVariables ?? {};
  const workflow = loaded.value.bundle.workflow;
  const stepAddressedExecution = true;
  const executionTargetNoun = "step";
  const nodeMap = loaded.value.bundle.nodePayloads;
  const workflowNodes = new Map(
    workflow.nodes.map((entry) => [entry.id, entry]),
  );
  const loopRuleByJudgeNodeId = new Map<string, LoopRule>(
    getStructuralLoops(workflow).map((entry) => [entry.judgeNodeId, entry]),
  );
  const effectiveAdapter =
    adapter ??
    (options.mockScenario === undefined
      ? new DispatchingNodeAdapter()
      : new ScenarioNodeAdapter(options.mockScenario));
  if (
    adapter === undefined &&
    options.mockScenario === undefined &&
    options.dryRun !== true
  ) {
    const readiness = await inspectWorkflowRuntimeReadiness(
      loaded.value.bundle,
      options,
    );
    if (!readiness.ready) {
      return err({
        exitCode: 1,
        message: `workflow runtime readiness failed: ${readiness.blockers.join("; ")}`,
      });
    }
  }
  const cancellationProbe =
    guards?.cancellationProbe ??
    ({
      async isCancelled(sessionId: string): Promise<boolean> {
        const current = await loadSession(sessionId, options);
        return current.ok && current.value.status === "cancelled";
      },
    } satisfies CancellationProbe);
  const managerSessionStore = createManagerSessionStore(options);
  return ok({
    workflowName,
    options,
    adapter,
    guards,
    crossWorkflowInvocationStack,
    workflowWorkingDirectory,
    resumeRequested,
    rerunRequested,
    continuationRequested,
    isFreshAutoImproveSeed,
    preloadedForBundlePath,
    precomputedSupervision,
    temporaryWorkflowForRun: initialLoad.temporaryWorkflow,
    loaded,
    runtimeVariables,
    workflow,
    stepAddressedExecution,
    executionTargetNoun,
    nodeMap,
    workflowNodes,
    loopRuleByJudgeNodeId,
    effectiveAdapter,
    cancellationProbe,
    managerSessionStore,
  } satisfies PreparedWorkflowRun);
}
