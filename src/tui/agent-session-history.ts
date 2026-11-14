import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CliAgentBackend } from "../workflow/types";

export interface AgentSessionTranscript {
  readonly backend: CliAgentBackend;
  readonly content: string;
  readonly sessionId: string;
  readonly sourcePath: string;
}

interface CodexSessionMeta {
  readonly cliVersion?: string;
  readonly cwd?: string;
  readonly timestamp?: string;
}

interface ClaudeSessionMeta {
  readonly cwd?: string;
  readonly gitBranch?: string;
  readonly version?: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function joinBlocks(blocks: readonly string[]): string {
  return blocks.filter((block) => block.trim().length > 0).join("\n\n");
}

function normalizeMessageText(text: string): string {
  return text.trim().replace(/\r\n/g, "\n");
}

function formatRoleLabel(role: string): string {
  return role.toUpperCase();
}

function formatTranscriptHeader(input: {
  readonly backend: CliAgentBackend;
  readonly sessionId: string;
  readonly sourcePath: string;
  readonly metaLines: readonly string[];
}): string {
  return [
    `Backend: ${input.backend}`,
    `Session ID: ${input.sessionId}`,
    `Source: ${input.sourcePath}`,
    ...input.metaLines,
  ].join("\n");
}

function formatTranscriptEntries(
  entries: readonly Readonly<{ role: string; text: string }>[],
): string {
  if (entries.length === 0) {
    return "(no readable chat messages found in the stored transcript)";
  }
  return entries
    .map(
      (entry) =>
        `[${formatRoleLabel(entry.role)}]\n${normalizeMessageText(entry.text)}`,
    )
    .join("\n\n");
}

function extractCodexMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = content.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry["type"] !== "string") {
      return [];
    }
    if (
      (entry["type"] === "input_text" ||
        entry["type"] === "output_text" ||
        entry["type"] === "text") &&
      typeof entry["text"] === "string"
    ) {
      return [entry["text"]];
    }
    return [];
  });
  return joinBlocks(parts);
}

export function formatCodexSessionTranscript(input: {
  readonly raw: string;
  readonly sessionId: string;
  readonly sourcePath: string;
}): string {
  const messages: Array<Readonly<{ role: string; text: string }>> = [];
  let meta: CodexSessionMeta = {};

  for (const line of input.raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed)) {
      continue;
    }

    if (parsed["type"] === "session_meta" && isRecord(parsed["payload"])) {
      const payload = parsed["payload"];
      meta = {
        ...(typeof payload["cli_version"] === "string"
          ? { cliVersion: payload["cli_version"] }
          : {}),
        ...(typeof payload["cwd"] === "string" ? { cwd: payload["cwd"] } : {}),
        ...(typeof payload["timestamp"] === "string"
          ? { timestamp: payload["timestamp"] }
          : {}),
      };
      continue;
    }

    if (parsed["type"] !== "response_item" || !isRecord(parsed["payload"])) {
      continue;
    }

    const payload = parsed["payload"];
    if (
      payload["type"] !== "message" ||
      typeof payload["role"] !== "string" ||
      !["assistant", "developer", "system", "user"].includes(payload["role"])
    ) {
      continue;
    }

    const text = extractCodexMessageText(payload["content"]);
    if (text.length === 0) {
      continue;
    }
    messages.push({
      role: payload["role"],
      text,
    });
  }

  return [
    formatTranscriptHeader({
      backend: "codex-agent",
      sessionId: input.sessionId,
      sourcePath: input.sourcePath,
      metaLines: [
        ...(meta.timestamp === undefined ? [] : [`Started: ${meta.timestamp}`]),
        ...(meta.cwd === undefined ? [] : [`CWD: ${meta.cwd}`]),
        ...(meta.cliVersion === undefined
          ? []
          : [`CLI Version: ${meta.cliVersion}`]),
      ],
    }),
    "",
    formatTranscriptEntries(messages),
  ].join("\n");
}

function extractClaudeContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = content.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry["type"] !== "string") {
      return [];
    }
    if (entry["type"] === "text" && typeof entry["text"] === "string") {
      return [entry["text"]];
    }
    if (entry["type"] === "tool_use") {
      const toolName =
        typeof entry["name"] === "string" ? entry["name"] : "unknown-tool";
      const toolInput =
        entry["input"] === undefined ? "" : `\n${stringifyUnknown(entry["input"])}`;
      return [`[tool_use:${toolName}]${toolInput}`];
    }
    if (entry["type"] === "tool_result") {
      const toolResult =
        entry["content"] === undefined ? "" : `\n${stringifyUnknown(entry["content"])}`;
      return [`[tool_result]${toolResult}`];
    }
    return [];
  });
  return joinBlocks(parts);
}

export function formatClaudeSessionTranscript(input: {
  readonly raw: string;
  readonly sessionId: string;
  readonly sourcePath: string;
}): string {
  const messages: Array<Readonly<{ role: string; text: string }>> = [];
  let meta: ClaudeSessionMeta = {};

  for (const line of input.raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed)) {
      continue;
    }

    if (
      (parsed["type"] === "user" || parsed["type"] === "assistant") &&
      isRecord(parsed["message"])
    ) {
      meta = {
        ...(typeof parsed["cwd"] === "string" ? { cwd: parsed["cwd"] } : meta),
        ...(typeof parsed["gitBranch"] === "string"
          ? { gitBranch: parsed["gitBranch"] }
          : meta),
        ...(typeof parsed["version"] === "string"
          ? { version: parsed["version"] }
          : meta),
      };
      const message = parsed["message"];
      const role =
        typeof message["role"] === "string"
          ? message["role"]
          : String(parsed["type"]);
      const text = extractClaudeContentText(message["content"]);
      if (text.length > 0) {
        messages.push({ role, text });
      }
    }
  }

  return [
    formatTranscriptHeader({
      backend: "claude-code-agent",
      sessionId: input.sessionId,
      sourcePath: input.sourcePath,
      metaLines: [
        ...(meta.cwd === undefined ? [] : [`CWD: ${meta.cwd}`]),
        ...(meta.gitBranch === undefined
          ? []
          : [`Git Branch: ${meta.gitBranch}`]),
        ...(meta.version === undefined ? [] : [`CLI Version: ${meta.version}`]),
      ],
    }),
    "",
    formatTranscriptEntries(messages),
  ].join("\n");
}

async function findFirstMatchingFile(
  root: string,
  matcher: (filePath: string) => boolean,
): Promise<string | undefined> {
  let entries:
    | Awaited<ReturnType<typeof readdir>>
    | undefined;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFirstMatchingFile(entryPath, matcher);
      if (nested !== undefined) {
        return nested;
      }
      continue;
    }
    if (entry.isFile() && matcher(entryPath)) {
      return entryPath;
    }
  }

  return undefined;
}

async function resolveAgentSessionFilePath(input: {
  readonly backend: CliAgentBackend;
  readonly homeDir: string;
  readonly sessionId: string;
}): Promise<string | undefined> {
  if (input.backend === "codex-agent") {
    return findFirstMatchingFile(
      path.join(input.homeDir, ".codex", "sessions"),
      (filePath) => filePath.endsWith(`${input.sessionId}.jsonl`),
    );
  }
  return findFirstMatchingFile(
    path.join(input.homeDir, ".claude", "projects"),
    (filePath) => path.basename(filePath) === `${input.sessionId}.jsonl`,
  );
}

export async function loadAgentSessionTranscript(input: {
  readonly backend: CliAgentBackend;
  readonly homeDir: string;
  readonly sessionId: string;
}): Promise<AgentSessionTranscript> {
  const sourcePath = await resolveAgentSessionFilePath(input);
  if (sourcePath === undefined) {
    throw new Error(
      `stored ${input.backend} session '${input.sessionId}' was not found under '${input.homeDir}'`,
    );
  }

  const raw = await readFile(sourcePath, "utf8");
  const content =
    input.backend === "codex-agent"
      ? formatCodexSessionTranscript({
          raw,
          sessionId: input.sessionId,
          sourcePath,
        })
      : formatClaudeSessionTranscript({
          raw,
          sessionId: input.sessionId,
          sourcePath,
        });

  return {
    backend: input.backend,
    content,
    sessionId: input.sessionId,
    sourcePath,
  };
}
