import { constants as fsConstants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  executeGraphqlRequest,
  type GraphqlClientResponse,
} from "../../../../src/graphql/client";
import {
  createLifecycleSupervisionPolicyInput,
  type AutoImprovePolicyInput,
} from "../../../../src/workflow/auto-improve-policy";
import { createCommunicationService } from "../../../../src/workflow/communication-service";
import type { WorkflowRunOptions } from "../../../../src/workflow/engine";
import {
  readWorkflowNodePatch,
  type WorkflowNodePatchMap,
} from "../../../../src/workflow/node-patches";
import {
  listRuntimeHookEvents,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
} from "../../../../src/workflow/runtime-db";
import type { MockNodeScenario } from "../../../../src/workflow/scenario-adapter";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../../../../src/workflow/session";
import type { SessionHealthReport } from "../../../../src/workflow/session-health";
import { loadSession } from "../../../../src/workflow/session-store";
import {
  createSupervisorProgressEventSink,
  createSupervisorProgressRenderer,
} from "../../../../src/workflow/supervisor-progress-renderer";
import { normalizeWorkflowWorkingDirectoryOverride } from "../../../../src/workflow/working-directory";
import type {
  CliDependencies,
  CliIo,
  CliStorageOptions,
  GraphqlCliTransportOptions,
  ParsedOptions,
  RemoteWorkflowRunSummary,
  RuntimeNodeLogEntry,
  RuntimeVariablesSource,
  WorkflowExecutionContinuationMetadata,
  WorkflowExecutionExport,
} from "./storage-and-options";
import { HOOK_VENDOR_USAGE } from "./storage-and-options";

export function printHelp(io: CliIo): void {
  io.stdout("Usage:");
  io.stdout(
    "  divedra cli workflow <create|checkout|validate|inspect|usage|list|status|run> <name-or-url?> [options]",
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
  io.stdout("Checkout options:");
  io.stdout("  workflow checkout <github-url>  Install a GitHub workflow directory into project scope");
  io.stdout("  --user-scope   Install checkout under the user scope root");
  io.stdout("  --overwrite    Replace an existing checkout after staged validation");
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
    "  workflow validate <name> --executable  Run active node executability preflight",
  );
  io.stdout(
    "  workflow run <name> --variables <json|@file|file>  Runtime variables as inline JSON object, explicit @file, or bare JSON file path",
  );
  io.stdout(
    "  workflow <validate|run> <name> --node-patch <json|@file|file>  Non-persistent node patch keyed by node id with executionBackend/model/effort",
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
export function formatValidationIssues(
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
export function isJsonScalarLiteralCandidate(value: string): boolean {
  return (
    value === "true" ||
    value === "false" ||
    value === "null" ||
    value.startsWith('"') ||
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
  );
}
export async function readRuntimeVariablesSource(
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
export async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}
export async function readRuntimeVariables(
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
export async function readWorkflowNodePatchOption(
  value: string,
): Promise<WorkflowNodePatchMap> {
  return await readWorkflowNodePatch({
    value,
    invocationCwd: process.cwd(),
    optionName: "--node-patch",
  });
}
export async function readGraphqlVariables(
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
export async function readJsonValueFromFile(
  filePath: string,
): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as unknown;
}
export async function readDirectCallMessage(
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
export async function readMockScenario(
  pathToJson: string,
): Promise<MockNodeScenario> {
  const content = await readFile(pathToJson, "utf8");
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      "mock scenario file must contain a JSON object keyed by step id",
    );
  }
  return parsed as MockNodeScenario;
}
export async function readMockScenarioOption(
  pathToJson: string | undefined,
): Promise<Readonly<{ mockScenario?: MockNodeScenario }>> {
  if (pathToJson === undefined) {
    return {};
  }
  return {
    mockScenario: await readMockScenario(pathToJson),
  };
}
export function emitJson(io: CliIo, payload: unknown): void {
  io.stdout(JSON.stringify(payload, null, 2));
}
export function buildSupervisorProgressEventSink(
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
export function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}
export function buildWorkflowExecutionContinuationMetadata(
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
export async function buildWorkflowExecutionExport(
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
export async function writeExportFile(
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
export function formatRuntimeNodeLogLine(entry: RuntimeNodeLogEntry): string {
  return [
    entry.at,
    entry.level,
    entry.nodeId ?? "-",
    entry.nodeExecId ?? "-",
    entry.message,
  ].join("\t");
}
export function serializeRuntimeNodeLogs(
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
export function nullableDisplay(
  value: string | number | null | undefined,
): string {
  return value === null || value === undefined || value === ""
    ? "-"
    : String(value);
}
export function formatSessionHealthText(
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
export async function writeTextFile(
  filePath: string,
  content: string,
): Promise<string> {
  const resolvedPath = path.resolve(filePath);
  await writeFile(resolvedPath, content, "utf8");
  return resolvedPath;
}
export function isJsonObjectRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function requireObjectField(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!isJsonObjectRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}
export function requireStringField(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}
export function requireNumberField(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}
export function requireArrayField(
  value: unknown,
  label: string,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}
export interface RemoteWorkflowExecutionPayload {
  readonly sessionId: string;
  readonly status: string;
  readonly exitCode: number;
}
export function readRemoteWorkflowExecutionPayload(
  data: Readonly<Record<string, unknown>>,
  fieldName: string,
): RemoteWorkflowExecutionPayload {
  const payload = requireObjectField(data[fieldName], fieldName);
  return {
    sessionId: requireStringField(
      payload["sessionId"],
      `${fieldName}.sessionId`,
    ),
    status: requireStringField(payload["status"], `${fieldName}.status`),
    exitCode: requireNumberField(payload["exitCode"], `${fieldName}.exitCode`),
  };
}
export function resolveCliEnv(
  deps: CliDependencies,
): Readonly<Record<string, string | undefined>> {
  return deps.env ?? process.env;
}
export function resolveGraphqlCliTransport(
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
export function readGraphqlExecutionPayload(
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
export async function executeCliGraphqlOperation(args: {
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
export function buildRemoteExecutionInput(
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
export async function fetchRemoteWorkflowRunSummary(
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
export function rejectUnsupportedRemoteMockScenario(
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
export function parseStepRunExecutionStatusFilter(
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
