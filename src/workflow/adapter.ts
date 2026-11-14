import type { AmbientManagerControlPlaneEnvironment } from "./manager-session-store";
import type { NodeExecutionMailbox } from "./node-execution-mailbox";
import type { AgentNodePayload, JsonObject } from "./types";

export type AdapterFailureCode =
  | "provider_error"
  | "timeout"
  | "invalid_output"
  | "policy_blocked";

export interface AdapterExecutionContext {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface AdapterBackendSessionInput {
  readonly mode: "new" | "reuse";
  readonly sessionId?: string;
}

export interface AdapterBackendSessionOutput {
  readonly sessionId: string;
}

export interface AdapterLlmSessionMessage {
  readonly ordinal: number;
  readonly eventType: string;
  readonly role?: string;
  readonly contentText?: string;
  readonly rawMessageJson?: string;
  readonly backendSessionId?: string;
  readonly at?: string;
}

export interface AdapterExecutionInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly node: AgentNodePayload;
  readonly workingDirectory: string;
  readonly mergedVariables: Readonly<Record<string, unknown>>;
  readonly systemPromptText?: string;
  readonly promptText: string;
  readonly arguments: Readonly<Record<string, unknown>> | null;
  readonly executionIndex: number;
  readonly artifactDir: string;
  readonly upstreamCommunicationIds: readonly string[];
  readonly executionMailbox?: NodeExecutionMailbox;
  readonly backendSession?: AdapterBackendSessionInput;
  readonly divedraHookContext?: AdapterDivedraHookContext;
  readonly ambientManagerContext?: AdapterAmbientManagerContext;
  readonly output?: AdapterOutputContractInput;
}

export interface AdapterAmbientManagerContext {
  readonly environment: AmbientManagerControlPlaneEnvironment;
}

export interface AdapterDivedraHookContext {
  readonly environment: {
    readonly DIVEDRA_WORKFLOW_ID: string;
    readonly DIVEDRA_WORKFLOW_EXECUTION_ID: string;
    readonly DIVEDRA_NODE_ID: string;
    readonly DIVEDRA_NODE_EXEC_ID: string;
    readonly DIVEDRA_MAILBOX_DIR?: string;
    readonly DIVEDRA_AGENT_BACKEND?: string;
  };
}

export function buildAdapterDivedraHookContext(input: {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly mailboxDir?: string;
  readonly agentBackend?: string;
}): AdapterDivedraHookContext {
  return {
    environment: {
      DIVEDRA_WORKFLOW_ID: input.workflowId,
      DIVEDRA_WORKFLOW_EXECUTION_ID: input.workflowExecutionId,
      DIVEDRA_NODE_ID: input.nodeId,
      DIVEDRA_NODE_EXEC_ID: input.nodeExecId,
      ...(input.mailboxDir === undefined
        ? {}
        : { DIVEDRA_MAILBOX_DIR: input.mailboxDir }),
      ...(input.agentBackend === undefined
        ? {}
        : { DIVEDRA_AGENT_BACKEND: input.agentBackend }),
    },
  };
}

export interface AdapterOutputContractInput {
  readonly description?: string;
  readonly jsonSchema?: JsonObject;
  readonly maxValidationAttempts: number;
  readonly attempt: number;
  readonly candidatePath: string;
  readonly validationErrors: readonly AdapterOutputValidationError[];
  readonly publication: AdapterOutputPublicationPolicy;
}

export interface AdapterOutputValidationError {
  readonly path: string;
  readonly message: string;
}

export interface AdapterOutputPublicationPolicy {
  readonly owner: "runtime";
  readonly finalArtifactWrite: "runtime-only";
  readonly mailboxWrite: "runtime-only-after-validation";
  readonly candidateSubmission: "inline-json-or-reserved-candidate-file";
  readonly futureCommunicationIdsExposed: false;
}

export interface AdapterExecutionOutput {
  readonly provider: string;
  readonly model: string;
  readonly promptText: string;
  readonly completionPassed: boolean;
  readonly when: Readonly<Record<string, boolean>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly backendSession?: AdapterBackendSessionOutput;
  readonly candidateFilePath?: string;
  readonly processLogs?: readonly AdapterProcessLog[];
  readonly llmMessages?: readonly AdapterLlmSessionMessage[];
}

export interface AdapterProcessLog {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
  readonly label?: string;
}

export class AdapterExecutionError extends Error {
  readonly code: AdapterFailureCode;
  readonly processLogs?: readonly AdapterProcessLog[];

  constructor(
    code: AdapterFailureCode,
    message: string,
    options: {
      readonly processLogs?: readonly AdapterProcessLog[];
    } = {},
  ) {
    super(message);
    this.code = code;
    if (options.processLogs !== undefined) {
      this.processLogs = options.processLogs;
    }
  }
}

function isBooleanMap(
  value: unknown,
): value is Readonly<Record<string, boolean>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "boolean");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type AdapterExecutionOutputEnvelope = Pick<
  AdapterExecutionOutput,
  "provider" | "model" | "promptText" | "completionPassed" | "when" | "payload"
>;

export function isAdapterExecutionOutputEnvelope(
  value: unknown,
): value is AdapterExecutionOutputEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["provider"] === "string" &&
    value["provider"].length > 0 &&
    typeof value["model"] === "string" &&
    value["model"].length > 0 &&
    typeof value["promptText"] === "string" &&
    typeof value["completionPassed"] === "boolean" &&
    isBooleanMap(value["when"]) &&
    isRecord(value["payload"])
  );
}

function extractJsonObjectCandidateText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  if (isCompleteJson(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("{")) {
    const candidate = extractBalancedJsonObject(trimmed, 0);
    return candidate ?? trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/u);
  if (fencedMatch?.[1] !== undefined) {
    return fencedMatch[1].trim();
  }

  const embeddedCandidate = findFirstJsonObjectCandidate(trimmed);
  if (embeddedCandidate !== null) {
    return embeddedCandidate;
  }

  return trimmed;
}

function isCompleteJson(text: string): boolean {
  try {
    JSON.parse(text) as unknown;
    return true;
  } catch {
    return false;
  }
}

function findFirstJsonObjectCandidate(text: string): string | null {
  let searchStart = 0;
  while (searchStart < text.length) {
    const objectStart = text.indexOf("{", searchStart);
    if (objectStart < 0) {
      return null;
    }

    const candidate = extractBalancedJsonObject(text, objectStart);
    if (candidate === null) {
      return null;
    }
    if (isJsonObjectText(candidate)) {
      return candidate;
    }

    searchStart = objectStart + 1;
  }

  return null;
}

function isJsonObjectText(text: string): boolean {
  try {
    return isRecord(JSON.parse(text) as unknown);
  } catch {
    return false;
  }
}

function extractBalancedJsonObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === undefined) {
      break;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char !== "}") {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return text.slice(start, index + 1);
    }
  }

  return null;
}

export function parseJsonObjectCandidate(
  text: string,
  source: string,
): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObjectCandidateText(text)) as unknown;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown JSON parse error";
    throw new AdapterExecutionError(
      "invalid_output",
      `${source} must return a JSON object: ${message}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new AdapterExecutionError(
      "invalid_output",
      `${source} must return a top-level JSON object`,
    );
  }

  return parsed;
}

export function normalizeAdapterOutput(
  value: unknown,
  fallbackModel: string,
): AdapterExecutionOutput {
  if (!isRecord(value)) {
    throw new AdapterExecutionError(
      "invalid_output",
      "adapter output must be an object",
    );
  }

  const provider = value["provider"];
  const model = value["model"];
  const promptText = value["promptText"];
  const completionPassed = value["completionPassed"];
  const when = value["when"];
  const payload = value["payload"];
  const candidateFilePath = value["candidateFilePath"];
  const backendSession = value["backendSession"];

  if (typeof provider !== "string" || provider.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      "adapter output.provider must be a non-empty string",
    );
  }
  if (typeof promptText !== "string") {
    throw new AdapterExecutionError(
      "invalid_output",
      "adapter output.promptText must be a string",
    );
  }
  if (typeof completionPassed !== "boolean") {
    throw new AdapterExecutionError(
      "invalid_output",
      "adapter output.completionPassed must be a boolean",
    );
  }
  if (!isBooleanMap(when)) {
    throw new AdapterExecutionError(
      "invalid_output",
      "adapter output.when must be an object<boolean>",
    );
  }
  if (
    candidateFilePath !== undefined &&
    (typeof candidateFilePath !== "string" || candidateFilePath.length === 0)
  ) {
    throw new AdapterExecutionError(
      "invalid_output",
      "adapter output.candidateFilePath must be a non-empty string",
    );
  }
  if (
    backendSession !== undefined &&
    (!isRecord(backendSession) ||
      typeof backendSession["sessionId"] !== "string" ||
      backendSession["sessionId"].length === 0)
  ) {
    throw new AdapterExecutionError(
      "invalid_output",
      "adapter output.backendSession.sessionId must be a non-empty string",
    );
  }
  if (!isRecord(payload) && typeof candidateFilePath !== "string") {
    throw new AdapterExecutionError(
      "invalid_output",
      "adapter output.payload must be an object",
    );
  }

  return {
    provider,
    model:
      typeof model === "string" && model.length > 0 ? model : fallbackModel,
    promptText,
    completionPassed,
    when,
    payload: isRecord(payload) ? payload : {},
    ...(isRecord(backendSession)
      ? { backendSession: { sessionId: String(backendSession["sessionId"]) } }
      : {}),
    ...(typeof candidateFilePath === "string" ? { candidateFilePath } : {}),
  };
}

export interface OutputContractEnvelopeNormalization {
  readonly completionPassed: boolean;
  readonly when: Readonly<Record<string, boolean>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly usedEnvelope: boolean;
}

export function normalizeOutputContractEnvelope(
  value: Readonly<Record<string, unknown>>,
  source: string,
  defaults: {
    readonly completionPassed: boolean;
    readonly when: Readonly<Record<string, boolean>>;
  } = {
    completionPassed: true,
    when: { always: true },
  },
): OutputContractEnvelopeNormalization {
  const when = value["when"];
  if (when === undefined) {
    return {
      completionPassed: defaults.completionPassed,
      when: defaults.when,
      payload: value,
      usedEnvelope: false,
    };
  }

  if (!isBooleanMap(when)) {
    throw new AdapterExecutionError(
      "invalid_output",
      `${source}.when must be an object<boolean> when provided`,
    );
  }

  const payload = value["payload"];
  if (!isRecord(payload)) {
    throw new AdapterExecutionError(
      "invalid_output",
      `${source}.payload must be an object when when is provided`,
    );
  }

  const completionPassed = value["completionPassed"];
  if (completionPassed !== undefined && typeof completionPassed !== "boolean") {
    throw new AdapterExecutionError(
      "invalid_output",
      `${source}.completionPassed must be a boolean when provided`,
    );
  }

  return {
    completionPassed:
      typeof completionPassed === "boolean"
        ? completionPassed
        : defaults.completionPassed,
    when,
    payload,
    usedEnvelope: true,
  };
}

export interface NodeAdapter {
  execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput>;
}

export class DeterministicNodeAdapter implements NodeAdapter {
  async execute(
    input: AdapterExecutionInput,
    _context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput> {
    return {
      provider: "deterministic-local",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      when: { always: true },
      payload: {
        workflowId: input.workflowId,
        workflowExecutionId: input.workflowExecutionId,
        nodeId: input.nodeId,
        nodeExecId: input.nodeExecId,
        renderedLength: input.promptText.length,
      },
    };
  }
}
