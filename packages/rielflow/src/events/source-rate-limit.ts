import type { ChatSdkSourceConfig, EventSourceConfig } from "./types";

export interface EventSourceRateLimitPolicy {
  readonly sourceId: string;
  readonly windowMs: number;
  readonly maxRequests: number;
}

interface RateLimitBucket {
  windowStartedAt: number;
  count: number;
}

export interface EventSourceRateLimiter {
  accept(source: EventSourceConfig, now: Date): boolean;
}

export function resolveEventSourceRateLimitPolicy(
  source: EventSourceConfig,
): EventSourceRateLimitPolicy | undefined {
  if (source.kind !== "chat-sdk") {
    return undefined;
  }
  const rateLimit = (source as ChatSdkSourceConfig).webhook.rateLimit;
  return {
    sourceId: source.id,
    windowMs: rateLimit?.windowMs ?? 60_000,
    maxRequests: rateLimit?.maxRequests ?? 60,
  };
}

export function createEventSourceRateLimiter(): EventSourceRateLimiter {
  const buckets = new Map<string, RateLimitBucket>();
  return {
    accept(source: EventSourceConfig, now: Date): boolean {
      const policy = resolveEventSourceRateLimitPolicy(source);
      if (policy === undefined) {
        return true;
      }
      const current = now.getTime();
      const existing = buckets.get(policy.sourceId);
      if (
        existing === undefined ||
        current - existing.windowStartedAt >= policy.windowMs
      ) {
        buckets.set(policy.sourceId, { windowStartedAt: current, count: 1 });
        return true;
      }
      if (existing.count >= policy.maxRequests) {
        return false;
      }
      existing.count += 1;
      return true;
    },
  };
}
