import { afterEach, describe, expect, test, vi } from "vitest";
import { AdapterExecutionError } from "../adapter";
import { executeWithRetry, normalizeAdapterFailure } from "./shared";

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

describe("normalizeAdapterFailure", () => {
  test("preserves diagnostic fields from non-Error thrown values", () => {
    const error = normalizeAdapterFailure(
      {
        command: "codex exec --json",
        exitCode: 2,
        stderr: "unsupported model",
      },
      "unknown codex adapter failure",
    );

    const message = error.message;
    expect(error.code).toBe("provider_error");
    expect(message).toEqual(
      expect.stringContaining("unknown codex adapter failure"),
    );
    expect(message).toEqual(
      expect.stringContaining('"command":"codex exec --json"'),
    );
    expect(message).toEqual(expect.stringContaining('"exitCode":2'));
    expect(message).toEqual(
      expect.stringContaining('"stderr":"unsupported model"'),
    );
  });
});
