import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { atomicWriteJsonFile } from "../shared/fs";
import { resolveRootDataDir } from "../workflow/paths";
import type {
  HookEventSaveInput,
  HookEventStatus,
  HookEventStore,
} from "divedra-hook/recorder-contracts";
import type { LoadOptions } from "../workflow/types";
import { HookBlockError } from "./handler";
import { redactHookPayload } from "./redaction";
import { runtimeDbHookEventStore } from "./runtime-event-store";
import type {
  HookPayloadCaptureMode,
  HookResponse,
  ParsedHookContext,
} from "./types";

export interface HookEventRecorderOptions extends LoadOptions {
  readonly captureMode?: HookPayloadCaptureMode;
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly eventStore?: HookEventStore;
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96) || "hook";
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function buildHookEventId(now: string, idFactory: () => string): string {
  const compactTime = now.replace(/[^0-9]/g, "").slice(0, 14);
  return `hook-${compactTime}-${idFactory().slice(0, 12)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown hook error";
}

function buildArtifactRelativePath(input: {
  readonly workflowExecutionId: string;
  readonly nodeExecId: string;
  readonly agentSessionId: string;
  readonly hookEventId: string;
}): string {
  return path.posix.join(
    "hooks",
    safeSegment(input.workflowExecutionId),
    safeSegment(input.nodeExecId),
    safeSegment(input.agentSessionId),
    safeSegment(input.hookEventId),
    "payload.json",
  );
}

async function writePayloadArtifact(input: {
  readonly ctx: ParsedHookContext;
  readonly hookEventId: string;
  readonly captureMode: HookPayloadCaptureMode;
  readonly options: LoadOptions;
}): Promise<string | undefined> {
  if (
    input.ctx.divedra === undefined ||
    input.captureMode === "metadata-only"
  ) {
    return undefined;
  }

  const relativePath = buildArtifactRelativePath({
    workflowExecutionId: input.ctx.divedra.workflowExecutionId,
    nodeExecId: input.ctx.divedra.nodeExecId,
    agentSessionId: input.ctx.divedra.agentSessionId,
    hookEventId: input.hookEventId,
  });
  const payload =
    input.captureMode === "full"
      ? input.ctx.payload
      : redactHookPayload(input.ctx.payload);
  await atomicWriteJsonFile(
    path.join(resolveRootDataDir(input.options), relativePath),
    payload,
  );
  return JSON.stringify({ root: "artifact", path: relativePath });
}

function buildHookEventRow(input: {
  readonly ctx: ParsedHookContext;
  readonly hookEventId: string;
  readonly payloadHash: string;
  readonly payloadRefJson?: string;
  readonly response?: HookResponse;
  readonly status: HookEventStatus;
  readonly error?: string;
  readonly now: string;
}): HookEventSaveInput | undefined {
  const divedra = input.ctx.divedra;
  if (divedra === undefined) {
    return undefined;
  }
  return {
    hookEventId: input.hookEventId,
    workflowId: divedra.workflowId,
    workflowExecutionId: divedra.workflowExecutionId,
    nodeId: divedra.nodeId,
    nodeExecId: divedra.nodeExecId,
    ...(divedra.managerSessionId === undefined
      ? {}
      : { managerSessionId: divedra.managerSessionId }),
    vendor: input.ctx.vendor,
    agentSessionId: divedra.agentSessionId,
    rawEventName: input.ctx.rawEventName,
    eventName: input.ctx.eventName,
    cwd: input.ctx.payload.cwd,
    ...(input.ctx.payload.transcript_path === undefined
      ? {}
      : { transcriptPath: input.ctx.payload.transcript_path }),
    ...(input.ctx.payload.model === undefined
      ? {}
      : { model: input.ctx.payload.model }),
    ...(input.ctx.payload.turn_id === undefined
      ? {}
      : { turnId: input.ctx.payload.turn_id }),
    payloadHash: input.payloadHash,
    ...(input.payloadRefJson === undefined
      ? {}
      : { payloadRefJson: input.payloadRefJson }),
    ...(input.response === undefined
      ? {}
      : { responseJson: JSON.stringify(input.response) }),
    status: input.status,
    ...(input.error === undefined ? {} : { error: input.error }),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export async function recordHookEvent(
  input: {
    readonly ctx: ParsedHookContext;
    readonly response?: HookResponse;
    readonly status?: HookEventStatus;
    readonly error?: string;
  },
  options: HookEventRecorderOptions = {},
): Promise<void> {
  if (input.ctx.divedra === undefined) {
    return;
  }
  const now = options.now?.() ?? new Date().toISOString();
  const hookEventId = buildHookEventId(now, options.idFactory ?? randomUUID);
  const captureMode = options.captureMode ?? "redacted";
  const payloadHash = hashPayload(input.ctx.payload);
  const payloadRefJson = await writePayloadArtifact({
    ctx: input.ctx,
    hookEventId,
    captureMode,
    options,
  });
  const status =
    input.status ??
    (input.response?.decision === "block" ? "blocked" : "recorded");
  const row = buildHookEventRow({
    ctx: input.ctx,
    hookEventId,
    payloadHash,
    ...(payloadRefJson === undefined ? {} : { payloadRefJson }),
    ...(input.response === undefined ? {} : { response: input.response }),
    status,
    ...(input.error === undefined ? {} : { error: input.error }),
    now,
  });
  if (row !== undefined) {
    await (options.eventStore ?? runtimeDbHookEventStore).saveHookEvent(
      row,
      options,
    );
  }
}

export async function recordHookFailure(
  ctx: ParsedHookContext,
  error: unknown,
  options: HookEventRecorderOptions = {},
): Promise<void> {
  await recordHookEvent(
    {
      ctx,
      status: error instanceof HookBlockError ? "blocked" : "handler_failed",
      error: errorMessage(error),
    },
    options,
  );
}
