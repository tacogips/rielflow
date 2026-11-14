import {
  AdapterExecutionError,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type AdapterFailureCode,
  type AdapterProcessLog,
  type NodeAdapter,
} from "./adapter";
import {
  executeNativeNode,
  type NativeNodeExecutionInput,
} from "./native-node-executor";
import { loadRuntimeSessionSummary } from "./runtime-db";
import { err, ok, type Result } from "./result";
import { formatSupervisionStallError } from "./superviser";
import type { SupervisionStallWatch } from "./types";

export interface AdapterExecutionFailure {
  readonly code: AdapterFailureCode;
  readonly message: string;
  readonly processLogs?: readonly AdapterProcessLog[];
}

function toAdapterExecutionFailure(
  error: AdapterExecutionError,
): AdapterExecutionFailure {
  return {
    code: error.code,
    message: error.message,
    ...(error.processLogs === undefined
      ? {}
      : { processLogs: error.processLogs }),
  };
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function toExecutionFailure(
  error: unknown,
  input: {
    readonly timeoutMessage: string;
    readonly unknownFailureMessage: string;
    readonly timeoutExpired: boolean;
  },
): AdapterExecutionFailure {
  if (error instanceof AdapterExecutionError) {
    return toAdapterExecutionFailure(error);
  }
  if (input.timeoutExpired && isAbortError(error)) {
    return {
      code: "timeout",
      message: input.timeoutMessage,
    };
  }
  return {
    code: "provider_error",
    message:
      error instanceof Error ? error.message : input.unknownFailureMessage,
  };
}

type SupervisionStallController = {
  readonly clear: () => void;
  readonly promise: Promise<never>;
};

function attachSupervisionStallToAbort(
  controller: AbortController,
  supervisionStall: SupervisionStallWatch,
): SupervisionStallController {
  let interval: ReturnType<typeof setInterval> | undefined;
  let done = false;
  const clear = (): void => {
    done = true;
    if (interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }
  };
  const promise = new Promise<never>((_, reject) => {
    const runCheck = async (): Promise<void> => {
      if (done) {
        return;
      }
      try {
        const s = await loadRuntimeSessionSummary(
          supervisionStall.sessionId,
          supervisionStall.loadOptions,
        );
        if (done) {
          return;
        }
        if (s === null || s.status !== "running") {
          return;
        }
        const last = new Date(s.updatedAt).getTime();
        if (Date.now() - last > supervisionStall.stallTimeoutMs) {
          if (done) {
            return;
          }
          done = true;
          clear();
          controller.abort();
          reject(
            new AdapterExecutionError(
              "provider_error",
              formatSupervisionStallError(supervisionStall.stallTimeoutMs),
            ),
          );
        }
      } catch {
        // best-effort; keep polling
      }
    };
    const intervalMs = Math.max(50, supervisionStall.monitorIntervalMs);
    void runCheck();
    interval = setInterval(() => {
      void runCheck();
    }, intervalMs);
  });
  return { clear, promise };
}

export async function executeAdapterWithTimeout(
  adapter: NodeAdapter,
  input: AdapterExecutionInput,
  timeoutMs: number,
  supervisionStall?: SupervisionStallWatch,
): Promise<Result<AdapterExecutionOutput, AdapterExecutionFailure>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutExpired = false;
  const timeoutMessage = "adapter execution timed out";
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timeoutExpired = true;
      controller.abort();
      reject(new AdapterExecutionError("timeout", timeoutMessage));
    }, timeoutMs);
  });
  const stall = supervisionStall
    ? attachSupervisionStallToAbort(controller, supervisionStall)
    : undefined;

  try {
    const output = await Promise.race([
      adapter.execute(input, {
        timeoutMs,
        signal: controller.signal,
      }),
      timeoutPromise,
      ...(stall ? [stall.promise] : []),
    ]);
    return ok(output);
  } catch (error: unknown) {
    return err(
      toExecutionFailure(error, {
        timeoutMessage,
        unknownFailureMessage: "unknown adapter execution failure",
        timeoutExpired,
      }),
    );
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    stall?.clear();
  }
}

export async function executeNativeNodeWithTimeout(
  input: NativeNodeExecutionInput & {
    readonly timeoutMs: number;
    readonly supervisionStall?: SupervisionStallWatch;
  },
): Promise<Result<AdapterExecutionOutput, AdapterExecutionFailure>> {
  const controller = new AbortController();
  let timeoutExpired = false;
  const timeoutMessage = "native node execution timed out";
  const timer = setTimeout(() => {
    timeoutExpired = true;
    controller.abort();
  }, input.timeoutMs);
  const { supervisionStall, ...rest } = input;
  const stall = supervisionStall
    ? attachSupervisionStallToAbort(controller, supervisionStall)
    : undefined;

  try {
    const output = await Promise.race([
      executeNativeNode(rest, {
        timeoutMs: input.timeoutMs,
        signal: controller.signal,
      }),
      ...(stall ? [stall.promise] : []),
    ]);
    return ok(output);
  } catch (error: unknown) {
    return err(
      toExecutionFailure(error, {
        timeoutMessage,
        unknownFailureMessage: "unknown native node execution failure",
        timeoutExpired,
      }),
    );
  } finally {
    clearTimeout(timer);
    stall?.clear();
  }
}
