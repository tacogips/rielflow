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

export interface AdapterExecutionInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly node: AgentNodePayload;
  readonly mergedVariables: Readonly<Record<string, unknown>>;
  readonly systemPromptText?: string;
  readonly promptText: string;
  readonly arguments: Readonly<Record<string, unknown>> | null;
  readonly executionIndex: number;
  readonly artifactDir: string;
  readonly upstreamCommunicationIds: readonly string[];
  readonly executionMailbox?: NodeExecutionMailbox;
  readonly backendSession?: AdapterBackendSessionInput;
  readonly ambientManagerContext?: AdapterAmbientManagerContext;
  readonly output?: AdapterOutputContractInput;
}

export interface AdapterAmbientManagerContext {
  readonly environment: AmbientManagerControlPlaneEnvironment;
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
}

export class AdapterExecutionError extends Error {
  readonly code: AdapterFailureCode;

  constructor(code: AdapterFailureCode, message: string) {
    super(message);
    this.code = code;
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

function extractJsonObjectCandidateText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  if (fencedMatch?.[1] !== undefined) {
    return fencedMatch[1].trim();
  }

  return trimmed;
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

export interface NodeAdapter {
  execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput>;
}

export interface MockNodeResponse {
  readonly provider?: string;
  readonly model?: string;
  readonly promptText?: string;
  readonly completionPassed?: boolean;
  readonly when?: Readonly<Record<string, boolean>>;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly fail?: boolean;
}

export type MockNodeScenarioEntry =
  | MockNodeResponse
  | readonly MockNodeResponse[];
export type MockNodeScenario = Readonly<Record<string, MockNodeScenarioEntry>>;

function resolveScenarioEntry(
  entry: MockNodeScenarioEntry,
  attemptIndex: number,
): MockNodeResponse {
  if (Array.isArray(entry)) {
    if (entry.length === 0) {
      return {};
    }
    const selected = entry[Math.min(attemptIndex - 1, entry.length - 1)];
    return selected ?? {};
  }
  return entry as MockNodeResponse;
}

function resolveScenarioSequenceIndex(input: AdapterExecutionInput): number {
  if (input.output === undefined) {
    return input.executionIndex;
  }
  return (
    (input.executionIndex - 1) * input.output.maxValidationAttempts +
    input.output.attempt
  );
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

export class ScenarioNodeAdapter implements NodeAdapter {
  readonly #fallback: NodeAdapter;
  readonly #scenario: MockNodeScenario;

  constructor(
    scenario: MockNodeScenario,
    fallback: NodeAdapter = new DeterministicNodeAdapter(),
  ) {
    this.#scenario = scenario;
    this.#fallback = fallback;
  }

  async execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput> {
    const scenarioEntry = this.#scenario[input.nodeId];
    if (scenarioEntry === undefined) {
      return this.#fallback.execute(input, context);
    }

    const sequenceIndex = resolveScenarioSequenceIndex(input);
    const response = resolveScenarioEntry(scenarioEntry, sequenceIndex);
    if (response.fail === true) {
      throw new Error(`scenario forced failure for node '${input.nodeId}'`);
    }

    return {
      provider: response.provider ?? "scenario-mock",
      model: response.model ?? input.node.model,
      promptText: response.promptText ?? input.promptText,
      completionPassed: response.completionPassed ?? true,
      when: response.when ?? { always: true },
      payload: response.payload ?? {},
    };
  }
}
