import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "../result";
import type { WorkflowCheckoutFailure } from "./types";

export interface WorkflowCheckoutContentDigest {
  readonly contentDigestAlgorithm: "sha256";
  readonly contentDigest: string;
  readonly includedFiles: readonly string[];
}

function checkoutFailure(
  code: WorkflowCheckoutFailure["code"],
  message: string,
): WorkflowCheckoutFailure {
  return { code, message };
}

function shouldExclude(relativePath: string): boolean {
  return (
    relativePath === ".git" ||
    relativePath.startsWith(".git/") ||
    relativePath === ".rielflow" ||
    relativePath.startsWith(".rielflow/") ||
    relativePath.includes("/.rielflow/") ||
    relativePath.endsWith(".tmp") ||
    relativePath === ".rielflow-package-provenance.json"
  );
}

async function collectContentDigestFiles(
  rootDirectory: string,
): Promise<readonly string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path
        .relative(rootDirectory, absolutePath)
        .split(path.sep)
        .join("/");
      if (shouldExclude(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  await visit(rootDirectory);
  return files.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

export async function computeWorkflowCheckoutContentDigest(
  workflowDirectory: string,
): Promise<Result<WorkflowCheckoutContentDigest, WorkflowCheckoutFailure>> {
  try {
    const includedFiles = await collectContentDigestFiles(workflowDirectory);
    const hash = createHash("sha256");
    for (const relativePath of includedFiles) {
      hash.update(relativePath, "utf8");
      hash.update("\0", "utf8");
      const content = await readFile(
        path.join(workflowDirectory, relativePath),
      );
      hash.update(String(content.byteLength), "utf8");
      hash.update("\0", "utf8");
      hash.update(content.toString("base64"), "utf8");
      hash.update("\0", "utf8");
    }
    return ok({
      contentDigestAlgorithm: "sha256",
      contentDigest: `sha256:${hash.digest("hex")}`,
      includedFiles,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      checkoutFailure(
        "IO",
        `failed computing workflow checkout content digest: ${message}`,
      ),
    );
  }
}
