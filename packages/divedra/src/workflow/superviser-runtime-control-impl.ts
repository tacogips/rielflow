import { loadSession, type SessionStoreOptions } from "./session-store";
import {
  loadWorkflowFromDisk,
  mergeLoadOptionsForSessionMutableBundle,
} from "./load";
import { isSafeWorkflowName } from "./paths";
import { err, ok, type Result } from "./result";
import type { WorkflowRunFailure, WorkflowRunResult } from "./engine";
import { saveWorkflowToDisk } from "./save";
import type { WorkflowRunOptions } from "./engine";
import type { AutoImprovePolicy } from "./types";
import type { WorkflowSessionState } from "./session";
import type {
  GetWorkflowExecutionDetailsAddonInput,
  GetWorkflowStatusAddonInput,
  LoadWorkflowDefinitionAddonInput,
  RerunWorkflowAddonInput,
  SaveWorkflowDefinitionAddonInput,
  StartWorkflowAddonInput,
  StartTargetWorkflowOutput,
  GetWorkflowStatusOutput,
  GetWorkflowExecutionDetailsOutput,
  RerunTargetWorkflowOutput,
  LoadWorkflowDefinitionOutput,
  SaveWorkflowDefinitionOutput,
  SuperviserControlAuth,
} from "./types";
import type { SuperviserRuntimeControl } from "./superviser-control";
import { resolveNestedSuperviserAddonRerunFromStepId } from "./superviser";

function stripRunOptionsForSuperviserControlPlane(
  o: WorkflowRunOptions,
): WorkflowRunOptions {
  const {
    nestedSuperviserDriver: _n,
    superviserControl: _c,
    autoImprove: _a,
    supervisionLoopExecution: _s,
    resumeSessionId: _r0,
    rerunFromSessionId: _r1,
    rerunFromStepId: _r2,
    sessionId: _sid0,
    ...rest
  } = o;
  return rest;
}

/**
 * Strips outer-run routing, auto-improve loop, and nested-superviser driver fields so invocations
 * of the supervised target workflow from the superviser control plane do not inherit the wrong
 * `sessionId`, resume, or rerun context.
 */
export function workflowRunBaseForSuperviserControl(
  o: WorkflowRunOptions,
): WorkflowRunOptions {
  return stripRunOptionsForSuperviserControlPlane(o);
}

function targetSessionMismatchError(operation: string): string {
  return `${operation}: sessionId does not match target session`;
}

function targetWorkflowMismatchError(
  operation: string,
  expectedWorkflowId: string,
  actualWorkflowId: string,
): string {
  return (
    `${operation}: persisted target session workflowId must be ` +
    `'${expectedWorkflowId}' (got '${actualWorkflowId}')`
  );
}

async function loadVerifiedTargetSession(input: {
  readonly sessionId: string;
  readonly expectedSessionId: string;
  readonly expectedWorkflowId: string;
  readonly store: SessionStoreOptions;
  readonly operation: string;
}): Promise<Result<WorkflowSessionState, string>> {
  if (input.sessionId !== input.expectedSessionId) {
    return err(targetSessionMismatchError(input.operation));
  }
  const sessionResult = await loadSession(input.sessionId, input.store);
  if (!sessionResult.ok) {
    return err(sessionResult.error.message);
  }
  if (sessionResult.value.workflowId !== input.expectedWorkflowId) {
    return err(
      targetWorkflowMismatchError(
        input.operation,
        input.expectedWorkflowId,
        sessionResult.value.workflowId,
      ),
    );
  }
  return ok(sessionResult.value);
}

function getMutableWorkflowDirFromSession(
  session: Pick<WorkflowSessionState, "supervision">,
  operation: string,
): Result<string, string> {
  const mutableWorkflowDir = session.supervision?.mutableWorkflowDir;
  if (mutableWorkflowDir === undefined) {
    return err(`${operation}: mutable bundle path missing on supervision`);
  }
  return ok(mutableWorkflowDir);
}

async function loadMutableWorkflowSession(input: {
  readonly sessionId: string;
  readonly expectedSessionId: string;
  readonly expectedWorkflowId: string;
  readonly store: SessionStoreOptions;
  readonly operation: string;
}): Promise<
  Result<
    {
      readonly session: WorkflowSessionState;
      readonly mutableWorkflowDir: string;
    },
    string
  >
> {
  const sessionResult = await loadVerifiedTargetSession(input);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  const mutableWorkflowDirResult = getMutableWorkflowDirFromSession(
    sessionResult.value,
    input.operation,
  );
  if (!mutableWorkflowDirResult.ok) {
    return mutableWorkflowDirResult;
  }
  return ok({
    session: sessionResult.value,
    mutableWorkflowDir: mutableWorkflowDirResult.value,
  });
}

function serializeSessionForSuperviserDetails(
  session: WorkflowSessionState,
): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(session, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  ) as Record<string, unknown>;
}

/**
 * Real {@link SuperviserRuntimeControl} for phase-2 nested superviser workflows. Constructed
 * per supervision cycle in the engine and passed to `runWorkflowInternal` for the superviser bundle.
 */
export function buildSuperviserRuntimeControl(input: {
  readonly base: WorkflowRunOptions;
  readonly runWorkflow: (
    workflowName: string,
    options: WorkflowRunOptions,
  ) => Promise<Result<WorkflowRunResult, WorkflowRunFailure>>;
  readonly auth: SuperviserControlAuth;
  readonly targetWorkflowName: string;
  readonly targetExpectedWorkflowId: string;
  readonly defaultPolicy: AutoImprovePolicy;
}): SuperviserRuntimeControl {
  const {
    base,
    runWorkflow,
    targetWorkflowName,
    defaultPolicy,
    targetExpectedWorkflowId,
    auth,
  } = input;

  const store: SessionStoreOptions = base;

  return {
    auth,
    startTargetWorkflow: async (
      start: Readonly<StartWorkflowAddonInput>,
    ): Promise<Result<StartTargetWorkflowOutput, string>> => {
      if (start.workflowId !== targetExpectedWorkflowId) {
        return err(
          `divedra/start-workflow: workflowId must be the supervised target id '${targetExpectedWorkflowId}' (got '${start.workflowId}')`,
        );
      }
      const targetSessionResult = await loadVerifiedTargetSession({
        sessionId: auth.targetSessionId,
        expectedSessionId: auth.targetSessionId,
        expectedWorkflowId: targetExpectedWorkflowId,
        store,
        operation: "divedra/start-workflow",
      });
      if (!targetSessionResult.ok) {
        return targetSessionResult;
      }
      const baseForTargetRun = stripRunOptionsForSuperviserControlPlane(base);
      const runtimeVariables =
        start.runtimeVariables === undefined
          ? baseForTargetRun.runtimeVariables
          : {
              ...(baseForTargetRun.runtimeVariables ?? {}),
              ...start.runtimeVariables,
            };
      const r = await runWorkflow(targetWorkflowName, {
        ...baseForTargetRun,
        ...(runtimeVariables === undefined ? {} : { runtimeVariables }),
        autoImprove: start.autoImprove ?? defaultPolicy,
        resumeSessionId: auth.targetSessionId,
      });
      if (!r.ok) {
        return err(r.error.message);
      }
      return ok({
        sessionId: r.value.session.sessionId,
        status: r.value.session.status,
      });
    },
    getWorkflowStatus: async (
      statusInput: Readonly<GetWorkflowStatusAddonInput>,
    ): Promise<Result<GetWorkflowStatusOutput, string>> => {
      const sessionResult = await loadVerifiedTargetSession({
        sessionId: statusInput.sessionId,
        expectedSessionId: auth.targetSessionId,
        expectedWorkflowId: targetExpectedWorkflowId,
        store,
        operation: "get-workflow-status",
      });
      if (!sessionResult.ok) {
        return sessionResult;
      }
      const session = sessionResult.value;
      return ok({
        sessionId: session.sessionId,
        status: session.status,
        workflowId: session.workflowId,
        ...(session.currentNodeId === undefined
          ? {}
          : { currentNodeId: session.currentNodeId }),
        ...(session.lastError === undefined
          ? {}
          : { lastError: session.lastError }),
      });
    },
    getWorkflowExecutionDetails: async (
      detailsInput: Readonly<GetWorkflowExecutionDetailsAddonInput>,
    ): Promise<Result<GetWorkflowExecutionDetailsOutput, string>> => {
      const sessionResult = await loadVerifiedTargetSession({
        sessionId: detailsInput.sessionId,
        expectedSessionId: auth.targetSessionId,
        expectedWorkflowId: targetExpectedWorkflowId,
        store,
        operation: "get-workflow-execution-details",
      });
      if (!sessionResult.ok) {
        return sessionResult;
      }
      return ok({
        session: serializeSessionForSuperviserDetails(sessionResult.value),
      });
    },
    rerunTargetWorkflow: async (
      rerunInput: Readonly<RerunWorkflowAddonInput>,
    ): Promise<Result<RerunTargetWorkflowOutput, string>> => {
      const sessionResult = await loadVerifiedTargetSession({
        sessionId: rerunInput.sessionId,
        expectedSessionId: auth.targetSessionId,
        expectedWorkflowId: targetExpectedWorkflowId,
        store,
        operation: "rerun-workflow",
      });
      if (!sessionResult.ok) {
        return sessionResult;
      }
      const targetSession = sessionResult.value;
      const loadOpts = mergeLoadOptionsForSessionMutableBundle(
        base,
        targetSession,
      );
      const wf = await loadWorkflowFromDisk(targetWorkflowName, loadOpts);
      if (!wf.ok) {
        return err(wf.error.message);
      }
      const stepAddressed = wf.value.bundle.workflow;
      const baseForTargetRun = stripRunOptionsForSuperviserControlPlane(base);
      const rerunFromStepId = resolveNestedSuperviserAddonRerunFromStepId(
        rerunInput.rerunFromStepId,
        targetSession,
        stepAddressed,
      );
      const res = await runWorkflow(targetWorkflowName, {
        ...baseForTargetRun,
        autoImprove: defaultPolicy,
        rerunFromSessionId: rerunInput.sessionId,
        rerunFromStepId,
      });
      if (!res.ok) {
        return err(res.error.message);
      }
      return ok({
        sessionId: res.value.session.sessionId,
        status: res.value.session.status,
      });
    },
    loadWorkflowDefinition: async (
      loadInput: Readonly<LoadWorkflowDefinitionAddonInput>,
    ): Promise<Result<LoadWorkflowDefinitionOutput, string>> => {
      if (loadInput.workflowId !== targetExpectedWorkflowId) {
        return err(
          "load-workflow-definition: workflowId does not match target",
        );
      }
      const sessionResult = await loadMutableWorkflowSession({
        sessionId: auth.targetSessionId,
        expectedSessionId: auth.targetSessionId,
        expectedWorkflowId: targetExpectedWorkflowId,
        store,
        operation: "load-workflow-definition",
      });
      if (!sessionResult.ok) {
        return sessionResult;
      }
      const { mutableWorkflowDir } = sessionResult.value;
      if (loadInput.mutableWorkflowDir !== mutableWorkflowDir) {
        return err(
          "load-workflow-definition: mutableWorkflowDir does not match supervision",
        );
      }
      const loaded = await loadWorkflowFromDisk(targetWorkflowName, {
        ...base,
        workflowBundleDirectoryOverride: loadInput.mutableWorkflowDir,
      });
      if (!loaded.ok) {
        return err(loaded.error.message);
      }
      return ok({
        workflowId: loadInput.workflowId,
        mutableWorkflowDir: loadInput.mutableWorkflowDir,
        bundle: {
          workflow: loaded.value.bundle.workflow,
          nodePayloads: loaded.value.bundle.nodePayloads,
        } as Readonly<Record<string, unknown>>,
      });
    },
    saveWorkflowDefinition: async (
      saveInput: Readonly<SaveWorkflowDefinitionAddonInput>,
    ): Promise<Result<SaveWorkflowDefinitionOutput, string>> => {
      if (saveInput.workflowId !== targetExpectedWorkflowId) {
        return err(
          "save-workflow-definition: workflowId does not match target",
        );
      }
      const sessionResult = await loadMutableWorkflowSession({
        sessionId: auth.targetSessionId,
        expectedSessionId: auth.targetSessionId,
        expectedWorkflowId: targetExpectedWorkflowId,
        store,
        operation: "save-workflow-definition",
      });
      if (!sessionResult.ok) {
        return sessionResult;
      }
      const { mutableWorkflowDir } = sessionResult.value;
      if (saveInput.mutableWorkflowDir !== mutableWorkflowDir) {
        return err(
          "save-workflow-definition: mutableWorkflowDir does not match supervision",
        );
      }
      if (!isSafeWorkflowName(targetWorkflowName)) {
        return err(
          "save-workflow-definition: target workflow name is not safe to persist",
        );
      }
      const w = await saveWorkflowToDisk(
        targetWorkflowName,
        {
          workflow: saveInput.bundle.workflow,
          nodePayloads: saveInput.bundle.nodePayloads,
        },
        {
          ...base,
          workflowBundleDirectoryOverride: saveInput.mutableWorkflowDir,
        },
      );
      if (!w.ok) {
        return err(w.error.message);
      }
      return ok({
        saved: true,
        workflowId: saveInput.workflowId,
        mutableWorkflowDir: saveInput.mutableWorkflowDir,
      });
    },
  };
}
