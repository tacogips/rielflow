import { stat } from "node:fs/promises";
import path from "node:path";
import type { EventListenerHandle } from "../../../../src/events/listener-service";
import { createReadHookStdin } from "../../../../src/hook/index";
import { SUPPORTED_HOOK_VENDORS } from "../../../../src/hook/types";
import {
  startServe,
  type ServeStartOptions,
  type StartedServe,
} from "../../../../src/server/serve";
import {
  normalizeAutoImprovePolicy,
  type AutoImprovePolicyInput,
} from "../../../../src/workflow/auto-improve-policy";
import type { createCommunicationService } from "../../../../src/workflow/communication-service";
import {
  buildFanoutGroupSummaries,
  type buildInspectionSummary,
} from "../../../../src/workflow/inspect";
import { loadWorkflowFromCatalog } from "../../../../src/workflow/load";
import { computeProjectScopedRootDataDirForScopeRoot } from "../../../../src/workflow/paths";
import type {
  listRuntimeHookEvents,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  RuntimeEventReplyDispatchStatus,
} from "../../../../src/workflow/runtime-db";
import {
  resolveCurrentStepId,
  resolveCurrentStepIdFromWorkflow,
  type WorkflowSessionState,
} from "../../../../src/workflow/session";
import type {
  AsyncNodeAddonPayloadResolver,
  NodeAddonDefinition,
  NodeAddonPayloadResolver,
  ResolvedWorkflowSource,
  WorkflowScopeSelector,
} from "../../../../src/workflow/types";

export type AutoImproveCliInputs = {
  readonly enabled: boolean;
  readonly superviserWorkflowId?: string;
  readonly monitorIntervalMs?: number;
  readonly stallTimeoutMs?: number;
  readonly maxSupervisedAttempts?: number;
  readonly maxWorkflowPatches?: number;
  readonly workflowMutationMode?: "execution-copy" | "in-place";
  readonly allowTargetedRerun?: boolean;
};
export function parseAutoImprovePolicyFromCliFlags(
  input: AutoImproveCliInputs,
): {
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
  readonly nodeAddons?: readonly NodeAddonDefinition[];
  readonly asyncNodeAddonResolvers?: readonly AsyncNodeAddonPayloadResolver[];
  readonly nodeAddonResolvers?: readonly NodeAddonPayloadResolver[];
}
export interface CliStorageOptions {
  readonly workflowRoot?: string;
  readonly workflowScope?: WorkflowScopeSelector;
  readonly userRoot?: string;
  readonly projectRoot?: string;
  readonly addonRoot?: string;
  readonly artifactRoot?: string;
  readonly rootDataDir?: string;
  readonly sessionStoreRoot?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nodeAddons?: readonly NodeAddonDefinition[];
  readonly asyncNodeAddonResolvers?: readonly AsyncNodeAddonPayloadResolver[];
  readonly nodeAddonResolvers?: readonly NodeAddonPayloadResolver[];
}
export interface RunCliSharedOptions extends CliStorageOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
}
export interface RunCliScopeContext {
  readonly parsed: ParsedArgs;
  readonly positionals: readonly string[];
  readonly scope: string | undefined;
  readonly command: string | undefined;
  readonly target: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly sharedOptions: RunCliSharedOptions;
  readonly graphqlCliTransport: GraphqlCliTransportOptions | null;
  readonly deps: CliDependencies;
  readonly io: CliIo;
}
export async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}
export function resolveCliPath(rawPath: string, cwd: string): string {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.resolve(cwd, rawPath);
}
export async function resolveProjectScopeRootFromWorkflowRoot(
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
export async function resolveProjectScopeRootForSessionCommand(
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
    return scopeRoot;
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
export function hasExplicitSessionStorageOverride(
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
function storageOptionsForProjectScopeRoot(
  options: CliStorageOptions,
  projectScopeRoot: string,
): CliStorageOptions {
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
export async function resolveSessionCommandStorageOptions(
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

  return storageOptionsForProjectScopeRoot(options, projectScopeRoot);
}

export async function resolveWorkflowOverviewStorageOptions(
  options: CliStorageOptions,
): Promise<CliStorageOptions> {
  if (hasExplicitSessionStorageOverride(options)) {
    return options;
  }

  const env = options.env ?? process.env;
  const configuredWorkflowRoot =
    options.workflowRoot ?? env["DIVEDRA_WORKFLOW_DEFINITION_DIR"];
  if (
    configuredWorkflowRoot !== undefined &&
    configuredWorkflowRoot.length > 0
  ) {
    const projectScopeRoot = await resolveProjectScopeRootFromWorkflowRoot(
      configuredWorkflowRoot,
      process.cwd(),
    );
    return projectScopeRoot === undefined
      ? options
      : storageOptionsForProjectScopeRoot(options, projectScopeRoot);
  }

  return options;
}
export interface WorkflowSourceOutput {
  readonly scope: ResolvedWorkflowSource["scope"];
  readonly workflowRoot: string;
  readonly workflowDirectory: string;
  readonly scopeRoot?: string;
}
export type RuntimeVariablesSourceKind =
  | "inline-json"
  | "explicit-file"
  | "file-path";
export interface RuntimeVariablesSource {
  readonly kind: RuntimeVariablesSourceKind;
  readonly displayValue: string;
  readonly content: string;
}
export interface WorkflowVariablesExample {
  readonly mode: RuntimeVariablesSourceKind;
  readonly command: string;
}
export interface ParsedOptions {
  readonly workflowRoot?: string;
  readonly workflowScope?: WorkflowScopeSelector;
  readonly userRoot?: string;
  readonly projectRoot?: string;
  readonly addonRoot?: string;
  readonly artifactRoot?: string;
  readonly sessionStoreRoot?: string;
  readonly workingDirectory?: string;
  readonly workerOnly: boolean;
  readonly userScope: boolean;
  readonly overwrite: boolean;
  readonly output: "text" | "json" | "table";
  readonly structure: boolean;
  readonly executablePreflight: boolean;
  readonly format?: "text" | "json" | "jsonl";
  readonly variablesPath?: string;
  readonly nodePatchPath?: string;
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
export interface ParsedArgs {
  readonly positionals: string[];
  readonly options: ParsedOptions;
  readonly error?: string;
}
export function normalizeCliPositionals(
  positionals: readonly string[],
): string[] {
  if (positionals[0] === "cli" && positionals[1] === "workflow") {
    return positionals.slice(1);
  }
  return [...positionals];
}
export interface GraphqlCliTransportOptions {
  readonly endpoint: string;
  readonly authToken?: string;
  readonly managerSessionId?: string;
  readonly fetchImpl?: typeof fetch;
}
export interface RemoteWorkflowRunSummary {
  readonly workflowName: string;
  readonly workflowId: string;
  readonly nodeExecutions: number;
  readonly transitions: number;
}
export interface WorkflowExecutionContinuationMetadata {
  readonly continuedFromWorkflowExecutionId?: string;
  readonly continuedAfterStepRunId?: string;
  readonly continuedAfterExecutionOrdinal?: number;
  readonly continuedStartStepId?: string;
  readonly continuationMode?: WorkflowSessionState["continuationMode"];
  readonly historyImports?: WorkflowSessionState["historyImports"];
}
export interface WorkflowExecutionExport {
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
export type RuntimeNodeLogEntry = Awaited<
  ReturnType<typeof listRuntimeNodeLogs>
>[number];
export const HOOK_VENDOR_USAGE = SUPPORTED_HOOK_VENDORS.join("|");
export const HOOK_VENDOR_EXPECTED = SUPPORTED_HOOK_VENDORS.map(
  (vendor) => `'${vendor}'`,
).join(" or ");
export const DEFAULT_IO: CliIo = {
  stdout: (line: string) => console.log(line),
  stderr: (line: string) => console.error(line),
};
export async function waitForProcessShutdownSignal(): Promise<void> {
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
export const DEFAULT_DEPS: CliDependencies = {
  startServe,
  isInteractiveTerminal: () =>
    process.stdin.isTTY === true && process.stdout.isTTY === true,
  readStdin: createReadHookStdin(process.stdin),
  waitForServeShutdown: async (_started: StartedServe) =>
    waitForProcessShutdownSignal(),
  waitForEventListenerShutdown: async (_started: EventListenerHandle) =>
    waitForProcessShutdownSignal(),
};
export function parseNumericOption(
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
export function parseRequiredStringOption(
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
export function parseEnumOption<const T extends string>(
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
export function parseEnvBooleanFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}
export function parseWorkflowScopeOption(
  value: string | undefined,
): WorkflowScopeSelector | undefined {
  return value === "auto" || value === "project" || value === "user"
    ? value
    : undefined;
}
export function parseWorkflowDefinitionDirectoryOption(
  flagName: string,
  value: string | undefined,
): { readonly value?: string; readonly error?: string } {
  return parseRequiredStringOption(flagName, value);
}
export function parseReplyDispatchStatus(
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
export function buildStepProgressSummaries(
  session: WorkflowSessionState,
): readonly {
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
export function formatFanoutSummaryLines(
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
export async function resolveSessionCurrentStepId(
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
