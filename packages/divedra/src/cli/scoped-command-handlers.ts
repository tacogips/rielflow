import {
  createEventListenerService,
  loadAndValidateEventConfiguration,
} from "../../../../src/events";
import { emitEventFile } from "../../../../src/events/manual-emit";
import { listEventReceipts, replayEventReceipt } from "../../../../src/events/receipt-ops";
import { createWorkflowScheduleRepository } from "../../../../src/events/workflow-schedule-registry";
import type { WorkflowScheduleStatus } from "../../../../src/events/types";
import {
  DEFAULT_GRAPHQL_ENDPOINT,
  executeGraphqlRequest,
} from "../../../../src/graphql/client";
import { buildHookConfigurationSnippet } from "../../../../src/hook/config";
import { parseHookVendorOption } from "../../../../src/hook/detect-vendor";
import { createReadHookStdin, runHookCommand } from "../../../../src/hook/index";
import { callStep } from "../../../../src/workflow/call-step";
import { resolveWorkflowSource } from "../../../../src/workflow/catalog";
import { listEventReplyDispatchesFromRuntimeDb } from "../../../../src/workflow/runtime-db";
import type { MockNodeScenario } from "../../../../src/workflow/scenario-adapter";
import type { LoadOptions, ResolvedWorkflowSource } from "../../../../src/workflow/types";
import type { RunCliScopeContext } from "./storage-and-options";
import {
  DEFAULT_DEPS,
  HOOK_VENDOR_EXPECTED,
  HOOK_VENDOR_USAGE,
  parseEnvBooleanFlag,
  parseReplyDispatchStatus,
} from "./storage-and-options";
import {
  emitJson,
  formatValidationIssues,
  printHelp,
  readDirectCallMessage,
  readGraphqlVariables,
  readMockScenarioOption,
} from "./input-output-helpers";
import { buildLocalCallStepOverrides } from "./workflow-graphql-formatters";

const WORKFLOW_SCHEDULE_STATUSES = new Set<WorkflowScheduleStatus>([
  "active",
  "paused",
  "completed",
  "cancelled",
  "failed",
]);

function parseWorkflowScheduleStatus(
  value: string | undefined,
): WorkflowScheduleStatus | undefined {
  return value !== undefined && WORKFLOW_SCHEDULE_STATUSES.has(value as WorkflowScheduleStatus)
    ? (value as WorkflowScheduleStatus)
    : undefined;
}

export async function runCliGraphqlScope(
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
export async function runCliHookScope(
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
export async function runCliEventsScope(
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
      const message = error instanceof Error ? error.message : "unknown error";
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
      const message = error instanceof Error ? error.message : "unknown error";
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
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`events emit failed: ${message}`);
      return 1;
    }
  }

  if (command === "schedules") {
    const schedulesCommand = target;
    const scheduleId = positionals[3];
    const repository = createWorkflowScheduleRepository(eventOptions);
    if (schedulesCommand === "list") {
      const status = parseWorkflowScheduleStatus(parsed.options.status);
      if (parsed.options.status !== undefined && status === undefined) {
        io.stderr(
          "--status must be one of active, paused, completed, cancelled, or failed",
        );
        return 2;
      }
      try {
        const schedules = await repository.list({
          ...(parsed.options.sourceId === undefined
            ? {}
            : { sourceId: parsed.options.sourceId }),
          ...(status === undefined ? {} : { status }),
          ...(parsed.options.limit === undefined
            ? {}
            : { limit: parsed.options.limit }),
        });
        if (parsed.options.output === "json") {
          emitJson(io, { schedules });
        } else {
          for (const schedule of schedules) {
            io.stdout(
              [
                `schedule: ${schedule.scheduleId}`,
                `source: ${schedule.sourceId}`,
                `status: ${schedule.status}`,
                `workflow: ${schedule.workflowName}`,
                `kind: ${schedule.kind}`,
                `nextDueAt: ${schedule.nextDueAt}`,
              ].join(" "),
            );
          }
        }
        return 0;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        io.stderr(`events schedules list failed: ${message}`);
        return 1;
      }
    }
    if (schedulesCommand === "inspect") {
      if (scheduleId === undefined) {
        io.stderr("schedule id is required");
        io.stderr("usage: divedra events schedules inspect <schedule-id>");
        return 2;
      }
      try {
        const schedule = await repository.load(scheduleId);
        if (schedule === null) {
          io.stderr(`workflow schedule not found: ${scheduleId}`);
          return 1;
        }
        if (parsed.options.output === "json") {
          emitJson(io, { schedule });
        } else {
          io.stdout(`schedule: ${schedule.scheduleId}`);
          io.stdout(`status: ${schedule.status}`);
          io.stdout(`workflow: ${schedule.workflowName}`);
          io.stdout(`kind: ${schedule.kind}`);
          io.stdout(`timezone: ${schedule.timezone}`);
          io.stdout(`nextDueAt: ${schedule.nextDueAt}`);
          io.stdout(`sourceReceiptId: ${schedule.sourceReceiptId}`);
        }
        return 0;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        io.stderr(`events schedules inspect failed: ${message}`);
        return 1;
      }
    }
    if (schedulesCommand === "cancel") {
      if (scheduleId === undefined) {
        io.stderr("schedule id is required");
        io.stderr(
          "usage: divedra events schedules cancel <schedule-id> [--reason <text>]",
        );
        return 2;
      }
      try {
        const schedule = await repository.cancel({
          scheduleId,
          ...(parsed.options.reason === undefined
            ? {}
            : { reason: parsed.options.reason }),
        });
        if (parsed.options.output === "json") {
          emitJson(io, { schedule });
        } else {
          io.stdout(
            `schedule: ${schedule.scheduleId} status: ${schedule.status}`,
          );
        }
        return 0;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        io.stderr(`events schedules cancel failed: ${message}`);
        return 1;
      }
    }
    io.stderr("unknown events schedules command");
    io.stderr(
      "usage: divedra events schedules <list|inspect|cancel> [schedule-id]",
    );
    return 2;
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
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`events list failed: ${message}`);
      return 1;
    }
  }

  if (command === "replies") {
    const status = parseReplyDispatchStatus(parsed.options.status);
    if (parsed.options.status !== undefined && status === undefined) {
      io.stderr("--status must be one of dispatching, sent, queued, or failed");
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
      const message = error instanceof Error ? error.message : "unknown error";
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
      return result.receipts.some((entry) => entry.receipt.status === "failed")
        ? 1
        : 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
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
      const message = error instanceof Error ? error.message : "unknown error";
      io.stderr(`events serve failed: ${message}`);
      return 7;
    }
  }

  io.stderr(`unknown events command: ${command ?? "(empty)"}`);
  printHelp(io);
  return 2;
}
export async function runCliServeScope(
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
export async function runCliCallStepScope(
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
