import type {
  DivedraHookContext,
  HookInputPayload,
  HookPayloadCaptureMode,
  HookRecordingMode,
} from "./types";

export interface HookRecordingControls {
  readonly recordingMode: HookRecordingMode;
  readonly strict: boolean;
  readonly captureMode: HookPayloadCaptureMode;
}

export class HookContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookContextError";
  }
}

function readEnvValue(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = env[key];
  return value === undefined || value.length === 0 ? undefined : value;
}

function parseRecordingMode(value: string | undefined): HookRecordingMode {
  if (value === undefined || value.length === 0) {
    return "auto";
  }
  if (value === "auto" || value === "off" || value === "required") {
    return value;
  }
  throw new HookContextError(
    `DIVEDRA_HOOK_RECORDING must be 'auto', 'off', or 'required'`,
  );
}

function parseCaptureMode(value: string | undefined): HookPayloadCaptureMode {
  if (value === undefined || value.length === 0) {
    return "redacted";
  }
  if (value === "redacted" || value === "metadata-only" || value === "full") {
    return value;
  }
  throw new HookContextError(
    `DIVEDRA_HOOK_CAPTURE_RAW must be 'redacted', 'metadata-only', or 'full'`,
  );
}

function parseBoolean(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

export function resolveHookRecordingControls(
  env: Readonly<Record<string, string | undefined>> = process.env,
): HookRecordingControls {
  return {
    recordingMode: parseRecordingMode(
      readEnvValue(env, "DIVEDRA_HOOK_RECORDING"),
    ),
    strict: parseBoolean(readEnvValue(env, "DIVEDRA_HOOK_STRICT")),
    captureMode: parseCaptureMode(
      readEnvValue(env, "DIVEDRA_HOOK_CAPTURE_RAW"),
    ),
  };
}

export function resolveDivedraHookContext(input: {
  readonly payload: HookInputPayload;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly controls?: HookRecordingControls;
}): DivedraHookContext | undefined {
  const env = input.env ?? process.env;
  const controls = input.controls ?? resolveHookRecordingControls(env);
  if (controls.recordingMode === "off") {
    return undefined;
  }

  const workflowId = readEnvValue(env, "DIVEDRA_WORKFLOW_ID");
  const workflowExecutionId = readEnvValue(
    env,
    "DIVEDRA_WORKFLOW_EXECUTION_ID",
  );
  const nodeId =
    readEnvValue(env, "DIVEDRA_NODE_ID") ??
    readEnvValue(env, "DIVEDRA_MANAGER_NODE_ID");
  const nodeExecId =
    readEnvValue(env, "DIVEDRA_NODE_EXEC_ID") ??
    readEnvValue(env, "DIVEDRA_MANAGER_NODE_EXEC_ID");

  if (
    workflowId === undefined ||
    workflowExecutionId === undefined ||
    nodeId === undefined ||
    nodeExecId === undefined
  ) {
    if (controls.recordingMode === "required") {
      throw new HookContextError(
        "missing divedra hook context; required env vars are DIVEDRA_WORKFLOW_ID, DIVEDRA_WORKFLOW_EXECUTION_ID, DIVEDRA_NODE_ID, and DIVEDRA_NODE_EXEC_ID",
      );
    }
    return undefined;
  }

  const managerSessionId = readEnvValue(env, "DIVEDRA_MANAGER_SESSION_ID");
  const agentBackend = readEnvValue(env, "DIVEDRA_AGENT_BACKEND");
  return {
    workflowId,
    workflowExecutionId,
    nodeId,
    nodeExecId,
    agentSessionId: input.payload.session_id,
    ...(managerSessionId === undefined ? {} : { managerSessionId }),
    ...(agentBackend === undefined ? {} : { agentBackend }),
  };
}
