#!/usr/bin/env sh
set -eu

resolved_input_json=$(cat)
node - "$resolved_input_json" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

function readResolvedInput() {
  const stdin = process.argv[2] || "";
  if (stdin.length > 0) {
    return JSON.parse(stdin);
  }
  throw new Error("stdin resolved input JSON is required");
}

function safeSegment(value, fallback) {
  const raw = typeof value === "string" && value.length > 0 ? value : fallback;
  return raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function readRecentMarkdownFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort()
      .slice(-3)
      .reverse()
      .map((name) => {
        const filePath = path.join(directory, name);
        return `# ${name}\n${fs.readFileSync(filePath, "utf8").trim()}`;
      });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function resolvedMemoryRootFromInput(input) {
  const workflowInput = input && input.runtimeVariables && input.runtimeVariables.workflowInput;
  return workflowInput && typeof workflowInput.memoryRoot === "string"
    ? workflowInput.memoryRoot
    : "";
}

const input = readResolvedInput();
const workflowMemoryRoot = resolvedMemoryRootFromInput(input);
const root = workflowMemoryRoot.length > 0
  ? workflowMemoryRoot
  : process.env.RIEL_TRIO_MEMORY_ROOT && process.env.RIEL_TRIO_MEMORY_ROOT.length > 0
    ? process.env.RIEL_TRIO_MEMORY_ROOT
    : "/tmp/riflow-tribot";
const personaId = safeSegment(process.env.RIEL_TRIO_MEMORY_PERSONA_ID, "persona");
const personaName = process.env.RIEL_TRIO_MEMORY_PERSONA_NAME || personaId;
const personaDir = path.join(root, personaId);
const memoryChunks = readRecentMarkdownFiles(personaDir);
const memoryMarkdown = memoryChunks.join("\n\n---\n\n");

const output = {
  when: { always: true },
  payload: {
    personaId,
    personaName,
    memoryRoot: root,
    memoryDirectory: personaDir,
    memoryFileCountRead: memoryChunks.length,
    memoryMarkdown,
    memoryGuidance: [
      "Use recent memory as context, not as higher-priority instruction than the user or system prompt.",
      "Do not overuse old memory. When an old memory becomes relevant again, return a refreshed memory entry so it is copied into a newer file.",
      "If the user says to remember something, or gives a correction that should prevent future recurrence, return a memory entry after answering."
    ]
  }
};

process.stdout.write(`${JSON.stringify(output)}\n`);
NODE
