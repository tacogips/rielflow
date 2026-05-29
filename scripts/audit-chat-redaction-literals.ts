import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

interface AuditViolation {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly rule: string;
  readonly evidence: string;
}

interface ScanRule {
  readonly id: string;
  readonly pattern: RegExp;
}

const ROOT_SCAN_PATHS = [
  "design-docs/specs/architecture.md",
  "design-docs/specs/design-telegram-gateway-agent-trio.md",
  "examples",
  "packages/rielflow/src/events/adapters",
  "packages/rielflow/src/events/validate-source-telegram-gateway.ts",
  "packages/rielflow-addons/src/native-node-executor/chat-and-gateway-addons.ts",
  "packages/rielflow-addons/src/node-addons/chat-persona-router-config.ts",
  "README.md",
] as const;

const SCANNED_EXTENSIONS = new Set([".json", ".md", ".ts"]);

const RULES: readonly ScanRule[] = [
  {
    id: "telegram-token-bearing-url",
    pattern:
      /(?:api\.telegram\.org\/(?:file\/)?bot|\/(?:file\/)?bot)(?![${<])([A-Za-z0-9:_-]{6,})/giu,
  },
  {
    id: "matrix-access-token-url",
    pattern: /access_token=(?![${<])([^&"'\s)]+)/giu,
  },
  {
    id: "authorization-bearer-literal",
    pattern: /authorization["'\s:]+Bearer\s+(?![${<])([A-Za-z0-9._:-]{6,})/giu,
  },
  {
    id: "exported-secret-literal",
    pattern:
      /export\s+[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD)[A-Z0-9_]*=(?!<)([^\s]+)/giu,
  },
  {
    id: "known-test-secret-literal",
    pattern:
      /(?<![A-Za-z0-9_-])(telegram-secret|matrix-bot-token|secret-token|url-secret|mika-token|bot-token)(?![A-Za-z0-9_-])/giu,
  },
  {
    id: "raw-provider-body-literal",
    pattern: /raw provider body/giu,
  },
];

const ALLOWED_FIXTURE_LITERALS: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  [
    "packages/rielflow/src/events/adapters/telegram-gateway.test.ts",
    new Set(["telegram-secret"]),
  ],
  [
    "packages/rielflow/src/events/adapters/discord-gateway.test.ts",
    new Set(["bot-token", "mika-token"]),
  ],
  [
    "packages/rielflow/src/events/adapters/matrix.test.ts",
    new Set([
      "Authorization: Bearer matrix-bot-token raw provider body",
      "access_token=url-secret",
      "matrix-bot-token",
      "raw provider body",
      "secret-token",
      "url-secret",
    ]),
  ],
  [
    "packages/rielflow/src/events/adapters/chat-sdk.test.ts",
    new Set(["secret-token"]),
  ],
]);

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function evidenceFromMatch(match: RegExpExecArray): string {
  return match[0].trim().slice(0, 160);
}

function isAllowedFixture(input: {
  readonly filePath: string;
  readonly evidence: string;
}): boolean {
  const allowed = ALLOWED_FIXTURE_LITERALS.get(input.filePath);
  if (allowed === undefined) {
    return false;
  }
  for (const literal of allowed) {
    if (input.evidence.includes(literal)) {
      return true;
    }
  }
  return false;
}

function shouldScanFile(filePath: string): boolean {
  return SCANNED_EXTENSIONS.has(path.extname(filePath));
}

async function collectFiles(
  rootDir: string,
  relativePath: string,
): Promise<string[]> {
  const absolutePath = path.join(rootDir, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true }).catch(
    async (error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOTDIR"
      ) {
        return null;
      }
      throw error;
    },
  );

  if (entries === null) {
    return shouldScanFile(relativePath) ? [normalizePath(relativePath)] : [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const childPath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(rootDir, childPath)));
      continue;
    }
    if (entry.isFile() && shouldScanFile(childPath)) {
      files.push(normalizePath(childPath));
    }
  }
  return files;
}

export async function auditChatRedactionLiterals(
  rootDir: string,
): Promise<readonly AuditViolation[]> {
  const files = (
    await Promise.all(
      ROOT_SCAN_PATHS.map((scanPath) => collectFiles(rootDir, scanPath)),
    )
  )
    .flat()
    .sort((left, right) => left.localeCompare(right));
  const violations: AuditViolation[] = [];

  for (const filePath of files) {
    const text = await readFile(path.join(rootDir, filePath), "utf8");
    const lines = text.split(/\r?\n/u);
    for (const [lineIndex, line] of lines.entries()) {
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        let match = rule.pattern.exec(line);
        while (match !== null) {
          const evidence = evidenceFromMatch(match);
          if (!isAllowedFixture({ filePath, evidence })) {
            violations.push({
              filePath,
              lineNumber: lineIndex + 1,
              rule: rule.id,
              evidence,
            });
          }
          match = rule.pattern.exec(line);
        }
      }
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const rootDir = process.argv[2] ?? process.cwd();
  const violations = await auditChatRedactionLiterals(rootDir);
  if (violations.length === 0) {
    console.log("Chat redaction literal audit passed.");
    return;
  }

  console.error(
    "Chat redaction literal audit failed. Unexpected credential, authorization header, raw provider payload, or token-bearing URL literals found:",
  );
  for (const violation of violations) {
    console.error(
      `- ${violation.filePath}:${String(violation.lineNumber)} ${violation.rule}: ${violation.evidence}`,
    );
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
