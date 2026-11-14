import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  formatClaudeSessionTranscript,
  formatCodexSessionTranscript,
  loadAgentSessionTranscript,
} from "./agent-session-history";

const tempDirs: string[] = [];

async function createTempHome(): Promise<string> {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "divedra-agent-session-history-test-"),
  );
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (tempDir) => {
      await rm(tempDir, { force: true, recursive: true });
    }),
  );
});

describe("formatCodexSessionTranscript", () => {
  test("renders codex user and assistant messages from stored jsonl", () => {
    const raw = [
      JSON.stringify({
        type: "session_meta",
        payload: {
          cli_version: "0.1.0",
          cwd: "/tmp/demo",
          timestamp: "2026-03-25T00:00:00.000Z",
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello from user" }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello from assistant" }],
        },
      }),
    ].join("\n");

    const transcript = formatCodexSessionTranscript({
      raw,
      sessionId: "codex-session-1",
      sourcePath: "/tmp/codex-session-1.jsonl",
    });

    expect(transcript).toContain("Backend: codex-agent");
    expect(transcript).toContain("Session ID: codex-session-1");
    expect(transcript).toContain("[USER]");
    expect(transcript).toContain("hello from user");
    expect(transcript).toContain("[ASSISTANT]");
    expect(transcript).toContain("hello from assistant");
  });
});

describe("formatClaudeSessionTranscript", () => {
  test("renders claude text and tool events from stored jsonl", () => {
    const raw = [
      JSON.stringify({
        type: "user",
        cwd: "/tmp/demo",
        gitBranch: "main",
        version: "2.0.0",
        message: {
          role: "user",
          content: "open the file",
        },
      }),
      JSON.stringify({
        type: "assistant",
        cwd: "/tmp/demo",
        gitBranch: "main",
        version: "2.0.0",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "working on it" },
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/tmp/demo/file.txt" },
            },
          ],
        },
      }),
    ].join("\n");

    const transcript = formatClaudeSessionTranscript({
      raw,
      sessionId: "claude-session-1",
      sourcePath: "/tmp/claude-session-1.jsonl",
    });

    expect(transcript).toContain("Backend: claude-code-agent");
    expect(transcript).toContain("Git Branch: main");
    expect(transcript).toContain("[USER]");
    expect(transcript).toContain("open the file");
    expect(transcript).toContain("[ASSISTANT]");
    expect(transcript).toContain("[tool_use:Read]");
  });
});

describe("loadAgentSessionTranscript", () => {
  test("finds codex transcripts by backend session id suffix", async () => {
    const homeDir = await createTempHome();
    const codexDir = path.join(homeDir, ".codex", "sessions", "2026", "03", "25");
    await mkdir(codexDir, { recursive: true });
    const sessionId = "019d-session-codex";
    const sourcePath = path.join(
      codexDir,
      `rollout-2026-03-25T00-00-00-${sessionId}.jsonl`,
    );
    await writeFile(
      sourcePath,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "codex transcript body" }],
        },
      })}\n`,
      "utf8",
    );

    const transcript = await loadAgentSessionTranscript({
      backend: "codex-agent",
      homeDir,
      sessionId,
    });

    expect(transcript.sourcePath).toBe(sourcePath);
    expect(transcript.content).toContain("codex transcript body");
  });

  test("finds claude transcripts by exact backend session id filename", async () => {
    const homeDir = await createTempHome();
    const claudeDir = path.join(homeDir, ".claude", "projects", "demo");
    await mkdir(claudeDir, { recursive: true });
    const sessionId = "claude-session-xyz";
    const sourcePath = path.join(claudeDir, `${sessionId}.jsonl`);
    await writeFile(
      sourcePath,
      `${JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "claude transcript body" }],
        },
      })}\n`,
      "utf8",
    );

    const transcript = await loadAgentSessionTranscript({
      backend: "claude-code-agent",
      homeDir,
      sessionId,
    });

    expect(transcript.sourcePath).toBe(sourcePath);
    expect(transcript.content).toContain("claude transcript body");
  });
});
