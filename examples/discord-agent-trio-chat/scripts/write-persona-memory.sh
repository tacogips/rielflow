#!/usr/bin/env sh
set -eu

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readResolvedInput() {
  const filePath = process.env.RIEL_RESOLVED_INPUT_PATH;
  if (typeof filePath === "string" && filePath.length > 0) {
    return readJson(filePath);
  }
  const stdin = fs.readFileSync(0, "utf8").trim();
  if (stdin.length > 0) {
    return JSON.parse(stdin);
  }
  throw new Error("RIEL_RESOLVED_INPUT_PATH or stdin resolved input JSON is required");
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeSegment(value, fallback) {
  const raw = typeof value === "string" && value.length > 0 ? value : fallback;
  return raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function upstreamPayloads(input) {
  const directPayloads = (Array.isArray(input.upstream) ? input.upstream : [])
    .map((entry) => entry && entry.output && entry.output.payload)
    .filter(isObject);
  const latestOutputPayloads = (Array.isArray(input.latestOutputs) ? input.latestOutputs : [])
    .map((entry) => entry && entry.payload)
    .filter(isObject);
  return [...directPayloads, ...latestOutputPayloads];
}

function latestPersonaPayload(payloads) {
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const payload = payloads[index];
    if (typeof payload.replyText === "string") {
      return payload;
    }
  }
  return {};
}

function normalizeMemoryEntry(entry) {
  if (typeof entry === "string") {
    const content = entry.trim();
    return content.length > 0
      ? { kind: "note", importance: "normal", content }
      : null;
  }
  if (!isObject(entry)) {
    return null;
  }
  const content = typeof entry.content === "string" ? entry.content.trim() : "";
  if (content.length === 0) {
    return null;
  }
  return {
    kind: typeof entry.kind === "string" && entry.kind.trim().length > 0 ? entry.kind.trim() : "note",
    importance: typeof entry.importance === "string" && entry.importance.trim().length > 0 ? entry.importance.trim() : "normal",
    content,
    ...(typeof entry.source === "string" && entry.source.trim().length > 0 ? { source: entry.source.trim() } : {}),
  };
}

function markdownForEntry(entry, recordedAt) {
  const lines = [
    `## ${recordedAt}`,
    "",
    `- kind: ${entry.kind}`,
    `- importance: ${entry.importance}`,
  ];
  if (entry.source) {
    lines.push(`- source: ${entry.source}`);
  }
  lines.push("", entry.content, "");
  return lines.join("\n");
}

const input = readResolvedInput();
const payloads = upstreamPayloads(input);
const personaPayload = latestPersonaPayload(payloads);
const workflowInput = input && input.runtimeVariables && input.runtimeVariables.workflowInput;
const workflowMemoryRoot = workflowInput && typeof workflowInput.memoryRoot === "string"
  ? workflowInput.memoryRoot
  : "";
const root = workflowMemoryRoot.length > 0
  ? workflowMemoryRoot
  : process.env.RIEL_TRIO_MEMORY_ROOT && process.env.RIEL_TRIO_MEMORY_ROOT.length > 0
    ? process.env.RIEL_TRIO_MEMORY_ROOT
    : "/tmp/riflow-tribot";
const personaId = safeSegment(process.env.RIEL_TRIO_MEMORY_PERSONA_ID, "persona");
const personaName = process.env.RIEL_TRIO_MEMORY_PERSONA_NAME || personaId;
const personaDir = path.join(root, personaId);
const entries = (Array.isArray(personaPayload.memoryEntries) ? personaPayload.memoryEntries : [])
  .map(normalizeMemoryEntry)
  .filter(Boolean);
const recordedAt = new Date().toISOString();
const fileStamp = recordedAt.slice(0, 13).replace("T", "_");
const memoryFile = path.join(personaDir, `${fileStamp}.md`);

if (entries.length > 0) {
  fs.mkdirSync(personaDir, { recursive: true });
  const header = fs.existsSync(memoryFile)
    ? ""
    : `# ${personaName} memory ${fileStamp}\n\n`;
  const body = entries.map((entry) => markdownForEntry(entry, recordedAt)).join("\n");
  fs.appendFileSync(memoryFile, `${header}${body}`);
}

const replyText = typeof personaPayload.replyText === "string" ? personaPayload.replyText : "";
const handoffs = {
  handoff_yui: personaPayload.handoff_yui === true,
  handoff_mika: personaPayload.handoff_mika === true,
  handoff_rina: personaPayload.handoff_rina === true,
};
const output = {
  when: {
    ...handoffs,
    always: true,
  },
  payload: {
    ...personaPayload,
    replyText,
    ...handoffs,
    memory: {
      personaId,
      memoryRoot: root,
      memoryDirectory: personaDir,
      memoryFile: entries.length > 0 ? memoryFile : null,
      entriesWritten: entries.length,
      recordedAt,
    },
  },
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
NODE
