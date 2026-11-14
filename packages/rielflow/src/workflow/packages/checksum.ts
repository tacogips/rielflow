import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "../result";
import {
  WORKFLOW_PACKAGE_MANIFEST_FILE,
  type WorkflowPackageChecksumAlgorithm,
  type WorkflowPackageFailure,
  type WorkflowPackageIntegrityAlgorithm,
} from "./types";

export interface WorkflowPackageChecksumInput {
  readonly packageRoot: string;
  readonly workflowDirectory: string;
  readonly algorithm?: WorkflowPackageChecksumAlgorithm;
}

export interface WorkflowNodeAddonPackageChecksumInput {
  readonly packageRoot: string;
  readonly algorithm?: WorkflowPackageChecksumAlgorithm;
}

export interface WorkflowPackageChecksumResult {
  readonly checksum: string;
  readonly checksumAlgorithm: WorkflowPackageChecksumAlgorithm;
  readonly includedFiles: readonly string[];
}

export interface WorkflowPackageIntegrityDigestInput {
  readonly packageRoot: string;
  readonly workflowDirectory: string;
  readonly algorithm?: WorkflowPackageIntegrityAlgorithm;
}

export interface WorkflowNodeAddonPackageIntegrityDigestInput {
  readonly packageRoot: string;
  readonly algorithm?: WorkflowPackageIntegrityAlgorithm;
}

export interface WorkflowPackageIntegrityDigestResult {
  readonly digest: string;
  readonly digestAlgorithm: WorkflowPackageIntegrityAlgorithm;
  readonly includedFiles: readonly string[];
}

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
}

function shouldExclude(relativePath: string): boolean {
  return (
    relativePath.startsWith(".git/") ||
    relativePath.startsWith(".rielflow/") ||
    relativePath.includes("/.rielflow/") ||
    relativePath.endsWith(".tmp") ||
    relativePath === ".rielflow-package-provenance.json"
  );
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (shouldExclude(relative)) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function normalizePackageManifestDigestInput(
  parsed: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const rawIntegrity = parsed["integrity"];
  const integrity =
    typeof rawIntegrity === "object" &&
    rawIntegrity !== null &&
    !Array.isArray(rawIntegrity)
      ? {
          ...(rawIntegrity as Readonly<Record<string, unknown>>),
          digest: "",
          signatures: [],
        }
      : undefined;
  return {
    ...parsed,
    checksum: "",
    ...(integrity === undefined ? {} : { integrity }),
  };
}

function normalizeDigestInput(relativePath: string, content: string): string {
  if (relativePath !== WORKFLOW_PACKAGE_MANIFEST_FILE) {
    return content;
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return content;
    }
    return `${JSON.stringify(
      normalizePackageManifestDigestInput(
        parsed as Readonly<Record<string, unknown>>,
      ),
      null,
      2,
    )}\n`;
  } catch {
    return content;
  }
}

async function computePackageDigest(input: {
  readonly packageRoot: string;
  readonly workflowDirectory?: string;
  readonly hashAlgorithm: "md5" | "sha256";
  readonly requireWorkflowBundle: boolean;
}): Promise<
  Result<
    { readonly digest: string; readonly includedFiles: readonly string[] },
    WorkflowPackageFailure
  >
> {
  try {
    const files = await collectFiles(input.packageRoot);
    const hasManifest = files.includes(WORKFLOW_PACKAGE_MANIFEST_FILE);
    const workflowJson =
      input.workflowDirectory === undefined
        ? undefined
        : path
            .join(input.workflowDirectory, "workflow.json")
            .split(path.sep)
            .join("/");
    if (
      !hasManifest ||
      (input.requireWorkflowBundle &&
        (workflowJson === undefined || !files.includes(workflowJson)))
    ) {
      return err(
        packageFailure(
          "MISSING_WORKFLOW_BUNDLE",
          input.requireWorkflowBundle
            ? "package checksum requires rielflow-package.json and workflow.json"
            : "package checksum requires rielflow-package.json",
        ),
      );
    }
    const hash = createHash(input.hashAlgorithm);
    for (const relativePath of files) {
      const content = await readFile(
        path.join(input.packageRoot, relativePath),
        "utf8",
      );
      hash.update(relativePath);
      hash.update("\0");
      hash.update(normalizeDigestInput(relativePath, content));
      hash.update("\0");
    }
    return ok({ digest: hash.digest("hex"), includedFiles: files });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(packageFailure("IO", `failed to compute checksum: ${message}`));
  }
}

export async function computeWorkflowPackageChecksum(
  input: WorkflowPackageChecksumInput,
): Promise<Result<WorkflowPackageChecksumResult, WorkflowPackageFailure>> {
  const algorithm = input.algorithm ?? "md5";
  if (algorithm !== "md5") {
    return err(
      packageFailure("USAGE", "only md5 package checksums are supported"),
    );
  }
  const computed = await computePackageDigest({
    packageRoot: input.packageRoot,
    workflowDirectory: input.workflowDirectory,
    hashAlgorithm: "md5",
    requireWorkflowBundle: true,
  });
  if (!computed.ok) {
    return computed;
  }
  return ok({
    checksum: computed.value.digest,
    checksumAlgorithm: algorithm,
    includedFiles: computed.value.includedFiles,
  });
}

export async function computeWorkflowNodeAddonPackageChecksum(
  input: WorkflowNodeAddonPackageChecksumInput,
): Promise<Result<WorkflowPackageChecksumResult, WorkflowPackageFailure>> {
  const algorithm = input.algorithm ?? "md5";
  if (algorithm !== "md5") {
    return err(
      packageFailure("USAGE", "only md5 package checksums are supported"),
    );
  }
  const computed = await computePackageDigest({
    packageRoot: input.packageRoot,
    hashAlgorithm: "md5",
    requireWorkflowBundle: false,
  });
  if (!computed.ok) {
    return computed;
  }
  return ok({
    checksum: computed.value.digest,
    checksumAlgorithm: algorithm,
    includedFiles: computed.value.includedFiles,
  });
}

export async function computeWorkflowPackageIntegrityDigest(
  input: WorkflowPackageIntegrityDigestInput,
): Promise<
  Result<WorkflowPackageIntegrityDigestResult, WorkflowPackageFailure>
> {
  const algorithm = input.algorithm ?? "sha256";
  if (algorithm !== "sha256") {
    return err(
      packageFailure("USAGE", "only sha256 package integrity is supported"),
    );
  }
  const computed = await computePackageDigest({
    packageRoot: input.packageRoot,
    workflowDirectory: input.workflowDirectory,
    hashAlgorithm: "sha256",
    requireWorkflowBundle: true,
  });
  if (!computed.ok) {
    return computed;
  }
  return ok({
    digest: computed.value.digest,
    digestAlgorithm: algorithm,
    includedFiles: computed.value.includedFiles,
  });
}

export async function computeWorkflowNodeAddonPackageIntegrityDigest(
  input: WorkflowNodeAddonPackageIntegrityDigestInput,
): Promise<
  Result<WorkflowPackageIntegrityDigestResult, WorkflowPackageFailure>
> {
  const algorithm = input.algorithm ?? "sha256";
  if (algorithm !== "sha256") {
    return err(
      packageFailure("USAGE", "only sha256 package integrity is supported"),
    );
  }
  const computed = await computePackageDigest({
    packageRoot: input.packageRoot,
    hashAlgorithm: "sha256",
    requireWorkflowBundle: false,
  });
  if (!computed.ok) {
    return computed;
  }
  return ok({
    digest: computed.value.digest,
    digestAlgorithm: algorithm,
    includedFiles: computed.value.includedFiles,
  });
}
