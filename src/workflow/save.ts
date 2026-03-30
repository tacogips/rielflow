import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile, atomicWriteTextFile } from "../shared/fs";
import { NODE_TEMPLATE_FIELD_SPECS } from "./node-template-fields";
import {
  remapAuthoredNodePayloadsByNodeFile,
  resolveAuthoredNodeFileReference,
} from "./authored-node";
import { resolveWorkflowRelativePath } from "./prompt-template-file";
import { err, ok, type Result } from "./result";
import { isSafeWorkflowName, resolveEffectiveRoots } from "./paths";
import { validateWorkflowBundle } from "./validate";
import {
  collectPromptTemplateFiles,
  computeWorkflowRevisionFromFiles,
} from "./revision";
import type { LoadOptions } from "./types";

export interface SaveWorkflowInput {
  readonly workflow: unknown;
  readonly workflowVis: unknown;
  readonly nodePayloads: Readonly<Record<string, unknown>>;
  readonly expectedRevision?: string;
}

export interface SaveWorkflowSuccess {
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly revision: string;
}

export interface SaveWorkflowFailure {
  readonly code: "INVALID_WORKFLOW_NAME" | "VALIDATION" | "CONFLICT" | "IO";
  readonly message: string;
  readonly issues?: readonly {
    readonly severity: "error" | "warning";
    readonly path: string;
    readonly message: string;
  }[];
  readonly currentRevision?: string;
}

function collectReferencedNodePayloads(input: {
  readonly workflow: {
    readonly nodes: readonly {
      readonly id: string;
      readonly nodeFile: string;
    }[];
  };
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const referencedPayloads: Record<string, unknown> = {};
  for (const node of input.workflow.nodes) {
    const payload =
      input.nodePayloads[node.nodeFile] ?? input.nodePayloads[node.id];
    if (payload !== undefined) {
      referencedPayloads[node.nodeFile] = payload;
    }
  }
  return referencedPayloads;
}

function collectAuthoredReferencedNodePayloads(
  workflow: unknown,
  nodePayloads: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (typeof workflow !== "object" || workflow === null) {
    return nodePayloads;
  }

  const nodesRaw = (workflow as Record<string, unknown>)["nodes"];
  if (!Array.isArray(nodesRaw)) {
    return nodePayloads;
  }

  const referencedPayloads: Record<string, unknown> = {};
  for (const node of nodesRaw) {
    if (typeof node !== "object" || node === null) {
      continue;
    }

    const nodeRecord = node as Record<string, unknown>;
    const nodeId =
      typeof nodeRecord["id"] === "string" ? nodeRecord["id"] : undefined;
    const nodeFile = resolveAuthoredNodeFileReference(nodeRecord);
    if (!nodeId || nodeFile === undefined) {
      continue;
    }

    const payload = nodePayloads[nodeFile] ?? nodePayloads[nodeId];
    if (payload !== undefined) {
      referencedPayloads[nodeFile] = payload;
    }
  }

  return referencedPayloads;
}

async function persistNodePayload(input: {
  readonly workflowDirectory: string;
  readonly nodeFile: string;
  readonly payload: unknown;
}): Promise<void> {
  if (typeof input.payload !== "object" || input.payload === null) {
    await atomicWriteJsonFile(
      path.join(input.workflowDirectory, input.nodeFile),
      input.payload,
    );
    return;
  }

  const payload = input.payload as Record<string, unknown>;
  const persistedPayload = { ...payload };
  let wroteTemplateFile = false;

  for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
    const templateFile = payload[spec.fileField];
    const templateText = payload[spec.textField];
    if (
      typeof templateFile !== "string" ||
      templateFile.length === 0 ||
      typeof templateText !== "string" ||
      templateText.length === 0
    ) {
      continue;
    }

    const promptFilePath = resolveWorkflowRelativePath(
      input.workflowDirectory,
      templateFile,
    );
    if (!promptFilePath.ok) {
      throw new Error(promptFilePath.error.message);
    }
    await atomicWriteTextFile(
      promptFilePath.value,
      `${templateText.trimEnd()}\n`,
    );
    delete persistedPayload[spec.textField];
    wroteTemplateFile = true;
  }

  await atomicWriteJsonFile(
    path.join(input.workflowDirectory, input.nodeFile),
    wroteTemplateFile ? persistedPayload : input.payload,
  );
}

async function hydratePromptTemplateFilesForValidation(input: {
  readonly workflowDirectory: string;
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}): Promise<Result<Readonly<Record<string, unknown>>, SaveWorkflowFailure>> {
  const hydrated: Record<string, unknown> = { ...input.nodePayloads };

  for (const [nodeFile, payload] of Object.entries(input.nodePayloads)) {
    if (typeof payload !== "object" || payload === null) {
      continue;
    }

    const payloadRecord = payload as Record<string, unknown>;
    const hydratedPayload = { ...payloadRecord };
    for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
      const templateText = payloadRecord[spec.textField];
      if (typeof templateText === "string" && templateText.length > 0) {
        continue;
      }

      const templateFile = payloadRecord[spec.fileField];
      if (typeof templateFile !== "string" || templateFile.length === 0) {
        continue;
      }

      const resolvedPath = resolveWorkflowRelativePath(
        input.workflowDirectory,
        templateFile,
      );
      if (!resolvedPath.ok) {
        return err({
          code: "VALIDATION",
          message: "workflow validation failed",
          issues: [
            {
              severity: "error",
              path: `bundle.nodePayloads.${nodeFile}.${spec.fileField}`,
              message: resolvedPath.error.message,
            },
          ],
        });
      }

      try {
        hydratedPayload[spec.textField] = await readFile(resolvedPath.value, "utf8");
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        if (message.includes("ENOENT")) {
          return err({
            code: "VALIDATION",
            message: "workflow validation failed",
            issues: [
              {
                severity: "error",
                path: `bundle.nodePayloads.${nodeFile}.${spec.textField}`,
                message:
                  `must be provided inline or by an existing ${spec.fileField} '${templateFile}'`,
              },
            ],
          });
        }

        return err({
          code: "IO",
          message:
            `failed reading ${spec.fileField} '${templateFile}' for validation: ${message}`,
        });
      }
    }

    hydrated[nodeFile] = hydratedPayload;
  }

  return ok(hydrated);
}

export async function saveWorkflowToDisk(
  workflowName: string,
  input: SaveWorkflowInput,
  options: LoadOptions = {},
): Promise<Result<SaveWorkflowSuccess, SaveWorkflowFailure>> {
  if (!isSafeWorkflowName(workflowName)) {
    return err({
      code: "INVALID_WORKFLOW_NAME",
      message: `invalid workflow name '${workflowName}'`,
    });
  }

  const normalizedNodePayloads = remapAuthoredNodePayloadsByNodeFile(
    input.workflow,
    input.nodePayloads,
  );
  const authoredReferencedNodePayloads = collectAuthoredReferencedNodePayloads(
    input.workflow,
    normalizedNodePayloads,
  );
  const roots = resolveEffectiveRoots(options);
  const workflowDirectory = path.join(roots.workflowRoot, workflowName);
  const validationNodePayloads = await hydratePromptTemplateFilesForValidation({
    workflowDirectory,
    nodePayloads: authoredReferencedNodePayloads,
  });
  if (!validationNodePayloads.ok) {
    return err(validationNodePayloads.error);
  }

  const validation = validateWorkflowBundle({
    workflow: input.workflow,
    workflowVis: input.workflowVis,
    nodePayloads: validationNodePayloads.value,
  });

  if (!validation.ok) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: validation.error,
    });
  }

  const nodeFiles = validation.value.workflow.nodes.map(
    (node) => node.nodeFile,
  );
  const referencedNodePayloads = collectReferencedNodePayloads({
    workflow: validation.value.workflow,
    nodePayloads: normalizedNodePayloads,
  });

  const currentRevision = await computeWorkflowRevisionFromFiles(
    workflowDirectory,
    nodeFiles,
    collectPromptTemplateFiles(referencedNodePayloads),
  );
  if (input.expectedRevision !== undefined) {
    if (
      currentRevision.ok &&
      currentRevision.value !== input.expectedRevision
    ) {
      return err({
        code: "CONFLICT",
        message: "workflow revision conflict",
        currentRevision: currentRevision.value,
      });
    }
  }

  try {
    await mkdir(workflowDirectory, { recursive: true });
    await atomicWriteJsonFile(
      path.join(workflowDirectory, "workflow.json"),
      validation.value.workflow,
    );
    await atomicWriteJsonFile(
      path.join(workflowDirectory, "workflow-vis.json"),
      validation.value.workflowVis,
    );
    for (const node of validation.value.workflow.nodes) {
      const payload =
        normalizedNodePayloads[node.nodeFile] ??
        normalizedNodePayloads[node.id];
      if (payload === undefined) {
        return err({
          code: "VALIDATION",
          message: `missing node payload for ${node.nodeFile}`,
          issues: [
            {
              severity: "error",
              path: `bundle.nodePayloads.${node.nodeFile}`,
              message: "required payload is missing",
            },
          ],
        });
      }
      await persistNodePayload({
        workflowDirectory,
        nodeFile: node.nodeFile,
        payload,
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed saving workflow files: ${message}`,
    });
  }

  const revision = await computeWorkflowRevisionFromFiles(
    workflowDirectory,
    nodeFiles,
    collectPromptTemplateFiles(referencedNodePayloads),
  );
  if (!revision.ok) {
    return err({ code: "IO", message: revision.error.message });
  }

  return ok({ workflowName, workflowDirectory, revision: revision.value });
}
