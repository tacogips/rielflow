import { isEventSourceEnabled } from "./config";
import {
  createDefaultEventSourceRegistry,
  type EventSourceRegistry,
} from "./adapter-registry";
import {
  dispatchEventToMatchingBindings,
  createWorkflowTriggerRunner,
  type WorkflowTriggerRunnerOptions,
} from "./trigger-runner";
import { loadAndValidateEventConfiguration } from "./validate";
import { normalizeS3RepositoryRawEvent } from "./adapters/s3-repository";
import { verifyWebhookRequest } from "./adapters/webhook";
import {
  buildWebhookVerificationSource,
  resolveEventSourceHttpPath,
} from "./http-routes";
import { createEventReplyDispatcher } from "./reply-dispatcher";
import type {
  EventSourceAdapter,
  EventSourceDiagnostic,
  RawExternalEvent,
} from "./source-adapter";
import type {
  EventConfigLoadOptions,
  EventConfiguration,
  EventSourceConfig,
  S3RepositorySourceConfig,
} from "./types";

export interface EventListenerServeOptions
  extends EventConfigLoadOptions,
    WorkflowTriggerRunnerOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface EventListenerHandle {
  readonly host?: string;
  readonly port?: number;
  readonly sources: readonly string[];
  stop(): Promise<void>;
}

export interface EventListenerService {
  start(options: EventListenerServeOptions): Promise<EventListenerHandle>;
}

export interface EventListenerServer {
  readonly port: number;
  stop(): void;
}

export interface EventListenerRuntime {
  serve(options: {
    readonly hostname: string;
    readonly port: number;
    readonly fetch: (request: Request) => Response | Promise<Response>;
  }): EventListenerServer;
}

interface EventHttpRoute {
  readonly source: EventSourceConfig;
  readonly adapter: EventSourceAdapter;
  readonly path: string;
}

const DEFAULT_EVENT_LISTENER_RUNTIME: EventListenerRuntime = {
  serve: (options) => Bun.serve(options),
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function requestHeadersToRecord(
  headers: Headers,
): Readonly<Record<string, string>> {
  return Object.fromEntries([...headers.entries()]);
}

function isS3RepositorySource(
  source: EventSourceConfig,
): source is S3RepositorySourceConfig {
  return source.kind === "s3-repository";
}

function parseEventListenerPort(rawPort: number | string): number {
  const port = typeof rawPort === "number" ? rawPort : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`invalid event listener port '${String(rawPort)}'`);
  }
  return port;
}

function resolveEventListenerPort(input: {
  readonly optionPort?: number;
  readonly env: Readonly<Record<string, string | undefined>>;
}): number {
  const envPort = input.env["DIVEDRA_EVENTS_PORT"];
  return parseEventListenerPort(
    input.optionPort ??
      (envPort === undefined || envPort.length === 0 ? 43_174 : envPort),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function writeEventSourceDiagnostic(diagnostic: EventSourceDiagnostic): void {
  process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
}

async function stopEventListenerResources(input: {
  readonly abortController: AbortController;
  readonly handles: readonly Awaited<ReturnType<EventSourceAdapter["start"]>>[];
  readonly server?: EventListenerServer;
}): Promise<void> {
  input.abortController.abort();
  const failures: string[] = [];
  const handleResults = await Promise.allSettled(
    input.handles.map((handle) => handle.stop()),
  );
  handleResults.forEach((result, index) => {
    if (result.status === "rejected") {
      const sourceId = input.handles[index]?.sourceId ?? "unknown";
      failures.push(`${sourceId}: ${errorMessage(result.reason)}`);
    }
  });
  try {
    input.server?.stop();
  } catch (error: unknown) {
    failures.push(`http-server: ${errorMessage(error)}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `failed stopping event listener resources: ${failures.join("; ")}`,
    );
  }
}

function parseRequestJsonBody(bodyText: string): unknown {
  try {
    return bodyText.length === 0 ? {} : (JSON.parse(bodyText) as unknown);
  } catch (error: unknown) {
    const message = errorMessage(error);
    throw new Error(`event request body must be valid JSON: ${message}`);
  }
}

async function normalizeRouteEvent(input: {
  readonly route: EventHttpRoute;
  readonly raw: RawExternalEvent;
}) {
  if (isS3RepositorySource(input.route.source)) {
    return normalizeS3RepositoryRawEvent(input.route.source, input.raw);
  }
  return input.route.adapter.normalize(input.raw);
}

export async function handleEventHttpRequest(
  request: Request,
  input: {
    readonly configuration: EventConfiguration;
    readonly routes: readonly EventHttpRoute[];
    readonly triggerOptions: WorkflowTriggerRunnerOptions;
    readonly registry?: EventSourceRegistry;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly now: () => Date;
  },
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "event endpoint only supports POST" }, 405);
  }
  const url = new URL(request.url);
  const route = input.routes.find((entry) => entry.path === url.pathname);
  if (route === undefined) {
    return json({ error: "event source not found" }, 404);
  }
  let body: unknown;
  let event: Awaited<ReturnType<typeof normalizeRouteEvent>>;
  try {
    const bodyText = await request.text();
    const verificationSource = buildWebhookVerificationSource(route.source);
    if (verificationSource !== undefined) {
      const verified = verifyWebhookRequest({
        source: verificationSource,
        headers: requestHeadersToRecord(request.headers),
        bodyText,
        env: input.env,
        now: input.now(),
      });
      if (!verified.ok) {
        return json(
          { error: "event signature rejected", reason: verified.reason },
          401,
        );
      }
    }
    body = parseRequestJsonBody(bodyText);
    const raw: RawExternalEvent = {
      sourceId: route.source.id,
      source: route.source,
      receivedAt: input.now().toISOString(),
      headers: requestHeadersToRecord(request.headers),
      body,
    };
    event = await normalizeRouteEvent({ route, raw });
  } catch (error: unknown) {
    return json({ error: errorMessage(error) }, 400);
  }

  const eventReplyDispatcher =
    input.triggerOptions.eventReplyDispatcher ??
    createEventReplyDispatcher({
      configuration: input.configuration,
      ...(input.registry === undefined ? {} : { registry: input.registry }),
      env: input.env,
      ...(input.triggerOptions.fetchImpl === undefined
        ? {}
        : { fetchImpl: input.triggerOptions.fetchImpl }),
      runtimeOptions: input.triggerOptions,
    });
  const triggerOptions: WorkflowTriggerRunnerOptions = {
    ...input.triggerOptions,
    eventReplyDispatcher,
  };
  const runner = createWorkflowTriggerRunner(triggerOptions);
  try {
    const results = await dispatchEventToMatchingBindings(
      {
        configuration: input.configuration,
        event,
        raw: body,
        runner,
      },
      triggerOptions,
    );
    return json(
      {
        accepted: true,
        sourceId: route.source.id,
        receipts: results.map((result) => ({
          receiptId: result.receipt.receiptId,
          status: result.receipt.status,
          duplicate: result.duplicate,
          workflowName: result.workflowName ?? null,
          workflowExecutionId: result.workflowExecutionId ?? null,
          supervisedRunId: result.supervisedRunId ?? null,
          supervisorExecutionId: result.supervisorExecutionId ?? null,
          supervisorConversationId:
            result.supervisorConversationId ??
            result.receipt.supervisorConversationId ??
            null,
          supervisorDecisionId:
            result.supervisorDecisionId ??
            result.receipt.supervisorDecisionId ??
            null,
        })),
      },
      202,
    );
  } catch (error: unknown) {
    return json({ error: errorMessage(error) }, 500);
  }
}

export function createEventListenerService(
  registry: EventSourceRegistry = createDefaultEventSourceRegistry(),
  runtime: EventListenerRuntime = DEFAULT_EVENT_LISTENER_RUNTIME,
): EventListenerService {
  return {
    async start(
      options: EventListenerServeOptions,
    ): Promise<EventListenerHandle> {
      const validation = await loadAndValidateEventConfiguration(options);
      if (!validation.valid) {
        throw new Error(
          validation.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; "),
        );
      }
      const configuration = validation.configuration;
      const abortController = new AbortController();
      const now = (): Date => new Date();
      const env = options.env ?? process.env;
      const eventReplyDispatcher =
        options.eventReplyDispatcher ??
        createEventReplyDispatcher({
          configuration,
          registry,
          env,
          ...(options.fetchImpl === undefined
            ? {}
            : { fetchImpl: options.fetchImpl }),
          runtimeOptions: options,
        });
      const triggerOptions: WorkflowTriggerRunnerOptions = {
        ...options,
        eventReplyDispatcher,
      };
      const runner = createWorkflowTriggerRunner(triggerOptions);
      const handles: Awaited<ReturnType<EventSourceAdapter["start"]>>[] = [];
      const routes: EventHttpRoute[] = [];
      let server: EventListenerServer | undefined;
      try {
        const enabledSources =
          configuration.sources.filter(isEventSourceEnabled);
        for (const source of enabledSources) {
          const adapter = registry.get(source.kind);
          if (adapter === undefined) {
            throw new Error(
              `no event source adapter registered for '${source.kind}'`,
            );
          }
          const routePath = resolveEventSourceHttpPath(source);
          if (routePath !== undefined) {
            routes.push({ source, adapter, path: routePath });
          }
          if (adapter.capabilities.supportsStart) {
            handles.push(
              await adapter.start({
                source,
                signal: abortController.signal,
                now,
                env,
                ...(options.fetchImpl === undefined
                  ? {}
                  : { fetchImpl: options.fetchImpl }),
                diagnosticSink: writeEventSourceDiagnostic,
                dispatch: async (event, raw) => {
                  await dispatchEventToMatchingBindings(
                    {
                      configuration,
                      event,
                      ...(raw === undefined ? {} : { raw }),
                      runner,
                    },
                    triggerOptions,
                  );
                },
              }),
            );
          }
        }

        const host = options.host ?? env["DIVEDRA_EVENTS_HOST"] ?? "127.0.0.1";
        const port = resolveEventListenerPort({
          ...(options.port === undefined ? {} : { optionPort: options.port }),
          env,
        });
        server =
          routes.length === 0
            ? undefined
            : runtime.serve({
                hostname: host,
                port,
                fetch: (request) =>
                  handleEventHttpRequest(request, {
                    configuration,
                    routes,
                    triggerOptions,
                    registry,
                    env,
                    now,
                  }),
              });

        return {
          ...(server === undefined ? {} : { host, port: server.port }),
          sources: enabledSources.map((source) => source.id),
          stop: async () => {
            await stopEventListenerResources({
              abortController,
              handles,
              ...(server === undefined ? {} : { server }),
            });
          },
        };
      } catch (error: unknown) {
        await stopEventListenerResources({
          abortController,
          handles,
          ...(server === undefined ? {} : { server }),
        }).catch(() => {});
        throw error;
      }
    },
  };
}
