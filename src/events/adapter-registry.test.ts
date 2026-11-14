import { describe, expect, test } from "vitest";
import {
  createDefaultEventSourceRegistry,
  createEventSourceRegistry,
} from "./adapter-registry";
import type { EventSourceAdapter } from "./source-adapter";

function createMockAdapter(kind: string): EventSourceAdapter {
  return {
    kind,
    capabilities: {
      eventTypes: [`${kind}.event`],
      supportsStart: false,
      webhook: false,
    },
    async start(input) {
      return {
        sourceId: input.source.id,
        stop: async () => {},
      };
    },
    async normalize(raw) {
      return {
        sourceId: raw.sourceId,
        eventId: `${kind}-event`,
        provider: kind,
        eventType: `${kind}.event`,
        receivedAt: raw.receivedAt,
        dedupeKey: `${kind}-dedupe`,
        input: {},
      };
    },
  };
}

describe("event source registry", () => {
  test("supports mock adapters without external provider APIs", () => {
    const registry = createEventSourceRegistry([
      createMockAdapter("zeta"),
      createMockAdapter("alpha"),
    ]);

    expect(registry.get("alpha")?.kind).toBe("alpha");
    expect(registry.list().map((adapter) => adapter.kind)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  test("rejects duplicate adapter kinds", () => {
    const registry = createEventSourceRegistry([createMockAdapter("mock")]);

    expect(() => registry.register(createMockAdapter("mock"))).toThrow(
      "duplicate event source adapter kind 'mock'",
    );
  });

  test("default registry contains offline-testable built-in adapters", () => {
    const registry = createDefaultEventSourceRegistry();

    expect(registry.list().map((adapter) => adapter.kind)).toEqual([
      "cron",
      "s3-repository",
      "webhook",
    ]);
  });
});