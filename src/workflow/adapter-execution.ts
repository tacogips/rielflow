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
import { err, ok, type Result } from "./result";

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

export async function executeAdapterWithTimeout(
  adapter: NodeAdapter,
  input: AdapterExecutionInput,
  timeoutMs: number,
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

  try {
    const output = await Promise.race([
      adapter.execute(input, {
        timeoutMs,
        signal: controller.signal,
      }),
      timeoutPromise,
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
  }
}

export async function executeNativeNodeWithTimeout(
  input: NativeNodeExecutionInput & { readonly timeoutMs: number },
): Promise<Result<AdapterExecutionOutput, AdapterExecutionFailure>> {
  const controller = new AbortController();
  let timeoutExpired = false;
  const timeoutMessage = "native node execution timed out";
  const timer = setTimeout(() => {
    timeoutExpired = true;
    controller.abort();
  }, input.timeoutMs);

  try {
    const output = await executeNativeNode(input, {
      timeoutMs: input.timeoutMs,
      signal: controller.signal,
    });
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
  }
}
