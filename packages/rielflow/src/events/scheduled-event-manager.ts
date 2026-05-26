export type ScheduledEventKind =
  | "cron"
  | "workflow-sleep"
  | "workflow-schedule";

export type ScheduledEventStatus =
  | "pending"
  | "firing"
  | "fired"
  | "cancelled"
  | "failed";

export interface ScheduledEvent {
  readonly id: string;
  readonly kind: ScheduledEventKind;
  readonly dueAt: string;
  readonly dedupeKey: string;
  readonly status: ScheduledEventStatus;
  readonly attempt: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly lastError?: string;
}

export interface ScheduledEventRegistration {
  readonly id: string;
  readonly kind: ScheduledEventKind;
  readonly dueAt: string | Date;
  readonly dedupeKey: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly fire: (event: ScheduledEvent) => Promise<void> | void;
}

interface ScheduledEventPoolEntry {
  readonly event: ScheduledEvent;
  readonly fire: (event: ScheduledEvent) => Promise<void> | void;
}

export interface ScheduledEventManager {
  register(input: ScheduledEventRegistration): ScheduledEvent;
  cancel(eventId: string): boolean;
  get(eventId: string): ScheduledEvent | undefined;
  list(): readonly ScheduledEvent[];
  stop(): void;
}

export interface ScheduledEventManagerOptions {
  readonly now?: () => Date;
  readonly timerPrecisionMs?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown scheduled error";
}

function normalizeDueAt(dueAt: string | Date): string {
  const date = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`invalid scheduled event dueAt '${String(dueAt)}'`);
  }
  return date.toISOString();
}

export function createScheduledEventManager(
  options: ScheduledEventManagerOptions = {},
): ScheduledEventManager {
  const now = options.now ?? (() => new Date());
  const timerPrecisionMs = options.timerPrecisionMs ?? 500;
  const pool = new Map<string, ScheduledEventPoolEntry>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let firing = false;

  const replaceEvent = (
    event: ScheduledEvent,
    fire: (event: ScheduledEvent) => Promise<void> | void,
  ): ScheduledEvent => {
    pool.set(event.id, { event, fire });
    return event;
  };

  const updateEvent = (
    eventId: string,
    patch: Partial<Omit<ScheduledEvent, "id">>,
  ): ScheduledEvent | undefined => {
    const entry = pool.get(eventId);
    if (entry === undefined) {
      return undefined;
    }
    const event: ScheduledEvent = {
      ...entry.event,
      ...patch,
      updatedAt: now().toISOString(),
    };
    replaceEvent(event, entry.fire);
    return event;
  };

  const clearCurrentTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const pendingEntries = (): ScheduledEventPoolEntry[] =>
    [...pool.values()].filter((entry) => entry.event.status === "pending");

  const nextPendingEntry = (): ScheduledEventPoolEntry | undefined =>
    pendingEntries().sort(
      (left, right) =>
        new Date(left.event.dueAt).getTime() -
        new Date(right.event.dueAt).getTime(),
    )[0];

  const fireDue = async (): Promise<void> => {
    if (stopped || firing) {
      return;
    }
    firing = true;
    try {
      for (;;) {
        const nowMs = now().getTime();
        const due = pendingEntries().filter(
          (entry) => new Date(entry.event.dueAt).getTime() <= nowMs,
        );
        if (due.length === 0) {
          return;
        }
        due.sort(
          (left, right) =>
            new Date(left.event.dueAt).getTime() -
            new Date(right.event.dueAt).getTime(),
        );
        for (const entry of due) {
          const current = pool.get(entry.event.id);
          if (current?.event.status !== "pending") {
            continue;
          }
          const firingEvent = updateEvent(entry.event.id, {
            status: "firing",
            attempt: current.event.attempt + 1,
          });
          if (firingEvent === undefined) {
            continue;
          }
          try {
            await current.fire(firingEvent);
            const afterFire = pool.get(entry.event.id)?.event;
            if (
              afterFire?.status === "firing" &&
              afterFire.dueAt === firingEvent.dueAt
            ) {
              updateEvent(entry.event.id, { status: "fired" });
            }
          } catch (error: unknown) {
            const afterFailure = pool.get(entry.event.id)?.event;
            if (
              afterFailure?.status === "firing" &&
              afterFailure.dueAt === firingEvent.dueAt
            ) {
              updateEvent(entry.event.id, {
                status: "failed",
                lastError: errorMessage(error),
              });
            }
          }
        }
      }
    } finally {
      firing = false;
      arm();
    }
  };

  function arm(): void {
    if (stopped) {
      return;
    }
    clearCurrentTimer();
    const next = nextPendingEntry();
    if (next === undefined) {
      return;
    }
    const delayMs = Math.max(
      0,
      new Date(next.event.dueAt).getTime() - now().getTime(),
    );
    const roundedDelayMs =
      delayMs <= timerPrecisionMs
        ? delayMs
        : Math.ceil(delayMs / timerPrecisionMs) * timerPrecisionMs;
    timer = setTimeout(() => {
      void fireDue();
    }, roundedDelayMs);
  }

  return {
    register(input): ScheduledEvent {
      if (stopped) {
        throw new Error("scheduled event manager is stopped");
      }
      const timestamp = now().toISOString();
      const previous = pool.get(input.id)?.event;
      const event: ScheduledEvent = {
        id: input.id,
        kind: input.kind,
        dueAt: normalizeDueAt(input.dueAt),
        dedupeKey: input.dedupeKey,
        status: "pending",
        attempt: previous?.attempt ?? 0,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...(input.payload === undefined ? {} : { payload: input.payload }),
      };
      replaceEvent(event, input.fire);
      arm();
      return event;
    },
    cancel(eventId): boolean {
      const current = pool.get(eventId);
      if (current === undefined) {
        return false;
      }
      if (current.event.status !== "pending") {
        return false;
      }
      updateEvent(eventId, { status: "cancelled" });
      arm();
      return true;
    },
    get(eventId): ScheduledEvent | undefined {
      return pool.get(eventId)?.event;
    },
    list(): readonly ScheduledEvent[] {
      return [...pool.values()].map((entry) => entry.event);
    },
    stop(): void {
      stopped = true;
      clearCurrentTimer();
    },
  };
}
