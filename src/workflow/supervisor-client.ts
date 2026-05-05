import { runWorkflow } from "./engine";
import { loadWorkflowFromCatalog } from "./load";
import { withResolvedWorkflowSourceOptions } from "./catalog";
import {
  getNormalizedNodePayload,
  resolveWorkflowManagerStepId,
} from "./types";
import { loadSession, saveSession } from "./session-store";
import type { WorkflowSessionState } from "./session";
import type { LoadOptions } from "./types";
import {
  createEventSupervisedRunRepository,
  newSupervisedRunId,
  resolveSupervisedRunArtifactDir,
} from "../events/supervised-runs";
import type {
  EventBinding,
  EventSupervisedRunRecord,
  EventSupervisedRunStatus,
  EventSupervisorCommand,
} from "../events/types";
import type { SupervisedRunCorrelationKey } from "../events/supervised-runs";
import type {
  RestartSupervisedWorkflowInput,
  StartSupervisedWorkflowInput,
  StopSupervisedWorkflowInput,
  SubmitSupervisedWorkflowInput,
  SupervisedWorkflowLookup,
  SupervisedWorkflowView,
  SupervisorEngineOverrides,
  WorkflowSupervisorClient,
} from "./supervisor-client-types";
import {
  dedupeNodeIds,
  resolveAutoImproveEnabled,
  resolveMaxRestarts,
  resolveSupervisorWorkflowName,
} from "./supervisor-client-policy";

export type {
  RestartSupervisedWorkflowInput,
  StartSupervisedWorkflowInput,
  StopSupervisedWorkflowInput,
  SubmitSupervisedWorkflowInput,
  SupervisedWorkflowLookup,
  SupervisedWorkflowView,
  SupervisorEngineOverrides,
  WorkflowSupervisorClient,
};

function nowIso(): string {
  return new Date().toISOString();
}

function isTerminalTargetStatus(
  status: WorkflowSessionState["status"],
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function localEngineOverrides(
  input: SupervisorEngineOverrides | undefined,
): Pick<
  SupervisorEngineOverrides,
  | "mockScenario"
  | "dryRun"
  | "maxSteps"
  | "maxLoopIterations"
  | "defaultTimeoutMs"
> {
  if (input === undefined) {
    return {};
  }
  return {
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
  };
}

function mergeRuntimeVariables(
  base: Readonly<Record<string, unknown>>,
  overlay?: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (overlay === undefined) {
    return base;
  }
  return { ...base, ...overlay };
}

function resolvePublicCommandId(input: {
  readonly idempotencyKey: string | undefined;
  readonly prefix: string;
  readonly scope: string;
}): string {
  if (input.idempotencyKey !== undefined && input.idempotencyKey.length > 0) {
    return input.idempotencyKey;
  }
  return `${input.prefix}-${nowIso()}-${input.scope}`;
}

function requireNonEmptyLookupValue(
  value: string | undefined,
  label: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

async function cancelTargetSession(
  sessionId: string,
  options: LoadOptions,
): Promise<void> {
  const loaded = await loadSession(sessionId, options);
  if (!loaded.ok) {
    return;
  }
  if (isTerminalTargetStatus(loaded.value.status)) {
    return;
  }
  const cancelled: WorkflowSessionState = {
    ...loaded.value,
    status: "cancelled",
    endedAt: nowIso(),
    lastError: "cancelled by event supervisor",
  };
  const saved = await saveSession(cancelled, options);
  if (!saved.ok) {
    throw new Error(saved.error.message);
  }
}

async function resolveWorkflowOptionsForName(
  workflowName: string,
  loadOptions: LoadOptions,
): Promise<LoadOptions> {
  const loaded = await loadWorkflowFromCatalog(workflowName, loadOptions);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  const src = loaded.value.source;
  return src === undefined
    ? loadOptions
    : withResolvedWorkflowSourceOptions(src, loadOptions);
}

export function eventBindingStubFromSupervisedRunRecord(
  record: EventSupervisedRunRecord,
): EventBinding {
  return {
    id: record.bindingId,
    sourceId: record.sourceId,
    workflowName: record.targetWorkflowName,
    inputMapping: { mode: "event-input" },
    execution: {
      mode: "supervised",
      supervisorWorkflowName: record.supervisorWorkflowName,
      maxRestartsOnFailure: record.maxRestartsOnFailure,
      autoImprove: record.autoImproveEnabled,
    },
  };
}

function viewFrom(
  record: EventSupervisedRunRecord,
  activeTargetStatus?: WorkflowSessionState["status"],
): SupervisedWorkflowView {
  return {
    supervisedRun: record,
    ...(activeTargetStatus === undefined ? {} : { activeTargetStatus }),
  };
}

async function activeTargetStatusFor(
  record: EventSupervisedRunRecord,
  options: LoadOptions,
): Promise<WorkflowSessionState["status"] | undefined> {
  const id = record.activeTargetExecutionId;
  if (id === undefined) {
    return undefined;
  }
  const loaded = await loadSession(id, options);
  if (!loaded.ok) {
    return undefined;
  }
  return loaded.value.status;
}

/**
 * When the supervised-run row is still in an active status but the linked
 * target session is already terminal, persist the terminal supervisor status
 * so the supervised-run record remains the lifecycle authority.
 */
export async function reconcileTerminalSupervisedRunRecord(
  record: EventSupervisedRunRecord,
  repo: {
    readonly save: (
      record: EventSupervisedRunRecord,
      artifactDir: string,
    ) => Promise<void>;
  },
  options: LoadOptions,
): Promise<EventSupervisedRunRecord> {
  const sessionId = record.activeTargetExecutionId;
  if (sessionId === undefined) {
    return record;
  }
  if (
    record.status !== "starting" &&
    record.status !== "running" &&
    record.status !== "stopping" &&
    record.status !== "restarting"
  ) {
    return record;
  }
  const loaded = await loadSession(sessionId, options);
  if (!loaded.ok) {
    return record;
  }
  const st = loaded.value.status;
  if (!isTerminalTargetStatus(st)) {
    return record;
  }
  let nextStatus: EventSupervisedRunStatus;
  if (st === "completed") {
    nextStatus = "completed";
  } else if (st === "failed") {
    nextStatus = "failed";
  } else {
    nextStatus = "stopped";
  }
  const { activeTargetExecutionId: _omit, ...persistable } = record;
  const updated: EventSupervisedRunRecord = {
    ...persistable,
    status: nextStatus,
    updatedAt: nowIso(),
  };
  const dir = resolveSupervisedRunArtifactDir(updated, options);
  await repo.save(updated, dir);
  return updated;
}

export async function reconcileTerminalSupervisedRunForCorrelation(
  correlation: SupervisedRunCorrelationKey,
  repo: {
    readonly findActiveByCorrelation: (
      input: SupervisedRunCorrelationKey,
    ) => Promise<EventSupervisedRunRecord | null>;
    readonly save: (
      record: EventSupervisedRunRecord,
      artifactDir: string,
    ) => Promise<void>;
  },
  options: LoadOptions,
): Promise<void> {
  const active = await repo.findActiveByCorrelation(correlation);
  if (active === null) {
    return;
  }
  await reconcileTerminalSupervisedRunRecord(active, repo, options);
}

function assertSupervisedCommandBindingConsistency(input: {
  readonly command: EventSupervisorCommand;
  readonly binding: EventBinding;
}): void {
  if (input.binding.execution?.mode !== "supervised") {
    throw new Error(
      'supervisor command binding requires execution.mode "supervised"',
    );
  }
  if (input.command.sourceId !== input.binding.sourceId) {
    throw new Error(
      "supervisor command sourceId does not match binding.sourceId",
    );
  }
  if (input.command.bindingId !== input.binding.id) {
    throw new Error("supervisor command bindingId does not match binding.id");
  }
  if (input.command.targetWorkflowName !== input.binding.workflowName) {
    throw new Error(
      "supervisor command targetWorkflowName does not match binding.workflowName",
    );
  }
}

export function createWorkflowSupervisorClient(
  baseOptions: LoadOptions = {},
): WorkflowSupervisorClient {
  const repo = createEventSupervisedRunRepository(baseOptions);

  async function resolveLookupRecord(
    input: SupervisedWorkflowLookup,
  ): Promise<EventSupervisedRunRecord> {
    if (
      input.supervisedRunId !== undefined &&
      input.supervisedRunId.length > 0
    ) {
      const byId = await repo.loadById(input.supervisedRunId);
      if (byId === null) {
        throw new Error(`unknown supervised run '${input.supervisedRunId}'`);
      }
      return await reconcileTerminalSupervisedRunRecord(
        byId,
        repo,
        baseOptions,
      );
    }
    if (
      input.sourceId === undefined ||
      input.bindingId === undefined ||
      input.correlationKey === undefined
    ) {
      throw new Error(
        "supervised workflow lookup requires supervisedRunId or sourceId+bindingId+correlationKey",
      );
    }
    const sourceId = requireNonEmptyLookupValue(
      input.sourceId,
      "input.sourceId",
    );
    const bindingId = requireNonEmptyLookupValue(
      input.bindingId,
      "input.bindingId",
    );
    const correlationKey = requireNonEmptyLookupValue(
      input.correlationKey,
      "input.correlationKey",
    );
    const latest = await repo.findLatestByCorrelation({
      sourceId,
      bindingId,
      correlationKey,
    });
    if (latest === null) {
      throw new Error("no supervised run matches the lookup");
    }
    return await reconcileTerminalSupervisedRunRecord(
      latest,
      repo,
      baseOptions,
    );
  }

  async function persistAndView(
    record: EventSupervisedRunRecord,
  ): Promise<SupervisedWorkflowView> {
    const dir = resolveSupervisedRunArtifactDir(record, baseOptions);
    await repo.save(record, dir);
    const st = await activeTargetStatusFor(record, baseOptions);
    return viewFrom(record, st);
  }

  async function dispatchCommandImpl(input: {
    readonly command: EventSupervisorCommand;
    readonly binding: EventBinding;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly engine?: SupervisorEngineOverrides;
  }): Promise<SupervisedWorkflowView> {
    assertSupervisedCommandBindingConsistency(input);
    const correlation = {
      sourceId: input.command.sourceId,
      bindingId: input.command.bindingId,
      correlationKey: input.command.correlationKey,
    };
    return repo.withCorrelationLock(correlation, async () => {
      const binding = input.binding;
      const cmd = input.command;
      await reconcileTerminalSupervisedRunForCorrelation(
        correlation,
        repo,
        baseOptions,
      );
      const active = await repo.findActiveByCorrelation(correlation);
      const latest = await repo.findLatestByCorrelation(correlation);

      const scopedId =
        cmd.supervisedRunId !== undefined &&
        typeof cmd.supervisedRunId === "string" &&
        cmd.supervisedRunId.trim().length > 0
          ? cmd.supervisedRunId.trim()
          : undefined;

      let context: EventSupervisedRunRecord | null;
      let effectiveRunId: string;

      if (scopedId !== undefined) {
        const scopedRecord = await repo.loadById(scopedId);
        if (scopedRecord === null) {
          throw new Error(`unknown supervised run '${scopedId}'`);
        }
        if (
          scopedRecord.sourceId !== cmd.sourceId ||
          scopedRecord.bindingId !== cmd.bindingId ||
          scopedRecord.correlationKey !== cmd.correlationKey ||
          scopedRecord.targetWorkflowName !== cmd.targetWorkflowName
        ) {
          throw new Error(
            "supervised run id does not match supervisor command scope",
          );
        }
        if (active !== null && active.supervisedRunId !== scopedId) {
          throw new Error(
            "supervised run id does not match the active supervised run for this correlation key",
          );
        }
        if (cmd.action === "start") {
          if (latest !== null && latest.supervisedRunId !== scopedId) {
            throw new Error(
              "supervised run id is not the latest supervised run for this correlation key",
            );
          }
        }
        effectiveRunId = scopedId;
        context = cmd.action === "start" ? (active ?? latest) : scopedRecord;
      } else {
        effectiveRunId =
          active?.supervisedRunId ??
          latest?.supervisedRunId ??
          newSupervisedRunId();
        context = active ?? latest;
      }

      const claim = await repo.claimCommandSlot({
        command: cmd,
        supervisedRunId: effectiveRunId,
      });
      if (claim.outcome === "replay") {
        try {
          const parsed = JSON.parse(claim.resultJson) as {
            readonly result?: unknown;
          };
          const raw = parsed.result;
          if (raw !== undefined && raw !== null && typeof raw === "object") {
            const r = raw as { readonly error?: unknown };
            if (Object.prototype.hasOwnProperty.call(r, "error")) {
              if (typeof r.error === "string") {
                throw new Error(
                  r.error.length > 0
                    ? r.error
                    : "supervisor command failed (replay)",
                );
              }
              throw new Error("supervisor command failed (replay)");
            }
            return raw as SupervisedWorkflowView;
          }
        } catch (error: unknown) {
          if (error instanceof Error) {
            throw error;
          }
          throw new Error("invalid replay payload for supervisor command");
        }
        throw new Error("invalid replay payload for supervisor command");
      }

      const finalizeOk = async (view: SupervisedWorkflowView) => {
        await repo.finalizeCommand(cmd.commandId, view);
        return view;
      };

      const finalizeError = async (
        record: EventSupervisedRunRecord,
        message: string,
      ) => {
        await repo.finalizeCommand(cmd.commandId, {
          supervisedRun: record,
          error: message,
        });
      };

      const runVars = mergeRuntimeVariables(
        input.runtimeVariables,
        cmd.runtimeVariables,
      );
      let latestRecord = context;
      let shouldPersistErrorRecord = context !== null;

      const startSupervisedTarget = async (
        runId: string,
        prior: EventSupervisedRunRecord | null,
      ): Promise<SupervisedWorkflowView> => {
        const t = nowIso();
        const record: EventSupervisedRunRecord = {
          supervisedRunId: runId,
          sourceId: cmd.sourceId,
          bindingId: cmd.bindingId,
          correlationKey: cmd.correlationKey,
          supervisorWorkflowName: resolveSupervisorWorkflowName(binding),
          targetWorkflowName: cmd.targetWorkflowName,
          status: "starting",
          restartCount: prior?.restartCount ?? 0,
          maxRestartsOnFailure: resolveMaxRestarts(binding),
          autoImproveEnabled: resolveAutoImproveEnabled(binding),
          createdAt: prior?.createdAt ?? t,
          updatedAt: t,
          ...(prior?.supervisorExecutionId === undefined
            ? {}
            : { supervisorExecutionId: prior.supervisorExecutionId }),
        };
        latestRecord = record;
        shouldPersistErrorRecord = true;
        const artifactDir = resolveSupervisedRunArtifactDir(
          { supervisedRunId: runId },
          baseOptions,
        );
        await repo.save(record, artifactDir);
        const wfOptions = await resolveWorkflowOptionsForName(
          cmd.targetWorkflowName,
          baseOptions,
        );
        const started = await runWorkflow(cmd.targetWorkflowName, {
          ...wfOptions,
          ...localEngineOverrides(input.engine ?? {}),
          runtimeVariables: runVars,
        });
        if (!started.ok) {
          throw new Error(started.error.message);
        }
        latestRecord = {
          ...record,
          status: "running",
          activeTargetExecutionId: started.value.session.sessionId,
          updatedAt: nowIso(),
        };
        return finalizeOk(await persistAndView(latestRecord));
      };

      try {
        if (cmd.action === "status") {
          if (context === null) {
            throw new Error("no supervised run for status lookup");
          }
          const st = await activeTargetStatusFor(context, baseOptions);
          return finalizeOk(viewFrom(context, st));
        }

        if (cmd.action === "start") {
          if (active !== null && active.activeTargetExecutionId !== undefined) {
            const targetSession = await loadSession(
              active.activeTargetExecutionId,
              baseOptions,
            );
            if (
              targetSession.ok &&
              !isTerminalTargetStatus(targetSession.value.status)
            ) {
              return finalizeOk(viewFrom(active, targetSession.value.status));
            }
          }
          const priorStart =
            latest !== null && latest.supervisedRunId === effectiveRunId
              ? latest
              : null;
          return await startSupervisedTarget(effectiveRunId, priorStart);
        }

        if (context === null) {
          if (cmd.action === "input") {
            const startOnFirst =
              binding.execution?.control?.startOnFirstInput !== false;
            if (!startOnFirst) {
              throw new Error(
                "no supervised run for correlation key and startOnFirstInput is disabled",
              );
            }
            return await startSupervisedTarget(effectiveRunId, null);
          }
          throw new Error("no supervised run for this correlation key");
        }
        const ctx = context;

        if (cmd.action === "stop") {
          if (ctx.activeTargetExecutionId !== undefined) {
            await cancelTargetSession(ctx.activeTargetExecutionId, baseOptions);
          }
          const { activeTargetExecutionId: _omit, ...base } = ctx;
          const updated: EventSupervisedRunRecord = {
            ...base,
            status: "stopped",
            updatedAt: nowIso(),
          };
          latestRecord = updated;
          shouldPersistErrorRecord = true;
          return finalizeOk(await persistAndView(updated));
        }

        if (cmd.action === "restart") {
          if (ctx.restartCount >= ctx.maxRestartsOnFailure) {
            throw new Error(
              "supervised restart budget exhausted for this correlation key",
            );
          }
          if (ctx.activeTargetExecutionId !== undefined) {
            await cancelTargetSession(ctx.activeTargetExecutionId, baseOptions);
          }
          const { activeTargetExecutionId: _omitRestart, ...baseRestart } = ctx;
          const restarting: EventSupervisedRunRecord = {
            ...baseRestart,
            status: "restarting",
            updatedAt: nowIso(),
          };
          latestRecord = restarting;
          shouldPersistErrorRecord = true;
          await persistAndView(restarting);
          const wfOptions = await resolveWorkflowOptionsForName(
            cmd.targetWorkflowName,
            baseOptions,
          );
          const started = await runWorkflow(cmd.targetWorkflowName, {
            ...wfOptions,
            ...localEngineOverrides(input.engine ?? {}),
            runtimeVariables: runVars,
          });
          if (!started.ok) {
            throw new Error(started.error.message);
          }
          const updated: EventSupervisedRunRecord = {
            ...ctx,
            status: "running",
            activeTargetExecutionId: started.value.session.sessionId,
            restartCount: ctx.restartCount + 1,
            updatedAt: nowIso(),
          };
          latestRecord = updated;
          return finalizeOk(await persistAndView(updated));
        }

        if (cmd.action === "input") {
          const sessionId = ctx.activeTargetExecutionId;
          if (sessionId === undefined) {
            const startOnFirst =
              binding.execution?.control?.startOnFirstInput !== false;
            if (!startOnFirst) {
              throw new Error("no active target for supervised input");
            }
            return await startSupervisedTarget(effectiveRunId, ctx);
          }
          const loadedWf = await loadWorkflowFromCatalog(
            ctx.targetWorkflowName,
            baseOptions,
          );
          if (!loadedWf.ok) {
            throw new Error(loadedWf.error.message);
          }
          const managerStepId = resolveWorkflowManagerStepId(
            loadedWf.value.bundle.workflow,
          );
          const managerNode = getNormalizedNodePayload(
            loadedWf.value.bundle,
            managerStepId,
          );
          const existing = await loadSession(sessionId, baseOptions);
          if (!existing.ok) {
            throw new Error(existing.error.message);
          }
          const wfBase =
            loadedWf.value.source === undefined
              ? baseOptions
              : withResolvedWorkflowSourceOptions(
                  loadedWf.value.source,
                  baseOptions,
                );
          if (managerNode?.sessionPolicy?.mode === "reuse") {
            const { endedAt: _e, lastError: _l, ...resumable } = existing.value;
            const merged: WorkflowSessionState = {
              ...resumable,
              status: "running",
              queue: dedupeNodeIds([managerStepId, ...existing.value.queue]),
              currentNodeId: managerStepId,
              runtimeVariables: {
                ...existing.value.runtimeVariables,
                ...runVars,
              },
            };
            const saved = await saveSession(merged, baseOptions);
            if (!saved.ok) {
              throw new Error(saved.error.message);
            }
            const runAgain = await runWorkflow(ctx.targetWorkflowName, {
              ...wfBase,
              resumeSessionId: merged.sessionId,
              ...localEngineOverrides(input.engine ?? {}),
            });
            if (!runAgain.ok) {
              throw new Error(runAgain.error.message);
            }
            const nextRecord: EventSupervisedRunRecord = {
              ...ctx,
              activeTargetExecutionId: runAgain.value.session.sessionId,
              updatedAt: nowIso(),
            };
            return finalizeOk(await persistAndView(nextRecord));
          }
          const resumed = await runWorkflow(ctx.targetWorkflowName, {
            ...wfBase,
            resumeSessionId: sessionId,
            ...localEngineOverrides(input.engine ?? {}),
            ...(Object.keys(runVars).length === 0
              ? {}
              : { runtimeVariables: runVars }),
          });
          if (!resumed.ok) {
            throw new Error(resumed.error.message);
          }
          const nextRecord: EventSupervisedRunRecord = {
            ...ctx,
            activeTargetExecutionId: resumed.value.session.sessionId,
            updatedAt: nowIso(),
          };
          return finalizeOk(await persistAndView(nextRecord));
        }

        throw new Error(`unsupported supervisor action '${cmd.action}'`);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        if (shouldPersistErrorRecord) {
          const failedBase =
            latestRecord ??
            ({
              supervisedRunId: effectiveRunId,
              sourceId: cmd.sourceId,
              bindingId: cmd.bindingId,
              correlationKey: cmd.correlationKey,
              supervisorWorkflowName: resolveSupervisorWorkflowName(binding),
              targetWorkflowName: cmd.targetWorkflowName,
              restartCount: 0,
              maxRestartsOnFailure: resolveMaxRestarts(binding),
              autoImproveEnabled: resolveAutoImproveEnabled(binding),
              createdAt: nowIso(),
              updatedAt: nowIso(),
            } satisfies Omit<EventSupervisedRunRecord, "status"> & {
              readonly updatedAt: string;
            });
          const failed: EventSupervisedRunRecord = {
            ...failedBase,
            status: "failed" as EventSupervisedRunStatus,
            updatedAt: nowIso(),
          };
          try {
            await persistAndView(failed);
            latestRecord = failed;
          } catch {
            // best-effort
          }
          await finalizeError(failed, message);
        } else {
          await repo.finalizeCommand(cmd.commandId, { error: message });
        }
        throw error instanceof Error ? error : new Error(message);
      }
    });
  }

  const client: WorkflowSupervisorClient = {
    dispatchCommand: dispatchCommandImpl,

    async start(
      input: StartSupervisedWorkflowInput,
    ): Promise<SupervisedWorkflowView> {
      const commandId = resolvePublicCommandId({
        idempotencyKey: input.idempotencyKey,
        prefix: "lib-start",
        scope: input.correlationKey,
      });
      const cmd: EventSupervisorCommand = {
        commandId,
        sourceId: input.sourceId,
        bindingId: input.bindingId,
        correlationKey: input.correlationKey,
        action: "start",
        targetWorkflowName: input.targetWorkflowName,
        ...(input.runtimeVariables === undefined
          ? {}
          : { runtimeVariables: input.runtimeVariables }),
        receivedEventReceiptId: "library",
      };
      return dispatchCommandImpl({
        command: cmd,
        binding: input.bindingSnapshot,
        runtimeVariables: input.runtimeVariables ?? {},
        engine: {
          ...(input.mockScenario === undefined
            ? {}
            : { mockScenario: input.mockScenario }),
          ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
          ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
          ...(input.maxLoopIterations === undefined
            ? {}
            : { maxLoopIterations: input.maxLoopIterations }),
          ...(input.defaultTimeoutMs === undefined
            ? {}
            : { defaultTimeoutMs: input.defaultTimeoutMs }),
        },
      });
    },

    async stop(
      input: StopSupervisedWorkflowInput,
    ): Promise<SupervisedWorkflowView> {
      const record = await resolveLookupRecord(input);
      const cmd: EventSupervisorCommand = {
        commandId: resolvePublicCommandId({
          idempotencyKey: input.idempotencyKey,
          prefix: "lib-stop",
          scope: record.supervisedRunId,
        }),
        sourceId: record.sourceId,
        bindingId: record.bindingId,
        correlationKey: record.correlationKey,
        action: "stop",
        targetWorkflowName: record.targetWorkflowName,
        supervisedRunId: record.supervisedRunId,
        receivedEventReceiptId: "library",
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      };
      return dispatchCommandImpl({
        command: cmd,
        binding: eventBindingStubFromSupervisedRunRecord(record),
        runtimeVariables: {},
      });
    },

    async restart(
      input: RestartSupervisedWorkflowInput,
    ): Promise<SupervisedWorkflowView> {
      const record = await resolveLookupRecord(input);
      const cmd: EventSupervisorCommand = {
        commandId: resolvePublicCommandId({
          idempotencyKey: input.idempotencyKey,
          prefix: "lib-restart",
          scope: record.supervisedRunId,
        }),
        sourceId: record.sourceId,
        bindingId: record.bindingId,
        correlationKey: record.correlationKey,
        action: "restart",
        targetWorkflowName: record.targetWorkflowName,
        supervisedRunId: record.supervisedRunId,
        receivedEventReceiptId: "library",
        ...(input.runtimeVariables === undefined
          ? {}
          : { runtimeVariables: input.runtimeVariables }),
      };
      return dispatchCommandImpl({
        command: cmd,
        binding: eventBindingStubFromSupervisedRunRecord(record),
        runtimeVariables: input.runtimeVariables ?? {},
        engine: {
          ...(input.mockScenario === undefined
            ? {}
            : { mockScenario: input.mockScenario }),
          ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
          ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
          ...(input.maxLoopIterations === undefined
            ? {}
            : { maxLoopIterations: input.maxLoopIterations }),
          ...(input.defaultTimeoutMs === undefined
            ? {}
            : { defaultTimeoutMs: input.defaultTimeoutMs }),
        },
      });
    },

    async status(
      input: SupervisedWorkflowLookup,
    ): Promise<SupervisedWorkflowView> {
      const record = await resolveLookupRecord(input);
      const cmd: EventSupervisorCommand = {
        commandId: resolvePublicCommandId({
          idempotencyKey: input.idempotencyKey,
          prefix: "lib-status",
          scope: record.supervisedRunId,
        }),
        sourceId: record.sourceId,
        bindingId: record.bindingId,
        correlationKey: record.correlationKey,
        action: "status",
        targetWorkflowName: record.targetWorkflowName,
        supervisedRunId: record.supervisedRunId,
        receivedEventReceiptId: "library",
      };
      return dispatchCommandImpl({
        command: cmd,
        binding: eventBindingStubFromSupervisedRunRecord(record),
        runtimeVariables: {},
      });
    },

    async submitInput(
      input: SubmitSupervisedWorkflowInput,
    ): Promise<SupervisedWorkflowView> {
      let record: EventSupervisedRunRecord | null;
      try {
        record = await resolveLookupRecord(input);
      } catch (error: unknown) {
        if (
          !(error instanceof Error) ||
          error.message !== "no supervised run matches the lookup"
        ) {
          throw error;
        }
        record = null;
      }
      const binding =
        record === null
          ? input.bindingSnapshot
          : eventBindingStubFromSupervisedRunRecord(record);
      if (binding === undefined) {
        throw new Error(
          "supervised input start requires bindingSnapshot when no supervised run exists",
        );
      }
      const sourceId =
        record?.sourceId ??
        requireNonEmptyLookupValue(input.sourceId, "input.sourceId");
      const bindingId =
        record?.bindingId ??
        requireNonEmptyLookupValue(input.bindingId, "input.bindingId");
      const correlationKey =
        record?.correlationKey ??
        requireNonEmptyLookupValue(
          input.correlationKey,
          "input.correlationKey",
        );
      const targetWorkflowName =
        record?.targetWorkflowName ??
        requireNonEmptyLookupValue(
          input.targetWorkflowName,
          "input.targetWorkflowName",
        );
      const cmd: EventSupervisorCommand = {
        commandId: resolvePublicCommandId({
          idempotencyKey: input.idempotencyKey,
          prefix: "lib-input",
          scope: record?.supervisedRunId ?? correlationKey,
        }),
        sourceId,
        bindingId,
        correlationKey,
        action: "input",
        targetWorkflowName,
        ...(record === null ? {} : { supervisedRunId: record.supervisedRunId }),
        receivedEventReceiptId: "library",
        ...(input.runtimeVariables === undefined
          ? {}
          : { runtimeVariables: input.runtimeVariables }),
      };
      const withControl: EventBinding = {
        ...binding,
        execution: {
          ...binding.execution,
          ...(record === null
            ? {}
            : {
                control: {
                  ...binding.execution?.control,
                  startOnFirstInput: false,
                },
              }),
        },
      };
      return dispatchCommandImpl({
        command: cmd,
        binding: withControl,
        runtimeVariables: input.runtimeVariables ?? {},
        engine: {
          ...(input.mockScenario === undefined
            ? {}
            : { mockScenario: input.mockScenario }),
          ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
          ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
          ...(input.maxLoopIterations === undefined
            ? {}
            : { maxLoopIterations: input.maxLoopIterations }),
          ...(input.defaultTimeoutMs === undefined
            ? {}
            : { defaultTimeoutMs: input.defaultTimeoutMs }),
        },
      });
    },
  };

  return client;
}
