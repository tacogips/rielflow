import { collectWorkflowAddonSourceSummaries } from "../../../../src/workflow/addon-source-summary";
import { createWorkflowTemplate } from "../../../../src/workflow/create";
import { runWorkflow } from "../../../../src/workflow/engine";
import {
  buildInspectionSummary,
  deriveWorkflowStructureRows,
  type WorkflowStructureRow,
} from "../../../../src/workflow/inspect";
import { loadWorkflowFromCatalog } from "../../../../src/workflow/load";
import {
  hasInvalidNodeValidationResult,
  type NodeValidationResult,
} from "../../../../src/workflow/validate";
import {
  buildWorkflowCatalogOverview,
  buildWorkflowStatusOverview,
  parseWorkflowOverviewAggregateStatusFilter,
  type WorkflowOverviewRow,
} from "../../../../src/workflow/overview";
import type { MockNodeScenario } from "../../../../src/workflow/scenario-adapter";
import {
  buildWorkflowUsageCatalog,
  buildWorkflowUsageSummary,
} from "../../../../src/workflow/usage";
import type { RunCliScopeContext } from "./storage-and-options";
import {
  buildRemoteExecutionInput,
  buildSupervisorProgressEventSink,
  emitJson,
  executeCliGraphqlOperation,
  fetchRemoteWorkflowRunSummary,
  formatValidationIssues,
  printHelp,
  readMockScenarioOption,
  readRemoteWorkflowExecutionPayload,
  readRuntimeVariables,
  rejectUnsupportedRemoteMockScenario,
  requireArrayField,
  requireObjectField,
} from "./input-output-helpers";
import {
  WORKFLOW_CATALOG_OVERVIEW_GQL,
  WORKFLOW_STATUS_OVERVIEW_GQL,
  buildLocalWorkflowRunOverrides,
  buildWorkflowVariablesExamples,
  emitLocalWorkflowCatalogWarnings,
  emitWorkflowOverviewWarnings,
  formatAddonSource,
  formatWorkflowSource,
  optionsForLoadedWorkflow,
  renderWorkflowOverviewTableLines,
  renderWorkflowStatusOverviewLines,
  renderWorkflowUsageCatalogLines,
  renderWorkflowUsageSummaryLines,
  summarizeWorkflowContractForText,
  workflowOverviewGraphqlVariables,
  workflowOverviewRowFromGraphqlJson,
  workflowOverviewWarningSourceFromGraphqlJson,
  workflowSourceJson,
  workflowStatusOverviewFromGraphqlJson,
} from "./workflow-graphql-formatters";

function renderWorkflowStructureLines(
  rows: readonly WorkflowStructureRow[],
  options: { readonly indentUnit: string } = { indentUnit: "  " },
): string[] {
  if (rows.length === 0) {
    return ["(none)"];
  }
  return rows.flatMap((row) => [
    `${options.indentUnit.repeat(row.indent)}${row.stepId}`,
    `${options.indentUnit.repeat(row.indent + 1)}${row.description}`,
  ]);
}

function renderNodeValidationSummaryLines(
  results: readonly NodeValidationResult[],
): readonly string[] {
  return results
    .filter(
      (result) => result.status === "invalid" || result.status === "warning",
    )
    .map((result) => {
      const nodeLabel =
        result.nodeId === undefined ? "workflow.nodes" : result.nodeId;
      return `nodeValidation: [${result.status}] ${nodeLabel}: ${result.message}`;
    });
}

export async function runCliWorkflowScope(
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

  if (command === "list") {
    const statusParsed = parseWorkflowOverviewAggregateStatusFilter(
      parsed.options.status,
    );
    if (!statusParsed.ok) {
      io.stderr(statusParsed.error);
      return 2;
    }
    const statusFilter = statusParsed.value;
    if (graphqlCliTransport !== null) {
      try {
        const data = await executeCliGraphqlOperation({
          transport: graphqlCliTransport,
          document: WORKFLOW_CATALOG_OVERVIEW_GQL,
          variables: workflowOverviewGraphqlVariables(
            parsed.options,
            statusFilter,
          ),
        });
        const catalog = requireObjectField(
          data["workflowCatalogOverview"],
          "workflowCatalogOverview",
        );
        const rowsRaw = requireArrayField(catalog["workflows"], "workflows");
        const rows: WorkflowOverviewRow[] = rowsRaw.map((entry, index) =>
          workflowOverviewRowFromGraphqlJson(
            entry,
            `workflows[${String(index)}]`,
          ),
        );
        const warningCatalog = requireObjectField(
          data["workflowCatalogWarningSources"],
          "workflowCatalogWarningSources",
        );
        const warningRowsRaw = requireArrayField(
          warningCatalog["workflows"],
          "workflowCatalogWarningSources.workflows",
        );
        const warningSources = warningRowsRaw.map((entry, index) =>
          workflowOverviewWarningSourceFromGraphqlJson(
            entry,
            `workflowCatalogWarningSources.workflows[${String(index)}]`,
          ),
        );
        emitWorkflowOverviewWarnings(io, warningSources);
        if (parsed.options.output === "json") {
          emitJson(io, catalog);
        } else {
          for (const line of renderWorkflowOverviewTableLines(rows)) {
            io.stdout(line);
          }
        }
        return 0;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`remote workflow list failed: ${message}`);
        return 1;
      }
    }
    const built = await buildWorkflowCatalogOverview(
      {
        ...(parsed.options.workflowScope === undefined
          ? {}
          : { workflowScope: parsed.options.workflowScope }),
        ...(statusFilter === undefined ? {} : { status: statusFilter }),
        ...(parsed.options.limit === undefined
          ? {}
          : { limit: parsed.options.limit }),
      },
      sharedOptions,
    );
    if (!built.ok) {
      io.stderr(built.error.message);
      return 1;
    }
    await emitLocalWorkflowCatalogWarnings(io, sharedOptions);
    if (parsed.options.output === "json") {
      emitJson(io, built.value);
    } else {
      for (const line of renderWorkflowOverviewTableLines(
        built.value.workflows,
      )) {
        io.stdout(line);
      }
    }
    return 0;
  }

  if (command === "status") {
    if (target === undefined) {
      io.stderr("workflow name is required for workflow status");
      printHelp(io);
      return 2;
    }
    const statusParsed = parseWorkflowOverviewAggregateStatusFilter(
      parsed.options.status,
    );
    if (!statusParsed.ok) {
      io.stderr(statusParsed.error);
      return 2;
    }
    if (statusParsed.value !== undefined) {
      io.stderr(
        "workflow status does not support filtering catalog rows by --status; omit --status",
      );
      return 2;
    }
    if (graphqlCliTransport !== null) {
      try {
        const variables: Record<string, unknown> = {
          workflowName: target,
          ...(parsed.options.workflowScope === undefined
            ? {}
            : { workflowScope: parsed.options.workflowScope }),
          ...(parsed.options.limit === undefined
            ? {}
            : { limit: parsed.options.limit }),
        };
        const data = await executeCliGraphqlOperation({
          transport: graphqlCliTransport,
          document: WORKFLOW_STATUS_OVERVIEW_GQL,
          variables,
        });
        const payload = data["workflowStatusOverview"];
        if (payload === null || payload === undefined) {
          io.stderr(
            `workflow '${target}' was not found for workflow status overview`,
          );
          return 2;
        }
        const overview = workflowStatusOverviewFromGraphqlJson(
          payload,
          "workflowStatusOverview",
        );
        if (parsed.options.output === "json") {
          emitJson(io, overview);
        } else {
          for (const line of renderWorkflowStatusOverviewLines(overview)) {
            io.stdout(line);
          }
        }
        return 0;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`remote workflow status failed: ${message}`);
        return 1;
      }
    }
    const built = await buildWorkflowStatusOverview(
      {
        workflowName: target,
        ...(parsed.options.workflowScope === undefined
          ? {}
          : { workflowScope: parsed.options.workflowScope }),
        ...(parsed.options.limit === undefined
          ? {}
          : { limit: parsed.options.limit }),
      },
      sharedOptions,
    );
    if (!built.ok) {
      const code = built.error.code;
      if (
        code === "NOT_FOUND" ||
        code === "INVALID_WORKFLOW_NAME" ||
        code === "INVALID_SCOPE"
      ) {
        io.stderr(built.error.message);
        return 2;
      }
      io.stderr(built.error.message);
      return 1;
    }
    if (parsed.options.output === "json") {
      emitJson(io, built.value);
    } else {
      for (const line of renderWorkflowStatusOverviewLines(built.value)) {
        io.stdout(line);
      }
    }
    return 0;
  }

  if (command === "usage") {
    if (graphqlCliTransport !== null) {
      io.stderr(
        "workflow usage currently supports local catalog inspection only; omit --endpoint",
      );
      return 2;
    }
    if (target === undefined) {
      const built = await buildWorkflowUsageCatalog(
        {
          ...(parsed.options.workflowScope === undefined
            ? {}
            : { workflowScope: parsed.options.workflowScope }),
        },
        sharedOptions,
      );
      if (!built.ok) {
        const code = built.error.code;
        if (code === "INVALID_SCOPE") {
          io.stderr(built.error.message);
          return 2;
        }
        io.stderr(built.error.message);
        return 1;
      }
      await emitLocalWorkflowCatalogWarnings(io, sharedOptions);
      if (parsed.options.output === "json") {
        emitJson(io, built.value);
      } else {
        for (const line of renderWorkflowUsageCatalogLines(built.value)) {
          io.stdout(line);
        }
      }
      return 0;
    }

    const built = await buildWorkflowUsageSummary(
      {
        workflowName: target,
        ...(parsed.options.workflowScope === undefined
          ? {}
          : { workflowScope: parsed.options.workflowScope }),
      },
      sharedOptions,
    );
    if (!built.ok) {
      const code = built.error.code;
      if (
        code === "NOT_FOUND" ||
        code === "INVALID_WORKFLOW_NAME" ||
        code === "INVALID_SCOPE"
      ) {
        io.stderr(built.error.message);
        return 2;
      }
      io.stderr(built.error.message);
      return 1;
    }
    if (parsed.options.output === "json") {
      emitJson(io, built.value);
    } else {
      for (const line of renderWorkflowUsageSummaryLines(built.value)) {
        io.stdout(line);
      }
    }
    return 0;
  }

  const workflowTarget = target;
  if (workflowTarget === undefined) {
    io.stderr("scope, command, and target are required");
    printHelp(io);
    return 2;
  }

  if (command === "create") {
    const created = await createWorkflowTemplate(workflowTarget, {
      ...sharedOptions,
      ...(parsed.options.workerOnly
        ? { templateMode: "worker-only" as const }
        : {}),
    });
    if (!created.ok) {
      io.stderr(created.error.message);
      return created.error.code === "INVALID_WORKFLOW_NAME" ||
        created.error.code === "INVALID_SCOPE"
        ? 2
        : 1;
    }
    if (parsed.options.output === "json") {
      emitJson(io, {
        workflowName: created.value.workflowName,
        workflowDirectory: created.value.workflowDirectory,
      });
    } else {
      io.stdout(`created workflow: ${created.value.workflowDirectory}`);
    }
    return 0;
  }

  if (command === "validate") {
    const validationLoadOptions = {
      ...sharedOptions,
      executablePreflight: parsed.options.executablePreflight,
    };
    const loaded = await loadWorkflowFromCatalog(
      workflowTarget,
      validationLoadOptions,
    );
    if (!loaded.ok) {
      if (parsed.options.output === "json") {
        emitJson(io, loaded.error);
      } else {
        io.stderr(`validation failed: ${loaded.error.message}`);
        if (loaded.error.issues) {
          io.stderr(formatValidationIssues(loaded.error.issues));
        }
      }
      return loaded.error.code === "VALIDATION" ||
        loaded.error.code === "INVALID_WORKFLOW_NAME" ||
        loaded.error.code === "INVALID_SCOPE"
        ? 2
        : 1;
    }
    const loadedWorkflowOptions = optionsForLoadedWorkflow(
      loaded.value,
      validationLoadOptions,
    );
    const nodeValidationResults = loaded.value.nodeValidationResults;
    const executableInvalid =
      parsed.options.executablePreflight &&
      hasInvalidNodeValidationResult(nodeValidationResults);
    const addonSources = await collectWorkflowAddonSourceSummaries({
      workflow: loaded.value.bundle.workflow,
      options: loadedWorkflowOptions,
      ...(loaded.value.source === undefined
        ? {}
        : { workflowSource: loaded.value.source }),
    });
    if (parsed.options.output === "json") {
      emitJson(io, {
        workflowName: loaded.value.workflowName,
        workflowId: loaded.value.bundle.workflow.workflowId,
        source: workflowSourceJson(loaded.value.source),
        addonSources,
        nodeValidationResults,
        valid: !executableInvalid,
      });
    } else {
      io.stdout(
        `workflow '${loaded.value.workflowName}' is ${executableInvalid ? "not executable" : "valid"}`,
      );
      const sourceLine = formatWorkflowSource(loaded.value.source);
      if (sourceLine !== undefined) {
        io.stdout(`source: ${sourceLine}`);
      }
      for (const addonSource of addonSources) {
        io.stdout(`addonSource: ${formatAddonSource(addonSource)}`);
      }
      for (const line of renderNodeValidationSummaryLines(
        nodeValidationResults,
      )) {
        io.stdout(line);
      }
    }
    return executableInvalid ? 2 : 0;
  }

  if (command === "inspect") {
    const loaded = await loadWorkflowFromCatalog(workflowTarget, sharedOptions);
    if (!loaded.ok) {
      io.stderr(`inspect failed: ${loaded.error.message}`);
      if (loaded.error.issues) {
        io.stderr(formatValidationIssues(loaded.error.issues));
      }
      return loaded.error.code === "VALIDATION" ||
        loaded.error.code === "INVALID_WORKFLOW_NAME" ||
        loaded.error.code === "INVALID_SCOPE"
        ? 2
        : 1;
    }

    if (parsed.options.structure && parsed.options.output !== "json") {
      for (const line of renderWorkflowStructureLines(
        deriveWorkflowStructureRows(loaded.value.bundle.workflow),
      )) {
        io.stdout(line);
      }
      return 0;
    }

    const loadedWorkflowOptions = optionsForLoadedWorkflow(
      loaded.value,
      sharedOptions,
    );
    const summaryBuilder =
      deps.buildInspectionSummary ?? buildInspectionSummary;
    const summary = await summaryBuilder(loaded.value, loadedWorkflowOptions);
    if (parsed.options.output === "json") {
      emitJson(io, {
        ...summary,
        source: workflowSourceJson(loaded.value.source),
      });
    } else {
      io.stdout(`workflow: ${summary.workflowName}`);
      const sourceLine = formatWorkflowSource(loaded.value.source);
      if (sourceLine !== undefined) {
        io.stdout(`source: ${sourceLine}`);
      }
      for (const addonSource of summary.addonSources) {
        io.stdout(`addonSource: ${formatAddonSource(addonSource)}`);
      }
      io.stdout(`workflowId: ${summary.workflowId}`);
      io.stdout(
        `managerStepId: ${summary.managerStepId ?? "(implicit or worker-only)"}`,
      );
      io.stdout(
        `entryStepId: ${summary.entryStepId ?? "(not set; check workflow authorship)"}`,
      );
      io.stdout(`stepIds: ${summary.stepIds.join(", ")}`);
      io.stdout(`nodeRegistryIds: ${summary.nodeRegistryIds.join(", ")}`);
      io.stdout(
        `steps: ${summary.counts.steps}, nodeRegistry: ${summary.counts.nodeRegistry}, crossWorkflowDispatches: ${summary.counts.crossWorkflowDispatches}`,
      );
      if (summary.crossWorkflowDispatchIds.length > 0) {
        io.stdout(
          `crossWorkflowDispatchIds: ${summary.crossWorkflowDispatchIds.join(", ")}`,
        );
      }
      io.stdout(
        `defaults: maxLoopIterations=${summary.defaults.maxLoopIterations}, nodeTimeoutMs=${summary.defaults.nodeTimeoutMs}`,
      );
      io.stdout(`callableStepId: ${summary.callable.stepId}`);
      io.stdout(`callableRole: ${summary.callable.role}`);
      io.stdout(
        `callableInput: ${summarizeWorkflowContractForText(summary.callable.input)}`,
      );
      io.stdout(
        `callableOutput: ${summarizeWorkflowContractForText(summary.callable.output)}`,
      );
      if (summary.callable.input !== undefined) {
        io.stdout("variablesExamples:");
        for (const example of buildWorkflowVariablesExamples({
          workflowName: summary.workflowName,
          jsonSchema: summary.callable.input.jsonSchema,
        })) {
          io.stdout(`  ${example.mode}: ${example.command}`);
        }
      }
      io.stdout("steps:");
      if (summary.steps.length === 0) {
        io.stdout("  (none)");
      } else {
        for (const step of summary.steps) {
          io.stdout(
            `  - ${step.stepId} role=${step.role} description=${step.description ?? "-"}`,
          );
        }
      }
      io.stdout(`runtimeReady: ${summary.runtime.ready ? "yes" : "no"}`);
      for (const requirement of summary.runtime.requirements) {
        io.stdout(
          `runtime[${requirement.status}] ${requirement.label}: ${requirement.detail}`,
        );
      }
    }
    return 0;
  }

  if (command === "run") {
    let runtimeVariables: Readonly<Record<string, unknown>> = {};
    if (parsed.options.variablesPath !== undefined) {
      try {
        runtimeVariables = await readRuntimeVariables(
          parsed.options.variablesPath,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`failed to parse --variables: ${message}`);
        return 1;
      }
    }
    if (graphqlCliTransport !== null) {
      if (rejectUnsupportedRemoteMockScenario(parsed.options, io)) {
        return 2;
      }
      try {
        const data = await executeCliGraphqlOperation({
          transport: graphqlCliTransport,
          document: `
              mutation ExecuteWorkflow($input: ExecuteWorkflowInput!) {
                executeWorkflow(input: $input) {
                  workflowExecutionId
                  sessionId
                  status
                  exitCode
                }
              }
            `,
          variables: {
            input: {
              workflowName: workflowTarget,
              runtimeVariables,
              ...buildRemoteExecutionInput(parsed.options),
            },
          },
        });
        const payload = readRemoteWorkflowExecutionPayload(
          data,
          "executeWorkflow",
        );
        const summary = await fetchRemoteWorkflowRunSummary(
          graphqlCliTransport,
          payload.sessionId,
        );

        if (parsed.options.output === "json") {
          emitJson(io, {
            sessionId: payload.sessionId,
            status: payload.status,
            workflowName: summary.workflowName,
            workflowId: summary.workflowId,
            nodeExecutions: summary.nodeExecutions,
            transitions: summary.transitions,
            exitCode: payload.exitCode,
          });
        } else {
          io.stdout(`run session: ${payload.sessionId}`);
          io.stdout(`status: ${payload.status}`);
          io.stdout(`nodeExecutions: ${summary.nodeExecutions}`);
        }
        return payload.exitCode;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`remote run failed: ${message}`);
        return 1;
      }
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

    const loadedWorkflow = await loadWorkflowFromCatalog(
      workflowTarget,
      sharedOptions,
    );
    if (!loadedWorkflow.ok) {
      if (parsed.options.output === "json") {
        emitJson(io, loadedWorkflow.error);
      } else {
        io.stderr(`run failed: ${loadedWorkflow.error.message}`);
        if (loadedWorkflow.error.issues) {
          io.stderr(formatValidationIssues(loadedWorkflow.error.issues));
        }
      }
      return loadedWorkflow.error.code === "VALIDATION" ||
        loadedWorkflow.error.code === "INVALID_WORKFLOW_NAME" ||
        loadedWorkflow.error.code === "INVALID_SCOPE"
        ? 2
        : 1;
    }
    const workflowRunOptions = optionsForLoadedWorkflow(
      loadedWorkflow.value,
      sharedOptions,
    );

    const result = await runWorkflow(workflowTarget, {
      ...workflowRunOptions,
      runtimeVariables,
      ...mockScenarioOptions,
      ...buildLocalWorkflowRunOverrides(parsed.options, true),
      ...buildSupervisorProgressEventSink(parsed.options, io),
      ...(parsed.options.maxSteps === undefined
        ? {}
        : { maxSteps: parsed.options.maxSteps }),
      ...(parsed.options.maxConcurrency === undefined
        ? {}
        : { maxConcurrency: parsed.options.maxConcurrency }),
    });

    if (!result.ok) {
      if (parsed.options.output === "json") {
        emitJson(io, result.error);
      } else {
        io.stderr(`run failed: ${result.error.message}`);
      }
      return result.error.exitCode;
    }

    if (parsed.options.output === "json") {
      emitJson(io, {
        sessionId: result.value.session.sessionId,
        status: result.value.session.status,
        workflowName: result.value.session.workflowName,
        workflowId: result.value.session.workflowId,
        source: workflowSourceJson(loadedWorkflow.value.source),
        nodeExecutions: result.value.session.nodeExecutions.length,
        transitions: result.value.session.transitions.length,
        exitCode: result.value.exitCode,
        ...(result.value.session.supervision === undefined
          ? {}
          : { supervision: result.value.session.supervision }),
      });
    } else {
      const sourceLine = formatWorkflowSource(loadedWorkflow.value.source);
      if (sourceLine !== undefined) {
        io.stdout(`source: ${sourceLine}`);
      }
      io.stdout(`run session: ${result.value.session.sessionId}`);
      io.stdout(`status: ${result.value.session.status}`);
      io.stdout(
        `nodeExecutions: ${result.value.session.nodeExecutions.length}`,
      );
    }

    return result.value.exitCode;
  }

  io.stderr(`unknown workflow command: ${command}`);
  printHelp(io);
  return 1;
}
