import { createCronEventSourceAdapter } from "./adapters/cron";
import { createMatrixEventSourceAdapter } from "./adapters/matrix";
import { createS3RepositoryEventSourceAdapter } from "./adapters/s3-repository";
import { createWebhookEventSourceAdapter } from "./adapters/webhook";
import type { EventSourceAdapter } from "./source-adapter";

export interface EventSourceRegistry {
  register(adapter: EventSourceAdapter): void;
  get(kind: string): EventSourceAdapter | undefined;
  list(): readonly EventSourceAdapter[];
}

export function createEventSourceRegistry(
  adapters: readonly EventSourceAdapter[] = [],
): EventSourceRegistry {
  const byKind = new Map<string, EventSourceAdapter>();
  const registry: EventSourceRegistry = {
    register(adapter: EventSourceAdapter): void {
      if (byKind.has(adapter.kind)) {
        throw new Error(
          `duplicate event source adapter kind '${adapter.kind}'`,
        );
      }
      byKind.set(adapter.kind, adapter);
    },
    get(kind: string): EventSourceAdapter | undefined {
      return byKind.get(kind);
    },
    list(): readonly EventSourceAdapter[] {
      return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind));
    },
  };
  for (const adapter of adapters) {
    registry.register(adapter);
  }
  return registry;
}

export function createDefaultEventSourceRegistry(): EventSourceRegistry {
  const registry = createEventSourceRegistry();
  registry.register(createCronEventSourceAdapter());
  registry.register(createMatrixEventSourceAdapter());
  registry.register(createWebhookEventSourceAdapter());
  registry.register(createS3RepositoryEventSourceAdapter());
  return registry;
}
