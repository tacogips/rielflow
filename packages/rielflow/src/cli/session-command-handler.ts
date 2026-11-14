import {
  ContinueWorkflowFromHistoryError,
  continueWorkflowFromHistory,
} from "../lib-continuation";
import { listMergedWorkflowExecutionStepRuns } from "../lib-step-runs";
import { runWorkflow } from "../workflow/engine";
import { loadWorkflowFromCatalog } from "../workflow/load";
import { buildFanoutGroupSummaries } from "../workflow/inspect";
import { listRuntimeNodeLogs } from "../workflow/runtime-db";
import type { MockNodeScenario } from "../workflow/scenario-adapter";
import { isTerminalWorkflowSessionStatus } from "../workflow/session";
import { buildSessionHealthReport } from "../workflow/session-health";
import { loadSession } from "../workflow/session-store";
import { workflowRegistryRunTextSummary } from "../workflow/packages";
import type {
  RunCliScopeContext,
  WorkflowExecutionExport,
} from "./storage-and-options";
import {
  buildStepProgressSummaries,
  buildSessionWorkflowLoadOptions,
  formatFanoutSummaryLines,
  resolveSessionCommandStorageOptions,
  resolveSessionCurrentStepId,
} from "./storage-and-options";
import {
  buildRemoteExecutionInput,
  buildSupervisorProgressEventSink,
  buildWorkflowExecutionExport,
  emitJson,
  executeCliGraphqlOperation,
  formatSessionHealthText,
  parseStepRunExecutionStatusFilter,
  printHelp,
  readMockScenarioOption,
  readRemoteWorkflowExecutionPayload,
  rejectUnsupportedRemoteMockScenario,
  serializeRuntimeNodeLogs,
  writeExportFile,
  writeTextFile,
} from "./input-output-helpers";
import {
  cleanupRetainedRegistryRunCheckout,
  readRegistryRunProvenance,
  registryRunSourceJson,
  registryRunWorkflowRoot,
  skippedRetainedRegistryRunCleanup,
  type RegistryRunCleanupOutput,
} from "./registry-run-provenance";
import {
  buildLocalWorkflowRunOverrides,
  optionsForLoadedWorkflow,
} from "./workflow-graphql-formatters";

async function cleanupRetainedRegistryRunAfterTerminalSession(input: {
  readonly provenance: Parameters<
    typeof cleanupRetainedRegistryRunCheckout
  >[0]["provenance"];
  readonly provenanceSessionId: string;
  readonly statusSessionId: string;
  readonly sharedOptions: RunCliScopeContext["sharedOptions"];
  readonly sessionOptions: Awaited<
    ReturnType<typeof resolveSessionCommandStorageOptions>
  >;
}): Promise<RegistryRunCleanupOutput | undefined> {
  const statusSession = await loadSession(
    input.statusSessionId,
    input.sessionOptions,
  );
  if (!statusSession.ok) {
    return undefined;
  }
  return isTerminalWorkflowSessionStatus(statusSession.value.status)
    ? await cleanupRetainedRegistryRunCheckout({
        options: input.sharedOptions,
        sessionId: input.provenanceSessionId,
        provenance: input.provenance,
      })
    : skippedRetainedRegistryRunCleanup(
        input.provenance,
        `workflow session status '${statusSession.value.status}' is not terminal`,
      );
}

function writeRegistryRunCleanupText(
  io: RunCliScopeContext["io"],
  cleanup: RegistryRunCleanupOutput | undefined,
): void {
  if (cleanup !== undefined && !cleanup.ok && "skipped" in cleanup) {
    io.stdout(`cleanup: skipped (${cleanup.reason})`);
  } else if (cleanup !== undefined && !cleanup.ok) {
    io.stderr(`cleanup warning: ${cleanup.error}`);
  }
}

export async function runCliSessionScope(
  context: RunCliScopeContext,
): Promise<number> {
  const {
    parsed,
    positionals,
    scope,
    command,
    target,
    env,
    sharedOptions,
    graphqlCliTransport,
    deps,
    io,
  } = context;
  void parsed;
  void positionals;
  void scope;
  void command;
  void target;
  void env;
  void sharedOptions;
  void graphqlCliTransport;
  void deps;
  void io;

  const sessionTarget = target;
  if (sessionTarget === undefined) {
    io.stderr("scope, command, and target are required");
    printHelp(io);
    return 2;
  }

  const sessionOptions =
    await resolveSessionCommandStorageOptions(sharedOptions);

  if (command === "progress") {
    const session = await loadSession(sessionTarget, sessionOptions);
    if (!session.ok) {
      io.stderr(session.error.message);
      return 1;
    }

    const countsByNode = session.value.nodeExecutionCounts;
    const currentStepId = await resolveSessionCurrentStepId(
      session.value,
      sessionOptions,
    );
    const stepSummaries = buildStepProgressSummaries(session.value);
    const fanoutSummaries = buildFanoutGroupSummaries(session.value);
    const nodeSummaries = Object.keys(countsByNode)
      .sort((a, b) => a.localeCompare(b))
      .map((nodeId) => ({
        nodeId,
        executions: countsByNode[nodeId] ?? 0,
        restarts: session.value.restartCounts?.[nodeId] ?? 0,
      }));

    if (parsed.options.output === "json") {
      emitJson(io, {
        sessionId: session.value.sessionId,
        workflowName: session.value.workflowName,
        status: session.value.status,
        queue: session.value.queue,
        currentNodeId: session.value.currentNodeId ?? null,
        currentStepId,
        totalExecutions: session.value.nodeExecutionCounter,
        nodeSummaries,
        stepSummaries,
        fanoutSummaries,
        lastError: session.value.lastError ?? null,
      });
    } else {
      io.stdout(`sessionId: ${session.value.sessionId}`);
      io.stdout(`workflow: ${session.value.workflowName}`);
      io.stdout(`status: ${session.value.status}`);
      io.stdout(`currentNodeId: ${session.value.currentNodeId ?? "-"}`);
      if (currentStepId !== null) {
        io.stdout(`currentStepId: ${currentStepId}`);
      }
      io.stdout(`queue: ${session.value.queue.join(",") || "-"}`);
      io.stdout(`totalExecutions: ${session.value.nodeExecutionCounter}`);
      io.stdout("nodeProgress:");
      nodeSummaries.forEach((summary) => {
        io.stdout(
          `  - ${summary.nodeId}: executions=${summary.executions}, restarts=${summary.restarts}`,
        );
      });
      if (stepSummaries.length > 0) {
        io.stdout("stepProgress:");
        stepSummaries.forEach((summary) => {
          io.stdout(
            `  - ${summary.stepId}: executions=${summary.executions}, restarts=${summary.restarts}`,
          );
        });
      }
      for (const line of formatFanoutSummaryLines(session.value)) {
        io.stdout(line);
      }
    }
    return 0;
  }

  if (command === "health") {
    if (graphqlCliTransport !== null) {
      io.stderr(
        "session health currently supports local execution only; omit --endpoint",
      );
      return 2;
    }

    try {
      const report = await buildSessionHealthReport({
        sessionId: sessionTarget,
        options: sessionOptions,
        live: parsed.options.live,
        ...(parsed.options.stallTimeoutMs === undefined
          ? {}
          : { stallTimeoutMs: parsed.options.stallTimeoutMs }),
        ...(parsed.options.logLimit === undefined
          ? {}
          : { logLimit: parsed.options.logLimit }),
        includeLlmMessages: parsed.options.includeLlmMessages,
        ...(parsed.options.llmLimit === undefined
          ? {}
          : { llmLimit: parsed.options.llmLimit }),
      });

      if (parsed.options.output === "json") {
        emitJson(io, report);
      } else {
        for (const line of formatSessionHealthText(report)) {
          io.stdout(line);
        }
      }
      return 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`session health failed: ${message}`);
      return 1;
    }
  }

  if (command === "status") {
    const session = await loadSession(sessionTarget, sessionOptions);
    if (!session.ok) {
      io.stderr(session.error.message);
      return 1;
    }

    const currentStepId = await resolveSessionCurrentStepId(
      session.value,
      sessionOptions,
    );
    if (parsed.options.output === "json") {
      emitJson(io, {
        ...session.value,
        fanoutGroups: session.value.fanoutGroups ?? [],
        fanoutSummaries: buildFanoutGroupSummaries(session.value),
        currentStepId,
      });
    } else {
      io.stdout(`sessionId: ${session.value.sessionId}`);
      io.stdout(`workflow: ${session.value.workflowName}`);
      io.stdout(`status: ${session.value.status}`);
      io.stdout(`currentNodeId: ${session.value.currentNodeId ?? "-"}`);
      if (currentStepId !== null) {
        io.stdout(`currentStepId: ${currentStepId}`);
      }
      io.stdout(`queueLength: ${session.value.queue.length}`);
      for (const line of formatFanoutSummaryLines(session.value)) {
        io.stdout(line);
      }
    }
    return 0;
  }

  if (command === "resume") {
    if (graphqlCliTransport !== null) {
      if (rejectUnsupportedRemoteMockScenario(parsed.options, io)) {
        return 2;
      }
      try {
        const data = await executeCliGraphqlOperation({
          transport: graphqlCliTransport,
          document: `
              mutation ResumeWorkflowExecution($input: ResumeWorkflowExecutionInput!) {
                resumeWorkflowExecution(input: $input) {
                  workflowExecutionId
                  sessionId
                  status
                  exitCode
                }
              }
            `,
          variables: {
            input: {
              workflowExecutionId: sessionTarget,
              ...buildRemoteExecutionInput(parsed.options),
            },
          },
        });
        const payload = readRemoteWorkflowExecutionPayload(
          data,
          "resumeWorkflowExecution",
        );

        if (parsed.options.output === "json") {
          emitJson(io, {
            sessionId: payload.sessionId,
            status: payload.status,
            exitCode: payload.exitCode,
          });
        } else {
          io.stdout(`session resumed: ${payload.sessionId}`);
          io.stdout(`status: ${payload.status}`);
        }
        return payload.exitCode;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`remote resume failed: ${message}`);
        return 1;
      }
    }
    const session = await loadSession(sessionTarget, sessionOptions);
    if (!session.ok) {
      io.stderr(session.error.message);
      return 1;
    }
    const registryRunProvenance = await readRegistryRunProvenance({
      options: sharedOptions,
      sessionId: session.value.sessionId,
    });
    const resumeSessionOptions =
      registryRunProvenance === undefined ||
      sharedOptions.workflowRoot !== undefined
        ? sessionOptions
        : {
            ...sessionOptions,
            workflowRoot: registryRunWorkflowRoot(registryRunProvenance),
          };

    let mockScenarioOptions: Readonly<{ mockScenario?: MockNodeScenario }> = {};
    try {
      mockScenarioOptions = await readMockScenarioOption(
        parsed.options.mockScenarioPath,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`failed to read --mock-scenario file: ${message}`);
      return 1;
    }

    const result = await runWorkflow(session.value.workflowName, {
      ...resumeSessionOptions,
      ...buildLocalWorkflowRunOverrides(parsed.options),
      ...buildSupervisorProgressEventSink(parsed.options, io),
      resumeSessionId: session.value.sessionId,
      ...mockScenarioOptions,
    });

    if (!result.ok) {
      const registryCleanup =
        registryRunProvenance === undefined ||
        result.error.sessionId === undefined
          ? undefined
          : await cleanupRetainedRegistryRunAfterTerminalSession({
              provenance: registryRunProvenance,
              provenanceSessionId: session.value.sessionId,
              statusSessionId: result.error.sessionId,
              sharedOptions,
              sessionOptions: resumeSessionOptions,
            });
      if (parsed.options.output === "json") {
        emitJson(io, {
          message: result.error.message,
          exitCode: result.error.exitCode,
          ...(registryRunProvenance === undefined
            ? {}
            : {
                registrySource: registryRunSourceJson({
                  provenance: registryRunProvenance,
                  ...(registryCleanup === undefined
                    ? {}
                    : { cleanup: registryCleanup }),
                }),
              }),
        });
      } else {
        io.stderr(result.error.message);
        writeRegistryRunCleanupText(io, registryCleanup);
      }
      return result.error.exitCode;
    }

    const registryCleanup =
      registryRunProvenance === undefined
        ? undefined
        : isTerminalWorkflowSessionStatus(result.value.session.status)
          ? await cleanupRetainedRegistryRunCheckout({
              options: sharedOptions,
              sessionId: session.value.sessionId,
              provenance: registryRunProvenance,
            })
          : skippedRetainedRegistryRunCleanup(
              registryRunProvenance,
              `workflow session status '${result.value.session.status}' is not terminal`,
            );

    if (parsed.options.output === "json") {
      emitJson(io, {
        sessionId: result.value.session.sessionId,
        status: result.value.session.status,
        exitCode: result.value.exitCode,
        ...(registryRunProvenance === undefined
          ? {}
          : {
              registrySource: registryRunSourceJson({
                provenance: registryRunProvenance,
                ...(registryCleanup === undefined
                  ? {}
                  : { cleanup: registryCleanup }),
              }),
            }),
      });
    } else {
      if (registryRunProvenance !== undefined) {
        io.stdout(
          `registry: ${workflowRegistryRunTextSummary(registryRunProvenance)}`,
        );
      }
      io.stdout(`session resumed: ${result.value.session.sessionId}`);
      io.stdout(`status: ${result.value.session.status}`);
      if (
        registryCleanup !== undefined &&
        !registryCleanup.ok &&
        "skipped" in registryCleanup
      ) {
        io.stdout(`cleanup: skipped (${registryCleanup.reason})`);
      } else if (registryCleanup !== undefined && !registryCleanup.ok) {
        io.stderr(`cleanup warning: ${registryCleanup.error}`);
      }
    }
    return result.value.exitCode;
  }

  if (command === "continue") {
    const startStepRaw = parsed.options.continuationStartStepId;
    const afterRunRaw = parsed.options.continuationAfterStepRunId;
    const startStep = startStepRaw?.trim() ?? "";
    const afterRun = afterRunRaw?.trim() ?? "";
    let missingUsage = false;
    if (startStep.length === 0) {
      io.stderr("--start-step is required for session continue");
      missingUsage = true;
    }
    if (afterRun.length === 0) {
      io.stderr("--after-step-run is required for session continue");
      missingUsage = true;
    }
    if (missingUsage) {
      io.stderr(
        "usage: rielflow session continue <workflow-execution-id> --start-step <step-id> --after-step-run <step-run-id> [options]",
      );
      return 2;
    }
    if (parsed.options.nestedSuperviser) {
      io.stderr(
        "--nested-supervisor / --nested-superviser is not supported for session continue",
      );
      return 2;
    }
    if (parsed.options.autoImprove !== undefined) {
      io.stderr("--auto-improve cannot be combined with session continue");
      return 2;
    }
    if (graphqlCliTransport !== null) {
      io.stderr(
        "session continue currently supports local execution only; omit --endpoint",
      );
      return 2;
    }

    let mockScenarioOptions: Readonly<{ mockScenario?: MockNodeScenario }> = {};
    try {
      mockScenarioOptions = await readMockScenarioOption(
        parsed.options.mockScenarioPath,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`failed to read --mock-scenario file: ${message}`);
      return 1;
    }

    const registryRunProvenance = await readRegistryRunProvenance({
      options: sharedOptions,
      sessionId: sessionTarget,
    });
    const continueSessionOptions =
      registryRunProvenance === undefined ||
      sharedOptions.workflowRoot !== undefined
        ? sessionOptions
        : {
            ...sessionOptions,
            workflowRoot: registryRunWorkflowRoot(registryRunProvenance),
          };

    try {
      const {
        autoImprove: _omitA,
        nestedSuperviserDriver: _omitN,
        ...budgetOverrides
      } = buildLocalWorkflowRunOverrides(parsed.options);

      const result = await continueWorkflowFromHistory({
        ...continueSessionOptions,
        ...budgetOverrides,
        sourceWorkflowExecutionId: sessionTarget,
        afterStepRunId: afterRun,
        startStepId: startStep,
        ...mockScenarioOptions,
      });
      const registryCleanup =
        registryRunProvenance === undefined
          ? undefined
          : isTerminalWorkflowSessionStatus(result.status)
            ? await cleanupRetainedRegistryRunCheckout({
                options: sharedOptions,
                sessionId: sessionTarget,
                provenance: registryRunProvenance,
              })
            : skippedRetainedRegistryRunCleanup(
                registryRunProvenance,
                `workflow session status '${result.status}' is not terminal`,
              );

      if (parsed.options.output === "json") {
        emitJson(io, {
          sourceWorkflowExecutionId: sessionTarget,
          sessionId: result.sessionId,
          status: result.status,
          continuedAfterStepRunId: result.continuedAfterStepRunId,
          continuedStartStepId: result.continuedStartStepId,
          exitCode: result.exitCode,
          ...(registryRunProvenance === undefined
            ? {}
            : {
                registrySource: registryRunSourceJson({
                  provenance: registryRunProvenance,
                  ...(registryCleanup === undefined
                    ? {}
                    : { cleanup: registryCleanup }),
                }),
              }),
        });
      } else {
        if (registryRunProvenance !== undefined) {
          io.stdout(
            `registry: ${workflowRegistryRunTextSummary(registryRunProvenance)}`,
          );
        }
        io.stdout(`sourceWorkflowExecutionId: ${sessionTarget}`);
        io.stdout(`continued session: ${result.sessionId}`);
        io.stdout(`continuedAfterStepRunId: ${result.continuedAfterStepRunId}`);
        io.stdout(`continuedStartStepId: ${result.continuedStartStepId}`);
        io.stdout(`status: ${result.status}`);
        if (
          registryCleanup !== undefined &&
          !registryCleanup.ok &&
          "skipped" in registryCleanup
        ) {
          io.stdout(`cleanup: skipped (${registryCleanup.reason})`);
        } else if (registryCleanup !== undefined && !registryCleanup.ok) {
          io.stderr(`cleanup warning: ${registryCleanup.error}`);
        }
      }
      return result.exitCode;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      const continuationError =
        error instanceof ContinueWorkflowFromHistoryError ? error : undefined;
      const registryCleanup =
        registryRunProvenance === undefined ||
        continuationError?.sessionId === undefined
          ? undefined
          : await cleanupRetainedRegistryRunAfterTerminalSession({
              provenance: registryRunProvenance,
              provenanceSessionId: sessionTarget,
              statusSessionId: continuationError.sessionId,
              sharedOptions,
              sessionOptions: continueSessionOptions,
            });
      const exitCode = continuationError?.exitCode ?? 1;
      if (parsed.options.output === "json") {
        emitJson(io, {
          sourceWorkflowExecutionId: sessionTarget,
          message,
          exitCode,
          ...(registryRunProvenance === undefined
            ? {}
            : {
                registrySource: registryRunSourceJson({
                  provenance: registryRunProvenance,
                  ...(registryCleanup === undefined
                    ? {}
                    : { cleanup: registryCleanup }),
                }),
              }),
        });
      } else {
        io.stderr(`session continue failed: ${message}`);
        writeRegistryRunCleanupText(io, registryCleanup);
      }
      return exitCode;
    }
  }

  if (command === "rerun") {
    const fromStepId = positionals[3];
    if (fromStepId === undefined) {
      io.stderr("step id is required for session rerun");
      io.stderr(
        "usage: rielflow session rerun <session-id> <step-id> [options]",
      );
      return 2;
    }
    if (parsed.options.nestedSuperviser) {
      io.stderr(
        "--nested-supervisor / --nested-superviser is not supported for session rerun; use workflow run or session resume with --auto-improve instead",
      );
      return 2;
    }
    if (graphqlCliTransport !== null) {
      if (rejectUnsupportedRemoteMockScenario(parsed.options, io)) {
        return 2;
      }
      try {
        const data = await executeCliGraphqlOperation({
          transport: graphqlCliTransport,
          document: `
              mutation RerunWorkflowExecution($input: RerunWorkflowExecutionInput!) {
                rerunWorkflowExecution(input: $input) {
                  workflowExecutionId
                  sessionId
                  status
                  exitCode
                }
              }
            `,
          variables: {
            input: {
              workflowExecutionId: sessionTarget,
              stepId: fromStepId,
              ...buildRemoteExecutionInput(parsed.options),
            },
          },
        });
        const payload = readRemoteWorkflowExecutionPayload(
          data,
          "rerunWorkflowExecution",
        );

        if (parsed.options.output === "json") {
          emitJson(io, {
            sourceSessionId: sessionTarget,
            sessionId: payload.sessionId,
            status: payload.status,
            rerunFromStepId: fromStepId,
            exitCode: payload.exitCode,
          });
        } else {
          io.stdout(`sourceSessionId: ${sessionTarget}`);
          io.stdout(`rerun session: ${payload.sessionId}`);
          io.stdout(`rerunFromStepId: ${fromStepId}`);
          io.stdout(`status: ${payload.status}`);
        }
        return payload.exitCode;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`remote rerun failed: ${message}`);
        return 1;
      }
    }

    const source = await loadSession(sessionTarget, sessionOptions);
    if (!source.ok) {
      io.stderr(source.error.message);
      return 1;
    }

    let mockScenarioOptions: Readonly<{ mockScenario?: MockNodeScenario }> = {};
    try {
      mockScenarioOptions = await readMockScenarioOption(
        parsed.options.mockScenarioPath,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`failed to read --mock-scenario file: ${message}`);
      return 1;
    }

    const workflowLoadOptions = buildSessionWorkflowLoadOptions(
      sessionOptions,
      sharedOptions,
    );
    const loadedWorkflow = await loadWorkflowFromCatalog(
      source.value.workflowName,
      workflowLoadOptions,
    );
    if (!loadedWorkflow.ok) {
      io.stderr(loadedWorkflow.error.message);
      return loadedWorkflow.error.code === "VALIDATION" ||
        loadedWorkflow.error.code === "INVALID_WORKFLOW_NAME" ||
        loadedWorkflow.error.code === "INVALID_SCOPE"
        ? 2
        : 1;
    }

    const result = await runWorkflow(source.value.workflowName, {
      ...optionsForLoadedWorkflow(loadedWorkflow.value, workflowLoadOptions),
      ...buildLocalWorkflowRunOverrides(parsed.options),
      ...buildSupervisorProgressEventSink(parsed.options, io),
      rerunFromSessionId: source.value.sessionId,
      rerunFromStepId: fromStepId,
      ...mockScenarioOptions,
    });

    if (!result.ok) {
      io.stderr(result.error.message);
      return result.error.exitCode;
    }

    if (parsed.options.output === "json") {
      emitJson(io, {
        sourceSessionId: source.value.sessionId,
        sessionId: result.value.session.sessionId,
        status: result.value.session.status,
        rerunFromStepId: fromStepId,
        exitCode: result.value.exitCode,
      });
    } else {
      io.stdout(`sourceSessionId: ${source.value.sessionId}`);
      io.stdout(`rerun session: ${result.value.session.sessionId}`);
      io.stdout(`rerunFromStepId: ${fromStepId}`);
      io.stdout(`status: ${result.value.session.status}`);
    }
    return result.value.exitCode;
  }

  if (command === "step-runs") {
    if (graphqlCliTransport !== null) {
      io.stderr(
        "session step-runs currently supports local execution only; omit --endpoint",
      );
      return 2;
    }

    const statusParsed = parseStepRunExecutionStatusFilter(
      parsed.options.status,
    );
    if (!statusParsed.ok) {
      io.stderr(statusParsed.error);
      return 2;
    }

    const filterStepCandidate = parsed.options.stepRunsFilterStepId?.trim();
    const filterStepId =
      filterStepCandidate !== undefined && filterStepCandidate.length > 0
        ? filterStepCandidate
        : undefined;

    try {
      const overview = await listMergedWorkflowExecutionStepRuns({
        ...sessionOptions,
        workflowExecutionId: sessionTarget,
        ...(filterStepId === undefined ? {} : { filterStepId }),
        ...(statusParsed.value === undefined
          ? {}
          : { filterStatus: statusParsed.value }),
      });

      if (parsed.options.output === "json") {
        emitJson(io, overview);
      } else {
        io.stdout(`workflowExecutionId: ${overview.workflowExecutionId}`);
        io.stdout(`workflow: ${overview.workflowName}`);
        if (overview.stepRuns.length === 0) {
          io.stdout("stepRuns: (none matching filters)");
        } else {
          io.stdout("stepRuns:");
          for (const row of overview.stepRuns) {
            io.stdout(
              `  timeline=${String(row.timelineOrdinal)} ord=${String(row.executionOrdinal)} stepRunId=${row.stepRunId} stepId=${row.stepId ?? "-"} owner=${row.persistedWorkflowExecutionId} status=${row.status} imported=${row.imported ? "yes" : "no"} started=${row.startedAt} ended=${row.endedAt}`,
            );
          }
        }
      }
      return 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`session step-runs failed: ${message}`);
      return 1;
    }
  }

  if (command === "export") {
    if (graphqlCliTransport !== null) {
      io.stderr(
        "session export currently supports local execution only; omit --endpoint",
      );
      return 2;
    }

    let payload: WorkflowExecutionExport;
    try {
      payload = await buildWorkflowExecutionExport(
        sessionTarget,
        sessionOptions,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`session export failed: ${message}`);
      return 1;
    }

    if (parsed.options.filePath === undefined) {
      emitJson(io, payload);
      return 0;
    }

    try {
      const savedPath = await writeExportFile(parsed.options.filePath, payload);
      if (parsed.options.output === "json") {
        emitJson(io, {
          filePath: savedPath,
          workflowId: payload.workflowId,
          workflowExecutionId: payload.workflowExecutionId,
          workflowName: payload.workflowName,
          status: payload.status,
        });
      } else {
        io.stdout(`exported workflow run to ${savedPath}`);
      }
      return 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`failed to write session export file: ${message}`);
      return 1;
    }
  }

  if (command === "logs") {
    if (graphqlCliTransport !== null) {
      io.stderr(
        "session logs currently supports local execution only; omit --endpoint",
      );
      return 2;
    }
    const session = await loadSession(sessionTarget, sessionOptions);
    if (!session.ok) {
      io.stderr(session.error.message);
      return 1;
    }

    const logs = await listRuntimeNodeLogs(sessionTarget, sessionOptions);
    const formatBase = parsed.options.format ?? parsed.options.output;
    const format = formatBase === "table" ? "text" : formatBase;
    const serialized = serializeRuntimeNodeLogs(logs, format);

    if (parsed.options.filePath !== undefined) {
      try {
        const savedPath = await writeTextFile(
          parsed.options.filePath,
          serialized,
        );
        if (parsed.options.output === "json") {
          emitJson(io, {
            filePath: savedPath,
            sessionId: sessionTarget,
            workflowId: session.value.workflowId,
            workflowName: session.value.workflowName,
            logCount: logs.length,
            format,
          });
        } else {
          io.stdout(`exported session logs to ${savedPath}`);
        }
        return 0;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`failed to write session logs file: ${message}`);
        return 1;
      }
    }

    if (format === "json") {
      emitJson(io, logs);
    } else {
      serialized
        .trimEnd()
        .split("\n")
        .filter((line) => line.length > 0)
        .forEach((line) => {
          io.stdout(line);
        });
    }
    return 0;
  }

  io.stderr(`unknown session command: ${command}`);
  printHelp(io);
  return 1;
}
