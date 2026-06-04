import { readFile } from "node:fs/promises";
import path from "node:path";
import { runWorkflow } from "../workflow/engine";
import { loadWorkflowFromCatalog, type LoadFailure } from "../workflow/load";
import type { Result } from "../workflow/result";
import {
  normalizeTemporaryWorkflowPayload,
  type LoadedTemporaryWorkflow,
} from "../workflow/temporary-workflow";
import {
  checkoutWorkflowPackageForTemporaryRun,
  type WorkflowPackageTemporaryRunCheckoutResult,
  workflowRegistryRunTextSummary,
  workflowRegistryRunTemporaryWorkflowDirectory,
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
  readRuntimeVariablesSource,
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
import type { DirectExecutableAddonGrant } from "../workflow/types";

function retainedRegistryStatus(
  status: string,
): "paused" | "running" | "waiting" {
  if (status === "running" || status === "waiting") {
    return status;
  }
  return "paused";
}

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
      workflowRegistryRunTemporaryWorkflowDirectory(checkout.provenance),
      checkout.packageStagingDirectory,
    ],
  };
}

async function loadTemporaryWorkflowForCli(
  context: RunCliScopeContext,
  loadOptions: RunCliScopeContext["sharedOptions"],
): Promise<Result<LoadedTemporaryWorkflow, LoadFailure>> {
  const { parsed } = context;
  if (parsed.options.workflowJson !== undefined) {
    return await normalizeTemporaryWorkflowPayload(
      {
        kind: "inline-json",
        value: parsed.options.workflowJson,
      },
      loadOptions,
    );
  }

  const workflowJsonFile = parsed.options.workflowJsonFile;
  if (workflowJsonFile === undefined) {
    throw new Error("internal: temporary workflow input missing");
  }
  const displayPath = path.resolve(process.cwd(), workflowJsonFile);
  try {
    const raw = await readFile(displayPath, "utf8");
    return await normalizeTemporaryWorkflowPayload(
      {
        kind: "json-file",
        value: JSON.parse(raw) as unknown,
        displayPath,
      },
      loadOptions,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      ok: false,
      error: {
        code: "IO",
        message: `failed reading --workflow-json-file '${workflowJsonFile}': ${message}`,
      },
    };
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDirectExecutableAddonGrant(
  value: unknown,
  pathLabel: string,
): DirectExecutableAddonGrant {
  if (!isRecord(value)) {
    throw new Error(`${pathLabel} must be an object`);
  }
  const packageId = value["packageId"];
  if (typeof packageId !== "string" || packageId.length === 0) {
    throw new Error(`${pathLabel}.packageId must be a non-empty string`);
  }
  const kind = value["kind"];
  if (kind !== undefined && kind !== "node-addon") {
    throw new Error(`${pathLabel}.kind must be node-addon when provided`);
  }
  const registry = value["registry"];
  if (
    registry !== undefined &&
    (typeof registry !== "string" || registry.length === 0)
  ) {
    throw new Error(`${pathLabel}.registry must be a non-empty string`);
  }
  const branch = value["branch"];
  if (
    branch !== undefined &&
    (typeof branch !== "string" || branch.length === 0)
  ) {
    throw new Error(`${pathLabel}.branch must be a non-empty string`);
  }
  const addonsRaw = value["addons"];
  if (!Array.isArray(addonsRaw) || addonsRaw.length === 0) {
    throw new Error(`${pathLabel}.addons must be a non-empty array`);
  }
  const addons = addonsRaw.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(
        `${pathLabel}.addons[${String(index)}] must be an object`,
      );
    }
    const name = entry["name"];
    const version = entry["version"];
    const contentDigest = entry["contentDigest"];
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(
        `${pathLabel}.addons[${String(index)}].name must be a non-empty string`,
      );
    }
    if (typeof version !== "string" || version.length === 0) {
      throw new Error(
        `${pathLabel}.addons[${String(index)}].version must be a non-empty string`,
      );
    }
    if (
      typeof contentDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(contentDigest)
    ) {
      throw new Error(
        `${pathLabel}.addons[${String(index)}].contentDigest must be a sha256 digest`,
      );
    }
    const optional = entry["optional"];
    if (optional !== undefined && typeof optional !== "boolean") {
      throw new Error(
        `${pathLabel}.addons[${String(index)}].optional must be a boolean`,
      );
    }
    const capabilityGrantRaw = entry["capabilityGrant"];
    let capabilityGrant:
      | Readonly<
          Record<
            string,
            NonNullable<
              DirectExecutableAddonGrant["addons"][number]["capabilityGrant"]
            >[string]
          >
        >
      | undefined;
    if (capabilityGrantRaw !== undefined) {
      if (!isRecord(capabilityGrantRaw)) {
        throw new Error(
          `${pathLabel}.addons[${String(index)}].capabilityGrant must be an object`,
        );
      }
      const grants: Record<
        string,
        NonNullable<
          DirectExecutableAddonGrant["addons"][number]["capabilityGrant"]
        >[string]
      > = {};
      for (const [capabilityName, grantRaw] of Object.entries(
        capabilityGrantRaw,
      )) {
        if (!isRecord(grantRaw) || typeof grantRaw["allowed"] !== "boolean") {
          throw new Error(
            `${pathLabel}.addons[${String(index)}].capabilityGrant.${capabilityName}.allowed must be a boolean`,
          );
        }
        const scope = grantRaw["scope"];
        if (
          scope !== undefined &&
          (typeof scope !== "string" || scope.length === 0)
        ) {
          throw new Error(
            `${pathLabel}.addons[${String(index)}].capabilityGrant.${capabilityName}.scope must be a non-empty string`,
          );
        }
        grants[capabilityName] = {
          allowed: grantRaw["allowed"],
          ...(scope === undefined ? {} : { scope }),
        };
      }
      capabilityGrant = grants;
    }
    return {
      name,
      version,
      contentDigest,
      ...(capabilityGrant === undefined ? {} : { capabilityGrant }),
      ...(optional === undefined ? {} : { optional }),
    };
  });
  return {
    packageId,
    ...(registry === undefined ? {} : { registry }),
    ...(branch === undefined ? {} : { branch }),
    ...(kind === undefined ? {} : { kind }),
    addons,
  };
}

async function readDirectExecutableAddonGrants(
  values: readonly string[] | undefined,
): Promise<readonly DirectExecutableAddonGrant[]> {
  const grants: DirectExecutableAddonGrant[] = [];
  for (const value of values ?? []) {
    const source = await readRuntimeVariablesSource(value);
    let parsed: unknown;
    try {
      parsed = JSON.parse(source.content) as unknown;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      throw new Error(
        `${source.displayValue} must contain valid JSON: ${message}`,
      );
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const [index, entry] of entries.entries()) {
      grants.push(
        normalizeDirectExecutableAddonGrant(
          entry,
          Array.isArray(parsed)
            ? `--direct-executable-addon-grant[${String(index)}]`
            : "--direct-executable-addon-grant",
        ),
      );
    }
  }
  return grants;
}

export async function runCliWorkflowRunCommand(
  context: RunCliScopeContext,
  workflowTarget: string | undefined,
): Promise<number> {
  const { parsed, sharedOptions, graphqlCliTransport, io } = context;
  const hasTemporaryWorkflowJson = parsed.options.workflowJson !== undefined;
  const hasTemporaryWorkflowJsonFile =
    parsed.options.workflowJsonFile !== undefined;
  const hasTemporaryWorkflowInput =
    hasTemporaryWorkflowJson || hasTemporaryWorkflowJsonFile;
  if (hasTemporaryWorkflowJson && hasTemporaryWorkflowJsonFile) {
    io.stderr("--workflow-json cannot be combined with --workflow-json-file");
    return 2;
  }
  if (hasTemporaryWorkflowInput && workflowTarget !== undefined) {
    io.stderr(
      "--workflow-json and --workflow-json-file cannot be combined with a positional workflow target",
    );
    return 2;
  }
  if (hasTemporaryWorkflowInput && parsed.options.workflowRoot !== undefined) {
    io.stderr(
      "--workflow-json and --workflow-json-file cannot be combined with --workflow-definition-dir",
    );
    return 2;
  }
  if (hasTemporaryWorkflowInput && parsed.options.fromRegistry) {
    io.stderr(
      "--workflow-json and --workflow-json-file cannot be combined with --from-registry",
    );
    return 2;
  }
  if (hasTemporaryWorkflowInput && graphqlCliTransport !== null) {
    io.stderr(
      "--workflow-json and --workflow-json-file are local-only and cannot be combined with --endpoint",
    );
    return 2;
  }
  if (!hasTemporaryWorkflowInput && workflowTarget === undefined) {
    io.stderr(
      "workflow run requires a workflow target or temporary workflow input",
    );
    return 2;
  }
  if (parsed.options.fromRegistry && graphqlCliTransport !== null) {
    io.stderr(
      "workflow run --from-registry is local-only and cannot be combined with --endpoint",
    );
    return 2;
  }
  if (
    graphqlCliTransport !== null &&
    parsed.options.directExecutableAddonGrantValues !== undefined
  ) {
    io.stderr(
      "--direct-executable-addon-grant is local-only and cannot be combined with --endpoint",
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
  let directExecutableAddonGrants:
    | readonly DirectExecutableAddonGrant[]
    | undefined;
  try {
    const parsedGrants = await readDirectExecutableAddonGrants(
      parsed.options.directExecutableAddonGrantValues,
    );
    if (parsedGrants.length > 0) {
      directExecutableAddonGrants = parsedGrants;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    io.stderr(`failed to parse --direct-executable-addon-grant: ${message}`);
    return 1;
  }
  let nodePatch:
    | Awaited<ReturnType<typeof readWorkflowNodePatchOption>>
    | undefined;
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
            workflowName: workflowTarget as string,
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
        target: workflowTarget as string,
        ...(parsed.options.registry === undefined
          ? {}
          : { registry: parsed.options.registry }),
        ...(parsed.options.branch === undefined
          ? {}
          : { branch: parsed.options.branch }),
        options: sharedOptions,
        ...(context.deps.fetchImpl === undefined
          ? {}
          : { fetchImpl: context.deps.fetchImpl }),
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
  const temporaryWorkflow = hasTemporaryWorkflowInput
    ? await loadTemporaryWorkflowForCli(context, {
        ...sharedOptions,
        ...(directExecutableAddonGrants === undefined
          ? {}
          : { directExecutableAddonGrants }),
        ...(nodePatch === undefined ? {} : { nodePatch }),
      })
    : undefined;
  if (temporaryWorkflow !== undefined && !temporaryWorkflow.ok) {
    if (parsed.options.output === "json") {
      emitJson(io, temporaryWorkflow.error);
    } else {
      io.stderr(`run failed: ${temporaryWorkflow.error.message}`);
      if (temporaryWorkflow.error.issues) {
        io.stderr(formatValidationIssues(temporaryWorkflow.error.issues));
      }
    }
    return temporaryWorkflow.error.code === "VALIDATION" ||
      temporaryWorkflow.error.code === "INVALID_WORKFLOW_NAME" ||
      temporaryWorkflow.error.code === "INVALID_SCOPE"
      ? 2
      : 1;
  }
  const effectiveWorkflowTarget =
    temporaryWorkflow?.value.loadedWorkflow.workflowName ??
    registryRun?.workflowName ??
    (workflowTarget as string);
  const effectiveSharedOptions =
    registryRun === undefined
      ? sharedOptions
      : {
          ...sharedOptions,
          workflowRoot: registryRun.workflowDefinitionDir,
        };
  const effectiveLoadOptions =
    directExecutableAddonGrants === undefined
      ? effectiveSharedOptions
      : { ...effectiveSharedOptions, directExecutableAddonGrants };

  const loadedWorkflow =
    temporaryWorkflow?.value.loadedWorkflow === undefined
      ? await loadWorkflowFromCatalog(effectiveWorkflowTarget, {
          ...effectiveLoadOptions,
          ...(nodePatch === undefined ? {} : { nodePatch }),
        })
      : {
          ok: true as const,
          value: temporaryWorkflow.value.loadedWorkflow,
        };
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
    effectiveLoadOptions,
  );

  const result = await runWorkflow(effectiveWorkflowTarget, {
    ...workflowRunOptions,
    ...(nodePatch === undefined ? {} : { nodePatch }),
    runtimeVariables,
    ...mockScenarioOptions,
    ...buildLocalWorkflowRunOverrides(
      parsed.options,
      !hasTemporaryWorkflowInput,
    ),
    ...buildSupervisorProgressEventSink(parsed.options, io),
    ...(temporaryWorkflow === undefined || !temporaryWorkflow.ok
      ? {}
      : { temporaryWorkflow: temporaryWorkflow.value }),
    ...(parsed.options.maxSteps === undefined
      ? {}
      : { maxSteps: parsed.options.maxSteps }),
    ...(parsed.options.maxConcurrency === undefined
      ? {}
      : { maxConcurrency: parsed.options.maxConcurrency }),
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
    }
    return result.error.exitCode;
  }

  const provenancePersistError =
    registryRun === undefined ||
    isTerminalWorkflowSessionStatus(result.value.session.status)
      ? undefined
      : await persistRegistryRunProvenance({
          options: sharedOptions,
          sessionId: result.value.session.sessionId,
          provenance: registryRun.provenance,
          retainedForStatus: retainedRegistryStatus(
            result.value.session.status,
          ),
        });
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
        `registry: ${workflowRegistryRunTextSummary(registryRun.provenance)}`,
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
