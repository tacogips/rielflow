export interface WorkflowTelemetryOptions {
  readonly enabled?: boolean;
  readonly serviceName?: string;
  readonly exportMessages?: boolean;
}

export interface ResolvedWorkflowTelemetryConfig {
  readonly enabled: boolean;
  readonly serviceName: string;
  readonly exportMessages: boolean;
  readonly endpointConfigured: boolean;
  readonly endpoint?: string;
  readonly protocol?: string;
}

export interface ResolveWorkflowTelemetryConfigInput {
  readonly options?: WorkflowTelemetryOptions;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  return undefined;
}

function firstNonEmpty(
  ...values: readonly (string | undefined)[]
): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

function appendTracePath(endpoint: string): string {
  const trimmed = endpoint.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
  } catch {
    return trimmed;
  }
  if (parsed.pathname.endsWith("/v1/traces")) {
    return parsed.toString();
  }
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/v1/traces`;
  return parsed.toString();
}

export function resolveWorkflowTelemetryConfig(
  input: ResolveWorkflowTelemetryConfigInput = {},
): ResolvedWorkflowTelemetryConfig {
  const env = input.env ?? process.env;
  const tracesEndpoint = firstNonEmpty(env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"]);
  const genericEndpoint = firstNonEmpty(env["OTEL_EXPORTER_OTLP_ENDPOINT"]);
  const endpoint =
    tracesEndpoint ??
    (genericEndpoint === undefined
      ? undefined
      : appendTracePath(genericEndpoint));
  const endpointConfigured = endpoint !== undefined;
  const sdkDisabled = parseBoolean(env["OTEL_SDK_DISABLED"]);
  const envEnabled =
    parseBoolean(env["RIELFLOW_OTEL_ENABLED"]) ??
    parseBoolean(env["DIVEDRA_OTEL_ENABLED"]);
  const enabled =
    sdkDisabled === true
      ? false
      : (input.options?.enabled ?? envEnabled ?? endpointConfigured);
  const serviceName = firstNonEmpty(
    input.options?.serviceName,
    env["OTEL_SERVICE_NAME"],
    env["RIELFLOW_OTEL_SERVICE_NAME"],
  );
  const exportMessages =
    input.options?.exportMessages ??
    parseBoolean(env["RIELFLOW_OTEL_EXPORT_MESSAGES"]) ??
    parseBoolean(env["DIVEDRA_OTEL_EXPORT_MESSAGES"]) ??
    false;

  return {
    enabled,
    serviceName: serviceName ?? "rielflow",
    exportMessages,
    endpointConfigured,
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(env["OTEL_EXPORTER_OTLP_PROTOCOL"] === undefined
      ? {}
      : { protocol: env["OTEL_EXPORTER_OTLP_PROTOCOL"] }),
  };
}
