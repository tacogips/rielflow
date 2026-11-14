import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { detectHookVendor } from "./detect-vendor";
import { HookBlockError } from "./handler";
import { runHookCommand } from "./index";
import { parseHookPayload } from "./parse";
import { HookVendor } from "./types";
import { listRuntimeHookEvents } from "../workflow/runtime-db";

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

function createGeminiHookPayload(
  overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return createHookPayload({
    session_id: "sess-gemini",
    transcript_path: "/tmp/divedra/gemini-transcript.json",
    hook_event_name: "BeforeTool",
    timestamp: "2026-04-20T07:20:00.000Z",
    tool_name: "read_file",
    tool_input: {},
    ...overrides,
  });
}

async function createRootDataDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "divedra-hook-events-"));
}

function createDivedraHookEnv(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    DIVEDRA_WORKFLOW_ID: "wf-hook",
    DIVEDRA_WORKFLOW_EXECUTION_ID: "wfexec-hook-1",
    DIVEDRA_NODE_ID: "node-hook",
    DIVEDRA_NODE_EXEC_ID: "nodeexec-hook-1",
    DIVEDRA_AGENT_BACKEND: "codex-agent",
    ...overrides,
  };
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

  test("detects Gemini tool hooks from Gemini-only event names", () => {
    const parsed = parseHookPayload(
      JSON.stringify(
        createGeminiHookPayload({
          session_id: "sess-gemini-before-tool",
          hook_event_name: "BeforeTool",
        }),
      ),
    );

    expect(
      detectHookVendor({
        payload: parsed.payload,
        eventName: parsed.eventName,
      }),
    ).toBe(HookVendor.Gemini);
  });

  test("detects Gemini lifecycle hooks before Codex transcript heuristics", () => {
    const parsed = parseHookPayload(
      JSON.stringify(
        createGeminiHookPayload({
          session_id: "sess-gemini-session-start",
          hook_event_name: "SessionStart",
        }),
      ),
    );

    expect(
      detectHookVendor({
        payload: parsed.payload,
        eventName: parsed.eventName,
      }),
    ).toBe(HookVendor.Gemini);
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

  test("records workflow-associated hook events with redacted payload artifacts", async () => {
    const capture = createIoCapture();
    const rootDataDir = await createRootDataDir();
    const exitCode = await runHookCommand({
      deps: {
        rootDataDir,
        env: createDivedraHookEnv(),
        readStdin: async () =>
          JSON.stringify(
            createCodexHookPayload({
              session_id: "agent-session-1",
              hook_event_name: "PostToolUse",
              tool_input: {
                command: "echo hello",
                api_key: "secret-value",
              },
              tool_response: {
                stdout: "sensitive output",
              },
            }),
          ),
      },
      explicitVendor: HookVendor.Codex,
      io: capture.io,
    });

    expect(exitCode).toBe(0);
    expect(capture.stderr).toEqual([]);
    expect(JSON.parse(capture.stdout.join("\n"))).toEqual({});

    const events = await listRuntimeHookEvents("wfexec-hook-1", {
      rootDataDir,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workflowId: "wf-hook",
      workflowExecutionId: "wfexec-hook-1",
      nodeId: "node-hook",
      nodeExecId: "nodeexec-hook-1",
      vendor: "codex",
      agentSessionId: "agent-session-1",
      rawEventName: "PostToolUse",
      eventName: "PostToolUse",
      status: "recorded",
    });
    expect(events[0]?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    const payloadRef = JSON.parse(events[0]?.payloadRefJson ?? "{}") as {
      readonly path?: string;
    };
    expect(payloadRef.path).toBeDefined();
    const artifactText = await readFile(
      path.join(rootDataDir, payloadRef.path ?? ""),
      "utf8",
    );
    const artifact = JSON.parse(artifactText) as {
      readonly tool_input?: { readonly api_key?: string };
      readonly tool_response?: { readonly stdout?: string };
    };
    expect(artifact.tool_input?.api_key).toBe("[REDACTED]");
    expect(artifact.tool_response?.stdout).toBe("[REDACTED]");
  });

  test("records blocked hook policy outcomes", async () => {
    const capture = createIoCapture();
    const rootDataDir = await createRootDataDir();
    const exitCode = await runHookCommand({
      deps: {
        rootDataDir,
        env: createDivedraHookEnv({
          DIVEDRA_WORKFLOW_EXECUTION_ID: "wfexec-hook-block",
        }),
        readStdin: async () =>
          JSON.stringify(
            createHookPayload({
              session_id: "agent-session-block",
              hook_event_name: "PreToolUse",
            }),
          ),
        dispatchHook: async () => {
          throw new HookBlockError("blocked by hook policy");
        },
      },
      explicitVendor: HookVendor.ClaudeCode,
      io: capture.io,
    });

    expect(exitCode).toBe(2);
    const events = await listRuntimeHookEvents("wfexec-hook-block", {
      rootDataDir,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      status: "blocked",
      error: "blocked by hook policy",
      agentSessionId: "agent-session-block",
    });
  });

  test("required hook recording fails when divedra context is missing", async () => {
    const capture = createIoCapture();
    const exitCode = await runHookCommand({
      deps: {
        env: { DIVEDRA_HOOK_RECORDING: "required" },
        readStdin: async () =>
          JSON.stringify(
            createHookPayload({
              session_id: "agent-session-missing-context",
            }),
          ),
      },
      io: capture.io,
    });

    expect(exitCode).toBe(1);
    expect(capture.stderr[0]).toContain("missing divedra hook context");
  });
});