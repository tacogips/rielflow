import { readFile, stat, writeFile } from "node:fs/promises";
import readline from "node:readline/promises";
import os from "node:os";
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
import { startServe, type StartedServe } from "./server/serve";
import {
  createEventListenerService,
  loadAndValidateEventConfiguration,
} from "./events";
import { emitEventFile } from "./events/manual-emit";
import { listEventReceipts, replayEventReceipt } from "./events/receipt-ops";
import type { EventListenerHandle } from "./events/listener-service";
import type { MockNodeScenario } from "./workflow/adapter";
import { createWorkflowTemplate } from "./workflow/create";
import { callNode, type CallNodeInput } from "./workflow/call-node";
import { runWorkflow, type WorkflowRunOptions } from "./workflow/engine";
import { loadWorkflowFromCatalog, type LoadedWorkflow } from "./workflow/load";
import {
  listWorkflowCatalogSources,
  withResolvedWorkflowSourceOptions,
} from "./workflow/catalog";
import { inferRootDataDirFromExplicitStorageRoots } from "./workflow/paths";
import { createSessionId, type WorkflowSessionState } from "./workflow/session";
import { buildInspectionSummary } from "./workflow/inspect";
import { collectWorkflowAddonSourceSummaries } from "./workflow/addon-source-summary";
import { loadSession } from "./workflow/session-store";
import { createCommunicationService } from "./workflow/communication-service";
import { selectTuiRuntimeMode } from "./tui/runtime";
import type {
  OpenTuiWorkflowActionResult,
  OpenTuiWorkflowAppOptions,
  OpenTuiWorkflowExecutionHandle,
} from "./tui/opentui-screen";
import { loadAgentSessionTranscript } from "./tui/agent-session-history";
import {
  listEventReplyDispatchesFromRuntimeDb,
  listRuntimeHookEvents,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  listRuntimeSessions,
  type RuntimeEventReplyDispatchStatus,
} from "./workflow/runtime-db";
import { createManagerSessionStore } from "./workflow/manager-session-store";
import { deleteWorkflowSessionHistory } from "./workflow/session-history";
import { deleteWorkflowHistory as deleteWorkflowHistoryForWorkflow } from "./workflow/history";
import { normalizeWorkflowWorkingDirectoryOverride } from "./workflow/working-directory";
import type {
  ResolvedWorkflowSource,
  WorkflowScopeSelector,
} from "./workflow/types";

export interface CliIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

export interface CliDependencies {
  readonly startServe: (options: {
    host?: string;
    port?: number;
    workflowRoot?: string;
    addonRoot?: string;
    artifactRoot?: string;
    sessionStoreRoot?: string;
    readOnly?: boolean;
    noExec?: boolean;
    fixedWorkflowName?: string;
  }) => Promise<StartedServe>;
  readonly isInteractiveTerminal: () => boolean;
  readonly waitForServeShutdown?: (started: StartedServe) => Promise<void>;
  readonly waitForEventListenerShutdown?: (
    started: EventListenerHandle,
  ) => Promise<void>;
  readonly fetchImpl?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly readStdin?: () => Promise<string>;
  readonly runOpenTuiWorkflowApp?: (
    options: OpenTuiWorkflowAppOptions,
  ) => Promise<number>;
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

interface WorkflowSourceOutput {
  readonly scope: ResolvedWorkflowSource["scope"];
  readonly workflowRoot: string;
  readonly workflowDirectory: string;
  readonly scopeRoot?: string;
  readonly legacyProjectRoot?: boolean;
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
  readonly output: "text" | "json";
  readonly format?: "text" | "json" | "jsonl";
  readonly variablesPath?: string;
  readonly mockScenarioPath?: string;
  readonly dryRun: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly host?: string;
  readonly port?: number;
  readonly endpoint?: string;
  readonly authToken?: string;
  readonly authTokenEnv?: string;
  readonly filePath?: string;
  readonly readOnly: boolean;
  readonly noExec: boolean;
  readonly resumeSessionId?: string;
  readonly workflowName?: string;
  readonly messageJson?: string;
  readonly messageFile?: string;
  readonly vendor?: string;
  readonly eventRoot?: string;
  readonly eventFile?: string;
  readonly sourceId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly reason?: string;
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

interface WorkflowExecutionExport {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly workflowName: string;
  readonly status: WorkflowSessionState["status"];
  readonly exportedAt: string;
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

function parseNumericOption(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
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
  let output: "text" | "json" = "text";
  let format: "text" | "json" | "jsonl" | undefined;
  let variablesPath: string | undefined;
  let dryRun = false;
  let mockScenarioPath: string | undefined;
  let maxSteps: number | undefined;
  let maxLoopIterations: number | undefined;
  let defaultTimeoutMs: number | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let endpoint: string | undefined;
  let authToken: string | undefined;
  let authTokenEnv: string | undefined;
  let filePath: string | undefined;
  let readOnly = false;
  let noExec = false;
  let resumeSessionId: string | undefined;
  let workflowName: string | undefined;
  let messageJson: string | undefined;
  let messageFile: string | undefined;
  let vendor: string | undefined;
  let eventRoot: string | undefined;
  let eventFile: string | undefined;
  let sourceId: string | undefined;
  let status: string | undefined;
  let limit: number | undefined;
  let reason: string | undefined;
  let parseError: string | undefined;

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

    switch (token) {
      case "--workflow-root":
        workflowRoot = readNext();
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
      case "--user-root":
        userRoot = readNext();
        break;
      case "--project-root":
        projectRoot = readNext();
        break;
      case "--addon-root":
        addonRoot = readNext();
        break;
      case "--artifact-root":
        artifactRoot = readNext();
        break;
      case "--session-store":
        sessionStoreRoot = readNext();
        break;
      case "--working-dir":
      case "--working-directory":
        workingDirectory = readNext();
        break;
      case "--worker-only":
        workerOnly = true;
        break;
      case "--variables":
        variablesPath = readNext();
        break;
      case "--output": {
        const maybeOutput = readNext();
        if (maybeOutput === "json" || maybeOutput === "text") {
          output = maybeOutput;
        }
        break;
      }
      case "--format": {
        const maybeFormat = readNext();
        if (
          maybeFormat === "json" ||
          maybeFormat === "jsonl" ||
          maybeFormat === "text"
        ) {
          format = maybeFormat;
        }
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      case "--mock-scenario":
        mockScenarioPath = readNext();
        break;
      case "--max-steps":
        maxSteps = parseNumericOption(readNext());
        break;
      case "--max-loop-iterations":
        maxLoopIterations = parseNumericOption(readNext());
        break;
      case "--default-timeout-ms":
        defaultTimeoutMs = parseNumericOption(readNext());
        break;
      case "--host":
        host = readNext();
        break;
      case "--port":
        port = parseNumericOption(readNext());
        break;
      case "--endpoint":
        endpoint = readNext();
        break;
      case "--auth-token":
        authToken = readNext();
        break;
      case "--auth-token-env":
        authTokenEnv = readNext();
        break;
      case "--file":
        filePath = readNext();
        break;
      case "--read-only":
        readOnly = true;
        break;
      case "--no-exec":
        noExec = true;
        break;
      case "--resume-session":
        resumeSessionId = readNext();
        break;
      case "--workflow":
        workflowName = readNext();
        break;
      case "--message-json":
        messageJson = readNext();
        break;
      case "--message-file":
        messageFile = readNext();
        break;
      case "--vendor":
        vendor = readNext();
        break;
      case "--event-root":
        eventRoot = readNext();
        break;
      case "--event-file":
        eventFile = readNext();
        break;
      case "--source":
        sourceId = readNext();
        break;
      case "--status":
        status = readNext();
        break;
      case "--limit":
        limit = parseNumericOption(readNext());
        break;
      case "--reason":
        reason = readNext();
        break;
      default:
        break;
    }
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
      ...(format === undefined ? {} : { format }),
      ...(variablesPath === undefined ? {} : { variablesPath }),
      ...(mockScenarioPath === undefined ? {} : { mockScenarioPath }),
      output,
      dryRun,
      ...(maxSteps === undefined ? {} : { maxSteps }),
      ...(maxLoopIterations === undefined ? {} : { maxLoopIterations }),
      ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
      ...(host === undefined ? {} : { host }),
      ...(port === undefined ? {} : { port }),
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(authToken === undefined ? {} : { authToken }),
      ...(authTokenEnv === undefined ? {} : { authTokenEnv }),
      ...(filePath === undefined ? {} : { filePath }),
      readOnly,
      noExec,
      ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
      ...(workflowName === undefined ? {} : { workflowName }),
      ...(messageJson === undefined ? {} : { messageJson }),
      ...(messageFile === undefined ? {} : { messageFile }),
      ...(vendor === undefined ? {} : { vendor }),
      ...(eventRoot === undefined ? {} : { eventRoot }),
      ...(eventFile === undefined ? {} : { eventFile }),
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(status === undefined ? {} : { status }),
      ...(limit === undefined ? {} : { limit }),
      ...(reason === undefined ? {} : { reason }),
    },
    ...(parseError === undefined ? {} : { error: parseError }),
  };
}

function printHelp(io: CliIo): void {
  io.stdout("Usage:");
  io.stdout(
    "  divedra cli workflow <create|validate|inspect|run> <name> [options]",
  );
  io.stdout(
    "  divedra session <status|progress|resume|export|logs> <session-id> [options]",
  );
  io.stdout("  divedra session rerun <session-id> <node-id> [options]");
  io.stdout(
    "  divedra tui [workflow-name] [--workflow <name>] [--resume-session <id>] [--variables <path>] [--mock-scenario <path>] [--max-steps <n>]",
  );
  io.stdout(
    "  divedra serve [workflow-name] [--host <host>] [--port <port>] [--read-only] [--no-exec]",
  );
  io.stdout(
    "  divedra web serve [workflow-name] [--host <host>] [--port <port>] [--read-only] [--no-exec]",
  );
  io.stdout(
    "  divedra gql <graphql-document> [--variables <json|@file>] [--endpoint <url>] [--auth-token <token>]",
  );
  io.stdout(
    "  divedra events <validate|serve|emit|list|replay|replies> [source-id|receipt-id|workflow-execution-id] [--event-root <path>] [--event-file <path>]",
  );
  io.stdout(
    "  divedra call-node <workflow-id> <workflow-run-id> <node-id> [--message-json <json> | --message-file <path>] [options]",
  );
  io.stdout(`  divedra hook [--vendor ${HOOK_VENDOR_USAGE}]`);
  io.stdout(`  divedra hook snippet --vendor ${HOOK_VENDOR_USAGE}`);
  io.stdout("");
  io.stdout("Create options:");
  io.stdout("  --worker-only  Scaffold a manager-less starter workflow");
  io.stdout("");
  io.stdout("Workflow scope options:");
  io.stdout(
    "  --workflow-root <path>  Use a direct workflow root and bypass scoped lookup",
  );
  io.stdout("  --scope <scope>         Select auto, project, or user scope");
  io.stdout("  --user-root <path>      Override the user scope root");
  io.stdout("  --project-root <path>   Override the project scope root");
  io.stdout("  --addon-root <path>     Use a direct add-on root override");
  io.stdout("");
  io.stdout("Session options:");
  io.stdout(
    "  export --file <path>     Write workflow run export JSON to a file",
  );
  io.stdout(
    "  logs --format <format>   Print node logs as text, json, or jsonl",
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

async function readRuntimeVariables(
  pathToJson: string,
): Promise<Readonly<Record<string, unknown>>> {
  const content = await readFile(pathToJson, "utf8");
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("runtime variables file must contain a JSON object");
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

async function readCallNodeMessage(
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
      "mock scenario file must contain a JSON object keyed by node id",
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

export function shouldFallbackFromOpenTuiError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /cannot find (?:package|module) ['"](?:@opentui\/(?:core|solid)(?:-[^'"]+)?|solid-js(?:\/[^'"]+)?)['"]/i.test(
    error.message,
  );
}

export function resolveTuiStartupSelection(input: {
  readonly requestedWorkflowName?: string;
  readonly resumeSession?: Pick<
    WorkflowSessionState,
    "sessionId" | "workflowName"
  >;
}):
  | {
      readonly ok: true;
      readonly initialSessionId?: string;
      readonly initialWorkflowName?: string;
    }
  | { readonly ok: false; readonly message: string } {
  if (input.resumeSession === undefined) {
    return {
      ok: true,
      ...(input.requestedWorkflowName === undefined
        ? {}
        : { initialWorkflowName: input.requestedWorkflowName }),
    };
  }
  if (
    input.requestedWorkflowName !== undefined &&
    input.requestedWorkflowName !== input.resumeSession.workflowName
  ) {
    return {
      ok: false,
      message:
        `resume session '${input.resumeSession.sessionId}' belongs to workflow ` +
        `'${input.resumeSession.workflowName}', not '${input.requestedWorkflowName}'`,
    };
  }
  return {
    ok: true,
    initialSessionId: input.resumeSession.sessionId,
    initialWorkflowName: input.resumeSession.workflowName,
  };
}

function emitJson(io: CliIo, payload: unknown): void {
  io.stdout(JSON.stringify(payload, null, 2));
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
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
  return {
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(parsedOptions.dryRun ? { dryRun: true } : {}),
    ...(parsedOptions.maxSteps === undefined
      ? {}
      : { maxSteps: parsedOptions.maxSteps }),
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildLocalWorkflowRunOverrides(
  parsedOptions: ParsedOptions,
): Pick<
  WorkflowRunOptions,
  | "defaultTimeoutMs"
  | "dryRun"
  | "maxLoopIterations"
  | "maxSteps"
  | "workflowWorkingDirectory"
> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    parsedOptions.workingDirectory,
  );
  return {
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(parsedOptions.maxSteps === undefined
      ? {}
      : { maxSteps: parsedOptions.maxSteps }),
    ...(parsedOptions.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: parsedOptions.maxLoopIterations }),
    ...(parsedOptions.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: parsedOptions.defaultTimeoutMs }),
    ...(parsedOptions.dryRun ? { dryRun: true } : {}),
  };
}

function buildLocalCallNodeOverrides(
  parsedOptions: ParsedOptions,
): Pick<
  CallNodeInput,
  "defaultTimeoutMs" | "dryRun" | "workflowWorkingDirectory"
> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    parsedOptions.workingDirectory,
  );
  return {
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(parsedOptions.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: parsedOptions.defaultTimeoutMs }),
    ...(parsedOptions.dryRun ? { dryRun: true } : {}),
  };
}

async function listWorkflowNames(options: {
  workflowRoot?: string;
  workflowScope?: WorkflowScopeSelector;
  userRoot?: string;
  projectRoot?: string;
  addonRoot?: string;
  artifactRoot?: string;
  sessionStoreRoot?: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<readonly string[]> {
  const catalogSources = await listWorkflowCatalogSources(options);
  if (!catalogSources.ok) {
    return [];
  }
  return [
    ...new Set(catalogSources.value.map((source) => source.workflowName)),
  ].sort((a, b) => a.localeCompare(b));
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
  const legacySuffix = source.legacyProjectRoot === true ? " legacy-root" : "";
  return `${source.scope}${legacySuffix} ${source.workflowDirectory}`;
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
    ...(source.legacyProjectRoot === undefined
      ? {}
      : { legacyProjectRoot: source.legacyProjectRoot }),
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

export async function loadOpenTuiScreenImplementations(
  deps: CliDependencies,
): Promise<{
  readonly runOpenTuiWorkflowApp: NonNullable<
    CliDependencies["runOpenTuiWorkflowApp"]
  >;
}> {
  if (deps.runOpenTuiWorkflowApp !== undefined) {
    return {
      runOpenTuiWorkflowApp: deps.runOpenTuiWorkflowApp,
    };
  }
  const module = await import("./tui/opentui-screen");
  return {
    runOpenTuiWorkflowApp: module.runOpenTuiWorkflowApp,
  };
}

interface LocalTuiWorkflowActionInput {
  readonly workflowName: string;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly rerunFromNodeId?: string;
  readonly rerunFromSessionId?: string;
  readonly resumeSessionId?: string;
  readonly sessionId?: string;
}

interface CreateOpenTuiWorkflowAppOptionsInput {
  readonly deps: Pick<CliDependencies, "env">;
  readonly initialSessionId?: string;
  readonly initialWorkflowName?: string;
  readonly io: CliIo;
  readonly optionRuntimeVariables: Readonly<Record<string, unknown>>;
  readonly runLocalTuiWorkflow: (
    input: LocalTuiWorkflowActionInput,
  ) => Promise<OpenTuiWorkflowActionResult>;
  readonly sharedOptions: CliStorageOptions;
  readonly startLocalTuiWorkflow: (input: {
    readonly workflowName: string;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly sessionId: string;
  }) => Promise<OpenTuiWorkflowExecutionHandle>;
  readonly workflowNames: readonly string[];
}

export function resolveCliHomeDir(
  env?: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const candidates = [
    env?.["HOME"],
    env?.["USERPROFILE"],
    process.env["HOME"],
    process.env["USERPROFILE"],
  ];
  const explicitHome = candidates.find(
    (candidate): candidate is string =>
      candidate !== undefined && candidate.length > 0,
  );
  if (explicitHome !== undefined) {
    return explicitHome;
  }
  try {
    const resolvedHome = os.homedir();
    return resolvedHome.length > 0 ? resolvedHome : undefined;
  } catch {
    return undefined;
  }
}

export function createOpenTuiWorkflowAppOptions(
  input: CreateOpenTuiWorkflowAppOptionsInput,
): OpenTuiWorkflowAppOptions {
  const loadWorkflowDefinitionOrThrow = async (
    workflowName: string,
  ): Promise<LoadedWorkflow> => {
    const loaded = await loadWorkflowFromCatalog(
      workflowName,
      input.sharedOptions,
    );
    if (!loaded.ok) {
      throw new Error(loaded.error.message);
    }
    return loaded.value;
  };

  const loadSessionOrThrow = async (
    sessionId: string,
  ): Promise<WorkflowSessionState> => {
    const loaded = await loadSession(sessionId, input.sharedOptions);
    if (!loaded.ok) {
      throw new Error(loaded.error.message);
    }
    return loaded.value;
  };

  return {
    ...(input.initialWorkflowName === undefined
      ? {}
      : { initialWorkflowName: input.initialWorkflowName }),
    ...(input.initialSessionId === undefined
      ? {}
      : { initialSessionId: input.initialSessionId }),
    io: input.io,
    workflowNames: input.workflowNames,
    refreshWorkflowNames: async () => listWorkflowNames(input.sharedOptions),
    loadWorkflowDefinition: loadWorkflowDefinitionOrThrow,
    listWorkflowSessions: async (workflowName) =>
      (await listRuntimeSessions(input.sharedOptions)).filter(
        (session) => session.workflowName === workflowName,
      ),
    loadRuntimeSessionView: async (sessionId) => {
      const session = await loadSessionOrThrow(sessionId);
      const [nodeExecutions, nodeLogs] = await Promise.all([
        listRuntimeNodeExecutions(sessionId, input.sharedOptions),
        listRuntimeNodeLogs(sessionId, input.sharedOptions),
      ]);
      return {
        session,
        nodeExecutions,
        nodeLogs,
      };
    },
    deleteWorkflowSession: async ({ sessionId, workflowId, workflowName }) =>
      deleteWorkflowSessionHistory(
        {
          sessionId,
          workflowId,
          workflowName,
        },
        input.sharedOptions,
      ),
    deleteWorkflowHistory: async ({ workflowId, workflowName }) =>
      deleteWorkflowHistoryForWorkflow({
        workflowId,
        workflowName,
        ...input.sharedOptions,
      }),
    loadManagerSessionMessages: async (managerSessionId) =>
      createManagerSessionStore(input.sharedOptions).listMessages(
        managerSessionId,
      ),
    loadAgentSessionTranscript: async ({ backend, sessionId }) => {
      const homeDir = resolveCliHomeDir(input.deps.env);
      if (homeDir === undefined) {
        throw new Error(
          "cannot load local AI agent session history because HOME is not set",
        );
      }
      return loadAgentSessionTranscript({
        backend,
        homeDir,
        sessionId,
      });
    },
    executeWorkflow: async ({ workflowName, runtimeVariables }) => {
      const loadedWorkflow = await loadWorkflowDefinitionOrThrow(workflowName);
      return input.startLocalTuiWorkflow({
        workflowName,
        sessionId: createSessionId({
          workflowId: loadedWorkflow.bundle.workflow.workflowId,
        }),
        runtimeVariables: {
          ...input.optionRuntimeVariables,
          ...runtimeVariables,
        },
      });
    },
    rerunWorkflow: async ({
      sourceSessionId,
      fromNodeId,
      runtimeVariables,
    }) => {
      const source = await loadSessionOrThrow(sourceSessionId);
      return input.runLocalTuiWorkflow({
        workflowName: source.workflowName,
        rerunFromSessionId: source.sessionId,
        rerunFromNodeId: fromNodeId,
        runtimeVariables: {
          ...input.optionRuntimeVariables,
          ...runtimeVariables,
        },
      });
    },
    resumeWorkflow: async (sessionId) => {
      const session = await loadSessionOrThrow(sessionId);
      return input.runLocalTuiWorkflow({
        workflowName: session.workflowName,
        resumeSessionId: session.sessionId,
        runtimeVariables: input.optionRuntimeVariables,
      });
    },
  };
}

async function runTui(
  workflowNameOrUndefined: string | undefined,
  parsedOptions: ParsedOptions,
  sharedOptions: CliStorageOptions,
  io: CliIo,
  deps: CliDependencies,
): Promise<number> {
  let optionRuntimeVariables: Readonly<Record<string, unknown>> = {};
  if (parsedOptions.variablesPath !== undefined) {
    try {
      optionRuntimeVariables = await readRuntimeVariables(
        parsedOptions.variablesPath,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`failed to read --variables file: ${message}`);
      return 1;
    }
  }

  const runAndReportProgress = async (
    workflowName: string,
    runtimeVariables: Readonly<Record<string, unknown>>,
    mockScenario: MockNodeScenario | undefined,
    resumeSessionId: string | undefined,
  ): Promise<number> => {
    let sessionId = resumeSessionId;
    let workflowOptions = sharedOptions;
    const loadedWorkflow = await loadWorkflowFromCatalog(
      workflowName,
      sharedOptions,
    );
    if (!loadedWorkflow.ok) {
      if (resumeSessionId === undefined) {
        io.stderr(loadedWorkflow.error.message);
        return 1;
      }
    } else {
      workflowOptions = optionsForLoadedWorkflow(
        loadedWorkflow.value,
        sharedOptions,
      );
    }
    if (sessionId === undefined && loadedWorkflow.ok) {
      sessionId = createSessionId({
        workflowId: loadedWorkflow.value.bundle.workflow.workflowId,
      });
    }
    if (sessionId === undefined) {
      io.stderr("cannot start workflow without a session id");
      return 1;
    }
    io.stdout(
      `${resumeSessionId === undefined ? "Starting" : "Resuming"} session ${sessionId}`,
    );
    const runPromise = runWorkflow(workflowName, {
      ...workflowOptions,
      sessionId,
      runtimeVariables,
      ...(mockScenario === undefined ? {} : { mockScenario }),
      ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
      ...buildLocalWorkflowRunOverrides(parsedOptions),
    });

    let terminal = false;
    while (!terminal) {
      await sleep(500);
      const loaded = await loadSession(sessionId, sharedOptions);
      if (!loaded.ok) {
        continue;
      }
      const session = loaded.value;
      const counts = Object.keys(session.nodeExecutionCounts)
        .sort((a, b) => a.localeCompare(b))
        .map(
          (nodeId) =>
            `${nodeId}:${String(session.nodeExecutionCounts[nodeId] ?? 0)}`,
        )
        .join(", ");
      io.stdout(
        `[progress] status=${session.status} current=${session.currentNodeId ?? "-"} totalExec=${String(
          session.nodeExecutionCounter,
        )} queue=${session.queue.join(",") || "-"} nodes=${counts || "-"}`,
      );
      terminal =
        session.status === "completed" ||
        session.status === "failed" ||
        session.status === "cancelled" ||
        session.status === "paused";
    }

    const result = await runPromise;
    if (!result.ok) {
      io.stderr(`run failed: ${result.error.message}`);
      return result.error.exitCode;
    }
    io.stdout(`sessionId: ${result.value.session.sessionId}`);
    io.stdout(`status: ${result.value.session.status}`);
    return result.value.exitCode;
  };

  const resolveTuiMockScenario = async (
    workflowName: string,
  ): Promise<MockNodeScenario | undefined> => {
    if (parsedOptions.mockScenarioPath !== undefined) {
      return readMockScenario(parsedOptions.mockScenarioPath);
    }
    const loaded = await loadWorkflowFromCatalog(workflowName, sharedOptions);
    if (!loaded.ok) {
      throw new Error(loaded.error.message);
    }
    const defaultScenarioPath = path.join(
      loaded.value.workflowDirectory,
      "mock-scenario.json",
    );
    try {
      await stat(defaultScenarioPath);
      return readMockScenario(defaultScenarioPath);
    } catch {
      return undefined;
    }
  };
  const runLocalTuiWorkflow = async (input: {
    readonly workflowName: string;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly rerunFromNodeId?: string;
    readonly rerunFromSessionId?: string;
    readonly resumeSessionId?: string;
    readonly sessionId?: string;
  }): Promise<OpenTuiWorkflowActionResult> => {
    const mockScenario = await resolveTuiMockScenario(input.workflowName);
    const result = await runWorkflow(input.workflowName, {
      ...sharedOptions,
      ...buildLocalWorkflowRunOverrides(parsedOptions),
      ...(mockScenario === undefined ? {} : { mockScenario }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.resumeSessionId === undefined
        ? {}
        : { resumeSessionId: input.resumeSessionId }),
      ...(input.rerunFromSessionId === undefined
        ? {}
        : { rerunFromSessionId: input.rerunFromSessionId }),
      ...(input.rerunFromNodeId === undefined
        ? {}
        : { rerunFromNodeId: input.rerunFromNodeId }),
      runtimeVariables: input.runtimeVariables,
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return {
      sessionId: result.value.session.sessionId,
      status: result.value.session.status,
      exitCode: result.value.exitCode,
    };
  };
  const startLocalTuiWorkflow = async (input: {
    readonly workflowName: string;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly sessionId: string;
  }): Promise<OpenTuiWorkflowExecutionHandle> => {
    return {
      sessionId: input.sessionId,
      completion: runLocalTuiWorkflow(input),
    };
  };

  try {
    const runtimeSelection = selectTuiRuntimeMode({
      isInteractiveTerminal: deps.isInteractiveTerminal(),
      ...(parsedOptions.resumeSessionId === undefined
        ? {}
        : {
            resumeSessionId: parsedOptions.resumeSessionId,
          }),
    });

    let resumeSession: WorkflowSessionState | undefined;
    if (parsedOptions.resumeSessionId !== undefined) {
      const loadedResumeSession = await loadSession(
        parsedOptions.resumeSessionId,
        sharedOptions,
      );
      if (!loadedResumeSession.ok) {
        io.stderr(
          `failed to load resume session: ${loadedResumeSession.error.message}`,
        );
        return 1;
      }
      resumeSession = loadedResumeSession.value;
    }

    const startupSelection = resolveTuiStartupSelection({
      ...(workflowNameOrUndefined === undefined
        ? {}
        : { requestedWorkflowName: workflowNameOrUndefined }),
      ...(resumeSession === undefined ? {} : { resumeSession }),
    });
    if (!startupSelection.ok) {
      io.stderr(startupSelection.message);
      return 2;
    }

    const runResumeSessionFallback = async (): Promise<number> => {
      if (resumeSession === undefined) {
        throw new Error("resume session fallback requested without a session");
      }
      try {
        return runAndReportProgress(
          resumeSession.workflowName,
          {
            ...resumeSession.runtimeVariables,
            ...optionRuntimeVariables,
            resumedFromSessionId: resumeSession.sessionId,
          },
          await resolveTuiMockScenario(resumeSession.workflowName),
          resumeSession.sessionId,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`failed to resolve mock scenario: ${message}`);
        return 1;
      }
    };

    if (resumeSession !== undefined && runtimeSelection.mode === "fallback") {
      return runResumeSessionFallback();
    }

    const workflowNames = await listWorkflowNames(sharedOptions);
    if (
      resumeSession !== undefined &&
      !workflowNames.includes(resumeSession.workflowName)
    ) {
      io.stderr(
        `workflow '${resumeSession.workflowName}' for resume session is unavailable in workflow root; falling back to direct resume flow`,
      );
      return runResumeSessionFallback();
    }
    if (workflowNames.length === 0) {
      io.stderr("no workflows found");
      return 1;
    }

    if (runtimeSelection.mode === "fallback") {
      if (
        workflowNameOrUndefined === undefined &&
        runtimeSelection.requiresWorkflowArgument
      ) {
        io.stderr("workflow name is required in non-interactive terminal");
        return 2;
      }
      if (workflowNameOrUndefined === undefined) {
        io.stderr("workflow name is required");
        return 2;
      }
      if (!workflowNames.includes(workflowNameOrUndefined)) {
        io.stderr(`workflow not found: ${workflowNameOrUndefined}`);
        return 1;
      }
      let mockScenario: MockNodeScenario | undefined;
      try {
        mockScenario = await resolveTuiMockScenario(workflowNameOrUndefined);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(`failed to resolve mock scenario: ${message}`);
        return 1;
      }
      io.stdout("using promptless fallback mode");
      return runAndReportProgress(
        workflowNameOrUndefined,
        optionRuntimeVariables,
        mockScenario,
        undefined,
      );
    }

    let openTuiImplementations:
      | Awaited<ReturnType<typeof loadOpenTuiScreenImplementations>>
      | undefined;
    try {
      openTuiImplementations = await loadOpenTuiScreenImplementations(deps);
    } catch (error: unknown) {
      if (!shouldFallbackFromOpenTuiError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(
        `OpenTUI unavailable (${message}); falling back to readline workflow selection`,
      );
      if (resumeSession !== undefined) {
        io.stderr(
          `resume session '${resumeSession.sessionId}' will use direct resume fallback`,
        );
        return runResumeSessionFallback();
      }
    }

    if (openTuiImplementations !== undefined) {
      try {
        return await openTuiImplementations.runOpenTuiWorkflowApp(
          createOpenTuiWorkflowAppOptions({
            deps,
            ...(startupSelection.initialWorkflowName === undefined
              ? {}
              : { initialWorkflowName: startupSelection.initialWorkflowName }),
            ...(startupSelection.initialSessionId === undefined
              ? {}
              : { initialSessionId: startupSelection.initialSessionId }),
            io,
            optionRuntimeVariables,
            runLocalTuiWorkflow,
            sharedOptions,
            startLocalTuiWorkflow,
            workflowNames,
          }),
        );
      } catch (error: unknown) {
        if (!shouldFallbackFromOpenTuiError(error)) {
          throw error;
        }
        const message =
          error instanceof Error ? error.message : "unknown error";
        io.stderr(
          `OpenTUI unavailable (${message}); falling back to readline workflow selection`,
        );
        if (resumeSession !== undefined) {
          io.stderr(
            `resume session '${resumeSession.sessionId}' will use direct resume fallback`,
          );
          return runResumeSessionFallback();
        }
      }
    }

    let workflowName = startupSelection.initialWorkflowName;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      if (workflowName === undefined) {
        io.stdout("Select workflow:");
        workflowNames.forEach((name, index) => {
          io.stdout(`  ${String(index + 1)}. ${name}`);
        });
        const selectedRaw = await rl.question("Workflow number: ");
        const selectedIndex = Number(selectedRaw);
        if (
          !Number.isFinite(selectedIndex) ||
          selectedIndex < 1 ||
          selectedIndex > workflowNames.length
        ) {
          io.stderr("invalid workflow selection");
          return 2;
        }
        workflowName = workflowNames[selectedIndex - 1];
      }

      if (workflowName === undefined || !workflowNames.includes(workflowName)) {
        io.stderr(`workflow not found: ${workflowName ?? "(empty)"}`);
        return 1;
      }

      const userPrompt = await rl.question("Prompt: ");
      const customVariablesRaw = await rl.question(
        "Additional runtime variables JSON (optional): ",
      );
      let runtimeVariables: Readonly<Record<string, unknown>> = {
        ...optionRuntimeVariables,
        humanInput: userPrompt,
        userPrompt,
        prompt: userPrompt,
      };
      if (customVariablesRaw.trim().length > 0) {
        const parsed = JSON.parse(customVariablesRaw) as unknown;
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          io.stderr("additional runtime variables must be a JSON object");
          return 2;
        }
        runtimeVariables = {
          ...runtimeVariables,
          ...(parsed as Record<string, unknown>),
        };
      }

      let mockScenario: MockNodeScenario | undefined;
      if (parsedOptions.mockScenarioPath !== undefined) {
        mockScenario = await readMockScenario(parsedOptions.mockScenarioPath);
      } else {
        const loaded = await loadWorkflowFromCatalog(
          workflowName,
          sharedOptions,
        );
        if (!loaded.ok) {
          io.stderr(loaded.error.message);
          return loaded.error.code === "VALIDATION" ||
            loaded.error.code === "INVALID_WORKFLOW_NAME" ||
            loaded.error.code === "INVALID_SCOPE"
            ? 2
            : 1;
        }
        const defaultScenarioPath = path.join(
          loaded.value.workflowDirectory,
          "mock-scenario.json",
        );
        try {
          await stat(defaultScenarioPath);
          const useScenarioAnswer = await rl.question(
            `Use mock scenario file at ${defaultScenarioPath}? [Y/n]: `,
          );
          if (useScenarioAnswer.trim().toLowerCase() !== "n") {
            mockScenario = await readMockScenario(defaultScenarioPath);
          }
        } catch {
          // default scenario does not exist
        }
      }

      return runAndReportProgress(
        workflowName,
        runtimeVariables,
        mockScenario,
        undefined,
      );
    } finally {
      rl.close();
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    io.stderr(`tui failed: ${message}`);
    return 1;
  }
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

  if (scope === "gql") {
    const document = positionals.slice(1).join(" ").trim();
    if (document.length === 0) {
      io.stderr("GraphQL document is required");
      io.stderr("usage: divedra gql <graphql-document> [options]");
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
          response.errors.forEach((error) => io.stderr(error.message));
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

  if (scope === "serve" || (scope === "web" && command === "serve")) {
    const serveWorkflowName = scope === "web" ? target : command;
    try {
      const started = await deps.startServe({
        ...sharedOptions,
        ...(parsed.options.host === undefined
          ? {}
          : { host: parsed.options.host }),
        ...(parsed.options.port === undefined
          ? {}
          : { port: parsed.options.port }),
        ...(serveWorkflowName === undefined
          ? {}
          : { fixedWorkflowName: serveWorkflowName }),
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

  if (scope === "tui") {
    const resolvedWorkflowName = parsed.options.workflowName;
    if (
      command !== undefined &&
      resolvedWorkflowName !== undefined &&
      command.length > 0 &&
      command !== resolvedWorkflowName
    ) {
      io.stderr(
        `conflicting workflow names: positional='${command}' and --workflow='${resolvedWorkflowName}'`,
      );
      return 2;
    }
    return runTui(
      resolvedWorkflowName ?? command,
      parsed.options,
      sharedOptions,
      io,
      deps,
    );
  }

  if (scope === "call-node") {
    const workflowId = command;
    const workflowRunId = target;
    const nodeId = positionals[3];
    if (
      workflowId === undefined ||
      workflowRunId === undefined ||
      nodeId === undefined
    ) {
      io.stderr("workflow id, workflow run id, and node id are required");
      io.stderr(
        "usage: divedra call-node <workflow-id> <workflow-run-id> <node-id> [--message-json <json> | --message-file <path>] [options]",
      );
      return 2;
    }
    if (graphqlCliTransport !== null) {
      io.stderr(
        "call-node currently supports local execution only; omit --endpoint",
      );
      return 2;
    }

    let message: unknown;
    try {
      message = await readCallNodeMessage(parsed.options);
    } catch (error: unknown) {
      const messageText =
        error instanceof Error ? error.message : "unknown error";
      io.stderr(`failed to read call-node message: ${messageText}`);
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

    const result = await callNode({
      ...sharedOptions,
      workflowId,
      workflowRunId,
      nodeId,
      ...buildLocalCallNodeOverrides(parsed.options),
      ...mockScenarioOptions,
      ...(message === undefined ? {} : { message }),
    });

    if (!result.ok) {
      if (parsed.options.output === "json") {
        emitJson(io, result.error);
      } else {
        io.stderr(`call-node failed: ${result.error.message}`);
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
        nodeId,
        nodeExecId: result.value.nodeExecution.nodeExecId,
        status: result.value.nodeExecution.status,
        output: result.value.output,
        outputRef: result.value.outputRef,
        exitCode: result.value.exitCode,
      });
    } else {
      io.stdout(`sessionId: ${result.value.session.sessionId}`);
      io.stdout(`nodeId: ${nodeId}`);
      io.stdout(`nodeExecId: ${result.value.nodeExecution.nodeExecId}`);
      io.stdout(`status: ${result.value.nodeExecution.status}`);
    }
    return result.value.exitCode;
  }

  if (scope === undefined || command === undefined || target === undefined) {
    io.stderr("scope, command, and target are required");
    printHelp(io);
    return 2;
  }

  if (scope === "workflow") {
    if (command === "create") {
      const created = await createWorkflowTemplate(target, {
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
      const loaded = await loadWorkflowFromCatalog(target, sharedOptions);
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
      const loaded = await loadWorkflowFromCatalog(target, sharedOptions);
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

      const loadedWorkflowOptions = optionsForLoadedWorkflow(
        loaded.value,
        sharedOptions,
      );
      const summary = await buildInspectionSummary(
        loaded.value,
        loadedWorkflowOptions,
      );
      if (parsed.options.output === "json") {
        emitJson(io, {
          ...summary,
          source: workflowSourceJson(loaded.value.source),
        });
      } else {
        const legacySubWorkflowCountSegment =
          summary.counts.legacySubWorkflows === 0
            ? ""
            : `, legacySubWorkflows: ${summary.counts.legacySubWorkflows}`;
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
          `managerNodeId: ${summary.managerNodeId ?? "(none; worker-only workflow)"}`,
        );
        io.stdout(`entryNodeId: ${summary.entryNodeId}`);
        io.stdout(
          `nodes: ${summary.counts.nodes}, edges: ${summary.counts.edges}, loops: ${summary.counts.loops}, workflowCalls: ${summary.counts.workflowCalls}${legacySubWorkflowCountSegment}`,
        );
        if (summary.workflowCallIds.length > 0) {
          io.stdout(`workflowCallIds: ${summary.workflowCallIds.join(", ")}`);
        }
        if (summary.compatibility.notes.length > 0) {
          io.stdout("compatibility:");
          for (const note of summary.compatibility.notes) {
            io.stdout(`- ${note}`);
          }
        }
        io.stdout(
          `defaults: maxLoopIterations=${summary.defaults.maxLoopIterations}, nodeTimeoutMs=${summary.defaults.nodeTimeoutMs}`,
        );
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
          io.stderr(`failed to read --variables file: ${message}`);
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
                workflowName: target,
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
        target,
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

      const result = await runWorkflow(target, {
        ...workflowRunOptions,
        runtimeVariables,
        ...mockScenarioOptions,
        dryRun: parsed.options.dryRun,
        ...(parsed.options.maxSteps === undefined
          ? {}
          : { maxSteps: parsed.options.maxSteps }),
        ...(parsed.options.maxLoopIterations === undefined
          ? {}
          : { maxLoopIterations: parsed.options.maxLoopIterations }),
        ...(parsed.options.defaultTimeoutMs === undefined
          ? {}
          : { defaultTimeoutMs: parsed.options.defaultTimeoutMs }),
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
    if (command === "progress") {
      const session = await loadSession(target, sharedOptions);
      if (!session.ok) {
        io.stderr(session.error.message);
        return 1;
      }

      const countsByNode = session.value.nodeExecutionCounts;
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
          totalExecutions: session.value.nodeExecutionCounter,
          nodeSummaries,
          lastError: session.value.lastError ?? null,
        });
      } else {
        io.stdout(`sessionId: ${session.value.sessionId}`);
        io.stdout(`workflow: ${session.value.workflowName}`);
        io.stdout(`status: ${session.value.status}`);
        io.stdout(`currentNodeId: ${session.value.currentNodeId ?? "-"}`);
        io.stdout(`queue: ${session.value.queue.join(",") || "-"}`);
        io.stdout(`totalExecutions: ${session.value.nodeExecutionCounter}`);
        io.stdout("nodeProgress:");
        nodeSummaries.forEach((summary) => {
          io.stdout(
            `  - ${summary.nodeId}: executions=${summary.executions}, restarts=${summary.restarts}`,
          );
        });
      }
      return 0;
    }

    if (command === "status") {
      const session = await loadSession(target, sharedOptions);
      if (!session.ok) {
        io.stderr(session.error.message);
        return 1;
      }

      if (parsed.options.output === "json") {
        emitJson(io, session.value);
      } else {
        io.stdout(`sessionId: ${session.value.sessionId}`);
        io.stdout(`workflow: ${session.value.workflowName}`);
        io.stdout(`status: ${session.value.status}`);
        io.stdout(`currentNodeId: ${session.value.currentNodeId ?? "-"}`);
        io.stdout(`queueLength: ${session.value.queue.length}`);
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
                workflowExecutionId: target,
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
      const session = await loadSession(target, sharedOptions);
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
        ...sharedOptions,
        ...buildLocalWorkflowRunOverrides(parsed.options),
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

    if (command === "rerun") {
      const fromNodeId = positionals[3];
      if (fromNodeId === undefined) {
        io.stderr("node id is required for session rerun");
        io.stderr(
          "usage: divedra session rerun <session-id> <node-id> [options]",
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
                workflowExecutionId: target,
                nodeId: fromNodeId,
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
              sourceSessionId: target,
              sessionId,
              status,
              rerunFromNodeId: fromNodeId,
              exitCode,
            });
          } else {
            io.stdout(`sourceSessionId: ${target}`);
            io.stdout(`rerun session: ${sessionId}`);
            io.stdout(`rerunFromNodeId: ${fromNodeId}`);
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

      const source = await loadSession(target, sharedOptions);
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
        ...sharedOptions,
        ...buildLocalWorkflowRunOverrides(parsed.options),
        rerunFromSessionId: source.value.sessionId,
        rerunFromNodeId: fromNodeId,
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
          rerunFromNodeId: fromNodeId,
          exitCode: result.value.exitCode,
        });
      } else {
        io.stdout(`sourceSessionId: ${source.value.sessionId}`);
        io.stdout(`rerun session: ${result.value.session.sessionId}`);
        io.stdout(`rerunFromNodeId: ${fromNodeId}`);
        io.stdout(`status: ${result.value.session.status}`);
      }
      return result.value.exitCode;
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
        payload = await buildWorkflowExecutionExport(target, sharedOptions);
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
      const session = await loadSession(target, sharedOptions);
      if (!session.ok) {
        io.stderr(session.error.message);
        return 1;
      }

      const logs = await listRuntimeNodeLogs(target, sharedOptions);
      const format = parsed.options.format ?? parsed.options.output;
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
              sessionId: target,
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
          .forEach((line) => io.stdout(line));
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
