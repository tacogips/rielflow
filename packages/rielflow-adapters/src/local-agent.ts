import {
  AdapterExecutionError,
  normalizeOutputContractEnvelope,
  normalizeTextBusinessPayload,
  parseJsonObjectCandidate,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
} from "rielflow-core";
import {
  createWatchedLlmSession,
  type LlmSessionStallWatchConfig,
  type WatchedLlmSession,
} from "./llm-session-stall-watch";

const ALWAYS_TRUE_WHEN: Readonly<Record<string, boolean>> = Object.freeze({
  always: true,
});

let processEnvOverrideQueue: Promise<void> = Promise.resolve();

export function buildCombinedPromptText(
  input: Pick<AdapterExecutionInput, "promptText" | "systemPromptText">,
): string {
  if (
    input.systemPromptText === undefined ||
    input.systemPromptText.trim().length === 0
  ) {
    return input.promptText;
  }
  return `${input.systemPromptText}\n\n${input.promptText}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImageDescriptor(value: Readonly<Record<string, unknown>>): boolean {
  return (
    value["kind"] === "image" ||
    (typeof value["mediaType"] === "string" &&
      value["mediaType"].startsWith("image/")) ||
    (typeof value["contentType"] === "string" &&
      value["contentType"].startsWith("image/")) ||
    (typeof value["mimetype"] === "string" &&
      value["mimetype"].startsWith("image/"))
  );
}

function collectImagePathCandidates(input: {
  readonly value: unknown;
  readonly paths: string[];
  readonly seen: WeakSet<object>;
  readonly depth: number;
  readonly key?: string;
}): void {
  if (input.depth > 8) {
    return;
  }
  if (Array.isArray(input.value)) {
    if (input.key === "imagePaths") {
      for (const entry of input.value) {
        if (typeof entry === "string" && entry.length > 0) {
          input.paths.push(entry);
        }
      }
    }
    for (const entry of input.value) {
      collectImagePathCandidates({
        value: entry,
        paths: input.paths,
        seen: input.seen,
        depth: input.depth + 1,
      });
    }
    return;
  }
  if (!isRecord(input.value)) {
    return;
  }
  if (input.seen.has(input.value)) {
    return;
  }
  input.seen.add(input.value);
  if (isImageDescriptor(input.value)) {
    for (const key of ["localPath", "imagePath", "downloadPath"]) {
      const candidate = input.value[key];
      if (typeof candidate === "string" && candidate.length > 0) {
        input.paths.push(candidate);
      }
    }
    const source = input.value["source"];
    if (isRecord(source)) {
      for (const key of ["localPath", "imagePath", "downloadPath"]) {
        const candidate = source[key];
        if (typeof candidate === "string" && candidate.length > 0) {
          input.paths.push(candidate);
        }
      }
    }
  }
  for (const [key, child] of Object.entries(input.value)) {
    collectImagePathCandidates({
      value: child,
      paths: input.paths,
      seen: input.seen,
      depth: input.depth + 1,
      key,
    });
  }
}

export function resolveAdapterImagePaths(
  input: Pick<
    AdapterExecutionInput,
    "arguments" | "mergedVariables" | "node"
  >,
): readonly string[] {
  if (input.node.variables["forwardImageAttachments"] === false) {
    return [];
  }
  const paths: string[] = [];
  const seen = new WeakSet<object>();
  collectImagePathCandidates({
    value: input.mergedVariables,
    paths,
    seen,
    depth: 0,
  });
  collectImagePathCandidates({
    value: input.arguments,
    paths,
    seen,
    depth: 0,
  });
  return [...new Set(paths)];
}

export function buildAmbientProcessEnv(
  ...sources: ReadonlyArray<
    Readonly<Record<string, string | undefined>> | undefined
  >
): Readonly<Record<string, string>> | undefined {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    if (source === undefined) {
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "string" && value.length > 0) {
        merged[key] = value;
      }
    }
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}

export async function withProcessEnvOverride<T>(
  env: Readonly<Record<string, string | undefined>> | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (env === undefined || Object.keys(env).length === 0) {
    return await run();
  }

  let releaseQueue: (() => void) | undefined;
  const previousQueue = processEnvOverrideQueue;
  processEnvOverrideQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousQueue;

  const previousValues = new Map<string, string | undefined>();
  try {
    for (const [key, value] of Object.entries(env)) {
      previousValues.set(key, process.env[key]);
      if (typeof value === "string" && value.length > 0) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    return await run();
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    releaseQueue?.();
  }
}

export function bindAbortSignal(
  signal: AbortSignal,
  cancel: () => Promise<void>,
): () => void {
  const onAbort = () => {
    void cancel().catch(() => {
      return;
    });
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return () => {
    signal.removeEventListener("abort", onAbort);
  };
}

interface WatchedLocalSessionLike<TResult> {
  readonly sessionId: string;
  messages(): AsyncIterable<unknown>;
  waitForCompletion(): Promise<TResult>;
  cancel(): Promise<void>;
  getState?(): unknown;
}

export function createWatchedLocalAgentSession<
  TSession extends WatchedLocalSessionLike<TResult>,
  TResult,
>(input: {
  readonly provider: string;
  readonly primarySession: TSession;
  readonly signal: AbortSignal;
  readonly stallWatch: LlmSessionStallWatchConfig;
  readonly resumeSession: (
    sessionId: string,
    prompt: string,
  ) => Promise<TSession>;
  readonly isResultSuccess: (result: TResult) => boolean;
  readonly describeResult: (result: TResult) => string;
  readonly onProcessLog: (log: import("rielflow-core").AdapterProcessLog) => void;
}): WatchedLlmSession<TResult> {
  return createWatchedLlmSession<TSession, TResult>(input);
}

export function throwIfAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) {
    throw new AdapterExecutionError("timeout", message);
  }
}

export function buildLocalAdapterOutput(
  input: {
    readonly node: AdapterExecutionInput["node"];
    readonly output: AdapterExecutionInput["output"] | undefined;
  },
  options: {
    readonly provider: string;
    readonly promptText: string;
    readonly responseText: string;
    readonly backendSessionId?: string;
    readonly llmMessages?: AdapterExecutionOutput["llmMessages"];
  },
): AdapterExecutionOutput {
  if (input.output === undefined) {
    return {
      provider: options.provider,
      model: input.node.model,
      ...(input.node.effort === undefined ? {} : { effort: input.node.effort }),
      promptText: options.promptText,
      completionPassed: true,
      when: ALWAYS_TRUE_WHEN,
      payload: normalizeTextBusinessPayload(options.responseText),
      ...(options.backendSessionId === undefined
        ? {}
        : { backendSession: { sessionId: options.backendSessionId } }),
      ...(options.llmMessages === undefined
        ? {}
        : { llmMessages: options.llmMessages }),
    };
  }

  const parsedPayload = parseJsonObjectCandidate(
    options.responseText,
    `${options.provider} adapter`,
  );
  const normalizedPayload = normalizeOutputContractEnvelope(
    parsedPayload,
    `${options.provider} adapter output`,
  );

  return {
    provider: options.provider,
    model: input.node.model,
    ...(input.node.effort === undefined ? {} : { effort: input.node.effort }),
    promptText: options.promptText,
    completionPassed: normalizedPayload.completionPassed,
    when: normalizedPayload.when,
    payload: normalizedPayload.payload,
    ...(options.backendSessionId === undefined
      ? {}
      : { backendSession: { sessionId: options.backendSessionId } }),
    ...(options.llmMessages === undefined
      ? {}
      : { llmMessages: options.llmMessages }),
  };
}
