import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  WorkflowPackagePreInstallCheckMode,
  WorkflowPackagePreInstallCheckResult,
  WorkflowPackagePreInstallFinding,
  WorkflowPackagePreInstallFindingSeverity,
} from "./types";

const SCANNER_VERSION = "static-v1";
const BLOCKING_SEVERITIES = new Set<WorkflowPackagePreInstallFindingSeverity>([
  "high",
  "critical",
]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".sh",
  ".bash",
  ".zsh",
  ".js",
  ".ts",
]);

interface StaticRule {
  readonly id: string;
  readonly severity: WorkflowPackagePreInstallFindingSeverity;
  readonly ruleName: string;
  readonly pattern: RegExp;
  readonly remediation: string;
}

export interface WorkflowPackageStaticScanInput {
  readonly packageDirectory: string;
  readonly workflowDirectory: string;
  readonly mode: WorkflowPackagePreInstallCheckMode;
}

export interface WorkflowPackageStaticScanner {
  scan(
    input: WorkflowPackageStaticScanInput,
  ): Promise<WorkflowPackagePreInstallCheckResult>;
}

const RULES: readonly StaticRule[] = [
  {
    id: "prompt-injection-instruction-override",
    severity: "high",
    ruleName: "Instruction override prompt injection",
    pattern:
      /\b(ignore|disregard|override)\b.{0,80}\b(previous|prior|system|developer)\b.{0,80}\b(instructions?|messages?|prompt)\b/is,
    remediation:
      "Remove prompt text that instructs agents to ignore higher-priority instructions.",
  },
  {
    id: "credential-exfiltration",
    severity: "critical",
    ruleName: "Credential exfiltration instruction",
    pattern:
      /\b(secret|token|api[_-]?key|ssh[_-]?key|credential|env(?:ironment)? variables?)\b.{0,120}\b(send|upload|post|curl|wget|exfiltrate|leak)\b/is,
    remediation:
      "Remove instructions or scripts that read and transmit credentials or environment data.",
  },
  {
    id: "local-file-network-transfer",
    severity: "high",
    ruleName: "Local file read with network transfer",
    pattern:
      /\b(cat|tar|zip|base64|open|read)\b.{0,120}\b(\.ssh|\.env|credentials?|secrets?|\/etc\/passwd)\b.{0,160}\b(curl|wget|nc|netcat|http:\/\/|https:\/\/)\b/is,
    remediation:
      "Separate local file access from network transfer and remove sensitive-path access.",
  },
  {
    id: "suspicious-shell-download-exec",
    severity: "medium",
    ruleName: "Suspicious shell download and execution",
    pattern: /\b(curl|wget)\b.{0,120}\|\s*(sh|bash|zsh)\b/is,
    remediation:
      "Avoid download-and-execute shell patterns in workflow package content.",
  },
];

function isTextCandidate(relativePath: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function sanitizeEvidence(rawEvidence: string): string {
  return rawEvidence
    .replace(
      /(RIEL_[A-Z0-9_]*|[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASS)[A-Z0-9_]*)=([^\s"'`]+)/g,
      "$1=<redacted>",
    )
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "<redacted-private-key>",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function statusForFindings(
  findings: readonly WorkflowPackagePreInstallFinding[],
  mode: WorkflowPackagePreInstallCheckMode,
): WorkflowPackagePreInstallCheckResult["status"] {
  if (findings.length === 0) {
    return "passed";
  }
  if (
    mode === "reject" &&
    findings.some((finding) => BLOCKING_SEVERITIES.has(finding.severity))
  ) {
    return "failed";
  }
  return "warned";
}

async function listFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") {
          continue;
        }
        await visit(absolutePath);
      } else if (entry.isFile()) {
        results.push(absolutePath);
      }
    }
  }
  await visit(root);
  return results;
}

async function createFindingForExecutable(
  packageDirectory: string,
  filePath: string,
): Promise<WorkflowPackagePreInstallFinding | undefined> {
  const stat = await lstat(filePath);
  if ((stat.mode & 0o111) === 0) {
    return undefined;
  }
  const relativePath = path.relative(packageDirectory, filePath);
  if (
    relativePath.startsWith(`prompts${path.sep}`) ||
    relativePath.endsWith("workflow.json") ||
    relativePath.includes(`${path.sep}nodes${path.sep}`)
  ) {
    return undefined;
  }
  return {
    id: "unexpected-executable-file",
    severity: "medium",
    relativePath,
    evidence: "executable bit set on package file",
    ruleName: "Unexpected executable file",
    remediation:
      "Remove executable permissions unless the package explicitly documents the file as inert content.",
  };
}

async function scanWorkflowPackage(
  input: WorkflowPackageStaticScanInput,
): Promise<WorkflowPackagePreInstallCheckResult> {
  const findings: WorkflowPackagePreInstallFinding[] = [];
  const files = await listFiles(input.packageDirectory);
  for (const filePath of files) {
    const relativePath = path.relative(input.packageDirectory, filePath);
    const executableFinding = await createFindingForExecutable(
      input.packageDirectory,
      filePath,
    );
    if (executableFinding !== undefined) {
      findings.push(executableFinding);
    }
    if (!isTextCandidate(relativePath)) {
      continue;
    }
    const content = await readFile(filePath, "utf8");
    for (const rule of RULES) {
      const match = rule.pattern.exec(content);
      if (match === null) {
        continue;
      }
      findings.push({
        id: rule.id,
        severity: rule.severity,
        relativePath,
        evidence: sanitizeEvidence(match[0]),
        ruleName: rule.ruleName,
        remediation: rule.remediation,
      });
    }
  }
  return {
    enabled: true,
    mode: input.mode,
    status: statusForFindings(findings, input.mode),
    scannerVersion: SCANNER_VERSION,
    findings,
  };
}

export function createWorkflowPackageStaticScanner(): WorkflowPackageStaticScanner {
  return { scan: scanWorkflowPackage };
}
