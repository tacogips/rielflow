import { isJsonObject } from "../shared/json";
import { isEventSourceEnabled, loadEventConfiguration } from "./config";
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
import { verifyWebhookRequest } from "./adapters/webhook";
import { normalizeS3RepositoryRawEvent } from "./adapters/s3-repository";
import { createEventReplyDispatcher } from "./reply-dispatcher";
import type { EventSourceAdapter, RawExternalEvent } from "./source-adapter";
import type {
  EventConfigLoadOptions,
  EventConfiguration,
  EventSourceConfig,
  S3RepositorySourceConfig,
  WebhookSourceConfig,
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

function defaultSourcePath(source: EventSourceConfig): string {
  return `/events/${encodeURIComponent(source.id)}`;
}

function routePathForSource(source: EventSourceConfig): string | undefined {
  if (source.kind === "webhook" && typeof source["path"] === "string") {
    return source["path"];
  }
  if (source.kind === "s3-repository") {
    const eventReceiver = source["eventReceiver"];
    if (
      isJsonObject(eventReceiver) &&
      typeof eventReceiver["path"] === "string"
    ) {
      return eventReceiver["path"];
    }
    return defaultSourcePath(source);
  }
  return undefined;
}

function isS3RepositorySource(
  source: EventSourceConfig,
): source is S3RepositorySourceConfig {
  return source.kind === "s3-repository";
}

function buildWebhookVerificationSource(
  source: EventSourceConfig,
): WebhookSourceConfig | undefined {
  if (source.kind === "webhook") {
    return source as WebhookSourceConfig;
  }
  if (source.kind !== "s3-repository") {
    return undefined;
  }
  const eventReceiver = source["eventReceiver"];
  if (!isJsonObject(eventReceiver)) {
    return undefined;
  }
  return {
    id: source.id,
    kind: "webhook",
    path: routePathForSource(source) ?? defaultSourcePath(source),
    ...(typeof eventReceiver["signingSecretEnv"] === "string"
      ? { signingSecretEnv: eventReceiver["signingSecretEnv"] }
      : {}),
  };
}

async function parseRequestBody(request: Request): Promise<{
  readonly bodyText: string;
  readonly body: unknown;
}> {
  const bodyText = await request.text();
  return {
    bodyText,
    body: bodyText.length === 0 ? {} : (JSON.parse(bodyText) as unknown),
  };
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
  const parsed = await parseRequestBody(request);
  const verificationSource = buildWebhookVerificationSource(route.source);
  if (verificationSource !== undefined) {
    const verified = verifyWebhookRequest({
      source: verificationSource,
      headers: requestHeadersToRecord(request.headers),
      bodyText: parsed.bodyText,
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
  const raw: RawExternalEvent = {
    sourceId: route.source.id,
    receivedAt: input.now().toISOString(),
    headers: requestHeadersToRecord(request.headers),
    body: parsed.body,
  };
  const event = await normalizeRouteEvent({ route, raw });
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
  const results = await dispatchEventToMatchingBindings(
    {
      configuration: input.configuration,
      event,
      raw: parsed.body,
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
        workflowExecutionId: result.workflowExecutionId ?? null,
      })),
    },
    202,
  );
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
      const configuration = await loadEventConfiguration(options);
      const abortController = new AbortController();
      const now = (): Date => new Date();
      const eventReplyDispatcher =
        options.eventReplyDispatcher ??
        createEventReplyDispatcher({
          configuration,
          registry,
          env: options.env ?? process.env,
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
      const enabledSources = configuration.sources.filter(isEventSourceEnabled);
      for (const source of enabledSources) {
        const adapter = registry.get(source.kind);
        if (adapter === undefined) {
          throw new Error(
            `no event source adapter registered for '${source.kind}'`,
          );
        }
        const routePath = routePathForSource(source);
        if (routePath !== undefined) {
          routes.push({ source, adapter, path: routePath });
        }
        if (adapter.capabilities.supportsStart) {
          handles.push(
            await adapter.start({
              source,
              signal: abortController.signal,
              now,
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

      const host =
        options.host ?? options.env?.["DIVEDRA_EVENTS_HOST"] ?? "127.0.0.1";
      const rawPort =
        options.port ?? options.env?.["DIVEDRA_EVENTS_PORT"] ?? 43174;
      const port = typeof rawPort === "number" ? rawPort : Number(rawPort);
      const server =
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
                  env: options.env ?? process.env,
                  now,
                }),
            });

      return {
        ...(server === undefined ? {} : { host, port: server.port }),
        sources: enabledSources.map((source) => source.id),
        stop: async () => {
          abortController.abort();
          await Promise.all(handles.map((handle) => handle.stop()));
          server?.stop();
        },
      };
    },
  };
}
