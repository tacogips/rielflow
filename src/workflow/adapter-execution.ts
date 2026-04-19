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
  return error instanceof DOMException && error.name === "AbortError";
}

export async function executeAdapterWithTimeout(
  adapter: NodeAdapter,
  input: AdapterExecutionInput,
  timeoutMs: number,
): Promise<Result<AdapterExecutionOutput, AdapterExecutionFailure>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new AdapterExecutionError("timeout", "adapter execution timed out"),
      );
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
    if (error instanceof AdapterExecutionError) {
      return err(toAdapterExecutionFailure(error));
    }
    if (isAbortError(error)) {
      return err({
        code: "timeout",
        message: "adapter execution timed out",
      });
    }
    return err({
      code: "provider_error",
      message:
        error instanceof Error
          ? error.message
          : "unknown adapter execution failure",
    });
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
  const timer = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs);

  try {
    const output = await executeNativeNode(input, {
      timeoutMs: input.timeoutMs,
      signal: controller.signal,
    });
    return ok(output);
  } catch (error: unknown) {
    if (error instanceof AdapterExecutionError) {
      return err(toAdapterExecutionFailure(error));
    }
    if (isAbortError(error)) {
      return err({
        code: "timeout",
        message: "native node execution timed out",
      });
    }
    return err({
      code: "provider_error",
      message:
        error instanceof Error
          ? error.message
          : "unknown native node execution failure",
    });
  } finally {
    clearTimeout(timer);
  }
}
