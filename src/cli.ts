import { constants as fsConstants } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_GRAPHQL_ENDPOINT,
  executeGraphqlRequest,
  type GraphqlClientResponse,
} from "./graphql/client";
import { buildHookConfigurationSnippet } from "./hook/config";
import { parseHookVendorOption } from "./hook/detect-vendor";
import { createReadHookStdin, runHookCommand } from "./hook/index";
import { SUPPORTED_HOOK_VENDORS } from "./hook/types";
import {
  startServe,
  type ServeStartOptions,
  type StartedServe,
} from "./server/serve";
import {
  createEventListenerService,
  loadAndValidateEventConfiguration,
} from "./events";
import { emitEventFile } from "./events/manual-emit";
import { listEventReceipts, replayEventReceipt } from "./events/receipt-ops";
import type { EventListenerHandle } from "./events/listener-service";
import type { MockNodeScenario } from "./workflow/scenario-adapter";
import type { WorkflowExecutionCompactSummary } from "./shared/ui-contract";
import {
  createLifecycleSupervisionPolicyInput,
  normalizeAutoImprovePolicy,
  type AutoImprovePolicyInput,
} from "./workflow/auto-improve-policy";
import { createWorkflowTemplate } from "./workflow/create";
import { callStep, type CallStepInput } from "./workflow/call-step";
import { runWorkflow, type WorkflowRunOptions } from "./workflow/engine";
import {
  createSupervisorProgressEventSink,
  createSupervisorProgressRenderer,
} from "./workflow/supervisor-progress-renderer";
import { loadWorkflowFromCatalog, type LoadedWorkflow } from "./workflow/load";
import {
  listWorkflowCatalogSources,
  resolveWorkflowSource,
  withResolvedWorkflowSourceOptions,
} from "./workflow/catalog";
import {
  computeProjectScopedRootDataDirForScopeRoot,
  inferRootDataDirFromExplicitStorageRoots,
} from "./workflow/paths";
import {
  resolveCurrentStepId,
  resolveCurrentStepIdFromWorkflow,
  type NodeExecutionRecord,
  type WorkflowSessionState,
} from "./workflow/session";
import {
  buildFanoutGroupSummaries,
  buildInspectionSummary,
  deriveWorkflowStructureRows,
  type WorkflowStructureRow,
} from "./workflow/inspect";
import { collectWorkflowAddonSourceSummaries } from "./workflow/addon-source-summary";
import { loadSession } from "./workflow/session-store";
import {
  buildSessionHealthReport,
  type SessionHealthReport,
} from "./workflow/session-health";
import { createCommunicationService } from "./workflow/communication-service";
import {
  listEventReplyDispatchesFromRuntimeDb,
  listRuntimeHookEvents,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  type RuntimeEventReplyDispatchStatus,
} from "./workflow/runtime-db";
import { normalizeWorkflowWorkingDirectoryOverride } from "./workflow/working-directory";
import {
  continueWorkflowFromHistory,
  listMergedWorkflowExecutionStepRuns,
} from "./lib";
import {
  buildWorkflowCatalogOverview,
  buildWorkflowStatusOverview,
  parseWorkflowOverviewAggregateStatusFilter,
  type WorkflowOverviewRow,
  type WorkflowStatusOverview,
} from "./workflow/overview";
import {
  buildWorkflowUsageCatalog,
  buildWorkflowUsageSummary,
  type WorkflowUsageCatalog,
  type WorkflowUsageSummary,
} from "./workflow/usage";
import type {
  LoadOptions,
  ResolvedWorkflowSource,
  WorkflowScopeSelector,
  WorkflowSourceScope,
} from "./workflow/types";

type AutoImproveCliInputs = {
  readonly enabled: boolean;
  readonly superviserWorkflowId?: string;
  readonly monitorIntervalMs?: number;
  readonly stallTimeoutMs?: number;
  readonly maxSupervisedAttempts?: number;
  readonly maxWorkflowPatches?: number;
  readonly workflowMutationMode?: "execution-copy" | "in-place";
  readonly allowTargetedRerun?: boolean;
};

function parseAutoImprovePolicyFromCliFlags(input: AutoImproveCliInputs): {
  readonly policy?: AutoImprovePolicyInput;
  readonly error?: string;
} {
  if (!input.enabled) {
    return {};
  }
  const normalized = normalizeAutoImprovePolicy(input);
  if (!normalized.ok) {
    return { error: normalized.error };
  }
  return normalized.value === undefined ? {} : { policy: input };
}

export interface CliIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

export interface CliDependencies {
  readonly startServe: (options: ServeStartOptions) => Promise<StartedServe>;
  readonly isInteractiveTerminal: () => boolean;
  readonly waitForServeShutdown?: (started: StartedServe) => Promise<void>;
  readonly waitForEventListenerShutdown?: (
    started: EventListenerHandle,
  ) => Promise<void>;
  readonly buildInspectionSummary?: typeof buildInspectionSummary;
  readonly fetchImpl?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly readStdin?: () => Promise<string>;
}

interface CliStorageOptions {
  readonly workflowRoot?: string;
  readonly workflowScope?: WorkflowScopeSelector;
  readonly userRoot?: string;
  readonly projectRoot?: string;
  readonly addonRoot?: string;
  readonly artifactRoot?: string;
  readonly rootDataDir?: string;
  readonly sessionStoreRoot?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function resolveCliPath(rawPath: string, cwd: string): string {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.resolve(cwd, rawPath);
}

async function resolveProjectScopeRootFromWorkflowRoot(
  workflowRoot: string,
  cwd: string,
): Promise<string | undefined> {
  const resolved = resolveCliPath(workflowRoot, cwd);
  if (!(await isDirectory(resolved))) {
    return undefined;
  }
  if (path.basename(resolved) !== "workflows") {
    return undefined;
  }

  const scopeRoot = path.dirname(resolved);
  return path.basename(scopeRoot) === ".divedra" ? scopeRoot : undefined;
}

async function resolveProjectScopeRootForSessionCommand(
  options: CliStorageOptions,
): Promise<string | undefined> {
  const cwd = process.cwd();
  const env = options.env ?? process.env;
  const configuredProjectRoot =
    options.projectRoot ?? env["DIVEDRA_PROJECT_ROOT"];
  if (configuredProjectRoot !== undefined && configuredProjectRoot.length > 0) {
    const resolved = resolveCliPath(configuredProjectRoot, cwd);
    if (await isDirectory(path.join(resolved, "workflows"))) {
      return resolved;
    }
    const nested = path.join(resolved, ".divedra");
    if (await isDirectory(path.join(nested, "workflows"))) {
      return nested;
    }
    return resolved;
  }

  const configuredWorkflowRoot =
    options.workflowRoot ?? env["DIVEDRA_WORKFLOW_DEFINITION_DIR"];
  if (
    configuredWorkflowRoot !== undefined &&
    configuredWorkflowRoot.length > 0
  ) {
    const scopeRoot = await resolveProjectScopeRootFromWorkflowRoot(
      configuredWorkflowRoot,
      cwd,
    );
    if (scopeRoot !== undefined) {
      return scopeRoot;
    }
  }

  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".divedra");
    if (await isDirectory(path.join(candidate, "workflows"))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function hasExplicitSessionStorageOverride(
  options: CliStorageOptions,
): boolean {
  const env = options.env ?? process.env;
  return (
    options.rootDataDir !== undefined ||
    options.artifactRoot !== undefined ||
    options.sessionStoreRoot !== undefined ||
    env["DIVEDRA_ARTIFACT_DIR"] !== undefined ||
    env["DIVEDRA_ARTIFACT_ROOT"] !== undefined ||
    env["DIVEDRA_SESSION_STORE"] !== undefined
  );
}

async function resolveSessionCommandStorageOptions(
  options: CliStorageOptions,
): Promise<CliStorageOptions> {
  if (hasExplicitSessionStorageOverride(options)) {
    return options;
  }

  const projectScopeRoot =
    await resolveProjectScopeRootForSessionCommand(options);
  if (projectScopeRoot === undefined) {
    return options;
  }

  const env = options.env ?? process.env;
  return {
    ...options,
    rootDataDir: computeProjectScopedRootDataDirForScopeRoot({
      scopeRoot: projectScopeRoot,
      ...(options.userRoot !== undefined
        ? { userRoot: options.userRoot }
        : env["DIVEDRA_USER_ROOT"] === undefined
          ? {}
          : { userRoot: env["DIVEDRA_USER_ROOT"] }),
    }),
  };
}

interface WorkflowSourceOutput {
  readonly scope: ResolvedWorkflowSource["scope"];
  readonly workflowRoot: string;
  readonly workflowDirectory: string;
  readonly scopeRoot?: string;
}

type RuntimeVariablesSourceKind = "inline-json" | "explicit-file" | "file-path";

interface RuntimeVariablesSource {
  readonly kind: RuntimeVariablesSourceKind;
  readonly displayValue: string;
  readonly content: string;
}

interface WorkflowVariablesExample {
  readonly mode: RuntimeVariablesSourceKind;
  readonly command: string;
}

interface ParsedOptions {
  readonly workflowRoot?: string;
  readonly workflowScope?: WorkflowScopeSelector;
  readonly userRoot?: string;
  readonly projectRoot?: string;
  readonly addonRoot?: string;
  readonly artifactRoot?: string;
  readonly sessionStoreRoot?: string;
  readonly workingDirectory?: string;
  readonly workerOnly: boolean;
  readonly output: "text" | "json" | "table";
  readonly structure: boolean;
  readonly format?: "text" | "json" | "jsonl";
  readonly variablesPath?: string;
  readonly mockScenarioPath?: string;
  readonly dryRun: boolean;
  readonly verbose: boolean;
  readonly debug: boolean;
  readonly maxSteps?: number;
  readonly maxConcurrency?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly timeoutMs?: number;
  readonly host?: string;
  readonly port?: number;
  readonly endpoint?: string;
  readonly authToken?: string;
  readonly authTokenEnv?: string;
  readonly filePath?: string;
  readonly readOnly: boolean;
  readonly noExec: boolean;
  readonly messageJson?: string;
  readonly messageFile?: string;
  readonly promptVariant?: string;
  readonly continueSession: boolean;
  readonly resumeStepExecId?: string;
  readonly vendor?: string;
  readonly eventRoot?: string;
  readonly eventFile?: string;
  readonly sourceId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly logLimit?: number;
  readonly includeLlmMessages: boolean;
  readonly llmLimit?: number;
  readonly live: boolean;
  readonly stallTimeoutMs?: number;
  readonly reason?: string;
  readonly autoImprove?: AutoImprovePolicyInput;
  readonly disableAutoImprove: boolean;
  /** Phase-2: run superviser bundle as nested workflow; requires --auto-improve */
  readonly nestedSuperviser?: boolean;
  readonly continuationStartStepId?: string;
  readonly continuationAfterStepRunId?: string;
  /** When set, restricts `session step-runs` to rows whose resolved step id matches. */
  readonly stepRunsFilterStepId?: string;
}

interface ParsedArgs {
  readonly positionals: string[];
  readonly options: ParsedOptions;
  readonly error?: string;
}

function normalizeCliPositionals(positionals: readonly string[]): string[] {
  if (positionals[0] === "cli" && positionals[1] === "workflow") {
    return positionals.slice(1);
  }
  return [...positionals];
}

interface GraphqlCliTransportOptions {
  readonly endpoint: string;
  readonly authToken?: string;
  readonly managerSessionId?: string;
  readonly fetchImpl?: typeof fetch;
}

interface RemoteWorkflowRunSummary {
  readonly workflowName: string;
  readonly workflowId: string;
  readonly nodeExecutions: number;
  readonly transitions: number;
}

interface WorkflowExecutionContinuationMetadata {
  readonly continuedFromWorkflowExecutionId?: string;
  readonly continuedAfterStepRunId?: string;
  readonly continuedAfterExecutionOrdinal?: number;
  readonly continuedStartStepId?: string;
  readonly continuationMode?: WorkflowSessionState["continuationMode"];
  readonly historyImports?: WorkflowSessionState["historyImports"];
}

interface WorkflowExecutionExport {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly workflowName: string;
  readonly status: WorkflowSessionState["status"];
  readonly exportedAt: string;
  /** Explicit lineage for history-linked runs (reproducible continuation metadata). */
  readonly continuationMetadata?: WorkflowExecutionContinuationMetadata;
  readonly session: WorkflowSessionState;
  readonly nodeExecutions: Awaited<
    ReturnType<typeof listRuntimeNodeExecutions>
  >;
  readonly nodeLogs: Awaited<ReturnType<typeof listRuntimeNodeLogs>>;
  readonly hookEvents: Awaited<ReturnType<typeof listRuntimeHookEvents>>;
  readonly communications: readonly NonNullable<
    Awaited<
      ReturnType<
        ReturnType<typeof createCommunicationService>["getCommunication"]
      >
    >
  >[];
}

type RuntimeNodeLogEntry = Awaited<
  ReturnType<typeof listRuntimeNodeLogs>
>[number];

const HOOK_VENDOR_USAGE = SUPPORTED_HOOK_VENDORS.join("|");
const HOOK_VENDOR_EXPECTED = SUPPORTED_HOOK_VENDORS.map(
  (vendor) => `'${vendor}'`,
).join(" or ");

const DEFAULT_IO: CliIo = {
  stdout: (line: string) => console.log(line),
  stderr: (line: string) => console.error(line),
};

async function waitForProcessShutdownSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      resolve();
    };
    const onSigint = (): void => finish();
    const onSigterm = (): void => finish();
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  });
}

const DEFAULT_DEPS: CliDependencies = {
  startServe,
  isInteractiveTerminal: () =>
    process.stdin.isTTY === true && process.stdout.isTTY === true,
  readStdin: createReadHookStdin(process.stdin),
  waitForServeShutdown: async (_started: StartedServe) =>
    waitForProcessShutdownSignal(),
  waitForEventListenerShutdown: async (_started: EventListenerHandle) =>
    waitForProcessShutdownSignal(),
};

function parseNumericOption(
  flagName: string,
  value: string | undefined,
): { readonly value?: number; readonly error?: string } {
  if (value === undefined) {
    return { error: `${flagName} requires a numeric value` };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return {
      error: `invalid ${flagName} value '${value}'; expected a number`,
    };
  }
  return { value: parsed };
}

function parseRequiredStringOption(
  flagName: string,
  value: string | undefined,
  expectation?: string,
): { readonly value?: string; readonly error?: string } {
  if (value !== undefined) {
    return { value };
  }
  return {
    error:
      expectation === undefined
        ? `${flagName} requires a value`
        : `${flagName} requires a value: ${expectation}`,
  };
}

function parseEnumOption<const T extends string>(
  flagName: string,
  value: string | undefined,
  allowedValues: readonly T[],
  expectation: string,
): { readonly value?: T; readonly error?: string } {
  const parsedString = parseRequiredStringOption(flagName, value, expectation);
  if (parsedString.error !== undefined) {
    return { error: parsedString.error };
  }
  const parsedValue = parsedString.value;
  if (
    parsedValue !== undefined &&
    allowedValues.some((allowed) => allowed === parsedValue)
  ) {
    return { value: parsedValue as T };
  }
  return {
    error: `invalid ${flagName} value '${parsedValue}'; expected ${expectation}`,
  };
}

function parseEnvBooleanFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseWorkflowScopeOption(
  value: string | undefined,
): WorkflowScopeSelector | undefined {
  return value === "auto" || value === "project" || value === "user"
    ? value
    : undefined;
}

function parseWorkflowDefinitionDirectoryOption(
  flagName: string,
  value: string | undefined,
): { readonly value?: string; readonly error?: string } {
  return parseRequiredStringOption(flagName, value);
}

function parseReplyDispatchStatus(
  value: string | undefined,
): RuntimeEventReplyDispatchStatus | undefined {
  if (
    value === "dispatching" ||
    value === "sent" ||
    value === "queued" ||
    value === "failed"
  ) {
    return value;
  }
  return undefined;
}

function buildStepProgressSummaries(session: WorkflowSessionState): readonly {
  readonly stepId: string;
  readonly executions: number;
  readonly restarts: number;
}[] {
  const executionCounts = new Map<string, number>();
  for (const execution of session.nodeExecutions) {
    if (execution.stepId === undefined) {
      continue;
    }
    executionCounts.set(
      execution.stepId,
      (executionCounts.get(execution.stepId) ?? 0) + 1,
    );
  }

  return [...executionCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([stepId, executions]) => ({
      stepId,
      executions,
      restarts: session.restartCounts?.[stepId] ?? 0,
    }));
}

function formatFanoutSummaryLines(
  session: WorkflowSessionState,
): readonly string[] {
  const summaries = buildFanoutGroupSummaries(session);
  if (summaries.length === 0) {
    return [];
  }
  return [
    "fanoutGroups:",
    ...summaries.flatMap((summary) => {
      const counts = Object.entries(summary.branchCounts)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => `${status}=${count}`)
        .join(",");
      const target =
        summary.targetWorkflowId === undefined
          ? summary.targetStepId
          : `${summary.targetWorkflowId}:${summary.targetStepId}`;
      const failure =
        summary.firstFailure === undefined
          ? ""
          : ` firstFailure=${summary.firstFailure}`;
      const groupLine = `  - ${summary.groupId}: target=${target} source=${summary.sourceStepId} join=${summary.joinStepId} concurrency=${summary.concurrency} policy=${summary.failurePolicy} order=${summary.resultOrder} branches=${counts || "none"}${failure}`;
      const branchLines = summary.branches.map((branch) => {
        const output =
          branch.outputRef === undefined
            ? ""
            : ` outputRef=${branch.outputRef.nodeExecId}`;
        const workspace =
          branch.workspaceRoot === undefined
            ? ""
            : ` workspaceRoot=${branch.workspaceRoot}`;
        const superseded =
          branch.supersededWorkspaceRoot === undefined
            ? ""
            : ` supersededWorkspaceRoot=${branch.supersededWorkspaceRoot}`;
        const error =
          branch.error === undefined ? "" : ` error=${branch.error}`;
        return `    - branch ${branch.branchIndex}: status=${branch.status} workItem=${branch.workItemId} nodeExecIds=${branch.nodeExecIds.join(",") || "-"}${output}${workspace}${superseded}${error}`;
      });
      return [groupLine, ...branchLines];
    }),
  ];
}

async function resolveSessionCurrentStepId(
  session: WorkflowSessionState,
  options: CliStorageOptions,
): Promise<string | null> {
  const currentStepId = resolveCurrentStepId(session);
  if (currentStepId !== null) {
    return currentStepId;
  }

  const loadedWorkflow = await loadWorkflowFromCatalog(
    session.workflowName,
    options,
  );
  if (!loadedWorkflow.ok) {
    return null;
  }
  if (loadedWorkflow.value.bundle.workflow.workflowId !== session.workflowId) {
    return null;
  }

  return resolveCurrentStepIdFromWorkflow(
    session,
    loadedWorkflow.value.bundle.workflow,
  );
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  let workflowRoot: string | undefined;
  let workflowScope: WorkflowScopeSelector | undefined;
  let userRoot: string | undefined;
  let projectRoot: string | undefined;
  let addonRoot: string | undefined;
  let artifactRoot: string | undefined;
  let sessionStoreRoot: string | undefined;
  let workingDirectory: string | undefined;
  let workerOnly = false;
  let output: "text" | "json" | "table" = "text";
  let structure = false;
  let format: "text" | "json" | "jsonl" | undefined;
  let variablesPath: string | undefined;
  let dryRun = false;
  let verbose = false;
  let debug = false;
  let mockScenarioPath: string | undefined;
  let maxSteps: number | undefined;
  let maxConcurrency: number | undefined;
  let maxLoopIterations: number | undefined;
  let defaultTimeoutMs: number | undefined;
  let timeoutMs: number | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let endpoint: string | undefined;
  let authToken: string | undefined;
  let authTokenEnv: string | undefined;
  let filePath: string | undefined;
  let readOnly = false;
  let noExec = false;
  let messageJson: string | undefined;
  let messageFile: string | undefined;
  let promptVariant: string | undefined;
  let continueSession = false;
  let resumeStepExecId: string | undefined;
  let vendor: string | undefined;
  let eventRoot: string | undefined;
  let eventFile: string | undefined;
  let sourceId: string | undefined;
  let status: string | undefined;
  let limit: number | undefined;
  let logLimit: number | undefined;
  let includeLlmMessages = false;
  let llmLimit: number | undefined;
  let live = false;
  let reason: string | undefined;
  let parseError: string | undefined;
  let autoImprove = false;
  let disableAutoImprove = false;
  let superviserWorkflowId: string | undefined;
  let monitorIntervalMs: number | undefined;
  let stallTimeoutMs: number | undefined;
  let maxSupervisedAttempts: number | undefined;
  let maxWorkflowPatches: number | undefined;
  let workflowMutationMode: "execution-copy" | "in-place" | undefined;
  let noAllowTargetedRerun = false;
  let firstAutoImprovePolicyFlag: string | undefined;
  let firstAutoImproveOnlyPolicyFlag: string | undefined;
  let nestedSuperviser = false;
  let continuationStartStepId: string | undefined;
  let continuationAfterStepRunId: string | undefined;
  let stepRunsFilterStepId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const readNext = (): string | undefined => {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        index += 1;
        return next;
      }
      return undefined;
    };
    const markAutoImprovePolicyFlag = (): void => {
      firstAutoImprovePolicyFlag ??= token;
      if (token !== "--stall-timeout-ms") {
        firstAutoImproveOnlyPolicyFlag ??= token;
      }
    };

    switch (token) {
      case "--workflow-definition-dir":
        {
          const parsedString = parseWorkflowDefinitionDirectoryOption(
            token,
            readNext(),
          );
          if (parsedString.error !== undefined) {
            parseError = parsedString.error;
            break;
          }
          workflowRoot = parsedString.value;
        }
        break;
      case "--workflow-root":
        readNext();
        parseError =
          "--workflow-root has been removed; use --workflow-definition-dir";
        break;
      case "--scope":
        {
          const rawScope = readNext();
          const parsedScope = parseWorkflowScopeOption(rawScope);
          if (parsedScope === undefined) {
            parseError =
              rawScope === undefined
                ? "--scope requires a value: auto, project, or user"
                : `invalid --scope value '${rawScope}'; expected auto, project, or user`;
          } else {
            workflowScope = parsedScope;
          }
        }
        break;
      case "--user-root": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        userRoot = parsedString.value;
        break;
      }
      case "--project-root": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        projectRoot = parsedString.value;
        break;
      }
      case "--addon-root": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        addonRoot = parsedString.value;
        break;
      }
      case "--artifact-root": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        artifactRoot = parsedString.value;
        break;
      }
      case "--session-store": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        sessionStoreRoot = parsedString.value;
        break;
      }
      case "--working-dir":
      case "--working-directory": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        workingDirectory = parsedString.value;
        break;
      }
      case "--worker-only":
        workerOnly = true;
        break;
      case "--structure":
        structure = true;
        break;
      case "--variables": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        variablesPath = parsedString.value;
        break;
      }
      case "--output": {
        const parsedOutput = parseEnumOption(
          token,
          readNext(),
          ["json", "text", "table"],
          "json, text, or table",
        );
        if (parsedOutput.error !== undefined) {
          parseError = parsedOutput.error;
          break;
        }
        if (parsedOutput.value !== undefined) {
          output = parsedOutput.value;
        }
        break;
      }
      case "--format": {
        const parsedFormat = parseEnumOption(
          token,
          readNext(),
          ["json", "jsonl", "text"],
          "json, jsonl, or text",
        );
        if (parsedFormat.error !== undefined) {
          parseError = parsedFormat.error;
          break;
        }
        if (parsedFormat.value !== undefined) {
          format = parsedFormat.value;
        }
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      case "--verbose":
      case "-v":
        verbose = true;
        break;
      case "--debug":
        debug = true;
        break;
      case "--mock-scenario": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        mockScenarioPath = parsedString.value;
        break;
      }
      case "--max-steps":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          maxSteps = parsedNumber.value;
        }
        break;
      case "--max-concurrency":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          const parsed = parsedNumber.value!;
          if (!Number.isInteger(parsed) || parsed < 1) {
            parseError = `invalid --max-concurrency value '${parsed}'; expected a positive integer`;
            break;
          }
          maxConcurrency = parsed;
        }
        break;
      case "--max-loop-iterations":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          maxLoopIterations = parsedNumber.value;
        }
        break;
      case "--default-timeout-ms":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          defaultTimeoutMs = parsedNumber.value;
        }
        break;
      case "--timeout-ms":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          timeoutMs = parsedNumber.value;
        }
        break;
      case "--host": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        host = parsedString.value;
        break;
      }
      case "--port":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          port = parsedNumber.value;
        }
        break;
      case "--endpoint": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        endpoint = parsedString.value;
        break;
      }
      case "--auth-token": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        authToken = parsedString.value;
        break;
      }
      case "--auth-token-env": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        authTokenEnv = parsedString.value;
        break;
      }
      case "--file": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        filePath = parsedString.value;
        break;
      }
      case "--read-only":
        readOnly = true;
        break;
      case "--no-exec":
        noExec = true;
        break;
      case "--message-json": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        messageJson = parsedString.value;
        break;
      }
      case "--message-file": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        messageFile = parsedString.value;
        break;
      }
      case "--prompt-variant": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        promptVariant = parsedString.value;
        break;
      }
      case "--continue-session":
        continueSession = true;
        break;
      case "--resume-node-exec":
        readNext();
        parseError ??=
          "--resume-node-exec has been removed; use --resume-step-exec";
        break;
      case "--resume-step-exec": {
        const nextResumeExec = readNext();
        if (nextResumeExec === undefined) {
          parseError = `${token} requires an execution record id`;
          break;
        }
        resumeStepExecId = nextResumeExec;
        break;
      }
      case "--vendor": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        vendor = parsedString.value;
        break;
      }
      case "--event-root": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        eventRoot = parsedString.value;
        break;
      }
      case "--event-file": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        eventFile = parsedString.value;
        break;
      }
      case "--source": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        sourceId = parsedString.value;
        break;
      }
      case "--status": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        status = parsedString.value;
        break;
      }
      case "--limit":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          limit = parsedNumber.value;
        }
        break;
      case "--log-limit":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          logLimit = parsedNumber.value;
        }
        break;
      case "--llm-limit":
        {
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          llmLimit = parsedNumber.value;
        }
        break;
      case "--include-llm-messages":
      case "--include-llm-history":
        includeLlmMessages = true;
        break;
      case "--live":
        live = true;
        break;
      case "--reason": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        reason = parsedString.value;
        break;
      }
      case "--auto-improve":
        autoImprove = true;
        break;
      case "--no-auto-improve":
        disableAutoImprove = true;
        break;
      case "--superviser-workflow":
      case "--supervisor-workflow": {
        markAutoImprovePolicyFlag();
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        superviserWorkflowId = parsedString.value;
        break;
      }
      case "--monitor-interval-ms":
        {
          markAutoImprovePolicyFlag();
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          monitorIntervalMs = parsedNumber.value;
        }
        break;
      case "--stall-timeout-ms":
        {
          markAutoImprovePolicyFlag();
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          stallTimeoutMs = parsedNumber.value;
        }
        break;
      case "--max-supervised-attempts":
        {
          markAutoImprovePolicyFlag();
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          maxSupervisedAttempts = parsedNumber.value;
        }
        break;
      case "--max-workflow-patches":
        {
          markAutoImprovePolicyFlag();
          const parsedNumber = parseNumericOption(token, readNext());
          if (parsedNumber.error !== undefined) {
            parseError = parsedNumber.error;
            break;
          }
          maxWorkflowPatches = parsedNumber.value;
        }
        break;
      case "--workflow-mutation-mode": {
        markAutoImprovePolicyFlag();
        const parsedMode = parseEnumOption(
          token,
          readNext(),
          ["execution-copy", "in-place"],
          "execution-copy or in-place",
        );
        if (parsedMode.error !== undefined) {
          parseError = parsedMode.error;
          break;
        }
        if (parsedMode.value !== undefined) {
          workflowMutationMode = parsedMode.value;
        }
        break;
      }
      case "--no-allow-targeted-rerun":
      case "--disable-targeted-rerun":
        markAutoImprovePolicyFlag();
        noAllowTargetedRerun = true;
        break;
      case "--nested-superviser":
      case "--nested-supervisor":
        nestedSuperviser = true;
        break;
      case "--start-step": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        continuationStartStepId = parsedString.value;
        break;
      }
      case "--after-step-run": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        continuationAfterStepRunId = parsedString.value;
        break;
      }
      case "--step": {
        const parsedString = parseRequiredStringOption(token, readNext());
        if (parsedString.error !== undefined) {
          parseError = parsedString.error;
          break;
        }
        stepRunsFilterStepId = parsedString.value;
        break;
      }
      default:
        break;
    }

    if (parseError !== undefined) {
      break;
    }
  }

  const isSessionHealthCommand =
    positionals[0] === "session" && positionals[1] === "health";
  const hasWorkflowAutoImprovePolicyFlag =
    firstAutoImprovePolicyFlag !== undefined && !isSessionHealthCommand;
  const shouldEnableCliAutoImprovePolicy =
    !isSessionHealthCommand &&
    (disableAutoImprove ||
      autoImprove ||
      nestedSuperviser ||
      hasWorkflowAutoImprovePolicyFlag);
  const autoImproveInputs = {
    enabled: shouldEnableCliAutoImprovePolicy,
    ...(superviserWorkflowId === undefined ? {} : { superviserWorkflowId }),
    ...(monitorIntervalMs === undefined ? {} : { monitorIntervalMs }),
    ...(stallTimeoutMs === undefined || (!autoImprove && isSessionHealthCommand)
      ? {}
      : { stallTimeoutMs }),
    ...(maxSupervisedAttempts === undefined ? {} : { maxSupervisedAttempts }),
    ...(disableAutoImprove
      ? { maxWorkflowPatches: 0 }
      : maxWorkflowPatches === undefined
        ? {}
        : { maxWorkflowPatches }),
    ...(disableAutoImprove || workflowMutationMode === undefined
      ? {}
      : { workflowMutationMode }),
    ...(noAllowTargetedRerun ? { allowTargetedRerun: false } : {}),
  } as const;
  const autoImprovePolicy =
    parseAutoImprovePolicyFromCliFlags(autoImproveInputs);
  if (parseError === undefined) {
    if (autoImprove && disableAutoImprove) {
      parseError = "--auto-improve cannot be combined with --no-auto-improve";
    } else if (nestedSuperviser && disableAutoImprove) {
      parseError =
        "--nested-superviser / --nested-supervisor cannot be combined with --no-auto-improve";
    } else if (disableAutoImprove && maxWorkflowPatches !== undefined) {
      parseError =
        "--max-workflow-patches cannot be combined with --no-auto-improve";
    } else if (disableAutoImprove && workflowMutationMode !== undefined) {
      parseError =
        "--workflow-mutation-mode cannot be combined with --no-auto-improve";
    } else if (
      isSessionHealthCommand &&
      !autoImprove &&
      firstAutoImproveOnlyPolicyFlag !== undefined
    ) {
      parseError = `${firstAutoImproveOnlyPolicyFlag} requires --auto-improve`;
    }
  }
  if (parseError === undefined && autoImprovePolicy.error !== undefined) {
    parseError = `invalid --auto-improve policy: ${autoImprovePolicy.error}`;
  }

  return {
    positionals,
    options: {
      ...(workflowRoot === undefined ? {} : { workflowRoot }),
      ...(workflowScope === undefined ? {} : { workflowScope }),
      ...(userRoot === undefined ? {} : { userRoot }),
      ...(projectRoot === undefined ? {} : { projectRoot }),
      ...(addonRoot === undefined ? {} : { addonRoot }),
      ...(artifactRoot === undefined ? {} : { artifactRoot }),
      ...(sessionStoreRoot === undefined ? {} : { sessionStoreRoot }),
      ...(workingDirectory === undefined ? {} : { workingDirectory }),
      workerOnly,
      structure,
      ...(format === undefined ? {} : { format }),
      ...(variablesPath === undefined ? {} : { variablesPath }),
      ...(mockScenarioPath === undefined ? {} : { mockScenarioPath }),
      output,
      dryRun,
      verbose,
      debug,
      ...(maxSteps === undefined ? {} : { maxSteps }),
      ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
      ...(maxLoopIterations === undefined ? {} : { maxLoopIterations }),
      ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(host === undefined ? {} : { host }),
      ...(port === undefined ? {} : { port }),
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(authToken === undefined ? {} : { authToken }),
      ...(authTokenEnv === undefined ? {} : { authTokenEnv }),
      ...(filePath === undefined ? {} : { filePath }),
      readOnly,
      noExec,
      ...(messageJson === undefined ? {} : { messageJson }),
      ...(messageFile === undefined ? {} : { messageFile }),
      ...(promptVariant === undefined ? {} : { promptVariant }),
      continueSession,
      ...(resumeStepExecId === undefined ? {} : { resumeStepExecId }),
      ...(vendor === undefined ? {} : { vendor }),
      ...(eventRoot === undefined ? {} : { eventRoot }),
      ...(eventFile === undefined ? {} : { eventFile }),
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(status === undefined ? {} : { status }),
      ...(limit === undefined ? {} : { limit }),
      ...(logLimit === undefined ? {} : { logLimit }),
      includeLlmMessages,
      ...(llmLimit === undefined ? {} : { llmLimit }),
      live,
      ...(stallTimeoutMs === undefined ? {} : { stallTimeoutMs }),
      ...(reason === undefined ? {} : { reason }),
      ...(autoImprovePolicy.policy === undefined
        ? {}
        : { autoImprove: autoImprovePolicy.policy }),
      disableAutoImprove,
      ...(nestedSuperviser ? { nestedSuperviser: true } : {}),
      ...(continuationStartStepId === undefined
        ? {}
        : { continuationStartStepId }),
      ...(continuationAfterStepRunId === undefined
        ? {}
        : { continuationAfterStepRunId }),
      ...(stepRunsFilterStepId === undefined ? {} : { stepRunsFilterStepId }),
    },
    ...(parseError === undefined ? {} : { error: parseError }),
  };
}

function printHelp(io: CliIo): void {
  io.stdout("Usage:");
  io.stdout(
    "  divedra cli workflow <create|validate|inspect|usage|list|status|run> <name?> [options]",
  );
  io.stdout(
    "  divedra session <status|progress|health|resume|continue|rerun|export|logs|step-runs> <workflow-execution-id> [positional-args] [options]",
  );
  io.stdout(
    "  divedra session health <workflow-execution-id> [--live] [--stall-timeout-ms <n>] [--log-limit <n>] [--include-llm-messages] [--llm-limit <n>] [options]",
  );
  io.stdout(
    "  divedra session rerun <workflow-execution-id> <step-id> [options]",
  );
  io.stdout(
    "  divedra session continue <workflow-execution-id> --start-step <step-id> --after-step-run <step-run-id> [options]",
  );
  io.stdout(
    "  divedra session export <workflow-execution-id> [--file <path>] [options]",
  );
  io.stdout(
    "  divedra session logs <workflow-execution-id> [--format <text|json|jsonl>] [options]",
  );
  io.stdout(
    "  divedra session step-runs <workflow-execution-id> [--step <step-id>] [--status <status>] [options]",
  );
  io.stdout(
    "  divedra serve [workflow-name] [--host <host>] [--port <port>] [--read-only] [--no-exec]",
  );
  io.stdout(
    "  divedra graphql <graphql-document> [--variables <json|@file>] [--endpoint <url>] [--auth-token <token>]",
  );
  io.stdout(
    "  divedra events <validate|serve|emit|list|replay|replies> [source-id|receipt-id|workflow-execution-id] [--event-root <path>] [--event-file <path>]",
  );
  io.stdout(
    "  divedra call-step <workflow-id> <workflow-run-id> <step-id> [--message-json <json> | --message-file <path>] [--prompt-variant <name>] [--continue-session] [--timeout-ms <ms>] [--resume-step-exec <id>] [options]",
  );
  io.stdout(`  divedra hook [--vendor ${HOOK_VENDOR_USAGE}]`);
  io.stdout(`  divedra hook snippet --vendor ${HOOK_VENDOR_USAGE}`);
  io.stdout("");
  io.stdout("Create options:");
  io.stdout("  --worker-only  Scaffold a manager-less starter workflow");
  io.stdout("");
  io.stdout("Workflow scope options:");
  io.stdout(
    "  --workflow-definition-dir <path>  Directory containing <workflow-name>/workflow.json bundles; bypasses scoped lookup",
  );
  io.stdout(
    "                                  Does not control logs, sessions, or artifacts",
  );
  io.stdout("  --scope <scope>         Select auto, project, or user scope");
  io.stdout("  --user-root <path>      Override the user scope root");
  io.stdout("  --project-root <path>   Override the project scope root");
  io.stdout("  --addon-root <path>     Use a direct add-on root override");
  io.stdout("");
  io.stdout("Workflow overview (list / status):");
  io.stdout(
    "  --status <aggregate>    Filter workflow list by aggregate status",
  );
  io.stdout(
    "  --limit <n>             Cap list rows or recent executions on workflow status",
  );
  io.stdout(
    "Default --output text matches the compact table for list/status (--output table is equivalent;",
  );
  io.stdout(
    "  use --output json here for payloads). Elsewhere --output stays text vs json.",
  );
  io.stdout("");
  io.stdout("Workflow discovery (usage):");
  io.stdout(
    "  workflow usage [name]  Show workflow purpose, compact step overview, and callable manager/entry input/output contracts",
  );
  io.stdout(
    "  workflow inspect <name> --structure  Show compact indented step ids with description lines",
  );
  io.stdout(
    "  workflow run <name> --variables <json|@file|file>  Runtime variables as inline JSON object, explicit @file, or bare JSON file path",
  );
  io.stdout(
    "  workflow run <name> --verbose  Print local step-start progress to stderr",
  );
  io.stdout(
    "  workflow run <name> --debug    Enable explicit local debug progress callbacks",
  );
  io.stdout("");
  io.stdout("Session options:");
  io.stdout(
    "  continue vs rerun        continue references a concrete prior step-run (after-step-run); rerun restarts using variables only without importing prior step artifacts",
  );
  io.stdout(
    "  step-runs --step/--status Narrow merged timeline rows (status is a node execution terminal: succeeded | failed | timed_out | cancelled | skipped)",
  );
  io.stdout(
    "  export --file <path>     Write workflow run export JSON to a file",
  );
  io.stdout(
    "  logs --format <format>   Print node logs as text, json, or jsonl",
  );
  io.stdout(
    "  health --live            Request best-effort local liveness evidence while preserving uncertainty",
  );
  io.stdout(
    "  health --log-limit <n>   Cap recent runtime logs included in health output",
  );
  io.stdout(
    "  health --include-llm-messages Include bounded recent LLM messages (alias: --include-llm-history)",
  );
  io.stdout(
    "  health --llm-limit <n>   Cap recent LLM messages included when enabled",
  );
  io.stdout(
    "  --max-concurrency <n>      Cap fanout concurrency for this run (positive integer)",
  );
  io.stdout("  --default-timeout-ms <ms>  Override workflow default timeout");
  io.stdout("  --timeout-ms <ms>          call-step only");
  io.stdout("  --prompt-variant <name>    call-step only");
  io.stdout("  --continue-session         call-step only");
  io.stdout(
    "  --resume-step-exec <id>    call-step only (execution record id; same as nodeExecId in session state)",
  );
  io.stdout("");
  io.stdout(
    "Auto-improve (supervision policy; engine retries on terminal failure until success or budgets;",
  );
  io.stdout(
    "  persisted stall watch is active; use --nested-supervisor (alias: --nested-superviser) to run the superviser bundle as a workflow):",
  );
  io.stdout(
    "  --auto-improve               Explicitly enable supervised runs with durable supervision state",
  );
  io.stdout(
    "  --no-auto-improve            Disable workflow patching while keeping lifecycle supervision",
  );
  io.stdout(
    "  --supervisor-workflow <id> Superviser bundle id (alias: --superviser-workflow; persisted; divedra/* control + optional nested driver)",
  );
  io.stdout(
    "  --nested-supervisor         Run the superviser workflow as a nested session (alias: --nested-superviser; requires --auto-improve)",
  );
  io.stdout(
    "  --monitor-interval-ms <n>    Observation cadence (default 5000)",
  );
  io.stdout(
    "  --stall-timeout-ms <n>       Stall threshold (default 3600000; must be >= monitor interval)",
  );
  io.stdout("  --max-supervised-attempts <n> Attempt budget (default 5)");
  io.stdout("  --max-workflow-patches <n>   Patch budget (default 3)");
  io.stdout(
    "  --workflow-mutation-mode execution-copy|in-place  (default execution-copy)",
  );
  io.stdout(
    "  --no-allow-targeted-rerun    Disable targeted step reruns (by default they are allowed).",
  );
  io.stdout(
    "                               Deprecated alias: --disable-targeted-rerun",
  );
}

function formatValidationIssues(
  issues: readonly {
    severity: "error" | "warning";
    path: string;
    message: string;
  }[],
): string {
  return issues
    .map((entry) => `[${entry.severity}] ${entry.path}: ${entry.message}`)
    .join("\n");
}

function isJsonScalarLiteralCandidate(value: string): boolean {
  return (
    value === "true" ||
    value === "false" ||
    value === "null" ||
    value.startsWith('"') ||
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
  );
}

async function readRuntimeVariablesSource(
  value: string,
): Promise<RuntimeVariablesSource> {
  const trimmed = value.trim();
  if (value.startsWith("@")) {
    const filePath = value.slice(1);
    if (filePath.length === 0) {
      throw new Error("explicit @file reference must include a file path");
    }
    return {
      kind: "explicit-file",
      displayValue: value,
      content: await readFile(filePath, "utf8"),
    };
  }
  if (await isReadableFile(value)) {
    return {
      kind: "file-path",
      displayValue: value,
      content: await readFile(value, "utf8"),
    };
  }
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    isJsonScalarLiteralCandidate(trimmed)
  ) {
    return {
      kind: "inline-json",
      displayValue: "inline JSON",
      content: trimmed,
    };
  }
  return {
    kind: "file-path",
    displayValue: value,
    content: await readFile(value, "utf8"),
  };
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readRuntimeVariables(
  value: string,
): Promise<Readonly<Record<string, unknown>>> {
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
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--variables must resolve to a JSON object");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

async function readGraphqlVariables(
  value: string | undefined,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  if (value === undefined) {
    return undefined;
  }
  const content =
    value.startsWith("@") && value.length > 1
      ? await readFile(value.slice(1), "utf8")
      : value;
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("GraphQL variables must be a JSON object");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

async function readJsonValueFromFile(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as unknown;
}

async function readDirectCallMessage(
  parsedOptions: ParsedOptions,
): Promise<unknown | undefined> {
  if (
    parsedOptions.messageJson !== undefined &&
    parsedOptions.messageFile !== undefined
  ) {
    throw new Error("use only one of --message-json or --message-file");
  }
  if (parsedOptions.messageJson !== undefined) {
    return JSON.parse(parsedOptions.messageJson) as unknown;
  }
  if (parsedOptions.messageFile !== undefined) {
    return readJsonValueFromFile(parsedOptions.messageFile);
  }
  return undefined;
}

async function readMockScenario(pathToJson: string): Promise<MockNodeScenario> {
  const content = await readFile(pathToJson, "utf8");
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      "mock scenario file must contain a JSON object keyed by step id",
    );
  }
  return parsed as MockNodeScenario;
}

async function readMockScenarioOption(
  pathToJson: string | undefined,
): Promise<Readonly<{ mockScenario?: MockNodeScenario }>> {
  if (pathToJson === undefined) {
    return {};
  }
  return {
    mockScenario: await readMockScenario(pathToJson),
  };
}

function emitJson(io: CliIo, payload: unknown): void {
  io.stdout(JSON.stringify(payload, null, 2));
}

function buildSupervisorProgressEventSink(
  parsedOptions: ParsedOptions,
  io: CliIo,
): Pick<WorkflowRunOptions, "eventSink"> {
  const renderer = createSupervisorProgressRenderer({
    verbose: parsedOptions.verbose,
    writeLine: io.stderr,
  });
  if (!renderer.verbose) {
    return {};
  }
  return {
    eventSink: createSupervisorProgressEventSink(renderer),
  };
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

function buildWorkflowExecutionContinuationMetadata(
  session: WorkflowSessionState,
): WorkflowExecutionContinuationMetadata | undefined {
  if (
    session.continuedFromWorkflowExecutionId === undefined &&
    session.continuedAfterStepRunId === undefined &&
    session.continuedAfterExecutionOrdinal === undefined &&
    session.continuedStartStepId === undefined &&
    session.continuationMode === undefined &&
    (session.historyImports === undefined ||
      session.historyImports.length === 0)
  ) {
    return undefined;
  }
  return {
    ...(session.continuedFromWorkflowExecutionId === undefined
      ? {}
      : {
          continuedFromWorkflowExecutionId:
            session.continuedFromWorkflowExecutionId,
        }),
    ...(session.continuedAfterStepRunId === undefined
      ? {}
      : { continuedAfterStepRunId: session.continuedAfterStepRunId }),
    ...(session.continuedAfterExecutionOrdinal === undefined
      ? {}
      : {
          continuedAfterExecutionOrdinal:
            session.continuedAfterExecutionOrdinal,
        }),
    ...(session.continuedStartStepId === undefined
      ? {}
      : { continuedStartStepId: session.continuedStartStepId }),
    ...(session.continuationMode === undefined
      ? {}
      : { continuationMode: session.continuationMode }),
    ...(session.historyImports === undefined
      ? {}
      : { historyImports: session.historyImports }),
  };
}

async function buildWorkflowExecutionExport(
  workflowExecutionId: string,
  options: CliStorageOptions,
): Promise<WorkflowExecutionExport> {
  const loaded = await loadSession(workflowExecutionId, options);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  const workflowId = loaded.value.workflowId;
  const continuationMetadata = buildWorkflowExecutionContinuationMetadata(
    loaded.value,
  );

  const [nodeExecutions, nodeLogs, hookEvents] = await Promise.all([
    listRuntimeNodeExecutions(workflowExecutionId, options),
    listRuntimeNodeLogs(workflowExecutionId, options),
    listRuntimeHookEvents(workflowExecutionId, options),
  ]);

  const communicationService = createCommunicationService();
  const communications = (
    await Promise.all(
      loaded.value.communications
        .filter((communication) => communication.workflowId === workflowId)
        .map((communication) =>
          communicationService.getCommunication(
            {
              workflowId,
              workflowExecutionId,
              communicationId: communication.communicationId,
            },
            options,
          ),
        ),
    )
  ).filter(isNonNull);

  return {
    workflowId,
    workflowExecutionId,
    workflowName: loaded.value.workflowName,
    status: loaded.value.status,
    exportedAt: new Date().toISOString(),
    ...(continuationMetadata === undefined ? {} : { continuationMetadata }),
    session: loaded.value,
    nodeExecutions,
    nodeLogs,
    hookEvents,
    communications,
  };
}

async function writeExportFile(
  filePath: string,
  payload: WorkflowExecutionExport,
): Promise<string> {
  const resolvedPath = path.resolve(filePath);
  await writeFile(
    resolvedPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  return resolvedPath;
}

function formatRuntimeNodeLogLine(entry: RuntimeNodeLogEntry): string {
  return [
    entry.at,
    entry.level,
    entry.nodeId ?? "-",
    entry.nodeExecId ?? "-",
    entry.message,
  ].join("\t");
}

function serializeRuntimeNodeLogs(
  entries: readonly RuntimeNodeLogEntry[],
  format: "text" | "json" | "jsonl",
): string {
  switch (format) {
    case "json":
      return `${JSON.stringify(entries, null, 2)}\n`;
    case "jsonl":
      return entries.length === 0
        ? ""
        : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    case "text":
      return entries.length === 0
        ? ""
        : `${entries.map(formatRuntimeNodeLogLine).join("\n")}\n`;
  }
}

function nullableDisplay(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === ""
    ? "-"
    : String(value);
}

function formatSessionHealthText(
  report: SessionHealthReport,
): readonly string[] {
  return [
    `sessionId: ${report.sessionId}`,
    `workflow: ${report.workflowName} (${report.workflowId})`,
    `status: ${report.status}`,
    `health: ${report.health.state}`,
    `confidence: ${report.health.confidence}`,
    `reason: ${report.health.reason}`,
    `currentStepId: ${nullableDisplay(report.currentStepId)}`,
    `currentNodeId: ${nullableDisplay(report.currentNodeId)}`,
    `activeNode: ${report.activeNode.known ? "known" : "unknown"}`,
    `activeNodeExecId: ${nullableDisplay(report.activeNode.nodeExecId)}`,
    `backend: ${nullableDisplay(report.activeNode.backend)}`,
    `backendSessionId: ${nullableDisplay(report.activeNode.backendSessionId)}`,
    `elapsedMs: ${nullableDisplay(report.activeNode.elapsedMs)}`,
    `timeoutMs: ${nullableDisplay(report.activeNode.timeoutMs)}`,
    `lastProgressAt: ${nullableDisplay(report.progressSignal.lastProgressAt)}`,
    `lastProgressSource: ${nullableDisplay(report.progressSignal.lastProgressSource)}`,
    `stallTimeoutMs: ${nullableDisplay(report.progressSignal.stallTimeoutMs)}`,
    `stalled: ${nullableDisplay(
      report.progressSignal.stalled === null
        ? null
        : report.progressSignal.stalled
          ? "yes"
          : "no",
    )}`,
    `liveSignal: ${report.liveSignal.status} (${report.liveSignal.source})`,
    `latestArtifactAt: ${nullableDisplay(report.artifacts.latestArtifactAt)}`,
    `latestCandidateAt: ${nullableDisplay(report.artifacts.latestCandidateAt)}`,
    `recommendation: ${report.health.recommendation}`,
    `fanoutGroups: ${String(report.persistedState.fanoutSummaries.length)}`,
    `recentLogs: ${String(report.recentLogs.length)}`,
    `recentLlmMessages: ${String(report.recentLlmMessages.length)}`,
    `evidence: sessionStore=${report.evidenceCompleteness.sessionStore} runtimeDb=${report.evidenceCompleteness.runtimeDb} artifacts=${report.evidenceCompleteness.artifacts} processLogs=${report.evidenceCompleteness.processLogs} llmMessages=${report.evidenceCompleteness.llmMessages}`,
  ];
}

async function writeTextFile(
  filePath: string,
  content: string,
): Promise<string> {
  const resolvedPath = path.resolve(filePath);
  await writeFile(resolvedPath, content, "utf8");
  return resolvedPath;
}

function isJsonObjectRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObjectField(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!isJsonObjectRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function requireStringField(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function requireNumberField(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function requireArrayField(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function resolveCliEnv(
  deps: CliDependencies,
): Readonly<Record<string, string | undefined>> {
  return deps.env ?? process.env;
}

function resolveGraphqlCliTransport(
  parsedOptions: ParsedOptions,
  env: Readonly<Record<string, string | undefined>>,
  deps: CliDependencies,
): GraphqlCliTransportOptions | null {
  if (parsedOptions.endpoint === undefined) {
    return null;
  }
  const authTokenEnvName =
    parsedOptions.authTokenEnv ?? "DIVEDRA_MANAGER_AUTH_TOKEN";
  const authToken =
    parsedOptions.authToken ?? env[authTokenEnvName] ?? undefined;
  const ambientManagerSessionId = env["DIVEDRA_MANAGER_SESSION_ID"];
  const managerSessionId =
    typeof ambientManagerSessionId === "string" &&
    ambientManagerSessionId.length > 0
      ? ambientManagerSessionId
      : undefined;
  return {
    endpoint: parsedOptions.endpoint,
    ...(authToken === undefined ? {} : { authToken }),
    ...(managerSessionId === undefined ? {} : { managerSessionId }),
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
  };
}

function readGraphqlExecutionPayload(
  response: GraphqlClientResponse,
): Readonly<Record<string, unknown>> {
  if (response.errors !== undefined && response.errors.length > 0) {
    throw new Error(response.errors.map((entry) => entry.message).join("; "));
  }
  if (!isJsonObjectRecord(response.data)) {
    throw new Error("GraphQL response data must be a JSON object");
  }
  return response.data;
}

async function executeCliGraphqlOperation(args: {
  readonly transport: GraphqlCliTransportOptions;
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}): Promise<Readonly<Record<string, unknown>>> {
  const response = await executeGraphqlRequest({
    endpoint: args.transport.endpoint,
    document: args.document,
    ...(args.variables === undefined ? {} : { variables: args.variables }),
    ...(args.transport.authToken === undefined
      ? {}
      : { authToken: args.transport.authToken }),
    ...(args.transport.managerSessionId === undefined
      ? {}
      : { managerSessionId: args.transport.managerSessionId }),
    ...(args.transport.fetchImpl === undefined
      ? {}
      : { fetchImpl: args.transport.fetchImpl }),
  });
  return readGraphqlExecutionPayload(response);
}

function buildRemoteExecutionInput(
  parsedOptions: ParsedOptions,
): Readonly<Record<string, unknown>> {
  const workingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    parsedOptions.workingDirectory,
  );
  const autoImprove: AutoImprovePolicyInput =
    parsedOptions.autoImprove ??
    (parsedOptions.disableAutoImprove
      ? createLifecycleSupervisionPolicyInput()
      : { enabled: true });
  return {
    autoImprove,
    ...(parsedOptions.nestedSuperviser ? { nestedSuperviser: true } : {}),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(parsedOptions.dryRun ? { dryRun: true } : {}),
    ...(parsedOptions.maxSteps === undefined
      ? {}
      : { maxSteps: parsedOptions.maxSteps }),
    ...(parsedOptions.maxConcurrency === undefined
      ? {}
      : { maxConcurrency: parsedOptions.maxConcurrency }),
    ...(parsedOptions.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: parsedOptions.maxLoopIterations }),
    ...(parsedOptions.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: parsedOptions.defaultTimeoutMs }),
  };
}

async function fetchRemoteWorkflowRunSummary(
  transport: GraphqlCliTransportOptions,
  workflowExecutionId: string,
): Promise<RemoteWorkflowRunSummary> {
  const data = await executeCliGraphqlOperation({
    transport,
    document: `
      query WorkflowExecutionSummary($workflowExecutionId: String!) {
        workflowExecution(workflowExecutionId: $workflowExecutionId) {
          session {
            sessionId
            workflowName
            workflowId
            transitions {
              when
            }
          }
          nodeExecutions {
            nodeExecId
          }
        }
      }
    `,
    variables: {
      workflowExecutionId,
    },
  });
  const workflowExecution = requireObjectField(
    data["workflowExecution"],
    "workflowExecution",
  );
  const session = requireObjectField(
    workflowExecution["session"],
    "workflowExecution.session",
  );
  return {
    workflowName: requireStringField(
      session["workflowName"],
      "workflowExecution.session.workflowName",
    ),
    workflowId: requireStringField(
      session["workflowId"],
      "workflowExecution.session.workflowId",
    ),
    nodeExecutions: requireArrayField(
      workflowExecution["nodeExecutions"],
      "workflowExecution.nodeExecutions",
    ).length,
    transitions: requireArrayField(
      session["transitions"],
      "workflowExecution.session.transitions",
    ).length,
  };
}

function rejectUnsupportedRemoteMockScenario(
  parsedOptions: ParsedOptions,
  io: CliIo,
): boolean {
  if (parsedOptions.mockScenarioPath === undefined) {
    return false;
  }
  io.stderr(
    "--mock-scenario is only supported for local execution; omit --endpoint to use it",
  );
  return true;
}

function parseStepRunExecutionStatusFilter(
  raw: string | undefined,
):
  | { ok: true; value: NodeExecutionRecord["status"] | undefined }
  | { ok: false; error: string } {
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: undefined };
  }
  const allowed: ReadonlySet<string> = new Set([
    "succeeded",
    "failed",
    "timed_out",
    "cancelled",
    "skipped",
  ]);
  if (!allowed.has(trimmed)) {
    return {
      ok: false,
      error: `invalid --status '${raw}' for session step-runs (expected succeeded, failed, timed_out, cancelled, or skipped)`,
    };
  }
  return { ok: true, value: trimmed as NodeExecutionRecord["status"] };
}

function buildLocalWorkflowRunOverrides(
  parsedOptions: ParsedOptions,
  defaultAutoImprove = false,
): Pick<
  WorkflowRunOptions,
  | "autoImprove"
  | "nestedSuperviserDriver"
  | "defaultTimeoutMs"
  | "debug"
  | "dryRun"
  | "maxConcurrency"
  | "maxLoopIterations"
  | "maxSteps"
  | "workflowWorkingDirectory"
> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    parsedOptions.workingDirectory,
  );
  const autoImprove =
    parsedOptions.autoImprove ??
    (!defaultAutoImprove
      ? undefined
      : parsedOptions.disableAutoImprove
        ? createLifecycleSupervisionPolicyInput()
        : { enabled: true });
  return {
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(parsedOptions.maxSteps === undefined
      ? {}
      : { maxSteps: parsedOptions.maxSteps }),
    ...(parsedOptions.maxConcurrency === undefined
      ? {}
      : { maxConcurrency: parsedOptions.maxConcurrency }),
    ...(parsedOptions.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: parsedOptions.maxLoopIterations }),
    ...(parsedOptions.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: parsedOptions.defaultTimeoutMs }),
    ...(parsedOptions.debug ? { debug: true } : {}),
    ...(parsedOptions.dryRun ? { dryRun: true } : {}),
    ...(autoImprove === undefined ? {} : { autoImprove }),
    ...(parsedOptions.nestedSuperviser ? { nestedSuperviserDriver: true } : {}),
  };
}

function buildLocalCallStepOverrides(
  parsedOptions: ParsedOptions,
): Pick<
  CallStepInput,
  "defaultTimeoutMs" | "dryRun" | "workflowWorkingDirectory" | "overrides"
> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    parsedOptions.workingDirectory,
  );
  const overrides =
    parsedOptions.timeoutMs === undefined &&
    parsedOptions.promptVariant === undefined &&
    !parsedOptions.continueSession &&
    parsedOptions.resumeStepExecId === undefined
      ? undefined
      : {
          ...(parsedOptions.timeoutMs === undefined
            ? {}
            : { timeoutMs: parsedOptions.timeoutMs }),
          ...(parsedOptions.promptVariant === undefined
            ? {}
            : { promptVariant: parsedOptions.promptVariant }),
          ...(parsedOptions.continueSession
            ? { sessionMode: "reuse" as const }
            : {}),
          ...(parsedOptions.resumeStepExecId === undefined
            ? {}
            : { resumeStepExecId: parsedOptions.resumeStepExecId }),
        };
  return {
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(parsedOptions.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: parsedOptions.defaultTimeoutMs }),
    ...(parsedOptions.dryRun ? { dryRun: true } : {}),
    ...(overrides === undefined ? {} : { overrides }),
  };
}

function optionsForLoadedWorkflow<T extends CliStorageOptions>(
  loadedWorkflow: LoadedWorkflow,
  options: T,
): T {
  return loadedWorkflow.source === undefined
    ? options
    : withResolvedWorkflowSourceOptions(loadedWorkflow.source, options);
}

function formatWorkflowSource(
  source: ResolvedWorkflowSource | undefined,
): string | undefined {
  if (source === undefined) {
    return undefined;
  }
  return `${source.scope} ${source.workflowDirectory}`;
}

function workflowSourceJson(
  source: ResolvedWorkflowSource | undefined,
): WorkflowSourceOutput | undefined {
  if (source === undefined) {
    return undefined;
  }
  return {
    scope: source.scope,
    workflowRoot: source.workflowRoot,
    workflowDirectory: source.workflowDirectory,
    ...(source.scopeRoot === undefined ? {} : { scopeRoot: source.scopeRoot }),
  };
}

function formatAddonSource(source: {
  readonly nodeId: string;
  readonly name: string;
  readonly version: string;
  readonly scope: string;
  readonly manifestPath: string;
}): string {
  return `${source.nodeId}: ${source.name}@${source.version} ${source.scope} ${source.manifestPath}`;
}

function assertWorkflowOverviewSourceScope(value: string): WorkflowSourceScope {
  if (value === "direct" || value === "project" || value === "user") {
    return value;
  }
  throw new Error(`invalid workflow overview sourceScope '${value}'`);
}

function workflowExecutionCompactSummaryFromGraphql(
  value: unknown,
  label: string,
): WorkflowExecutionCompactSummary {
  const o = requireObjectField(value, label);
  const currentStepIdRaw = o["currentStepId"];
  return {
    workflowExecutionId: requireStringField(
      o["workflowExecutionId"],
      `${label}.workflowExecutionId`,
    ),
    sessionId: requireStringField(o["sessionId"], `${label}.sessionId`),
    workflowName: requireStringField(
      o["workflowName"],
      `${label}.workflowName`,
    ),
    status: requireStringField(
      o["status"],
      `${label}.status`,
    ) as WorkflowExecutionCompactSummary["status"],
    currentNodeId:
      o["currentNodeId"] === null || o["currentNodeId"] === undefined
        ? null
        : requireStringField(o["currentNodeId"], `${label}.currentNodeId`),
    ...(currentStepIdRaw === null || currentStepIdRaw === undefined
      ? {}
      : {
          currentStepId: requireStringField(
            currentStepIdRaw,
            `${label}.currentStepId`,
          ),
        }),
    nodeExecutionCounter: requireNumberField(
      o["nodeExecutionCounter"],
      `${label}.nodeExecutionCounter`,
    ),
    startedAt: requireStringField(o["startedAt"], `${label}.startedAt`),
    endedAt:
      o["endedAt"] === null || o["endedAt"] === undefined
        ? null
        : requireStringField(o["endedAt"], `${label}.endedAt`),
  };
}

function workflowOverviewRowFromGraphqlJson(
  value: unknown,
  label: string,
): WorkflowOverviewRow {
  const row = requireObjectField(value, label);
  const latestRaw = row["latestExecution"];
  return {
    workflowName: requireStringField(
      row["workflowName"],
      `${label}.workflowName`,
    ),
    sourceScope: assertWorkflowOverviewSourceScope(
      requireStringField(row["sourceScope"], `${label}.sourceScope`),
    ),
    workflowDirectory: requireStringField(
      row["workflowDirectory"],
      `${label}.workflowDirectory`,
    ),
    description: requireStringField(row["description"], `${label}.description`),
    aggregateStatus: requireStringField(
      row["aggregateStatus"],
      `${label}.aggregateStatus`,
    ) as WorkflowOverviewRow["aggregateStatus"],
    activeExecutionCount: requireNumberField(
      row["activeExecutionCount"],
      `${label}.activeExecutionCount`,
    ),
    latestExecution:
      latestRaw === null || latestRaw === undefined
        ? null
        : workflowExecutionCompactSummaryFromGraphql(
            latestRaw,
            `${label}.latestExecution`,
          ),
  };
}

function workflowOverviewWarningSourceFromGraphqlJson(
  value: unknown,
  label: string,
): {
  readonly workflowName: string;
  readonly sourceScope: WorkflowSourceScope;
} {
  const row = requireObjectField(value, label);
  return {
    workflowName: requireStringField(
      row["workflowName"],
      `${label}.workflowName`,
    ),
    sourceScope: assertWorkflowOverviewSourceScope(
      requireStringField(row["sourceScope"], `${label}.sourceScope`),
    ),
  };
}

function workflowStatusOverviewFromGraphqlJson(
  value: unknown,
  label: string,
): WorkflowStatusOverview {
  const base = workflowOverviewRowFromGraphqlJson(value, label);
  const row = requireObjectField(value, label);
  const recentRaw = requireArrayField(
    row["recentExecutions"],
    `${label}.recentExecutions`,
  );
  const recentExecutions = recentRaw.map((entry, index) =>
    workflowExecutionCompactSummaryFromGraphql(
      entry,
      `${label}.recentExecutions[${String(index)}]`,
    ),
  );
  const newestRaw = row["newestActiveExecution"];
  const newestActiveExecution =
    newestRaw === null || newestRaw === undefined
      ? null
      : workflowExecutionCompactSummaryFromGraphql(
          newestRaw,
          `${label}.newestActiveExecution`,
        );
  return {
    ...base,
    recentExecutions,
    newestActiveExecution,
  };
}

const WORKFLOW_CATALOG_OVERVIEW_GQL = `
  query WorkflowCatalogOverviewCli($workflowScope: String, $status: String, $limit: Int) {
    workflowCatalogOverview(workflowScope: $workflowScope, status: $status, limit: $limit) {
      workflows {
        workflowName
        sourceScope
        workflowDirectory
        description
        aggregateStatus
        activeExecutionCount
        latestExecution {
          workflowExecutionId
          sessionId
          workflowName
          status
          currentNodeId
          currentStepId
          nodeExecutionCounter
          startedAt
          endedAt
        }
      }
    }
    workflowCatalogWarningSources: workflowCatalogOverview(workflowScope: $workflowScope) {
      workflows {
        workflowName
        sourceScope
      }
    }
  }
`;

const WORKFLOW_STATUS_OVERVIEW_GQL = `
  query WorkflowStatusOverviewCli($workflowName: String!, $workflowScope: String, $limit: Int) {
    workflowStatusOverview(workflowName: $workflowName, workflowScope: $workflowScope, limit: $limit) {
      workflowName
      sourceScope
      workflowDirectory
      description
      aggregateStatus
      activeExecutionCount
      latestExecution {
        workflowExecutionId
        sessionId
        workflowName
        status
        currentNodeId
        currentStepId
        nodeExecutionCounter
        startedAt
        endedAt
      }
      recentExecutions {
        workflowExecutionId
        sessionId
        workflowName
        status
        currentNodeId
        currentStepId
        nodeExecutionCounter
        startedAt
        endedAt
      }
      newestActiveExecution {
        workflowExecutionId
        sessionId
        workflowName
        status
        currentNodeId
        currentStepId
        nodeExecutionCounter
        startedAt
        endedAt
      }
    }
  }
`;

function renderWorkflowOverviewTableLines(
  rows: readonly WorkflowOverviewRow[],
): string[] {
  const lines: string[] = [
    [
      "name",
      "scope",
      "workflowDirectory",
      "aggregateStatus",
      "active",
      "latestExecutionId",
      "latestStatus",
      "latestStartedAt",
    ].join("\t"),
  ];
  for (const row of rows) {
    const latest = row.latestExecution;
    lines.push(
      [
        row.workflowName,
        workflowOverviewSourceScopeLabel(row.sourceScope),
        row.workflowDirectory,
        row.aggregateStatus,
        String(row.activeExecutionCount),
        latest?.workflowExecutionId ?? "-",
        latest?.status ?? "-",
        latest?.startedAt ?? "-",
      ].join("\t"),
    );
  }
  return lines;
}

function workflowOverviewSourceScopeLabel(scope: WorkflowSourceScope): string {
  switch (scope) {
    case "project":
      return "project scope";
    case "user":
      return "user scope";
    case "direct":
      return "direct root";
  }
}

function workflowOverviewDuplicateWarningLines(
  sources: readonly {
    readonly workflowName: string;
    readonly sourceScope: WorkflowSourceScope;
  }[],
): string[] {
  const scopedNames = new Map<string, Set<WorkflowSourceScope>>();
  for (const source of sources) {
    if (source.sourceScope === "direct") {
      continue;
    }
    const scopes = scopedNames.get(source.workflowName) ?? new Set();
    scopes.add(source.sourceScope);
    scopedNames.set(source.workflowName, scopes);
  }

  const duplicateNames = [...scopedNames.entries()]
    .filter(([, scopes]) => scopes.has("project") && scopes.has("user"))
    .map(([workflowName]) => workflowName)
    .sort((left, right) => left.localeCompare(right));

  return duplicateNames.map(
    (workflowName) =>
      `warning: workflow '${workflowName}' exists in both project scope and user scope; bare-name commands use project scope unless --scope user is specified`,
  );
}

function emitWorkflowOverviewWarnings(
  io: CliIo,
  sources: readonly {
    readonly workflowName: string;
    readonly sourceScope: WorkflowSourceScope;
  }[],
): void {
  for (const line of workflowOverviewDuplicateWarningLines(sources)) {
    io.stderr(line);
  }
}

async function emitLocalWorkflowCatalogWarnings(
  io: CliIo,
  options: LoadOptions,
): Promise<void> {
  const sources = await listWorkflowCatalogSources(options);
  if (!sources.ok) {
    return;
  }
  emitWorkflowOverviewWarnings(
    io,
    sources.value.map((source) => ({
      workflowName: source.workflowName,
      sourceScope: source.scope,
    })),
  );
}

function renderWorkflowStatusOverviewLines(
  overview: WorkflowStatusOverview,
): string[] {
  const lines: string[] = [
    `workflowName: ${overview.workflowName}`,
    `sourceScope: ${overview.sourceScope}`,
    `workflowDirectory: ${overview.workflowDirectory}`,
    `description: ${overview.description}`,
    `aggregateStatus: ${overview.aggregateStatus}`,
    `activeExecutionCount: ${String(overview.activeExecutionCount)}`,
  ];
  const latest = overview.latestExecution;
  if (latest === null) {
    lines.push("latestExecution: -");
  } else {
    lines.push(
      `latestExecution: ${latest.workflowExecutionId} ${latest.status} startedAt=${latest.startedAt} endedAt=${latest.endedAt ?? "-"}`,
    );
  }
  const active = overview.newestActiveExecution;
  if (active === null) {
    lines.push("newestActiveExecution: -");
  } else {
    const stepLabel =
      active.currentStepId !== undefined && active.currentStepId !== null
        ? active.currentStepId
        : (active.currentNodeId ?? "-");
    lines.push(
      `newestActiveExecution: ${active.workflowExecutionId} ${active.status} currentStepOrNode=${stepLabel}`,
    );
  }
  lines.push("recentExecutions:");
  if (overview.recentExecutions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const e of overview.recentExecutions) {
      const step =
        e.currentStepId !== undefined && e.currentStepId !== null
          ? ` step=${e.currentStepId}`
          : "";
      lines.push(
        `  - ${e.workflowExecutionId} ${e.status} ${e.startedAt}${step}`,
      );
    }
  }
  return lines;
}

function summarizeWorkflowContractForText(
  contract:
    | { readonly description?: string; readonly jsonSchema?: unknown }
    | undefined,
): string {
  if (contract === undefined) {
    return "-";
  }
  if (contract.description !== undefined) {
    return contract.description;
  }
  if (contract.jsonSchema !== undefined) {
    return JSON.stringify(contract.jsonSchema);
  }
  return "-";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sampleJsonValueFromSchema(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return {};
  }
  if (Object.hasOwn(schema, "default")) {
    return schema["default"];
  }
  if (Object.hasOwn(schema, "const")) {
    return schema["const"];
  }
  const typeValue = schema["type"];
  const typeName =
    typeof typeValue === "string"
      ? typeValue
      : Array.isArray(typeValue) && typeof typeValue[0] === "string"
        ? typeValue[0]
        : undefined;
  switch (typeName) {
    case "string":
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return sampleJsonObjectFromSchema(schema) ?? {};
    default:
      return {};
  }
}

function sampleJsonObjectFromSchema(
  schema: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(schema)) {
    return undefined;
  }
  const typeValue = schema["type"];
  const isObjectSchema =
    typeValue === "object" ||
    (Array.isArray(typeValue) && typeValue.includes("object")) ||
    isRecord(schema["properties"]);
  if (!isObjectSchema) {
    return undefined;
  }
  const properties = schema["properties"];
  if (!isRecord(properties)) {
    return {};
  }
  const required = Array.isArray(schema["required"])
    ? schema["required"].filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const keys = required.length > 0 ? required : Object.keys(properties);
  return Object.fromEntries(
    keys.map((key) => [key, sampleJsonValueFromSchema(properties[key])]),
  );
}

function shellQuoteSingle(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function buildWorkflowVariablesExamples(input: {
  readonly workflowName: string;
  readonly jsonSchema?: unknown;
}): readonly WorkflowVariablesExample[] {
  const sample = sampleJsonObjectFromSchema(input.jsonSchema) ?? {
    workflowInput: {},
  };
  const inlineJson = JSON.stringify(sample);
  return [
    {
      mode: "inline-json",
      command: `divedra workflow run ${input.workflowName} --variables ${shellQuoteSingle(inlineJson)}`,
    },
    {
      mode: "explicit-file",
      command: `divedra workflow run ${input.workflowName} --variables @./variables.json`,
    },
    {
      mode: "file-path",
      command: `divedra workflow run ${input.workflowName} --variables ./variables.json`,
    },
  ];
}

function renderWorkflowUsageSummaryLines(
  summary: WorkflowUsageSummary,
): string[] {
  const lines = [
    `workflowName: ${summary.workflowName}`,
    `workflowId: ${summary.workflowId}`,
  ];
  if (summary.source !== undefined) {
    lines.push(
      `source: ${summary.source.scope} ${summary.source.workflowDirectory}`,
    );
  }
  lines.push(`description: ${summary.description}`);
  lines.push(`callableStepId: ${summary.callable.stepId}`);
  lines.push(`callableRole: ${summary.callable.role}`);
  lines.push(
    `input: ${summarizeWorkflowContractForText(summary.callable.input)}`,
  );
  lines.push(
    `output: ${summarizeWorkflowContractForText(summary.callable.output)}`,
  );
  lines.push("steps:");
  if (summary.steps.length === 0) {
    lines.push("  (none)");
  } else {
    for (const step of summary.steps) {
      const description =
        step.description === undefined || step.description.length === 0
          ? "-"
          : step.description;
      lines.push(
        `  - ${step.stepId} role=${step.role} description=${description}`,
      );
    }
  }
  return lines;
}

function renderWorkflowUsageCatalogLines(
  catalog: WorkflowUsageCatalog,
): string[] {
  const lines: string[] = [];
  for (const [index, workflow] of catalog.workflows.entries()) {
    if (index > 0) {
      lines.push("");
    }
    lines.push(...renderWorkflowUsageSummaryLines(workflow));
  }
  if (catalog.workflows.length === 0) {
    lines.push("(no workflows)");
  }
  return lines;
}

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

function workflowOverviewGraphqlVariables(
  parsed: ParsedOptions,
  statusFilter: string | undefined,
): Readonly<Record<string, unknown>> {
  const variables: Record<string, unknown> = {};
  if (parsed.workflowScope !== undefined) {
    variables["workflowScope"] = parsed.workflowScope;
  }
  if (statusFilter !== undefined) {
    variables["status"] = statusFilter;
  }
  if (parsed.limit !== undefined) {
    variables["limit"] = parsed.limit;
  }
  return variables;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = DEFAULT_IO,
  deps: CliDependencies = DEFAULT_DEPS,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) {
    io.stderr(parsed.error);
    return 2;
  }
  const positionals = normalizeCliPositionals(parsed.positionals);
  const [scope, command, target] = positionals;
  const env = resolveCliEnv(deps);
  const envWorkflowScope = env["DIVEDRA_WORKFLOW_SCOPE"];
  if (
    parsed.options.workflowScope === undefined &&
    envWorkflowScope !== undefined &&
    envWorkflowScope.length > 0 &&
    parseWorkflowScopeOption(envWorkflowScope) === undefined
  ) {
    io.stderr(
      `invalid DIVEDRA_WORKFLOW_SCOPE value '${envWorkflowScope}'; expected auto, project, or user`,
    );
    return 2;
  }
  const inferredRootDataDir = inferRootDataDirFromExplicitStorageRoots({
    ...(parsed.options.artifactRoot === undefined
      ? {}
      : { artifactRoot: parsed.options.artifactRoot }),
    ...(parsed.options.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: parsed.options.sessionStoreRoot }),
  });

  const sharedOptions = {
    ...(parsed.options.workflowRoot === undefined
      ? {}
      : { workflowRoot: parsed.options.workflowRoot }),
    ...(parsed.options.workflowScope === undefined
      ? {}
      : { workflowScope: parsed.options.workflowScope }),
    ...(parsed.options.userRoot === undefined
      ? {}
      : { userRoot: parsed.options.userRoot }),
    ...(parsed.options.projectRoot === undefined
      ? {}
      : { projectRoot: parsed.options.projectRoot }),
    ...(parsed.options.addonRoot === undefined
      ? {}
      : { addonRoot: parsed.options.addonRoot }),
    ...(parsed.options.artifactRoot === undefined
      ? {}
      : { artifactRoot: parsed.options.artifactRoot }),
    ...(inferredRootDataDir === undefined
      ? {}
      : { rootDataDir: inferredRootDataDir }),
    ...(parsed.options.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: parsed.options.sessionStoreRoot }),
    env,
  };
  const graphqlCliTransport = resolveGraphqlCliTransport(
    parsed.options,
    env,
    deps,
  );

  if (scope === "gql" || scope === "graphql") {
    const document = positionals.slice(1).join(" ").trim();
    if (document.length === 0) {
      io.stderr("GraphQL document is required");
      io.stderr("usage: divedra graphql <graphql-document> [options]");
      return 2;
    }

    let variables: Readonly<Record<string, unknown>> | undefined;
    try {
      variables = await readGraphqlVariables(parsed.options.variablesPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`failed to read GraphQL variables: ${message}`);
      return 1;
    }

    const endpoint =
      parsed.options.endpoint ??
      env["DIVEDRA_GRAPHQL_ENDPOINT"] ??
      DEFAULT_GRAPHQL_ENDPOINT;
    const authTokenEnvName =
      parsed.options.authTokenEnv ?? "DIVEDRA_MANAGER_AUTH_TOKEN";
    const authToken =
      parsed.options.authToken ?? env[authTokenEnvName] ?? undefined;
    const ambientManagerSessionId = env["DIVEDRA_MANAGER_SESSION_ID"];
    const managerSessionId =
      typeof ambientManagerSessionId === "string" &&
      ambientManagerSessionId.length > 0
        ? ambientManagerSessionId
        : undefined;

    try {
      const response = await executeGraphqlRequest({
        endpoint,
        document,
        ...(variables === undefined ? {} : { variables }),
        ...(authToken === undefined ? {} : { authToken }),
        ...(managerSessionId === undefined ? {} : { managerSessionId }),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
      });

      if (parsed.options.output === "json") {
        emitJson(io, response);
      } else if (response.data !== undefined) {
        emitJson(io, response.data);
      } else {
        emitJson(io, response);
      }

      if (response.errors !== undefined && response.errors.length > 0) {
        if (parsed.options.output !== "json") {
          response.errors.forEach((error) => {
            io.stderr(error.message);
          });
        }
        return 1;
      }
      return 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`GraphQL request failed: ${message}`);
      return 1;
    }
  }

  if (scope === "hook") {
    const explicitVendor = parseHookVendorOption(parsed.options.vendor);
    if (command !== undefined) {
      if (command !== "snippet") {
        io.stderr("unknown hook subcommand");
        io.stderr(`usage: divedra hook snippet --vendor ${HOOK_VENDOR_USAGE}`);
        return 2;
      }
      if (target !== undefined) {
        io.stderr("hook snippet does not accept extra positional arguments");
        io.stderr(`usage: divedra hook snippet --vendor ${HOOK_VENDOR_USAGE}`);
        return 2;
      }
      if (parsed.options.vendor === undefined) {
        io.stderr(
          `--vendor is required for hook snippet; expected ${HOOK_VENDOR_EXPECTED}`,
        );
        return 2;
      }
      if (explicitVendor === undefined) {
        io.stderr(
          `invalid --vendor value '${parsed.options.vendor}'; expected ${HOOK_VENDOR_EXPECTED}`,
        );
        return 2;
      }
      emitJson(io, buildHookConfigurationSnippet(explicitVendor));
      return 0;
    }

    if (positionals.length > 1) {
      io.stderr("hook does not accept positional arguments");
      io.stderr(`usage: divedra hook [--vendor ${HOOK_VENDOR_USAGE}]`);
      return 2;
    }

    if (parsed.options.vendor !== undefined && explicitVendor === undefined) {
      io.stderr(
        `invalid --vendor value '${parsed.options.vendor}'; expected ${HOOK_VENDOR_EXPECTED}`,
      );
      return 2;
    }

    return runHookCommand({
      deps: {
        readStdin:
          deps.readStdin ??
          DEFAULT_DEPS.readStdin ??
          createReadHookStdin(process.stdin),
        env,
        cwd: process.cwd(),
        ...(sharedOptions.rootDataDir === undefined
          ? {}
          : { rootDataDir: sharedOptions.rootDataDir }),
        ...(sharedOptions.artifactRoot === undefined
          ? {}
          : { artifactRoot: sharedOptions.artifactRoot }),
      },
      ...(explicitVendor === undefined ? {} : { explicitVendor }),
      io,
    });
  }

  if (scope === "events") {
    const eventsReadOnly =
      parsed.options.readOnly ||
      parseEnvBooleanFlag(env["DIVEDRA_EVENTS_READ_ONLY"]);
    let mockScenarioOptions: Readonly<{ mockScenario?: MockNodeScenario }> = {};
    if (parsed.options.mockScenarioPath !== undefined) {
      if (parsed.options.endpoint !== undefined) {
        io.stderr("--mock-scenario cannot be combined with --endpoint");
        return 2;
      }
      try {
        mockScenarioOptions = await readMockScenarioOption(
          parsed.options.mockScenarioPath,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`failed to read mock scenario: ${message}`);
        return 2;
      }
    }
    const eventOptions = {
      ...sharedOptions,
      ...mockScenarioOptions,
      ...(parsed.options.dryRun ? { dryRun: true } : {}),
      ...(parsed.options.maxSteps === undefined
        ? {}
        : { maxSteps: parsed.options.maxSteps }),
      ...(parsed.options.maxConcurrency === undefined
        ? {}
        : { maxConcurrency: parsed.options.maxConcurrency }),
      ...(parsed.options.maxLoopIterations === undefined
        ? {}
        : { maxLoopIterations: parsed.options.maxLoopIterations }),
      ...(parsed.options.defaultTimeoutMs === undefined
        ? {}
        : { defaultTimeoutMs: parsed.options.defaultTimeoutMs }),
      ...(parsed.options.eventRoot === undefined
        ? {}
        : { eventRoot: parsed.options.eventRoot }),
      ...(parsed.options.endpoint === undefined
        ? {}
        : { endpoint: parsed.options.endpoint }),
      ...(graphqlCliTransport?.authToken === undefined
        ? {}
        : { authToken: graphqlCliTransport.authToken }),
      ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
      ...(eventsReadOnly ? { readOnly: true } : {}),
    };

    if (command === "validate") {
      try {
        const result = await loadAndValidateEventConfiguration(eventOptions);
        if (parsed.options.output === "json") {
          emitJson(io, {
            valid: result.valid,
            eventRoot: result.configuration.eventRoot,
            sources: result.configuration.sources.length,
            bindings: result.configuration.bindings.length,
            issues: result.issues,
          });
        } else if (result.valid) {
          io.stdout(
            `event configuration is valid: ${result.configuration.eventRoot}`,
          );
        } else {
          io.stderr("event validation failed");
          io.stderr(formatValidationIssues(result.issues));
        }
        return result.valid ? 0 : 2;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`events validate failed: ${message}`);
        return 1;
      }
    }

    if (command === "emit") {
      const sourceId = target;
      const eventFile = parsed.options.eventFile ?? parsed.options.filePath;
      if (sourceId === undefined || eventFile === undefined) {
        io.stderr("source id and --event-file are required");
        io.stderr(
          "usage: divedra events emit <source-id> --event-file <path> [options]",
        );
        return 2;
      }
      try {
        const results = await emitEventFile({
          ...eventOptions,
          sourceId,
          eventFile,
        });
        if (parsed.options.output === "json") {
          emitJson(io, {
            sourceId,
            receipts: results.map((result) => ({
              receiptId: result.receipt.receiptId,
              status: result.receipt.status,
              duplicate: result.duplicate,
              workflowName: result.workflowName ?? null,
              workflowExecutionId: result.workflowExecutionId ?? null,
            })),
          });
        } else {
          for (const result of results) {
            io.stdout(
              [
                `receipt: ${result.receipt.receiptId}`,
                `status: ${result.receipt.status}`,
                `duplicate: ${String(result.duplicate)}`,
                `workflowExecutionId: ${result.workflowExecutionId ?? "-"}`,
              ].join(" "),
            );
          }
        }
        return results.some((result) => result.receipt.status === "failed")
          ? 1
          : 0;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`events emit failed: ${message}`);
        return 1;
      }
    }

    if (command === "list") {
      try {
        const receipts = await listEventReceipts({
          ...eventOptions,
          ...(parsed.options.sourceId === undefined
            ? {}
            : { sourceId: parsed.options.sourceId }),
          ...(parsed.options.status === undefined
            ? {}
            : { status: parsed.options.status }),
          ...(parsed.options.limit === undefined
            ? {}
            : { limit: parsed.options.limit }),
        });
        if (parsed.options.output === "json") {
          emitJson(io, { receipts });
        } else {
          for (const receipt of receipts) {
            io.stdout(
              [
                `receipt: ${receipt.receiptId}`,
                `source: ${receipt.sourceId}`,
                `binding: ${receipt.bindingId ?? "-"}`,
                `status: ${receipt.status}`,
                `workflowExecutionId: ${receipt.workflowExecutionId ?? "-"}`,
                `updatedAt: ${receipt.updatedAt}`,
              ].join(" "),
            );
          }
        }
        return 0;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`events list failed: ${message}`);
        return 1;
      }
    }

    if (command === "replies") {
      const status = parseReplyDispatchStatus(parsed.options.status);
      if (parsed.options.status !== undefined && status === undefined) {
        io.stderr(
          "--status must be one of dispatching, sent, queued, or failed",
        );
        return 2;
      }
      try {
        const replies = await listEventReplyDispatchesFromRuntimeDb(
          {
            ...(target === undefined ? {} : { workflowExecutionId: target }),
            ...(status === undefined ? {} : { status }),
            ...(parsed.options.limit === undefined
              ? {}
              : { limit: parsed.options.limit }),
          },
          eventOptions,
        );
        if (parsed.options.output === "json") {
          emitJson(io, { replies });
        } else {
          for (const reply of replies) {
            io.stdout(
              [
                `reply: ${reply.idempotencyKey}`,
                `source: ${reply.sourceId}`,
                `status: ${reply.status}`,
                `workflowExecutionId: ${reply.workflowExecutionId}`,
                `node: ${reply.nodeId}/${reply.nodeExecId}`,
                `providerMessageId: ${reply.providerMessageId ?? "-"}`,
                `updatedAt: ${reply.updatedAt}`,
              ].join(" "),
            );
          }
        }
        return 0;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`events replies failed: ${message}`);
        return 1;
      }
    }

    if (command === "replay") {
      const receiptId = target;
      if (receiptId === undefined) {
        io.stderr("receipt id is required");
        io.stderr(
          "usage: divedra events replay <receipt-id> [--reason <text>] [--dry-run] [options]",
        );
        return 2;
      }
      try {
        const result = await replayEventReceipt({
          ...eventOptions,
          receiptId,
          ...(parsed.options.reason === undefined
            ? {}
            : { reason: parsed.options.reason }),
        });
        if (parsed.options.output === "json") {
          emitJson(io, {
            replayedFromReceiptId: result.original.receiptId,
            replayEventId: result.replayEvent.eventId,
            replayReason: result.reason ?? null,
            receipts: result.receipts.map((entry) => ({
              receiptId: entry.receipt.receiptId,
              status: entry.receipt.status,
              duplicate: entry.duplicate,
              workflowName: entry.workflowName ?? null,
              workflowExecutionId: entry.workflowExecutionId ?? null,
            })),
          });
        } else {
          for (const entry of result.receipts) {
            io.stdout(
              [
                `replayedFrom: ${result.original.receiptId}`,
                `receipt: ${entry.receipt.receiptId}`,
                `status: ${entry.receipt.status}`,
                `duplicate: ${String(entry.duplicate)}`,
                `reason: ${result.reason ?? "-"}`,
                `workflowExecutionId: ${entry.workflowExecutionId ?? "-"}`,
              ].join(" "),
            );
          }
        }
        return result.receipts.some(
          (entry) => entry.receipt.status === "failed",
        )
          ? 1
          : 0;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`events replay failed: ${message}`);
        return 1;
      }
    }

    if (command === "serve") {
      try {
        const listener = await createEventListenerService().start({
          ...eventOptions,
          ...(parsed.options.host === undefined
            ? {}
            : { host: parsed.options.host }),
          ...(parsed.options.port === undefined
            ? {}
            : { port: parsed.options.port }),
        });
        if (parsed.options.output === "json") {
          emitJson(io, {
            host: listener.host ?? null,
            port: listener.port ?? null,
            sources: listener.sources,
          });
        } else {
          io.stdout(
            listener.host === undefined || listener.port === undefined
              ? `events listening for sources: ${listener.sources.join(",") || "-"}`
              : `events listening on http://${listener.host}:${String(listener.port)}`,
          );
        }
        const waitForEventListenerShutdown =
          deps.waitForEventListenerShutdown ??
          DEFAULT_DEPS.waitForEventListenerShutdown;
        try {
          if (waitForEventListenerShutdown !== undefined) {
            await waitForEventListenerShutdown(listener);
          }
        } finally {
          await listener.stop();
        }
        return 0;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`events serve failed: ${message}`);
        return 7;
      }
    }

    io.stderr(`unknown events command: ${command ?? "(empty)"}`);
    printHelp(io);
    return 2;
  }

  if (scope === "serve") {
    const serveWorkflowName = command;
    try {
      let serveContext: LoadOptions & {
        readonly fixedWorkflowName?: string;
        readonly fixedResolvedWorkflowSource?: ResolvedWorkflowSource;
      } = sharedOptions;
      if (serveWorkflowName !== undefined) {
        const resolved = await resolveWorkflowSource(
          serveWorkflowName,
          sharedOptions,
        );
        if (!resolved.ok) {
          io.stderr(`serve failed: ${resolved.error.message}`);
          return 7;
        }
        serveContext = {
          ...sharedOptions,
          fixedWorkflowName: serveWorkflowName,
          fixedResolvedWorkflowSource: resolved.value,
        };
      }
      const started = await deps.startServe({
        ...serveContext,
        ...(parsed.options.host === undefined
          ? {}
          : { host: parsed.options.host }),
        ...(parsed.options.port === undefined
          ? {}
          : { port: parsed.options.port }),
        ...(parsed.options.readOnly ? { readOnly: true } : {}),
        ...(parsed.options.noExec ? { noExec: true } : {}),
      });

      if (parsed.options.output === "json") {
        emitJson(io, {
          host: started.host,
          port: started.port,
          fixedWorkflowName: serveWorkflowName,
          readOnly: parsed.options.readOnly,
          noExec: parsed.options.noExec,
        });
      } else {
        io.stdout(
          `serve listening on http://${started.host}:${String(started.port)}`,
        );
      }
      const waitForServeShutdown =
        deps.waitForServeShutdown ?? DEFAULT_DEPS.waitForServeShutdown;
      try {
        if (waitForServeShutdown !== undefined) {
          await waitForServeShutdown(started);
        }
      } finally {
        started.stop();
      }
      return 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`serve failed: ${message}`);
      return 7;
    }
  }

  if (scope === "call-step") {
    const workflowId = command;
    const workflowRunId = target;
    const stepId = positionals[3];
    if (
      workflowId === undefined ||
      workflowRunId === undefined ||
      stepId === undefined
    ) {
      io.stderr("workflow id, workflow run id, and step id are required");
      io.stderr(
        "usage: divedra call-step <workflow-id> <workflow-run-id> <step-id> [--message-json <json> | --message-file <path>] [--prompt-variant <name>] [--continue-session] [--timeout-ms <ms>] [--resume-step-exec <id>] [options]",
      );
      return 2;
    }
    if (graphqlCliTransport !== null) {
      io.stderr(
        "call-step currently supports local execution only; omit --endpoint",
      );
      return 2;
    }

    let message: unknown;
    try {
      message = await readDirectCallMessage(parsed.options);
    } catch (error: unknown) {
      const messageText =
        error instanceof Error ? error.message : "unknown error";
      io.stderr(`failed to read call-step message: ${messageText}`);
      return 1;
    }

    let mockScenarioOptions: Readonly<{ mockScenario?: MockNodeScenario }> = {};
    try {
      mockScenarioOptions = await readMockScenarioOption(
        parsed.options.mockScenarioPath,
      );
    } catch (error: unknown) {
      const messageText =
        error instanceof Error ? error.message : "unknown error";
      io.stderr(`failed to read --mock-scenario file: ${messageText}`);
      return 1;
    }

    const result = await callStep({
      ...sharedOptions,
      workflowId,
      workflowRunId,
      stepId,
      ...buildLocalCallStepOverrides(parsed.options),
      ...mockScenarioOptions,
      ...(message === undefined ? {} : { message }),
    });

    if (!result.ok) {
      if (parsed.options.output === "json") {
        emitJson(io, result.error);
      } else {
        io.stderr(`call-step failed: ${result.error.message}`);
        if (result.error.nodeExecution !== undefined) {
          io.stderr(`nodeExecId: ${result.error.nodeExecution.nodeExecId}`);
          io.stderr(`status: ${result.error.nodeExecution.status}`);
        }
      }
      return result.error.exitCode;
    }

    if (parsed.options.output === "json") {
      emitJson(io, {
        sessionId: result.value.session.sessionId,
        stepId,
        nodeExecId: result.value.nodeExecution.nodeExecId,
        status: result.value.nodeExecution.status,
        output: result.value.output,
        outputRef: result.value.outputRef,
        exitCode: result.value.exitCode,
      });
    } else {
      io.stdout(`sessionId: ${result.value.session.sessionId}`);
      io.stdout(`stepId: ${stepId}`);
      io.stdout(`nodeExecId: ${result.value.nodeExecution.nodeExecId}`);
      io.stdout(`status: ${result.value.nodeExecution.status}`);
    }
    return result.value.exitCode;
  }

  if (scope === undefined || command === undefined) {
    io.stderr("scope and command are required");
    printHelp(io);
    return 2;
  }
  if (
    target === undefined &&
    !(scope === "workflow" && (command === "list" || command === "usage"))
  ) {
    io.stderr("scope, command, and target are required");
    printHelp(io);
    return 2;
  }

  if (
    parsed.options.output === "table" &&
    !(scope === "workflow" && (command === "list" || command === "status"))
  ) {
    io.stderr(
      "`--output table` is only supported for workflow list and workflow status",
    );
    return 2;
  }

  if (scope === "workflow") {
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

    if (command === "create") {
      const created = await createWorkflowTemplate(target!, {
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
      const loaded = await loadWorkflowFromCatalog(target!, sharedOptions);
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
        sharedOptions,
      );
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
          valid: true,
        });
      } else {
        io.stdout(`workflow '${loaded.value.workflowName}' is valid`);
        const sourceLine = formatWorkflowSource(loaded.value.source);
        if (sourceLine !== undefined) {
          io.stdout(`source: ${sourceLine}`);
        }
        for (const addonSource of addonSources) {
          io.stdout(`addonSource: ${formatAddonSource(addonSource)}`);
        }
      }
      return 0;
    }

    if (command === "inspect") {
      const loaded = await loadWorkflowFromCatalog(target!, sharedOptions);
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
                workflowName: target!,
                runtimeVariables,
                ...buildRemoteExecutionInput(parsed.options),
              },
            },
          });
          const payload = requireObjectField(
            data["executeWorkflow"],
            "executeWorkflow",
          );
          const sessionId = requireStringField(
            payload["sessionId"],
            "executeWorkflow.sessionId",
          );
          const status = requireStringField(
            payload["status"],
            "executeWorkflow.status",
          );
          const exitCode = requireNumberField(
            payload["exitCode"],
            "executeWorkflow.exitCode",
          );
          const summary = await fetchRemoteWorkflowRunSummary(
            graphqlCliTransport,
            sessionId,
          );

          if (parsed.options.output === "json") {
            emitJson(io, {
              sessionId,
              status,
              workflowName: summary.workflowName,
              workflowId: summary.workflowId,
              nodeExecutions: summary.nodeExecutions,
              transitions: summary.transitions,
              exitCode,
            });
          } else {
            io.stdout(`run session: ${sessionId}`);
            io.stdout(`status: ${status}`);
            io.stdout(`nodeExecutions: ${summary.nodeExecutions}`);
          }
          return exitCode;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "unknown error";
          io.stderr(`remote run failed: ${message}`);
          return 1;
        }
      }
      let mockScenarioOptions: Readonly<{ mockScenario?: MockNodeScenario }> =
        {};
      try {
        mockScenarioOptions = await readMockScenarioOption(
          parsed.options.mockScenarioPath,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`failed to read --mock-scenario file: ${message}`);
        return 1;
      }

      const loadedWorkflow = await loadWorkflowFromCatalog(
        target!,
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

      const result = await runWorkflow(target!, {
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

  if (scope === "session") {
    const sessionOptions =
      await resolveSessionCommandStorageOptions(sharedOptions);

    if (command === "progress") {
      const session = await loadSession(target!, sessionOptions);
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
          sessionId: target!,
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
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`session health failed: ${message}`);
        return 1;
      }
    }

    if (command === "status") {
      const session = await loadSession(target!, sessionOptions);
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
                workflowExecutionId: target!,
                ...buildRemoteExecutionInput(parsed.options),
              },
            },
          });
          const payload = requireObjectField(
            data["resumeWorkflowExecution"],
            "resumeWorkflowExecution",
          );
          const sessionId = requireStringField(
            payload["sessionId"],
            "resumeWorkflowExecution.sessionId",
          );
          const status = requireStringField(
            payload["status"],
            "resumeWorkflowExecution.status",
          );
          const exitCode = requireNumberField(
            payload["exitCode"],
            "resumeWorkflowExecution.exitCode",
          );

          if (parsed.options.output === "json") {
            emitJson(io, {
              sessionId,
              status,
              exitCode,
            });
          } else {
            io.stdout(`session resumed: ${sessionId}`);
            io.stdout(`status: ${status}`);
          }
          return exitCode;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "unknown error";
          io.stderr(`remote resume failed: ${message}`);
          return 1;
        }
      }
      const session = await loadSession(target!, sessionOptions);
      if (!session.ok) {
        io.stderr(session.error.message);
        return 1;
      }

      let mockScenarioOptions: Readonly<{ mockScenario?: MockNodeScenario }> =
        {};
      try {
        mockScenarioOptions = await readMockScenarioOption(
          parsed.options.mockScenarioPath,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`failed to read --mock-scenario file: ${message}`);
        return 1;
      }

      const result = await runWorkflow(session.value.workflowName, {
        ...sessionOptions,
        ...buildLocalWorkflowRunOverrides(parsed.options),
        ...buildSupervisorProgressEventSink(parsed.options, io),
        resumeSessionId: session.value.sessionId,
        ...mockScenarioOptions,
      });

      if (!result.ok) {
        io.stderr(result.error.message);
        return result.error.exitCode;
      }

      if (parsed.options.output === "json") {
        emitJson(io, {
          sessionId: result.value.session.sessionId,
          status: result.value.session.status,
          exitCode: result.value.exitCode,
        });
      } else {
        io.stdout(`session resumed: ${result.value.session.sessionId}`);
        io.stdout(`status: ${result.value.session.status}`);
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
          "usage: divedra session continue <workflow-execution-id> --start-step <step-id> --after-step-run <step-run-id> [options]",
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

      let mockScenarioOptions: Readonly<{ mockScenario?: MockNodeScenario }> =
        {};
      try {
        mockScenarioOptions = await readMockScenarioOption(
          parsed.options.mockScenarioPath,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`failed to read --mock-scenario file: ${message}`);
        return 1;
      }

      try {
        const {
          autoImprove: _omitA,
          nestedSuperviserDriver: _omitN,
          ...budgetOverrides
        } = buildLocalWorkflowRunOverrides(parsed.options);

        const result = await continueWorkflowFromHistory({
          ...sessionOptions,
          ...budgetOverrides,
          sourceWorkflowExecutionId: target!,
          afterStepRunId: afterRun,
          startStepId: startStep,
          ...mockScenarioOptions,
        });

        if (parsed.options.output === "json") {
          emitJson(io, {
            sourceWorkflowExecutionId: target!,
            sessionId: result.sessionId,
            status: result.status,
            continuedAfterStepRunId: result.continuedAfterStepRunId,
            continuedStartStepId: result.continuedStartStepId,
            exitCode: result.exitCode,
          });
        } else {
          io.stdout(`sourceWorkflowExecutionId: ${target!}`);
          io.stdout(`continued session: ${result.sessionId}`);
          io.stdout(
            `continuedAfterStepRunId: ${result.continuedAfterStepRunId}`,
          );
          io.stdout(`continuedStartStepId: ${result.continuedStartStepId}`);
          io.stdout(`status: ${result.status}`);
        }
        return result.exitCode;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`session continue failed: ${message}`);
        return 1;
      }
    }

    if (command === "rerun") {
      const fromStepId = positionals[3];
      if (fromStepId === undefined) {
        io.stderr("step id is required for session rerun");
        io.stderr(
          "usage: divedra session rerun <session-id> <step-id> [options]",
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
                workflowExecutionId: target!,
                stepId: fromStepId,
                ...buildRemoteExecutionInput(parsed.options),
              },
            },
          });
          const payload = requireObjectField(
            data["rerunWorkflowExecution"],
            "rerunWorkflowExecution",
          );
          const sessionId = requireStringField(
            payload["sessionId"],
            "rerunWorkflowExecution.sessionId",
          );
          const status = requireStringField(
            payload["status"],
            "rerunWorkflowExecution.status",
          );
          const exitCode = requireNumberField(
            payload["exitCode"],
            "rerunWorkflowExecution.exitCode",
          );

          if (parsed.options.output === "json") {
            emitJson(io, {
              sourceSessionId: target!,
              sessionId,
              status,
              rerunFromStepId: fromStepId,
              exitCode,
            });
          } else {
            io.stdout(`sourceSessionId: ${target!}`);
            io.stdout(`rerun session: ${sessionId}`);
            io.stdout(`rerunFromStepId: ${fromStepId}`);
            io.stdout(`status: ${status}`);
          }
          return exitCode;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "unknown error";
          io.stderr(`remote rerun failed: ${message}`);
          return 1;
        }
      }

      const source = await loadSession(target!, sessionOptions);
      if (!source.ok) {
        io.stderr(source.error.message);
        return 1;
      }

      let mockScenarioOptions: Readonly<{ mockScenario?: MockNodeScenario }> =
        {};
      try {
        mockScenarioOptions = await readMockScenarioOption(
          parsed.options.mockScenarioPath,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`failed to read --mock-scenario file: ${message}`);
        return 1;
      }

      const result = await runWorkflow(source.value.workflowName, {
        ...sessionOptions,
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
          workflowExecutionId: target!,
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
        const message =
          error instanceof Error ? error.message : "unknown error";
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
        payload = await buildWorkflowExecutionExport(target!, sessionOptions);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`session export failed: ${message}`);
        return 1;
      }

      if (parsed.options.filePath === undefined) {
        emitJson(io, payload);
        return 0;
      }

      try {
        const savedPath = await writeExportFile(
          parsed.options.filePath,
          payload,
        );
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
        const message =
          error instanceof Error ? error.message : "unknown error";
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
      const session = await loadSession(target!, sessionOptions);
      if (!session.ok) {
        io.stderr(session.error.message);
        return 1;
      }

      const logs = await listRuntimeNodeLogs(target!, sessionOptions);
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
              sessionId: target!,
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

  io.stderr(`unknown scope: ${scope}`);
  printHelp(io);
  return 1;
}
