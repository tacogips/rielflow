import {
  SpanStatusCode,
  trace,
  type Span,
  type SpanStatus,
} from "@opentelemetry/api";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getWorkflowTelemetry,
  initializeWorkflowTelemetry,
  withTelemetryResultSpan,
} from "./tracing";

afterEach(async () => {
  await getWorkflowTelemetry().shutdown();
  vi.restoreAllMocks();
});

describe("initializeWorkflowTelemetry", () => {
  test("replaces a lazy disabled no-op state with explicit startup config", () => {
    expect(getWorkflowTelemetry().config.enabled).toBe(false);

    const telemetry = initializeWorkflowTelemetry({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
    });

    expect(telemetry.config.enabled).toBe(true);
    expect(telemetry.config.endpoint).toBe("http://localhost:4318/v1/traces");
  });

  test("supports explicit enable with exporter defaults", () => {
    const telemetry = initializeWorkflowTelemetry({
      env: { RIELFLOW_OTEL_ENABLED: "true" },
    });

    expect(telemetry.config.enabled).toBe(true);
    expect(telemetry.config.endpointConfigured).toBe(false);
  });

  test("keeps the already started SDK configuration on repeated initialization", () => {
    const first = initializeWorkflowTelemetry({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
    });
    const second = initializeWorkflowTelemetry({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:9999" },
    });

    expect(first.config.endpoint).toBe("http://localhost:4318/v1/traces");
    expect(second.config.endpoint).toBe("http://localhost:4318/v1/traces");
  });

  test("marks returned Result errors as error spans", async () => {
    const statuses: SpanStatus[] = [];
    const span = {
      setStatus: (status: SpanStatus) => {
        statuses.push(status);
        return span;
      },
      setAttributes: vi.fn(() => span),
      recordException: vi.fn(() => span),
      end: vi.fn(),
    } as unknown as Span;
    vi.spyOn(trace, "getTracer").mockReturnValue({
      startSpan: () => span,
    } as unknown as ReturnType<typeof trace.getTracer>);

    initializeWorkflowTelemetry({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
    });
    const result = await withTelemetryResultSpan(
      "rielflow.test.result",
      {},
      async () => ({
        ok: false,
        error: { kind: "timeout", message: "adapter execution timed out" },
      }),
    );

    expect(result.ok).toBe(false);
    expect(statuses).toContainEqual({
      code: SpanStatusCode.ERROR,
      message: "adapter execution timed out",
    });
    expect(span.setAttributes).toHaveBeenCalledWith({
      "result.ok": false,
      "error.type": "timeout",
      "error.message": "adapter execution timed out",
    });
  });
});
