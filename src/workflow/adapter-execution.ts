import {
  AdapterExecutionError,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type AdapterFailureCode,
  type AdapterProcessLog,
  type NodeAdapter,
} from "./adapter";
import { loadBoundaryAddonPackage } from "./addon-package-boundary";
import type { NodeExecutionMailbox } from "./node-execution-mailbox";
import { loadRuntimeSessionSummary } from "./runtime-db";
import { err, ok, type Result } from "./result";
import { formatSupervisionStallError } from "./superviser";
import type {
  ChatReplyDispatcher,
  NodePayload,
  SupervisionStallWatch,
  WorkflowDefaults,
} from "./types";
import type { SuperviserRuntimeControl } from "./superviser-control";

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

type ExecutionTimeoutController = {
  readonly controller: AbortController;
  readonly clear: () => void;
  readonly expired: () => boolean;
  readonly promise: Promise<never>;
};

interface PackageNodeExecutionInput {
  readonly workflowDirectory: string;
  readonly workflowWorkingDirectory: string;
  readonly artifactWorkflowRoot: string;
  readonly workflowId: string;
  readonly workflowDescription: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly node: NodePayload;
  readonly workflowDefaults: WorkflowDefaults;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly mergedVariables: Readonly<Record<string, unknown>>;
  readonly arguments: Readonly<Record<string, unknown>> | null;
  readonly artifactDir: string;
  readonly executionMailbox: NodeExecutionMailbox;
  readonly chatReplyDispatcher?: ChatReplyDispatcher;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly superviserControl?: SuperviserRuntimeControl;
}

type NativeNodeExecutor = (
  input: PackageNodeExecutionInput,
  options: {
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  },
) => Promise<AdapterExecutionOutput>;

interface PackageNodeExecutionDependencies {
  readonly loadExecutor?: () => Promise<NativeNodeExecutor>;
}

const nativeNodeExecutorExportName = ["execute", "Native", "Node"].join("");

async function loadPackageNodeExecutor(): Promise<NativeNodeExecutor> {
  const module = await loadBoundaryAddonPackage().catch((error: unknown) => {
    const reason = error instanceof Error ? `: ${error.message}` : "";
    throw new AdapterExecutionError(
      "provider_error",
      `unable to load add-on node executor${reason}`,
    );
  });
  const executor = module[nativeNodeExecutorExportName];
  if (typeof executor === "function") {
    return executor as NativeNodeExecutor;
  }
  throw new AdapterExecutionError(
    "provider_error",
    "add-on package does not expose native node execution",
  );
}

function throwIfNativeExecutionAlreadyAborted(input: {
  readonly signal: AbortSignal;
  readonly timeoutExpired: boolean;
  readonly timeoutMessage: string;
}): void {
  if (!input.signal.aborted) {
    return;
  }
  if (input.timeoutExpired) {
    throw new AdapterExecutionError("timeout", input.timeoutMessage);
  }
  throw new AdapterExecutionError(
    "provider_error",
    "native node execution aborted before start",
  );
}

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

function createRejectingExecutionTimeout(input: {
  readonly timeoutMs: number;
  readonly timeoutMessage: string;
}): ExecutionTimeoutController {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutExpired = false;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timeoutExpired = true;
      controller.abort();
      reject(new AdapterExecutionError("timeout", input.timeoutMessage));
    }, input.timeoutMs);
  });
  return {
    controller,
    clear: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    expired: () => timeoutExpired,
    promise,
  };
}

export async function executeAdapterWithTimeout(
  adapter: NodeAdapter,
  input: AdapterExecutionInput,
  timeoutMs: number,
  supervisionStall?: SupervisionStallWatch,
): Promise<Result<AdapterExecutionOutput, AdapterExecutionFailure>> {
  const timeoutMessage = "adapter execution timed out";
  const timeout = createRejectingExecutionTimeout({
    timeoutMs,
    timeoutMessage,
  });
  const stall = supervisionStall
    ? attachSupervisionStallToAbort(timeout.controller, supervisionStall)
    : undefined;

  try {
    const output = await Promise.race([
      adapter.execute(input, {
        timeoutMs,
        signal: timeout.controller.signal,
      }),
      timeout.promise,
      ...(stall ? [stall.promise] : []),
    ]);
    return ok(output);
  } catch (error: unknown) {
    return err(
      toExecutionFailure(error, {
        timeoutMessage,
        unknownFailureMessage: "unknown adapter execution failure",
        timeoutExpired: timeout.expired(),
      }),
    );
  } finally {
    timeout.clear();
    stall?.clear();
  }
}

export async function executePackageNodeWithTimeout(
  input: PackageNodeExecutionInput & {
    readonly timeoutMs: number;
    readonly supervisionStall?: SupervisionStallWatch;
  },
  dependencies: PackageNodeExecutionDependencies = {},
): Promise<Result<AdapterExecutionOutput, AdapterExecutionFailure>> {
  const timeoutMessage = "native node execution timed out";
  const timeout = createRejectingExecutionTimeout({
    timeoutMs: input.timeoutMs,
    timeoutMessage,
  });
  const { supervisionStall, ...rest } = input;
  const stall = supervisionStall
    ? attachSupervisionStallToAbort(timeout.controller, supervisionStall)
    : undefined;

  try {
    const loadExecutor = dependencies.loadExecutor ?? loadPackageNodeExecutor;
    const packageExecution = (async (): Promise<AdapterExecutionOutput> => {
      const executePackageNode = await loadExecutor();
      throwIfNativeExecutionAlreadyAborted({
        signal: timeout.controller.signal,
        timeoutExpired: timeout.expired(),
        timeoutMessage,
      });
      return await executePackageNode(rest, {
        timeoutMs: input.timeoutMs,
        signal: timeout.controller.signal,
      });
    })();
    const output = await Promise.race([
      packageExecution,
      timeout.promise,
      ...(stall ? [stall.promise] : []),
    ]);
    return ok(output);
  } catch (error: unknown) {
    return err(
      toExecutionFailure(error, {
        timeoutMessage,
        unknownFailureMessage: "unknown native node execution failure",
        timeoutExpired: timeout.expired(),
      }),
    );
  } finally {
    timeout.clear();
    stall?.clear();
  }
}
