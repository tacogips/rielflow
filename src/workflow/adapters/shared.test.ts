import { afterEach, describe, expect, test, vi } from "vitest";
import { AdapterExecutionError } from "../adapter";
import { executeWithRetry } from "./shared";

afterEach(() => {
  vi.useRealTimers();
});

describe("executeWithRetry", () => {
  test("aborts retry backoff immediately when the signal is canceled", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    let attempts = 0;

    const promise = executeWithRetry({
      maxAttempts: 2,
      retryDelayMs: 10_000,
      signal: controller.signal,
      run: async () => {
        attempts += 1;
        throw new AdapterExecutionError("provider_error", "provider offline");
      },
      normalizeError: (error) =>
        error instanceof AdapterExecutionError
          ? error
          : new AdapterExecutionError("provider_error", "unexpected failure"),
    });

    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toMatchObject({
      code: "timeout",
      message: "adapter retry delay aborted",
    });
    expect(attempts).toBe(1);
  });
});