import { runWorkflow } from "../workflow/engine";
import { loadWorkflowFromCatalog } from "../workflow/load";
import {
  checkoutWorkflowPackageForTemporaryRun,
  type WorkflowPackageTemporaryRunCheckoutResult,
} from "../workflow/packages";
import type { MockNodeScenario } from "../workflow/scenario-adapter";
import { isTerminalWorkflowSessionStatus } from "../workflow/session";
import type { RunCliScopeContext } from "./storage-and-options";
import {
  buildRemoteExecutionInput,
  buildSupervisorProgressEventSink,
  emitJson,
  executeCliGraphqlOperation,
  fetchRemoteWorkflowRunSummary,
  formatValidationIssues,
  readMockScenarioOption,
  readRemoteWorkflowExecutionPayload,
  readRuntimeVariables,
  readWorkflowNodePatchOption,
  rejectUnsupportedRemoteMockScenario,
} from "./input-output-helpers";
import {
  type RegistryRunCleanupOutput,
  persistRegistryRunProvenance,
  registryRunSourceJson,
} from "./registry-run-provenance";
import {
  buildLocalWorkflowRunOverrides,
  formatWorkflowSource,
  optionsForLoadedWorkflow,
  workflowSourceJson,
} from "./workflow-graphql-formatters";

async function cleanupTemporaryRegistryRun(
  checkout: WorkflowPackageTemporaryRunCheckoutResult | undefined,
): Promise<RegistryRunCleanupOutput | undefined> {
  if (checkout === undefined) {
    return undefined;
  }
  const cleaned = await checkout.cleanup();
  return cleaned.ok
    ? { ok: true, remainingPaths: cleaned.value.remainingPaths }
    : { ok: false, error: cleaned.error.message };
}

function skippedTemporaryRegistryRunCleanup(
  checkout: WorkflowPackageTemporaryRunCheckoutResult | undefined,
  reason: string,
): RegistryRunCleanupOutput | undefined {
  if (checkout === undefined) {
    return undefined;
  }
  return {
    ok: false,
    skipped: true,
    reason,
    remainingPaths: [
      checkout.provenance.temporaryWorkflowDirectory,
      checkout.packageStagingDirectory,
    ],
  };
}

export async function runCliWorkflowRunCommand(
  context: RunCliScopeContext,
  workflowTarget: string,
): Promise<number> {
  const { parsed, sharedOptions, graphqlCliTransport, io } = context;
  if (parsed.options.fromRegistry && graphqlCliTransport !== null) {
    io.stderr(
      "workflow run --from-registry is local-only and cannot be combined with --endpoint",
    );
    return 2;
  }
  let runtimeVariables: Readonly<Record<string, unknown>> = {};
  if (parsed.options.variablesPath !== undefined) {
    try {
      runtimeVariables = await readRuntimeVariables(
        parsed.options.variablesPath,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
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
      const message = error instanceof Error ? error.message : "unknown error";
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
      const message = error instanceof Error ? error.message : "unknown error";
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

  const registryCheckout = parsed.options.fromRegistry
    ? await checkoutWorkflowPackageForTemporaryRun({
        packageName: workflowTarget,
        ...(parsed.options.registry === undefined
          ? {}
          : { registry: parsed.options.registry }),
        ...(parsed.options.branch === undefined
          ? {}
          : { branch: parsed.options.branch }),
        options: sharedOptions,
      })
    : undefined;
  if (registryCheckout !== undefined && !registryCheckout.ok) {
    if (parsed.options.output === "json") {
      emitJson(io, registryCheckout.error);
    } else {
      io.stderr(`run failed: ${registryCheckout.error.message}`);
    }
    return registryCheckout.error.code === "VALIDATION" ||
      registryCheckout.error.code === "INVALID_PACKAGE_NAME" ||
      registryCheckout.error.code === "INVALID_REGISTRY" ||
      registryCheckout.error.code === "MISSING_PACKAGE" ||
      registryCheckout.error.code === "DUPLICATE_PACKAGE"
      ? 2
      : 1;
  }
  const registryRun =
    registryCheckout === undefined ? undefined : registryCheckout.value;
  const effectiveWorkflowTarget = registryRun?.workflowName ?? workflowTarget;
  const effectiveSharedOptions =
    registryRun === undefined
      ? sharedOptions
      : {
          ...sharedOptions,
          workflowRoot: registryRun.workflowDefinitionDir,
        };

  const loadedWorkflow = await loadWorkflowFromCatalog(
    effectiveWorkflowTarget,
    {
      ...effectiveSharedOptions,
      ...(nodePatch === undefined ? {} : { nodePatch }),
    },
  );
  if (!loadedWorkflow.ok) {
    const cleanup = await cleanupTemporaryRegistryRun(registryRun);
    if (parsed.options.output === "json") {
      emitJson(io, {
        ...loadedWorkflow.error,
        ...(registryRun === undefined
          ? {}
          : {
              registrySource: registryRunSourceJson({
                provenance: registryRun.provenance,
                ...(cleanup === undefined ? {} : { cleanup }),
              }),
            }),
      });
    } else {
      io.stderr(`run failed: ${loadedWorkflow.error.message}`);
      if (loadedWorkflow.error.issues) {
        io.stderr(formatValidationIssues(loadedWorkflow.error.issues));
      }
      if (cleanup !== undefined && !cleanup.ok && !("skipped" in cleanup)) {
        io.stderr(`cleanup warning: ${cleanup.error}`);
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
    effectiveSharedOptions,
  );

  const result = await runWorkflow(effectiveWorkflowTarget, {
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
  const provenancePersistError =
    registryRun === undefined
      ? undefined
      : result.ok
        ? await persistRegistryRunProvenance({
            options: sharedOptions,
            sessionId: result.value.session.sessionId,
            provenance: registryRun.provenance,
          })
        : result.error.sessionId === undefined
          ? undefined
          : await persistRegistryRunProvenance({
              options: sharedOptions,
              sessionId: result.error.sessionId,
              provenance: registryRun.provenance,
            });
  if (!result.ok) {
    const cleanup = await cleanupTemporaryRegistryRun(registryRun);
    if (parsed.options.output === "json") {
      emitJson(io, {
        ...result.error,
        ...(registryRun === undefined
          ? {}
          : {
              registrySource: registryRunSourceJson({
                provenance: registryRun.provenance,
                ...(cleanup === undefined ? {} : { cleanup }),
              }),
            }),
      });
    } else {
      io.stderr(`run failed: ${result.error.message}`);
      if (cleanup !== undefined && !cleanup.ok && !("skipped" in cleanup)) {
        io.stderr(`cleanup warning: ${cleanup.error}`);
      }
      if (provenancePersistError !== undefined) {
        io.stderr(`provenance warning: ${provenancePersistError}`);
      }
    }
    return result.error.exitCode;
  }

  const cleanup = isTerminalWorkflowSessionStatus(result.value.session.status)
    ? await cleanupTemporaryRegistryRun(registryRun)
    : skippedTemporaryRegistryRunCleanup(
        registryRun,
        `workflow session status '${result.value.session.status}' is not terminal`,
      );

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
      ...(registryRun === undefined
        ? {}
        : {
            registrySource: registryRunSourceJson({
              provenance: registryRun.provenance,
              ...(cleanup === undefined ? {} : { cleanup }),
            }),
          }),
    });
  } else {
    const sourceLine = formatWorkflowSource(loadedWorkflow.value.source);
    if (sourceLine !== undefined) {
      io.stdout(`source: ${sourceLine}`);
    }
    if (registryRun !== undefined) {
      io.stdout(
        `registry: ${registryRun.provenance.packageId} ${registryRun.provenance.registryUrl}#${registryRun.provenance.registryRef}`,
      );
    }
    io.stdout(`run session: ${result.value.session.sessionId}`);
    io.stdout(`status: ${result.value.session.status}`);
    io.stdout(`nodeExecutions: ${result.value.session.nodeExecutions.length}`);
    if (cleanup !== undefined && !cleanup.ok && "skipped" in cleanup) {
      io.stdout(`cleanup: skipped (${cleanup.reason})`);
    } else if (cleanup !== undefined && !cleanup.ok) {
      io.stderr(`cleanup warning: ${cleanup.error}`);
    }
    if (provenancePersistError !== undefined) {
      io.stderr(`provenance warning: ${provenancePersistError}`);
    }
  }

  return result.value.exitCode;
}
