import {
  createEventSupervisedRunRepository,
  newSupervisedRunId,
  resolveSupervisedRunArtifactDir,
} from "../../events/supervised-runs";
import type {
  EventBinding,
  EventSupervisedRunRecord,
  EventSupervisedRunStatus,
  EventSupervisorCommand,
} from "../../events/types";
import { withResolvedWorkflowSourceOptions } from "../catalog";
import { runWorkflow } from "../engine";
import { loadWorkflowFromCatalog } from "../load";
import { createSessionId, type WorkflowSessionState } from "../session";
import { loadSession, saveSession } from "../session-store";
import {
  dedupeNodeIds,
  resolveAutoImproveEnabled,
  resolveMaxRestarts,
  resolveSupervisorWorkflowName,
} from "../supervisor-client-policy";
import type {
  RestartSupervisedWorkflowInput,
  StartSupervisedWorkflowInput,
  StopSupervisedWorkflowInput,
  SubmitSupervisedWorkflowInput,
  SupervisedWorkflowLookup,
  SupervisedWorkflowView,
  SupervisorEngineOverrides,
  WorkflowSupervisorClient,
} from "../supervisor-client-types";
import type { LoadOptions } from "../types";
import {
  getNormalizedNodePayload,
  resolveWorkflowManagerStepId,
} from "../types";
import {
  activeTargetStatusFor,
  assertSupervisedCommandBindingConsistency,
  asyncEngineObserver,
  buildSupervisorInspectionCommandResult,
  cancelTargetSession,
  eventBindingStubFromSupervisedRunRecord,
  isTerminalTargetStatus,
  localEngineOverrides,
  mergeRuntimeVariables,
  normalizeSupervisorLifecycleAction,
  nowIso,
  reconcileTerminalSupervisedRunForCorrelation,
  reconcileTerminalSupervisedRunRecord,
  requireNonEmptyLookupValue,
  resolvePublicCommandId,
  resolveRerunFromStepId,
  viewFrom,
} from "./supervisor-client-helpers";
import { resolveSupervisedWorkflowLookupRecord } from "./workflow-supervisor-client-lookup";

export function createWorkflowSupervisorClient(
  baseOptions: LoadOptions = {},
): WorkflowSupervisorClient {
  const repo = createEventSupervisedRunRepository(baseOptions);
  async function resolveLookupRecord(
    input: SupervisedWorkflowLookup,
  ): Promise<EventSupervisedRunRecord> {
    return await resolveSupervisedWorkflowLookupRecord(
      input,
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
      const lifecycleAction = normalizeSupervisorLifecycleAction(cmd.action);
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
        if (lifecycleAction === "start") {
          if (latest !== null && latest.supervisedRunId !== scopedId) {
            throw new Error(
              "supervised run id is not the latest supervised run for this correlation key",
            );
          }
        }
        effectiveRunId = scopedId;
        context =
          lifecycleAction === "start" ? (active ?? latest) : scopedRecord;
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
            if (Object.hasOwn(r, "error")) {
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
      const finalizeAsyncRunError = async (
        runningRecord: EventSupervisedRunRecord,
        message: string,
      ): Promise<SupervisedWorkflowView> => {
        const current =
          (await repo.loadById(runningRecord.supervisedRunId)) ?? runningRecord;
        if (current.status === "stopped") {
          return viewFrom(current);
        }
        const targetId =
          current.activeTargetExecutionId ??
          runningRecord.activeTargetExecutionId;
        if (targetId !== undefined) {
          const loaded = await loadSession(targetId, baseOptions);
          if (loaded.ok && loaded.value.status === "cancelled") {
            const { activeTargetExecutionId: _omit, ...stoppedBase } = current;
            const stopped: EventSupervisedRunRecord = {
              ...stoppedBase,
              status: "stopped",
              updatedAt: nowIso(),
            };
            const finalView = await persistAndView(stopped);
            return viewFrom(finalView.supervisedRun, "cancelled");
          }
        }
        const failed: EventSupervisedRunRecord = {
          ...runningRecord,
          status: "failed",
          updatedAt: nowIso(),
        };
        await persistAndView(failed);
        await finalizeError(failed, message);
        return viewFrom(failed);
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
        const loadedWf = await loadWorkflowFromCatalog(
          cmd.targetWorkflowName,
          baseOptions,
        );
        if (!loadedWf.ok) {
          throw new Error(loadedWf.error.message);
        }
        const wfOptions =
          loadedWf.value.source === undefined
            ? baseOptions
            : withResolvedWorkflowSourceOptions(
                loadedWf.value.source,
                baseOptions,
              );
        const workflowExecutionId = createSessionId({
          workflowId: loadedWf.value.bundle.workflow.workflowId,
        });
        latestRecord = {
          ...record,
          status: "running",
          activeTargetExecutionId: workflowExecutionId,
          updatedAt: nowIso(),
        };
        const runningView = await persistAndView(latestRecord);
        const observer = asyncEngineObserver(input.engine);
        if (observer.asyncRun === true) {
          const runningRecord = latestRecord;
          const task = runWorkflow(cmd.targetWorkflowName, {
            ...wfOptions,
            ...localEngineOverrides(input.engine ?? {}),
            runtimeVariables: runVars,
            sessionId: workflowExecutionId,
          })
            .then(async (started) => {
              if (!started.ok) {
                throw new Error(started.error.message);
              }
              const reconciled = await reconcileTerminalSupervisedRunRecord(
                runningRecord,
                repo,
                baseOptions,
              );
              const finalView = await persistAndView(reconciled);
              await repo.finalizeCommand(cmd.commandId, finalView);
              return finalView;
            })
            .catch(async (error: unknown) => {
              const message =
                error instanceof Error ? error.message : "unknown error";
              return await finalizeAsyncRunError(runningRecord, message);
            });
          observer.onAsyncRun?.({
            supervisedRunId: runId,
            workflowExecutionId,
            task,
          });
          return finalizeOk(runningView);
        }
        const started = await runWorkflow(cmd.targetWorkflowName, {
          ...wfOptions,
          ...localEngineOverrides(input.engine ?? {}),
          runtimeVariables: runVars,
          sessionId: workflowExecutionId,
        });
        if (!started.ok) {
          throw new Error(started.error.message);
        }
        latestRecord = {
          ...record,
          status: "running",
          activeTargetExecutionId: workflowExecutionId,
          updatedAt: nowIso(),
        };
        return finalizeOk(await persistAndView(latestRecord));
      };
      try {
        if (
          lifecycleAction === "status" ||
          lifecycleAction === "progress" ||
          lifecycleAction === "inbox" ||
          lifecycleAction === "logs"
        ) {
          if (context === null) {
            throw new Error(`no supervised run for ${lifecycleAction} lookup`);
          }
          const st = await activeTargetStatusFor(context, baseOptions);
          const commandResult = await buildSupervisorInspectionCommandResult(
            lifecycleAction,
            context,
            baseOptions,
          );
          return finalizeOk(viewFrom(context, st, commandResult));
        }
        if (lifecycleAction === "start") {
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
          if (lifecycleAction === "input") {
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
        if (lifecycleAction === "stop") {
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
        if (lifecycleAction === "restart") {
          if (ctx.restartCount >= ctx.maxRestartsOnFailure) {
            throw new Error(
              "supervised restart budget exhausted for this correlation key",
            );
          }
          const rerunFromStepId = resolveRerunFromStepId(cmd);
          const rerunSourceSessionId =
            cmd.targetWorkflowExecutionId ?? ctx.activeTargetExecutionId;
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
          if (
            cmd.action === "rerun" ||
            rerunFromStepId !== undefined ||
            cmd.targetWorkflowExecutionId !== undefined
          ) {
            if (rerunSourceSessionId === undefined) {
              throw new Error(
                "supervised rerun requires an active target workflow execution or command.targetWorkflowExecutionId",
              );
            }
            if (rerunFromStepId === undefined) {
              throw new Error(
                "supervised rerun requires the first command arg to be the rerun step id",
              );
            }
            const loadedWf = await loadWorkflowFromCatalog(
              ctx.targetWorkflowName,
              baseOptions,
            );
            if (!loadedWf.ok) {
              throw new Error(loadedWf.error.message);
            }
            const wfBase =
              loadedWf.value.source === undefined
                ? baseOptions
                : withResolvedWorkflowSourceOptions(
                    loadedWf.value.source,
                    baseOptions,
                  );
            const workflowExecutionId = createSessionId({
              workflowId: loadedWf.value.bundle.workflow.workflowId,
            });
            const rerunning: EventSupervisedRunRecord = {
              ...restarting,
              status: "running",
              restartCount: ctx.restartCount + 1,
              activeTargetExecutionId: workflowExecutionId,
              updatedAt: nowIso(),
            };
            const observer = asyncEngineObserver(input.engine);
            if (observer.asyncRun === true) {
              const view = await persistAndView(rerunning);
              const task = runWorkflow(ctx.targetWorkflowName, {
                ...wfBase,
                ...localEngineOverrides(input.engine ?? {}),
                rerunFromSessionId: rerunSourceSessionId,
                rerunFromStepId,
                runtimeVariables: runVars,
                sessionId: workflowExecutionId,
              })
                .then(async (rerunResult) => {
                  if (!rerunResult.ok) {
                    throw new Error(rerunResult.error.message);
                  }
                  const reconciled = await reconcileTerminalSupervisedRunRecord(
                    rerunning,
                    repo,
                    baseOptions,
                  );
                  const finalView = await persistAndView(reconciled);
                  await repo.finalizeCommand(cmd.commandId, finalView);
                  return finalView;
                })
                .catch(async (error: unknown) => {
                  const message =
                    error instanceof Error ? error.message : "unknown error";
                  return await finalizeAsyncRunError(rerunning, message);
                });
              observer.onAsyncRun?.({
                supervisedRunId: rerunning.supervisedRunId,
                workflowExecutionId,
                task,
              });
              return finalizeOk(view);
            }
            const rerunResult = await runWorkflow(ctx.targetWorkflowName, {
              ...wfBase,
              ...localEngineOverrides(input.engine ?? {}),
              rerunFromSessionId: rerunSourceSessionId,
              rerunFromStepId,
              runtimeVariables: runVars,
              sessionId: workflowExecutionId,
            });
            if (!rerunResult.ok) {
              throw new Error(rerunResult.error.message);
            }
            return finalizeOk(await persistAndView(rerunning));
          }
          return await startSupervisedTarget(effectiveRunId, {
            ...ctx,
            restartCount: ctx.restartCount + 1,
          });
        }
        if (lifecycleAction === "input") {
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
            const nextRecord: EventSupervisedRunRecord = {
              ...ctx,
              activeTargetExecutionId: merged.sessionId,
              updatedAt: nowIso(),
            };
            const observer = asyncEngineObserver(input.engine);
            if (observer.asyncRun === true) {
              const view = await persistAndView(nextRecord);
              const task = runWorkflow(ctx.targetWorkflowName, {
                ...wfBase,
                resumeSessionId: merged.sessionId,
                ...localEngineOverrides(input.engine ?? {}),
              })
                .then(async (runAgain) => {
                  if (!runAgain.ok) {
                    throw new Error(runAgain.error.message);
                  }
                  const reconciled = await reconcileTerminalSupervisedRunRecord(
                    nextRecord,
                    repo,
                    baseOptions,
                  );
                  const finalView = await persistAndView(reconciled);
                  await repo.finalizeCommand(cmd.commandId, finalView);
                  return finalView;
                })
                .catch(async (error: unknown) => {
                  const message =
                    error instanceof Error ? error.message : "unknown error";
                  return await finalizeAsyncRunError(nextRecord, message);
                });
              observer.onAsyncRun?.({
                supervisedRunId: nextRecord.supervisedRunId,
                workflowExecutionId: merged.sessionId,
                task,
              });
              return finalizeOk(view);
            }
            const runAgain = await runWorkflow(ctx.targetWorkflowName, {
              ...wfBase,
              resumeSessionId: merged.sessionId,
              ...localEngineOverrides(input.engine ?? {}),
            });
            if (!runAgain.ok) {
              throw new Error(runAgain.error.message);
            }
            return finalizeOk(await persistAndView(nextRecord));
          }
          const nextRecord: EventSupervisedRunRecord = {
            ...ctx,
            activeTargetExecutionId: sessionId,
            updatedAt: nowIso(),
          };
          const observer = asyncEngineObserver(input.engine);
          if (observer.asyncRun === true) {
            const view = await persistAndView(nextRecord);
            const task = runWorkflow(ctx.targetWorkflowName, {
              ...wfBase,
              resumeSessionId: sessionId,
              ...localEngineOverrides(input.engine ?? {}),
              ...(Object.keys(runVars).length === 0
                ? {}
                : { runtimeVariables: runVars }),
            })
              .then(async (resumed) => {
                if (!resumed.ok) {
                  throw new Error(resumed.error.message);
                }
                const reconciled = await reconcileTerminalSupervisedRunRecord(
                  nextRecord,
                  repo,
                  baseOptions,
                );
                const finalView = await persistAndView(reconciled);
                await repo.finalizeCommand(cmd.commandId, finalView);
                return finalView;
              })
              .catch(async (error: unknown) => {
                const message =
                  error instanceof Error ? error.message : "unknown error";
                return await finalizeAsyncRunError(nextRecord, message);
              });
            observer.onAsyncRun?.({
              supervisedRunId: nextRecord.supervisedRunId,
              workflowExecutionId: sessionId,
              task,
            });
            return finalizeOk(view);
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
          const failedRest =
            "activeTargetExecutionId" in failedBase
              ? (({ activeTargetExecutionId: _failedTarget, ...rest }) => rest)(
                  failedBase,
                )
              : failedBase;
          const failed: EventSupervisedRunRecord = {
            ...failedRest,
            status: "failed" as EventSupervisedRunStatus,
            updatedAt: nowIso(),
          };
          try {
            await persistAndView(failed);
            latestRecord = failed;
          } catch {}
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
        binding: input.bindingSnapshot as EventBinding,
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
      const withControl = {
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
      } as EventBinding;
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
