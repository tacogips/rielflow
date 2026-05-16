import type { AdapterProcessLog } from "divedra-core";

const DEFAULT_STALL_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_STALL_NUDGE_MAX_ATTEMPTS = 3;
const DEFAULT_STALL_NUDGE_PROMPT =
  "Your divedra workflow session appears stalled because the raw SDK session has not changed during the stall-check interval. Continue the assigned workflow step now and return the required output when ready.";
const STALL_CHECK_INTERVAL_ENV = "DIVEDRA_LLM_STALL_CHECK_INTERVAL_MS";
const STALL_NUDGE_MAX_ATTEMPTS_ENV = "DIVEDRA_LLM_STALL_NUDGE_MAX_ATTEMPTS";
const STALL_NUDGE_PROMPT_ENV = "DIVEDRA_LLM_STALL_NUDGE_PROMPT";

type WatchedSessionSource = "primary" | "nudge";

interface WatchedSessionLike<TResult> {
  readonly sessionId: string;
  messages(): AsyncIterable<unknown>;
  waitForCompletion(): Promise<TResult>;
  cancel(): Promise<void>;
  getState?(): unknown;
}

export interface LlmSessionStallWatchConfig {
  readonly stallCheckIntervalMs?: number;
  readonly stallNudgePrompt?: string;
  readonly stallNudgeMaxAttempts?: number;
}

export interface WatchedLlmSessionMessage {
  readonly value: unknown;
  readonly sessionId: string;
  readonly source: WatchedSessionSource;
}

export interface WatchedLlmSession<TResult> {
  readonly messages: AsyncIterable<unknown>;
  waitForCompletion(): Promise<TResult>;
  stop(): void;
}

interface CreateWatchedLlmSessionInput<TSession, TResult> {
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
  readonly onProcessLog: (log: AdapterProcessLog) => void;
}

interface ActivitySnapshot {
  readonly messageCount: number;
  readonly rawSignature: string;
  readonly stateSignature: string;
}

class AsyncMessageQueue {
  readonly #items: unknown[] = [];
  #closed = false;
  #resolveWaiter: (() => void) | undefined;

  push(item: unknown): void {
    if (this.#closed) {
      return;
    }
    this.#items.push(item);
    this.#wake();
  }

  close(): void {
    this.#closed = true;
    this.#wake();
  }

  async *iterable(): AsyncIterable<unknown> {
    while (!this.#closed || this.#items.length > 0) {
      while (this.#items.length > 0) {
        const item = this.#items.shift();
        if (item !== undefined) {
          yield item;
        }
      }
      if (this.#closed) {
        break;
      }
      await new Promise<void>((resolve) => {
        this.#resolveWaiter = resolve;
      });
    }
  }

  #wake(): void {
    const resolveWaiter = this.#resolveWaiter;
    this.#resolveWaiter = undefined;
    resolveWaiter?.();
  }
}

export function createWatchedLlmSession<
  TSession extends WatchedSessionLike<TResult>,
  TResult,
>(
  input: CreateWatchedLlmSessionInput<TSession, TResult>,
): WatchedLlmSession<TResult> {
  const queue = new AsyncMessageQueue();
  const checkIntervalMs = resolvePositiveInteger(
    input.stallWatch.stallCheckIntervalMs ??
      readNumberEnvironmentVariable(STALL_CHECK_INTERVAL_ENV),
    DEFAULT_STALL_CHECK_INTERVAL_MS,
  );
  const nudgeMaxAttempts = resolveNonNegativeInteger(
    input.stallWatch.stallNudgeMaxAttempts ??
      readNumberEnvironmentVariable(STALL_NUDGE_MAX_ATTEMPTS_ENV),
    DEFAULT_STALL_NUDGE_MAX_ATTEMPTS,
  );
  const nudgePrompt =
    input.stallWatch.stallNudgePrompt ??
    readStringEnvironmentVariable(STALL_NUDGE_PROMPT_ENV) ??
    DEFAULT_STALL_NUDGE_PROMPT;
  const sessionStates = new Map<string, string>();
  let messageCount = 0;
  let rawSignature = "none";
  let completed = false;
  let nudgeCount = 0;
  let nudgeInFlight = 0;
  let latestFailure: TResult | undefined;
  let previousSnapshot = buildActivitySnapshot(
    messageCount,
    rawSignature,
    input.primarySession,
    sessionStates,
  );

  let resolveCompletion: ((result: TResult) => void) | undefined;
  const completionPromise = new Promise<TResult>((resolve) => {
    resolveCompletion = resolve;
  });

  const settle = (result: TResult): void => {
    if (completed) {
      return;
    }
    completed = true;
    clearInterval(stallTimer);
    queue.close();
    resolveCompletion?.(result);
    resolveCompletion = undefined;
  };

  const recordRawMessage = (session: TSession, value: unknown): void => {
    messageCount += 1;
    rawSignature = stringifyUnknown(value) ?? `message-${messageCount}`;
    sessionStates.set(session.sessionId, readSessionStateSignature(session));
    queue.push(value);
  };

  const finishSession = (
    session: TSession,
    source: WatchedSessionSource,
    result: TResult,
  ): void => {
    const success = input.isResultSuccess(result);
    sessionStates.set(
      session.sessionId,
      `completed:${success ? "success" : "failure"}:${input.describeResult(result)}`,
    );
    input.onProcessLog({
      stream: success ? "stdout" : "stderr",
      label: `${input.provider}-stall-watch`,
      text: `${source} SDK session '${session.sessionId}' completed after stall-watch observation: ${input.describeResult(result)}\n`,
    });
    if (success) {
      settle(result);
      return;
    }
    latestFailure = result;
    if (source === "primary" && nudgeInFlight === 0) {
      settle(result);
      return;
    }
    if (
      source === "nudge" &&
      nudgeInFlight === 0 &&
      nudgeCount >= nudgeMaxAttempts &&
      latestFailure !== undefined
    ) {
      settle(latestFailure);
    }
  };

  const pumpSession = (
    session: TSession,
    source: WatchedSessionSource,
  ): void => {
    sessionStates.set(session.sessionId, readSessionStateSignature(session));
    void (async () => {
      try {
        for await (const message of session.messages()) {
          recordRawMessage(session, message);
        }
        const result = await session.waitForCompletion();
        finishSession(session, source, result);
      } catch (error) {
        input.onProcessLog({
          stream: "stderr",
          label: `${input.provider}-stall-watch`,
          text: `${source} SDK session '${session.sessionId}' observation failed: ${errorToMessage(error)}\n`,
        });
      } finally {
        if (source === "nudge") {
          nudgeInFlight = Math.max(0, nudgeInFlight - 1);
        }
      }
    })();
  };

  const sendStallNudge = (): void => {
    if (
      completed ||
      input.signal.aborted ||
      nudgeInFlight > 0 ||
      nudgeCount >= nudgeMaxAttempts
    ) {
      return;
    }
    nudgeCount += 1;
    nudgeInFlight += 1;
    const targetSessionId = input.primarySession.sessionId;
    input.onProcessLog({
      stream: "stderr",
      label: `${input.provider}-stall-watch`,
      text: `Raw SDK session '${targetSessionId}' was unchanged for ${checkIntervalMs}ms; sending stall nudge ${nudgeCount}/${nudgeMaxAttempts}.\n`,
    });
    void (async () => {
      try {
        const resumed = await input.resumeSession(targetSessionId, nudgePrompt);
        sessionStates.set(
          resumed.sessionId,
          readSessionStateSignature(resumed),
        );
        pumpSession(resumed, "nudge");
      } catch (error) {
        nudgeInFlight = Math.max(0, nudgeInFlight - 1);
        input.onProcessLog({
          stream: "stderr",
          label: `${input.provider}-stall-watch`,
          text: `Failed to send stall nudge to SDK session '${targetSessionId}': ${errorToMessage(error)}\n`,
        });
      }
    })();
  };

  const observeStall = (): void => {
    if (completed || input.signal.aborted) {
      return;
    }
    const currentSnapshot = buildActivitySnapshot(
      messageCount,
      rawSignature,
      input.primarySession,
      sessionStates,
    );
    if (sameActivitySnapshot(previousSnapshot, currentSnapshot)) {
      sendStallNudge();
      return;
    }
    previousSnapshot = currentSnapshot;
  };

  const stallTimer = setInterval(observeStall, checkIntervalMs);
  pumpSession(input.primarySession, "primary");

  const stop = (): void => {
    completed = true;
    clearInterval(stallTimer);
    queue.close();
  };

  input.signal.addEventListener("abort", stop, { once: true });

  return {
    messages: queue.iterable(),
    waitForCompletion: async () => await completionPromise,
    stop: () => {
      input.signal.removeEventListener("abort", stop);
      stop();
    },
  };
}

function buildActivitySnapshot<TSession extends WatchedSessionLike<unknown>>(
  messageCount: number,
  rawSignature: string,
  primarySession: TSession,
  sessionStates: ReadonlyMap<string, string>,
): ActivitySnapshot {
  return {
    messageCount,
    rawSignature,
    stateSignature:
      sessionStates.get(primarySession.sessionId) ??
      readSessionStateSignature(primarySession),
  };
}

function sameActivitySnapshot(
  left: ActivitySnapshot,
  right: ActivitySnapshot,
): boolean {
  return (
    left.messageCount === right.messageCount &&
    left.rawSignature === right.rawSignature &&
    left.stateSignature === right.stateSignature
  );
}

function readSessionStateSignature(
  session: WatchedSessionLike<unknown>,
): string {
  if (session.getState === undefined) {
    return "running";
  }
  return stringifyUnknown(session.getState()) ?? "running";
}

function resolvePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value));
}

function resolveNonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(value));
}

function readNumberEnvironmentVariable(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readStringEnvironmentVariable(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function stringifyUnknown(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown");
}
