import { createWorkflowExecutionClient, type DivedraOptions } from "../lib";
import type { MockNodeScenario } from "../workflow/adapter";
import type { ChatReplyDispatcher } from "../workflow/types";
import { isEventBindingEnabled, isEventSourceEnabled } from "./config";
import {
  mapEventToWorkflowInput,
  selectMatchingBindings,
} from "./input-mapping";
import { beginEventReceipt, updateEventReceipt } from "./ledger";
import type {
  EventBinding,
  EventConfiguration,
  EventReceiptRecord,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";

export interface WorkflowTriggerDispatchInput {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig;
  readonly raw?: unknown;
}

export interface WorkflowTriggerResult {
  readonly receipt: EventReceiptRecord;
  readonly duplicate: boolean;
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
}

export interface WorkflowTriggerRunnerOptions extends DivedraOptions {
  readonly endpoint?: string;
  readonly authToken?: string;
  readonly fetchImpl?: typeof fetch;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly readOnly?: boolean;
  readonly eventReplyDispatcher?: ChatReplyDispatcher;
}

export interface WorkflowTriggerRunner {
  dispatch(input: WorkflowTriggerDispatchInput): Promise<WorkflowTriggerResult>;
}

export function createWorkflowTriggerRunner(
  options: WorkflowTriggerRunnerOptions = {},
): WorkflowTriggerRunner {
  return {
    async dispatch(
      input: WorkflowTriggerDispatchInput,
    ): Promise<WorkflowTriggerResult> {
      const begin = await beginEventReceipt(
        {
          event: input.event,
          binding: input.binding,
          ...(input.raw === undefined ? {} : { raw: input.raw }),
        },
        options,
      );
      if (begin.duplicateOf !== undefined) {
        return {
          receipt: begin.record,
          duplicate: true,
          workflowName: input.binding.workflowName,
        };
      }

      let mapping: ReturnType<typeof mapEventToWorkflowInput>;
      try {
        mapping = mapEventToWorkflowInput(
          input.binding,
          input.event,
          input.source,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        const failed = await updateEventReceipt(
          {
            record: begin.record,
            artifactDir: begin.artifactDir,
            status: "failed",
            error: message,
          },
          options,
        );
        return {
          receipt: failed,
          duplicate: false,
          workflowName: input.binding.workflowName,
        };
      }

      let receipt = await updateEventReceipt(
        {
          record: begin.record,
          artifactDir: begin.artifactDir,
          status: "mapped",
          inputPayload: mapping.runtimeVariables,
        },
        options,
      );
      if (options.readOnly === true) {
        const skipped = await updateEventReceipt(
          {
            record: receipt,
            artifactDir: begin.artifactDir,
            status: "skipped",
            error: "event dispatch skipped in read-only mode",
          },
          options,
        );
        return {
          receipt: skipped,
          duplicate: false,
          workflowName: input.binding.workflowName,
        };
      }

      try {
        receipt = await updateEventReceipt(
          {
            record: receipt,
            artifactDir: begin.artifactDir,
            status: "dispatching",
          },
          options,
        );
        const client = createWorkflowExecutionClient({
          workflowName: input.binding.workflowName,
          ...(options.workflowRoot === undefined
            ? {}
            : { workflowRoot: options.workflowRoot }),
          ...(options.workflowScope === undefined
            ? {}
            : { workflowScope: options.workflowScope }),
          ...(options.userRoot === undefined
            ? {}
            : { userRoot: options.userRoot }),
          ...(options.projectRoot === undefined
            ? {}
            : { projectRoot: options.projectRoot }),
          ...(options.artifactRoot === undefined
            ? {}
            : { artifactRoot: options.artifactRoot }),
          ...(options.rootDataDir === undefined
            ? {}
            : { rootDataDir: options.rootDataDir }),
          ...(options.sessionStoreRoot === undefined
            ? {}
            : { sessionStoreRoot: options.sessionStoreRoot }),
          ...(options.env === undefined ? {} : { env: options.env }),
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.nodeAddons === undefined
            ? {}
            : { nodeAddons: options.nodeAddons }),
          ...(options.asyncNodeAddonResolvers === undefined
            ? {}
            : { asyncNodeAddonResolvers: options.asyncNodeAddonResolvers }),
          ...(options.nodeAddonResolvers === undefined
            ? {}
            : { nodeAddonResolvers: options.nodeAddonResolvers }),
          ...(options.endpoint === undefined
            ? {}
            : { endpoint: options.endpoint }),
          ...(options.authToken === undefined
            ? {}
            : { authToken: options.authToken }),
          ...(options.fetchImpl === undefined
            ? {}
            : { fetchImpl: options.fetchImpl }),
          ...(options.eventReplyDispatcher === undefined
            ? {}
            : { eventReplyDispatcher: options.eventReplyDispatcher }),
        });
        const result = await client.execute({
          input: mapping.runtimeVariables,
          ...(options.mockScenario === undefined
            ? {}
            : { mockScenario: options.mockScenario }),
          ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
          ...(options.maxSteps === undefined
            ? {}
            : { maxSteps: options.maxSteps }),
          ...(options.maxLoopIterations === undefined
            ? {}
            : { maxLoopIterations: options.maxLoopIterations }),
          ...(options.defaultTimeoutMs === undefined
            ? {}
            : { defaultTimeoutMs: options.defaultTimeoutMs }),
          async: input.binding.execution?.async ?? true,
        });
        receipt = await updateEventReceipt(
          {
            record: receipt,
            artifactDir: begin.artifactDir,
            status: "dispatched",
            workflowExecutionId: result.workflowExecutionId,
            dispatchPayload: result,
          },
          options,
        );
        return {
          receipt,
          duplicate: false,
          workflowName: result.workflowName,
          workflowExecutionId: result.workflowExecutionId,
        };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        const failed = await updateEventReceipt(
          {
            record: receipt,
            artifactDir: begin.artifactDir,
            status: "failed",
            error: message,
          },
          options,
        );
        return {
          receipt: failed,
          duplicate: false,
          workflowName: input.binding.workflowName,
        };
      }
    },
  };
}

export async function dispatchEventToMatchingBindings(
  input: {
    readonly configuration: EventConfiguration;
    readonly event: ExternalEventEnvelope;
    readonly raw?: unknown;
    readonly runner: WorkflowTriggerRunner;
  },
  options: DivedraOptions = {},
): Promise<readonly WorkflowTriggerResult[]> {
  const source = input.configuration.sources.find(
    (entry) => entry.id === input.event.sourceId && isEventSourceEnabled(entry),
  );
  const bindings = selectMatchingBindings(
    input.configuration.bindings.filter(
      (binding) =>
        binding.sourceId === input.event.sourceId &&
        isEventBindingEnabled(binding),
    ),
    input.event,
  );
  if (bindings.length === 0) {
    const skipped = await beginEventReceipt(
      {
        event: input.event,
        ...(input.raw === undefined ? {} : { raw: input.raw }),
        status: "skipped",
      },
      options,
    );
    return [{ receipt: skipped.record, duplicate: false }];
  }
  const results: WorkflowTriggerResult[] = [];
  for (const binding of bindings) {
    results.push(
      await input.runner.dispatch({
        binding,
        event: input.event,
        ...(source === undefined ? {} : { source }),
        ...(input.raw === undefined ? {} : { raw: input.raw }),
      }),
    );
  }
  return results;
}
