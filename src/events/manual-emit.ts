import { readFile } from "node:fs/promises";
import { isEventSourceEnabled } from "./config";
import { createDefaultEventSourceRegistry } from "./adapter-registry";
import { normalizeS3RepositoryRawEvent } from "./adapters/s3-repository";
import { createEventReplyDispatcher } from "./reply-dispatcher";
import {
  createWorkflowTriggerRunner,
  dispatchEventToMatchingBindings,
  type WorkflowTriggerRunnerOptions,
  type WorkflowTriggerResult,
} from "./trigger-runner";
import { loadAndValidateEventConfiguration } from "./validate";
import type { RawExternalEvent } from "./source-adapter";
import type {
  EventConfigLoadOptions,
  EventSourceConfig,
  S3RepositorySourceConfig,
} from "./types";

export interface EmitEventFileInput
  extends EventConfigLoadOptions,
    WorkflowTriggerRunnerOptions {
  readonly sourceId: string;
  readonly eventFile: string;
}

function isS3RepositorySource(
  source: EventSourceConfig,
): source is S3RepositorySourceConfig {
  return source.kind === "s3-repository";
}

export async function emitEventFile(
  input: EmitEventFileInput,
): Promise<readonly WorkflowTriggerResult[]> {
  const validation = await loadAndValidateEventConfiguration(input);
  if (!validation.valid) {
    throw new Error(
      validation.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; "),
    );
  }
  const configuration = validation.configuration;
  const source = configuration.sources.find(
    (entry) => entry.id === input.sourceId && isEventSourceEnabled(entry),
  );
  if (source === undefined) {
    throw new Error(`event source not found: ${input.sourceId}`);
  }
  const content = await readFile(input.eventFile, "utf8");
  const body = JSON.parse(content) as unknown;
  const raw: RawExternalEvent = {
    sourceId: source.id,
    receivedAt: new Date().toISOString(),
    body,
  };
  const registry = createDefaultEventSourceRegistry();
  const adapter = registry.get(source.kind);
  if (adapter === undefined) {
    throw new Error(`no event source adapter registered for '${source.kind}'`);
  }
  const event = isS3RepositorySource(source)
    ? normalizeS3RepositoryRawEvent(source, raw)
    : await adapter.normalize(raw);
  const eventReplyDispatcher =
    input.eventReplyDispatcher ??
    createEventReplyDispatcher({
      configuration,
      registry,
      env: input.env ?? process.env,
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
      runtimeOptions: input,
    });
  const triggerOptions: WorkflowTriggerRunnerOptions = {
    ...input,
    eventReplyDispatcher,
  };
  return dispatchEventToMatchingBindings(
    {
      configuration,
      event,
      raw: body,
      runner: createWorkflowTriggerRunner(triggerOptions),
    },
    triggerOptions,
  );
}
