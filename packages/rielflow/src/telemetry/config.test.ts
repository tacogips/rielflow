import { describe, expect, test } from "vitest";
import { resolveWorkflowTelemetryConfig } from "./config";

describe("resolveWorkflowTelemetryConfig", () => {
  test("defaults to disabled with message export disabled", () => {
    expect(resolveWorkflowTelemetryConfig({ env: {} })).toMatchObject({
      enabled: false,
      serviceName: "rielflow",
      exportMessages: false,
      endpointConfigured: false,
    });
  });

  test("infers enabled when an OTLP endpoint is configured", () => {
    expect(
      resolveWorkflowTelemetryConfig({
        env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
      }),
    ).toMatchObject({
      enabled: true,
      endpointConfigured: true,
      endpoint: "http://localhost:4318/v1/traces",
    });
  });

  test("keeps a signal-specific OTLP traces endpoint unchanged", () => {
    expect(
      resolveWorkflowTelemetryConfig({
        env: {
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
            "http://trace-collector:4318/custom-traces",
        },
      }),
    ).toMatchObject({
      enabled: true,
      endpointConfigured: true,
      endpoint: "http://trace-collector:4318/custom-traces",
    });
  });

  test("honors explicit disable and legacy aliases", () => {
    expect(
      resolveWorkflowTelemetryConfig({
        env: {
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
          DIVEDRA_OTEL_ENABLED: "false",
          DIVEDRA_OTEL_EXPORT_MESSAGES: "true",
        },
      }),
    ).toMatchObject({
      enabled: false,
      exportMessages: true,
    });
  });

  test("library options override environment defaults", () => {
    expect(
      resolveWorkflowTelemetryConfig({
        options: {
          enabled: true,
          serviceName: "custom-service",
          exportMessages: false,
        },
        env: {
          OTEL_SERVICE_NAME: "env-service",
          RIELFLOW_OTEL_EXPORT_MESSAGES: "true",
        },
      }),
    ).toMatchObject({
      enabled: true,
      serviceName: "custom-service",
      exportMessages: false,
    });
  });
});
