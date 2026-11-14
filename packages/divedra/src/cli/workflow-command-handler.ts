import { collectWorkflowAddonSourceSummaries } from "../workflow/addon-source-summary";
import { checkoutWorkflow } from "../workflow/checkout";
import { createWorkflowTemplate } from "../workflow/create";
import { runWorkflow } from "../workflow/engine";
import {
  buildInspectionSummary,
  deriveWorkflowStructureRows,
  type WorkflowStructureRow,
} from "../workflow/inspect";
import { loadWorkflowFromCatalog } from "../workflow/load";
import { executeWorkflowSelfImprove } from "divedra-core";
import {
  hasInvalidNodeValidationResult,
  type NodeValidationResult,
} from "../workflow/validate";
import {
  buildWorkflowCatalogOverview,
  buildWorkflowStatusOverview,
  parseWorkflowOverviewAggregateStatusFilter,
  type WorkflowOverviewRow,
} from "../workflow/overview";
import type { MockNodeScenario } from "../workflow/scenario-adapter";
import {
  buildWorkflowUsageCatalog,
  buildWorkflowUsageSummary,
} from "../workflow/usage";
import {
  resolveWorkflowOverviewStorageOptions,
  type RunCliScopeContext,
} from "./storage-and-options";
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
  readWorkflowNodePatchOption,
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
    const overviewStorageOptions =
      await resolveWorkflowOverviewStorageOptions(sharedOptions);
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
      overviewStorageOptions,
    );
    if (!built.ok) {
      io.stderr(built.error.message);
      return 1;
    }
    await emitLocalWorkflowCatalogWarnings(io, overviewStorageOptions);
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
    const overviewStorageOptions =
      await resolveWorkflowOverviewStorageOptions(sharedOptions);
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
      overviewStorageOptions,
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

  if (command === "checkout") {
    if (positionals.length > 3) {
      io.stderr("workflow checkout accepts exactly one GitHub directory URL");
      return 2;
    }
    if (parsed.options.workflowRoot !== undefined) {
      io.stderr(
        "workflow checkout does not support --workflow-definition-dir; use project scope or --user-scope",
      );
      return 2;
    }
    if (graphqlCliTransport !== null) {
      io.stderr("workflow checkout is local-only; omit --endpoint");
      return 2;
    }

    const checkedOut = await checkoutWorkflow({
      ...sharedOptions,
      sourceUrl: workflowTarget,
      ...(parsed.options.userScope ? { userScope: true } : {}),
      ...(parsed.options.overwrite ? { overwrite: true } : {}),
      ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    });
    if (!checkedOut.ok) {
      io.stderr(`checkout failed: ${checkedOut.error.message}`);
      return checkedOut.error.code === "IO" ||
        checkedOut.error.code === "FETCH_FAILED"
        ? 1
        : 2;
    }
    if (parsed.options.output === "json") {
      emitJson(io, checkedOut.value);
    } else {
      io.stdout(`checked out workflow: ${checkedOut.value.workflowName}`);
      io.stdout(`scope: ${checkedOut.value.scope}`);
      io.stdout(`destination: ${checkedOut.value.destinationDirectory}`);
      io.stdout(`registry: ${checkedOut.value.registryPath}`);
    }
    return 0;
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

  if (command === "self-improve") {
    const input = {
      workflowName: workflowTarget,
      ...(parsed.options.selfImproveMode === undefined
        ? {}
        : { mode: parsed.options.selfImproveMode }),
      ...(parsed.options.selfImproveSourceMode === undefined
        ? {}
        : { sourceMode: parsed.options.selfImproveSourceMode }),
      ...(parsed.options.limit === undefined
        ? {}
        : { limit: parsed.options.limit }),
      ...(parsed.options.selfImproveSessions === undefined
        ? {}
        : { sessionIds: parsed.options.selfImproveSessions }),
      ...(parsed.options.selfImproveEnableDisabled
        ? { enableDisabled: true }
        : {}),
    };
    if (graphqlCliTransport !== null) {
      try {
        const data = await executeCliGraphqlOperation({
          transport: graphqlCliTransport,
          document: `
            mutation ExecuteWorkflowSelfImprove($input: ExecuteWorkflowSelfImproveInput!) {
              executeWorkflowSelfImprove(input: $input) {
                selfImproveId
                workflowName
                workflowId
                reportPath
                markdownReportPath
                inputRunsPath
                backupPath
                purposeAchievement
                patchStatus
                validationStatus
                gitCommitStatus
                gitCommitHash
                selectedSourceRuns {
                  sessionId
                  workflowId
                  workflowName
                  status
                  startedAt
                  updatedAt
                  artifactDir
                  lastError
                  nodeExecutions {
                    nodeId
                    stepId
                    nodeExecId
                    status
                    artifactDir
                    startedAt
                    endedAt
                    outputAttemptCount
                    outputValidationErrors
                  }
                }
                findings { severity category message evidenceSessionIds stepIds nodeIds }
              }
            }
          `,
          variables: { input },
        });
        const payload = requireObjectField(
          data["executeWorkflowSelfImprove"],
          "executeWorkflowSelfImprove",
        );
        if (parsed.options.output === "json") {
          emitJson(io, payload);
        } else {
          io.stdout(`selfImproveId: ${String(payload["selfImproveId"])}`);
          io.stdout(`report: ${String(payload["reportPath"])}`);
          io.stdout(
            `purposeAchievement: ${String(payload["purposeAchievement"])}`,
          );
          io.stdout(`patchStatus: ${String(payload["patchStatus"])}`);
          io.stdout(`gitCommitStatus: ${String(payload["gitCommitStatus"])}`);
        }
        return 0;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`remote self-improve failed: ${message}`);
        return 1;
      }
    }

    try {
      const result = await executeWorkflowSelfImprove({
        ...sharedOptions,
        ...input,
      });
      if (parsed.options.output === "json") {
        emitJson(io, result);
      } else {
        io.stdout(`selfImproveId: ${result.selfImproveId}`);
        io.stdout(`report: ${result.reportPath}`);
        io.stdout(`purposeAchievement: ${result.purposeAchievement}`);
        io.stdout(`patchStatus: ${result.patchStatus}`);
        io.stdout(`gitCommitStatus: ${result.gitCommitStatus}`);
      }
      return 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`self-improve failed: ${message}`);
      return 1;
    }
  }

  if (command === "validate") {
    let nodePatch = undefined;
    if (parsed.options.nodePatchPath !== undefined) {
      try {
        nodePatch = await readWorkflowNodePatchOption(
          parsed.options.nodePatchPath,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`failed to parse --node-patch: ${message}`);
        return 1;
      }
    }
    const validationLoadOptions = {
      ...sharedOptions,
      executablePreflight: parsed.options.executablePreflight,
      ...(nodePatch === undefined ? {} : { nodePatch }),
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
    let nodePatch = undefined;
    if (parsed.options.nodePatchPath !== undefined) {
      try {
        nodePatch = await readWorkflowNodePatchOption(
          parsed.options.nodePatchPath,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`failed to parse --node-patch: ${message}`);
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
              ...(nodePatch === undefined ? {} : { nodePatch }),
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

    const loadedWorkflow = await loadWorkflowFromCatalog(workflowTarget, {
      ...sharedOptions,
      ...(nodePatch === undefined ? {} : { nodePatch }),
    });
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
      ...(nodePatch === undefined ? {} : { nodePatch }),
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
