#!/usr/bin/env sh
set -eu

mailbox_dir="${RIEL_MAILBOX_DIR:?RIEL_MAILBOX_DIR is required}"
mkdir -p "$mailbox_dir/outbox"

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

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

function readWorkflowMemoryRoot() {
  try {
    const input = JSON.parse(
      fs.readFileSync(path.join(process.env.RIEL_MAILBOX_DIR, "inbox", "input.json"), "utf8"),
    );
    const workflowInput = input && input.runtimeVariables && input.runtimeVariables.workflowInput;
    return workflowInput && typeof workflowInput.memoryRoot === "string"
      ? workflowInput.memoryRoot
      : "";
  } catch {
    return "";
  }
}

const workflowMemoryRoot = readWorkflowMemoryRoot();
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

fs.writeFileSync(
  path.join(process.env.RIEL_MAILBOX_DIR, "outbox", "output.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);
NODE
