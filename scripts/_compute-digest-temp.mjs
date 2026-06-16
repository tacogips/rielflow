import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const files = [
  "Sources/CursorCLIAgent/CursorCLIAgentEffortResolution.swift",
  "Sources/CursorCLIAgent/CursorCLIAgentAdapter.swift",
  "Tests/AgentAdapterTests/AgentAdapterTests.swift",
  "packages/rielflow-adapters/src/cursor.ts",
  "packages/rielflow/src/workflow/adapters/cursor.test.ts",
];

const lines = files.map((file) => {
  const filePath = join(root, file);
  const bytes = readFileSync(filePath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return `${hash}  ${filePath}`;
});
const digest = createHash("sha256").update(`${lines.join("\n")}\n`).digest("hex");
process.stdout.write(digest);
