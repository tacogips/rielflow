import {
  context,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  resolveWorkflowTelemetryConfig,
  type ResolvedWorkflowTelemetryConfig,
  type WorkflowTelemetryOptions,
} from "./config";
import {
  sanitizeTelemetryAttributes,
  type TelemetryAttributes,
} from "./redaction";

export interface WorkflowTelemetry {
  readonly config: ResolvedWorkflowTelemetryConfig;
  startSpan<T>(
    name: string,
    attributes: TelemetryAttributes,
    run: () => Promise<T>,
  ): Promise<T>;
  startResultSpan<T>(
    name: string,
    attributes: TelemetryAttributes,
    run: () => Promise<T>,
  ): Promise<T>;
  addEvent(name: string, attributes?: TelemetryAttributes): void;
  shutdown(): Promise<void>;
}

interface TelemetryState {
  readonly config: ResolvedWorkflowTelemetryConfig;
  readonly sdk?: NodeSDK;
  readonly origin: "explicit" | "lazy";
}

let state: TelemetryState | undefined;

type TelemetryStateInput = {
  readonly options?: WorkflowTelemetryOptions;
  readonly env?: Readonly<Record<string, string | undefined>>;
};

function createState(
  input: TelemetryStateInput,
  origin: TelemetryState["origin"],
): TelemetryState {
  const config = resolveWorkflowTelemetryConfig(input);
  if (!config.enabled) {
    return { config: { ...config, enabled: false }, origin };
  }
  const exporter = new OTLPTraceExporter(
    config.endpoint === undefined ? {} : { url: config.endpoint },
  );
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
    }),
    traceExporter: exporter,
  });
  sdk.start();
  return { config, sdk, origin };
}

function hasStartupConfiguration(input: TelemetryStateInput): boolean {
  return input.options !== undefined || input.env !== undefined;
}

function shouldReplaceState(
  current: TelemetryState,
  next: TelemetryState,
  input: TelemetryStateInput,
): boolean {
  if (current.sdk !== undefined) {
    return false;
  }
  if (current.origin === "lazy" && hasStartupConfiguration(input)) {
    return true;
  }
  return !current.config.enabled && next.config.enabled;
}

export function initializeWorkflowTelemetry(
  input: {
    readonly options?: WorkflowTelemetryOptions;
    readonly env?: Readonly<Record<string, string | undefined>>;
  } = {},
): WorkflowTelemetry {
  if (state?.sdk !== undefined) {
    return getWorkflowTelemetry();
  }
  const next = createState(input, "explicit");
  if (state === undefined) {
    state = next;
  } else if (shouldReplaceState(state, next, input)) {
    state = next;
  }
  return getWorkflowTelemetry();
}

export function getWorkflowTelemetry(): WorkflowTelemetry {
  const current = state ?? createState({}, "lazy");
  if (state === undefined) {
    state = current;
  }
  return {
    config: current.config,
    async startSpan<T>(
      name: string,
      attributes: TelemetryAttributes,
      run: () => Promise<T>,
    ): Promise<T> {
      if (!current.config.enabled) {
        return await run();
      }
      const tracer = trace.getTracer("rielflow");
      const safeAttributes = sanitizeTelemetryAttributes(
        attributes,
      ) as Attributes;
      const span = tracer.startSpan(name, {
        attributes: safeAttributes,
      });
      return await context.with(trace.setSpan(context.active(), span), () =>
        runWithSpan(span, run),
      );
    },
    async startResultSpan<T>(
      name: string,
      attributes: TelemetryAttributes,
      run: () => Promise<T>,
    ): Promise<T> {
      if (!current.config.enabled) {
        return await run();
      }
      const tracer = trace.getTracer("rielflow");
      const safeAttributes = sanitizeTelemetryAttributes(
        attributes,
      ) as Attributes;
      const span = tracer.startSpan(name, {
        attributes: safeAttributes,
      });
      return await context.with(trace.setSpan(context.active(), span), () =>
        runWithSpan(span, run, resultFailureAttributes),
      );
    },
    addEvent(name: string, attributes: TelemetryAttributes = {}): void {
      if (!current.config.enabled) {
        return;
      }
      trace
        .getActiveSpan()
        ?.addEvent(name, sanitizeTelemetryAttributes(attributes) as Attributes);
    },
    async shutdown(): Promise<void> {
      await current.sdk?.shutdown();
      state = undefined;
    },
  };
}

export async function withTelemetrySpan<T>(
  name: string,
  attributes: TelemetryAttributes,
  run: () => Promise<T>,
): Promise<T> {
  return await getWorkflowTelemetry().startSpan(name, attributes, run);
}

export async function withTelemetryResultSpan<T>(
  name: string,
  attributes: TelemetryAttributes,
  run: () => Promise<T>,
): Promise<T> {
  return await getWorkflowTelemetry().startResultSpan(name, attributes, run);
}

async function runWithSpan<T>(
  span: Span,
  run: () => Promise<T>,
  classifyFailure?: (result: T) => TelemetryAttributes | undefined,
): Promise<T> {
  try {
    const result = await run();
    const failureAttributes = classifyFailure?.(result);
    if (failureAttributes === undefined) {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      span.setAttributes(
        sanitizeTelemetryAttributes(failureAttributes) as Attributes,
      );
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message:
          typeof failureAttributes["error.message"] === "string"
            ? failureAttributes["error.message"]
            : "operation returned an error result",
      });
    }
    return result;
  } catch (error: unknown) {
    span.recordException(error instanceof Error ? error : String(error));
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    span.end();
  }
}

function resultFailureAttributes(
  result: unknown,
): TelemetryAttributes | undefined {
  if (
    typeof result !== "object" ||
    result === null ||
    !("ok" in result) ||
    result.ok !== false
  ) {
    return undefined;
  }
  const error =
    "error" in result &&
    typeof result.error === "object" &&
    result.error !== null
      ? result.error
      : undefined;
  return {
    "result.ok": false,
    "error.type":
      readErrorField(error, "kind") ?? readErrorField(error, "type"),
    "error.message": readErrorField(error, "message"),
  };
}

function readErrorField(
  error: object | undefined,
  key: string,
): string | undefined {
  if (error === undefined || !(key in error)) {
    return undefined;
  }
  const value = (error as Readonly<Record<string, unknown>>)[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}
