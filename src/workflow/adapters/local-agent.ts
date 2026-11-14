import {
  AdapterExecutionError,
  normalizeOutputContractEnvelope,
  parseJsonObjectCandidate,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
} from "../adapter";
import { normalizeTextBusinessPayload } from "../json-boundary";

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
