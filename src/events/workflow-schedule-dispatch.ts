import { createHash } from "node:crypto";
import { computeNextCronFireTime } from "./adapters/cron";
import {
  createWorkflowTriggerRunner,
  dispatchEventToMatchingBindings,
  type WorkflowTriggerResult,
} from "./trigger-runner";
import type {
  EventBinding,
  EventConfiguration,
  EventSourceConfigBase,
  ExternalEventEnvelope,
  WorkflowScheduleRecord,
} from "./types";
import type {
  ScheduledEvent,
  ScheduledEventManager,
} from "./scheduled-event-manager";
import {
  createWorkflowScheduleRepository,
  type WorkflowScheduleRepository,
} from "./workflow-schedule-registry";
import type { WorkflowTriggerRunnerOptions } from "./workflow-trigger-runner-options";

const SCHEDULER_SOURCE_ID = "divedra-scheduler";
const SCHEDULER_PROVIDER = "divedra-scheduler";
const SCHEDULER_EVENT_TYPE = "workflow.schedule.due";

export interface WorkflowScheduleDuePayload {
  readonly scheduleId: string;
  readonly occurrenceId: string;
  readonly workflowName: string;
  readonly scheduledAt: string;
  readonly timezone: string;
  readonly kind: WorkflowScheduleRecord["kind"];
  readonly sourceId: string;
  readonly bindingId: string;
}

export interface WorkflowScheduleDueRegistration {
  readonly schedule: WorkflowScheduleRecord;
  readonly occurrenceId: string;
  readonly dueAt: string;
  readonly dispatch: (event: ExternalEventEnvelope) => Promise<void>;
}

export interface WorkflowScheduleRehydrateInput
  extends WorkflowTriggerRunnerOptions {
  readonly scheduledEventManager: ScheduledEventManager;
  readonly repository?: WorkflowScheduleRepository;
  readonly now?: Date;
}

export interface WorkflowScheduleDueDispatchInput
  extends WorkflowTriggerRunnerOptions {
  readonly scheduleId: string;
  readonly occurrenceId: string;
  readonly scheduledAt: string;
  readonly firedAt?: string;
  readonly scheduledEventManager?: ScheduledEventManager;
  readonly repository?: WorkflowScheduleRepository;
}

export interface WorkflowScheduleDueDispatchResult {
  readonly schedule: WorkflowScheduleRecord;
  readonly receiptId?: string;
  readonly workflowExecutionId?: string;
  readonly nextDueAt?: string;
}

export interface WorkflowScheduleDispatcher {
  rehydrateActiveSchedules(
    input: WorkflowScheduleRehydrateInput,
  ): Promise<readonly ScheduledEvent[]>;
  dispatchDueOccurrence(
    input: WorkflowScheduleDueDispatchInput,
  ): Promise<WorkflowScheduleDueDispatchResult>;
}

function hashDedupeKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildWorkflowScheduleOccurrenceId(input: {
  readonly scheduleId: string;
  readonly dueAt: string;
}): string {
  return `${input.scheduleId}:${input.dueAt}`;
}

export function buildWorkflowScheduleScheduledEventId(
  scheduleId: string,
): string {
  return `workflow-schedule:${scheduleId}`;
}

export function cancelWorkflowScheduleScheduledEvent(input: {
  readonly scheduledEventManager: ScheduledEventManager;
  readonly scheduleId: string;
}): boolean {
  return input.scheduledEventManager.cancel(
    buildWorkflowScheduleScheduledEventId(input.scheduleId),
  );
}

function buildDuePayload(
  schedule: WorkflowScheduleRecord,
): WorkflowScheduleDuePayload {
  return {
    scheduleId: schedule.scheduleId,
    occurrenceId: buildWorkflowScheduleOccurrenceId({
      scheduleId: schedule.scheduleId,
      dueAt: schedule.nextDueAt,
    }),
    workflowName: schedule.workflowName,
    scheduledAt: schedule.nextDueAt,
    timezone: schedule.timezone,
    kind: schedule.kind,
    sourceId: schedule.sourceId,
    bindingId: schedule.bindingId,
  };
}

function buildDueEnvelope(input: {
  readonly schedule: WorkflowScheduleRecord;
  readonly occurrenceId: string;
  readonly scheduledAt: string;
  readonly firedAt: string;
}): ExternalEventEnvelope {
  const dedupeMaterial = [
    SCHEDULER_SOURCE_ID,
    SCHEDULER_EVENT_TYPE,
    input.schedule.scheduleId,
    input.occurrenceId,
  ].join(":");
  return {
    sourceId: SCHEDULER_SOURCE_ID,
    eventId: `${SCHEDULER_SOURCE_ID}:${input.occurrenceId}`,
    provider: SCHEDULER_PROVIDER,
    eventType: SCHEDULER_EVENT_TYPE,
    occurredAt: input.scheduledAt,
    receivedAt: input.firedAt,
    dedupeKey: hashDedupeKey(dedupeMaterial),
    input: {
      ...input.schedule.workflowInput,
      scheduleId: input.schedule.scheduleId,
      occurrenceId: input.occurrenceId,
      workflowName: input.schedule.workflowName,
      scheduledAt: input.scheduledAt,
      firedAt: input.firedAt,
      timezone: input.schedule.timezone,
      kind: input.schedule.kind,
      workflowInput: input.schedule.workflowInput,
    },
    ...(input.schedule.actorId === undefined
      ? {}
      : { actor: { id: input.schedule.actorId } }),
    ...(input.schedule.conversationId === undefined
      ? {}
      : {
          conversation: {
            id: input.schedule.conversationId,
            ...(input.schedule.threadId === undefined
              ? {}
              : { threadId: input.schedule.threadId }),
          },
        }),
  };
}

function buildGeneratedConfiguration(
  schedule: WorkflowScheduleRecord,
): EventConfiguration {
  const source: EventSourceConfigBase = {
    id: SCHEDULER_SOURCE_ID,
    kind: SCHEDULER_PROVIDER,
    provider: SCHEDULER_PROVIDER,
  };
  const binding: EventBinding = {
    id: `workflow-schedule:${schedule.scheduleId}`,
    sourceId: SCHEDULER_SOURCE_ID,
    match: { eventType: SCHEDULER_EVENT_TYPE },
    workflowName: schedule.workflowName,
    inputMapping: {
      mode: "template",
      template: "{{event.input.workflowInput}}",
    },
    execution: { mode: "direct", async: true },
  };
  return {
    eventRoot: "internal:workflow-schedule",
    sources: [source],
    destinations: [],
    bindings: [binding],
  };
}

function firstReceiptResult(
  results: readonly WorkflowTriggerResult[],
): WorkflowTriggerResult | undefined {
  return results[0];
}

function acceptedDispatch(result: WorkflowTriggerResult | undefined): boolean {
  if (result === undefined) {
    return false;
  }
  return (
    result.duplicate ||
    result.receipt.status === "dispatched" ||
    result.receipt.status === "accepted"
  );
}

function normalizeIsoTimestamp(value: string): string | undefined {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function nextRecurringDueAt(
  schedule: WorkflowScheduleRecord,
  after: string,
): string | undefined {
  if (schedule.kind !== "recurring" || schedule.cron === undefined) {
    return undefined;
  }
  return computeNextCronFireTime(
    schedule.cron,
    new Date(after),
    schedule.timezone,
  ).toISOString();
}

function nextFutureRecurringDueAt(
  schedule: WorkflowScheduleRecord,
  now: Date,
): string | undefined {
  if (schedule.kind !== "recurring" || schedule.cron === undefined) {
    return undefined;
  }
  const currentDueAt = new Date(schedule.nextDueAt);
  if (
    Number.isFinite(currentDueAt.getTime()) &&
    currentDueAt.getTime() > now.getTime()
  ) {
    return undefined;
  }
  return computeNextCronFireTime(
    schedule.cron,
    now,
    schedule.timezone,
  ).toISOString();
}

export function registerNextWorkflowScheduleDueEvent(input: {
  readonly scheduledEventManager: ScheduledEventManager;
  readonly schedule: WorkflowScheduleRecord;
  readonly dispatch: (
    input: WorkflowScheduleDueDispatchInput,
  ) => Promise<unknown>;
}): ScheduledEvent | undefined {
  if (input.schedule.status !== "active") {
    return undefined;
  }
  const payload = buildDuePayload(input.schedule);
  return input.scheduledEventManager.register({
    id: buildWorkflowScheduleScheduledEventId(input.schedule.scheduleId),
    kind: "workflow-schedule",
    dueAt: input.schedule.nextDueAt,
    dedupeKey: hashDedupeKey(
      `${SCHEDULER_SOURCE_ID}:${payload.scheduleId}:${payload.occurrenceId}`,
    ),
    payload: { ...payload },
    fire: async () => {
      await input.dispatch({
        scheduleId: input.schedule.scheduleId,
        occurrenceId: payload.occurrenceId,
        scheduledAt: payload.scheduledAt,
      });
    },
  });
}

export function createWorkflowScheduleDispatcher(
  defaults: WorkflowTriggerRunnerOptions = {},
): WorkflowScheduleDispatcher {
  const repository =
    defaults.workflowScheduleRepository ??
    createWorkflowScheduleRepository(defaults);

  return {
    async rehydrateActiveSchedules(input): Promise<readonly ScheduledEvent[]> {
      const repo = input.repository ?? repository;
      const schedules = await repo.loadActive();
      const registered: ScheduledEvent[] = [];
      const now = input.now ?? new Date();
      for (const schedule of schedules) {
        const nextDueAt = nextFutureRecurringDueAt(schedule, now);
        const scheduleToRegister =
          nextDueAt === undefined
            ? schedule
            : await repo.rescheduleNextDueAt({
                scheduleId: schedule.scheduleId,
                nextDueAt,
              });
        const event = registerNextWorkflowScheduleDueEvent({
          scheduledEventManager: input.scheduledEventManager,
          schedule: scheduleToRegister,
          dispatch: (dispatchInput) =>
            this.dispatchDueOccurrence({
              ...defaults,
              ...input,
              ...dispatchInput,
              repository: repo,
            }),
        });
        if (event !== undefined) {
          registered.push(event);
        }
      }
      return registered;
    },
    async dispatchDueOccurrence(
      input,
    ): Promise<WorkflowScheduleDueDispatchResult> {
      const repo = input.repository ?? repository;
      const schedule = await repo.load(input.scheduleId);
      if (schedule === null) {
        throw new Error(`workflow schedule not found: ${input.scheduleId}`);
      }
      if (input.readOnly === true) {
        return { schedule };
      }
      const scheduledAt = normalizeIsoTimestamp(input.scheduledAt);
      const expectedOccurrenceId = buildWorkflowScheduleOccurrenceId({
        scheduleId: schedule.scheduleId,
        dueAt: schedule.nextDueAt,
      });
      if (schedule.status !== "active") {
        return { schedule };
      }
      if (
        scheduledAt !== schedule.nextDueAt ||
        input.occurrenceId !== expectedOccurrenceId ||
        schedule.lastOccurrenceId === input.occurrenceId
      ) {
        return { schedule };
      }
      const firedAt = input.firedAt ?? new Date().toISOString();
      const firing = await repo.markFiring({
        scheduleId: schedule.scheduleId,
        occurrenceId: input.occurrenceId,
        scheduledAt,
        firedAt,
      });
      if (
        firing.status !== "active" ||
        firing.lastOccurrenceId !== input.occurrenceId
      ) {
        return { schedule: firing };
      }
      const event = buildDueEnvelope({
        schedule: firing,
        occurrenceId: input.occurrenceId,
        scheduledAt: input.scheduledAt,
        firedAt,
      });
      const triggerOptions: WorkflowTriggerRunnerOptions = {
        ...defaults,
        ...input,
      };
      let results: readonly WorkflowTriggerResult[];
      try {
        results = await dispatchEventToMatchingBindings(
          {
            configuration: buildGeneratedConfiguration(firing),
            event,
            runner: createWorkflowTriggerRunner(triggerOptions),
          },
          triggerOptions,
        );
      } catch (error) {
        const nextDueAt = nextRecurringDueAt(firing, input.scheduledAt);
        const failed = await repo.markFailed({
          scheduleId: firing.scheduleId,
          occurrenceId: input.occurrenceId,
          error: error instanceof Error ? error.message : String(error),
          ...(nextDueAt === undefined ? {} : { nextDueAt }),
        });
        if (
          nextDueAt !== undefined &&
          input.scheduledEventManager !== undefined
        ) {
          registerNextWorkflowScheduleDueEvent({
            scheduledEventManager: input.scheduledEventManager,
            schedule: failed,
            dispatch: (dispatchInput) =>
              this.dispatchDueOccurrence({
                ...defaults,
                ...input,
                ...dispatchInput,
                repository: repo,
              }),
          });
        }
        throw error;
      }
      const result = firstReceiptResult(results);
      if (acceptedDispatch(result)) {
        const nextDueAt = nextRecurringDueAt(firing, input.scheduledAt);
        const completed = await repo.markCompleted({
          scheduleId: firing.scheduleId,
          occurrenceId: input.occurrenceId,
          ...(result?.workflowExecutionId === undefined
            ? {}
            : { workflowExecutionId: result.workflowExecutionId }),
          ...(nextDueAt === undefined ? {} : { nextDueAt }),
        });
        if (
          nextDueAt !== undefined &&
          input.scheduledEventManager !== undefined
        ) {
          registerNextWorkflowScheduleDueEvent({
            scheduledEventManager: input.scheduledEventManager,
            schedule: completed,
            dispatch: (dispatchInput) =>
              this.dispatchDueOccurrence({
                ...defaults,
                ...input,
                ...dispatchInput,
                repository: repo,
              }),
          });
        }
        return {
          schedule: completed,
          ...(result?.receipt.receiptId === undefined
            ? {}
            : { receiptId: result.receipt.receiptId }),
          ...(result?.workflowExecutionId === undefined
            ? {}
            : { workflowExecutionId: result.workflowExecutionId }),
          ...(nextDueAt === undefined ? {} : { nextDueAt }),
        };
      }
      const nextDueAt = nextRecurringDueAt(firing, input.scheduledAt);
      const failed = await repo.markFailed({
        scheduleId: firing.scheduleId,
        occurrenceId: input.occurrenceId,
        error: result?.receipt.error ?? "workflow schedule dispatch failed",
        ...(nextDueAt === undefined ? {} : { nextDueAt }),
      });
      if (
        nextDueAt !== undefined &&
        input.scheduledEventManager !== undefined
      ) {
        registerNextWorkflowScheduleDueEvent({
          scheduledEventManager: input.scheduledEventManager,
          schedule: failed,
          dispatch: (dispatchInput) =>
            this.dispatchDueOccurrence({
              ...defaults,
              ...input,
              ...dispatchInput,
              repository: repo,
            }),
        });
      }
      return {
        schedule: failed,
        ...(result?.receipt.receiptId === undefined
          ? {}
          : { receiptId: result.receipt.receiptId }),
      };
    },
  };
}
