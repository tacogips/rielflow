import { describe, expect, test } from "vitest";
import { detectHookVendor } from "./detect-vendor";
import { HookBlockError } from "./handler";
import { runHookCommand } from "./index";
import { parseHookPayload } from "./parse";
import { HookVendor } from "./types";

function createIoCapture(): {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly io: {
    readonly stdout: (line: string) => void;
    readonly stderr: (line: string) => void;
  };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (line: string) => {
        stdout.push(line);
      },
      stderr: (line: string) => {
        stderr.push(line);
      },
    },
  };
}

function createHookPayload(
  overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    session_id: "sess-default",
    cwd: "/tmp/divedra",
    hook_event_name: "SessionStart",
    ...overrides,
  };
}

function createCodexHookPayload(
  overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return createHookPayload({
    transcript_path: "/tmp/divedra/transcript.jsonl",
    model: "gpt-5",
    ...overrides,
  });
}

describe("runHookCommand", () => {
  test("accepts Claude payloads without Codex-only fields", async () => {
    const capture = createIoCapture();
    const exitCode = await runHookCommand({
      deps: {
        readStdin: async () =>
          JSON.stringify(
            createHookPayload({
              session_id: "sess-001",
              hook_event_name: "SessionStart",
              source: "startup",
            }),
          ),
      },
      explicitVendor: HookVendor.ClaudeCode,
      io: capture.io,
    });

    expect(exitCode).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({});
  });

  test("detects Codex SessionStart heuristically from documented common fields", () => {
    const parsed = parseHookPayload(
      JSON.stringify(
        createCodexHookPayload({
          session_id: "sess-codex-session-start",
          hook_event_name: "SessionStart",
          source: "resume",
        }),
      ),
    );

    expect(
      detectHookVendor({
        payload: parsed.payload,
        eventName: parsed.eventName,
      }),
    ).toBe(HookVendor.Codex);
  });

  test("accepts snake_case event names and detects codex heuristically", async () => {
    const capture = createIoCapture();
    const exitCode = await runHookCommand({
      deps: {
        readStdin: async () =>
          JSON.stringify(
            createCodexHookPayload({
              session_id: "sess-002",
              hook_event_name: "session_start",
              source: "resume",
            }),
          ),
      },
      io: capture.io,
    });

    expect(exitCode).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({});
  });

  test("prefers the explicit vendor over heuristic detection hints", async () => {
    const capture = createIoCapture();
    let capturedVendor: HookVendor | undefined;

    const exitCode = await runHookCommand({
      deps: {
        readStdin: async () =>
          JSON.stringify(
            createCodexHookPayload({
              session_id: "sess-explicit-vendor",
              hook_event_name: "SessionStart",
            }),
          ),
        dispatchHook: async (ctx) => {
          capturedVendor = ctx.vendor;
          return {};
        },
      },
      explicitVendor: HookVendor.ClaudeCode,
      io: capture.io,
    });

    expect(exitCode).toBe(0);
    expect(capturedVendor).toBe(HookVendor.ClaudeCode);
    expect(capture.stderr).toEqual([]);
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({});
  });

  test("returns exit 1 for invalid JSON", async () => {
    const capture = createIoCapture();
    const exitCode = await runHookCommand({
      deps: {
        readStdin: async () => "{not-json",
      },
      io: capture.io,
    });

    expect(exitCode).toBe(1);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr[0]).toContain("invalid hook JSON");
  });

  test("returns exit 1 when required transport fields are missing", async () => {
    const capture = createIoCapture();
    const exitCode = await runHookCommand({
      deps: {
        readStdin: async () =>
          JSON.stringify({
            session_id: "sess-003",
            transcript_path: "/tmp/divedra/transcript.jsonl",
            hook_event_name: "SessionStart",
          }),
      },
      io: capture.io,
    });

    expect(exitCode).toBe(1);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toEqual([
      "hook payload field 'cwd' must be a non-empty string",
    ]);
  });

  test("returns exit 1 when optional transcript_path has the wrong type", async () => {
    const capture = createIoCapture();
    const exitCode = await runHookCommand({
      deps: {
        readStdin: async () =>
          JSON.stringify(
            createHookPayload({
              session_id: "sess-003b",
              transcript_path: 42,
            }),
          ),
      },
      io: capture.io,
    });

    expect(exitCode).toBe(1);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toEqual([
      "hook payload field 'transcript_path' must be a string, null, or omitted",
    ]);
  });

  test("returns exit 1 when optional model has the wrong type", async () => {
    const capture = createIoCapture();
    const exitCode = await runHookCommand({
      deps: {
        readStdin: async () =>
          JSON.stringify(
            createHookPayload({
              session_id: "sess-003c",
              model: 42,
            }),
          ),
      },
      io: capture.io,
    });

    expect(exitCode).toBe(1);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toEqual([
      "hook payload field 'model' must be a string when present",
    ]);
  });

  test("falls back to noop for unknown events without stderr noise", async () => {
    const capture = createIoCapture();
    const exitCode = await runHookCommand({
      deps: {
        readStdin: async () =>
          JSON.stringify(
            createCodexHookPayload({
              session_id: "sess-004",
              hook_event_name: "FutureHookEvent",
              turn_id: "turn-001",
            }),
          ),
      },
      io: capture.io,
    });

    expect(exitCode).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({});
  });

  test("returns exit 2 when a handler blocks execution", async () => {
    const capture = createIoCapture();
    const exitCode = await runHookCommand({
      deps: {
        readStdin: async () =>
          JSON.stringify(
            createHookPayload({
              session_id: "sess-blocked",
            }),
          ),
        dispatchHook: async () => {
          throw new HookBlockError("blocked by hook policy");
        },
      },
      io: capture.io,
    });

    expect(exitCode).toBe(2);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr).toEqual(["blocked by hook policy"]);
  });
});
