import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkflowRelativeNodeFilePath } from "./authored-node";
import { NODE_TEMPLATE_FIELD_SPECS } from "./node-template-fields";
import {
  isSafeWorkflowRelativePath,
  resolveWorkflowRelativePath,
} from "./prompt-template-file";
import { err, ok, type Result } from "./result";

export interface RevisionFailure {
  readonly code: "NOT_FOUND" | "IO";
  readonly message: string;
}

export function collectPromptTemplateFiles(
  nodePayloads: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [...new Set(
    Object.values(nodePayloads)
      .flatMap((payload) => {
        if (typeof payload !== "object" || payload === null) {
          return [];
        }
        const payloadRecord = payload as Record<string, unknown>;
        return NODE_TEMPLATE_FIELD_SPECS.flatMap((spec) => {
          const templateFile = payloadRecord[spec.fileField];
          return typeof templateFile === "string" && templateFile.length > 0
            ? [templateFile]
            : [];
        });
      })
      .sort((a, b) => a.localeCompare(b)),
  )];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function computeWorkflowRevisionFromFiles(
  workflowDirectory: string,
  nodeFiles: readonly string[],
  extraFiles: readonly string[] = [],
): Promise<Result<string, RevisionFailure>> {
  const sortedNodeFiles = [...nodeFiles].sort((a, b) => a.localeCompare(b));
  const sortedExtraFiles = [...extraFiles].sort((a, b) => a.localeCompare(b));
  for (const fileName of sortedExtraFiles) {
    if (!isSafeWorkflowRelativePath(fileName)) {
      return err({
        code: "IO",
        message:
          `invalid workflow-relative file '${fileName}' used in revision computation`,
      });
    }
  }
  const nodeFileSet = new Set(sortedNodeFiles);
  const extraFileSet = new Set(sortedExtraFiles);
  const files = [
    "workflow.json",
    "workflow-vis.json",
    ...sortedNodeFiles,
    ...sortedExtraFiles,
  ];

  try {
    const chunks: string[] = [];
    for (const fileName of files) {
      const filePath = extraFileSet.has(fileName)
        ? resolveWorkflowRelativePath(workflowDirectory, fileName)
        : nodeFileSet.has(fileName)
          ? resolveWorkflowRelativeNodeFilePath(workflowDirectory, fileName)
          : ok(path.join(workflowDirectory, fileName));
      if (!filePath.ok) {
        return err({
          code: "IO",
          message: filePath.error.message,
        });
      }
      const content = await readFile(filePath.value, "utf8");
      chunks.push(`${fileName}\n${content}`);
    }
    const digest = sha256(chunks.join("\n---\n"));
    return ok(`sha256:${digest}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("ENOENT")) {
      return err({
        code: "NOT_FOUND",
        message: `workflow file is missing: ${message}`,
      });
    }
    return err({
      code: "IO",
      message: `failed computing workflow revision: ${message}`,
    });
  }
}
