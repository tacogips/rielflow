import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile, atomicWriteTextFile } from "../shared/fs";
import {
  cloneNodeTemplateAwarePayload,
  NODE_TEMPLATE_FIELD_SPECS,
  listNodeTemplateFieldContainers,
} from "./node-template-fields";
import { resolveWorkflowRelativeNodeFilePath } from "./authored-node";
import { resolveWorkflowRelativePath } from "./prompt-template-file";
import { err, ok, type Result } from "./result";
import { isSafeWorkflowName, resolveEffectiveRoots } from "./paths";
import { validateWorkflowBundleAsync } from "./validate";
import { computeWorkflowRevisionFromFiles } from "./revision";
import type { LoadOptions, WorkflowStepRef } from "./types";
import {
  OBSOLETE_WORKFLOW_VISUALIZATION_FILE,
  WORKFLOW_DEFINITION_FILE,
  type SaveWorkflowFailure,
  type SaveWorkflowInput,
  type SaveWorkflowSuccess,
} from "./save-types";
import {
  collectAuthoredNodeFiles,
  collectAuthoredStepFiles,
} from "./save-authored";
import {
  buildWorkflowSavePersistencePlan,
  buildWorkflowSaveValidationPlan,
  checkWorkflowSaveRevisionConflict,
  collectPayloadPromptTemplateFiles,
  isRecord,
} from "./save-plan";

export type { SaveWorkflowFailure, SaveWorkflowInput, SaveWorkflowSuccess };

async function readExistingAuthoredWorkflow(
  workflowDirectory: string,
): Promise<Result<unknown | undefined, SaveWorkflowFailure>> {
  const workflowPath = path.join(workflowDirectory, WORKFLOW_DEFINITION_FILE);
  try {
    const raw = await readFile(workflowPath, "utf8");
    return ok(JSON.parse(raw) as unknown);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("ENOENT")) {
      return ok(undefined);
    }
    return err({
      code: "IO",
      message: `failed reading existing workflow definition '${workflowPath}' while preparing save: ${message}`,
    });
  }
}

async function readExistingNodePayload(
  workflowDirectory: string,
  nodeFile: string,
): Promise<unknown | undefined> {
  const nodeFilePath = resolveWorkflowRelativeNodeFilePath(
    workflowDirectory,
    nodeFile,
  );
  if (!nodeFilePath.ok) {
    return undefined;
  }

  try {
    const raw = await readFile(nodeFilePath.value, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function collectExistingPromptTemplateFiles(input: {
  readonly workflowDirectory: string;
  readonly existingNodeFiles: readonly string[];
}): Promise<ReadonlySet<string>> {
  const existingPromptTemplateFiles = new Set<string>();

  for (const nodeFile of input.existingNodeFiles) {
    const existingPayload = await readExistingNodePayload(
      input.workflowDirectory,
      nodeFile,
    );
    for (const templateFile of collectPayloadPromptTemplateFiles(
      existingPayload,
    )) {
      existingPromptTemplateFiles.add(templateFile);
    }
  }

  return existingPromptTemplateFiles;
}

async function loadExistingAuthoredWorkflowFileState(input: {
  readonly workflowDirectory: string;
  readonly existingAuthoredWorkflow: unknown;
}): Promise<
  Result<
    {
      readonly existingAuthoredWorkflowRecord:
        | Record<string, unknown>
        | undefined;
      readonly existingNodeFiles: readonly string[];
      readonly existingStepFiles: readonly string[];
      readonly existingPromptTemplateFiles: ReadonlySet<string>;
    },
    SaveWorkflowFailure
  >
> {
  const existingAuthoredWorkflowRecord = isRecord(
    input.existingAuthoredWorkflow,
  )
    ? input.existingAuthoredWorkflow
    : undefined;
  const existingNodeFiles = collectAuthoredNodeFiles(
    existingAuthoredWorkflowRecord,
  );
  const existingStepFiles = collectAuthoredStepFiles(
    existingAuthoredWorkflowRecord,
  );

  try {
    const existingPromptTemplateFiles =
      await collectExistingPromptTemplateFiles({
        workflowDirectory: input.workflowDirectory,
        existingNodeFiles,
      });
    return ok({
      existingAuthoredWorkflowRecord,
      existingNodeFiles,
      existingStepFiles,
      existingPromptTemplateFiles,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed reading existing workflow files while preparing save: ${message}`,
    });
  }
}

async function removeStaleWorkflowFiles(input: {
  readonly workflowDirectory: string;
  readonly staleNodeFiles: readonly string[];
  readonly staleStepFiles: readonly string[];
  readonly stalePromptTemplateFiles: readonly string[];
}): Promise<void> {
  for (const nodeFile of input.staleNodeFiles) {
    const nodeFilePath = resolveWorkflowRelativeNodeFilePath(
      input.workflowDirectory,
      nodeFile,
    );
    if (!nodeFilePath.ok) {
      continue;
    }
    await rm(nodeFilePath.value, { force: true });
  }

  for (const stepFile of input.staleStepFiles) {
    const stepFilePath = resolveWorkflowRelativePath(
      input.workflowDirectory,
      stepFile,
      { fieldName: "stepFile" },
    );
    if (!stepFilePath.ok) {
      continue;
    }
    await rm(stepFilePath.value, { force: true });
  }

  for (const templateFile of input.stalePromptTemplateFiles) {
    const templateFilePath = resolveWorkflowRelativePath(
      input.workflowDirectory,
      templateFile,
      { fieldName: "promptTemplateFile" },
    );
    if (!templateFilePath.ok) {
      continue;
    }
    await rm(templateFilePath.value, { force: true });
  }
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
  const persistedPayload = cloneNodeTemplateAwarePayload(payload);
  let wroteTemplateFile = false;

  for (const { record } of listNodeTemplateFieldContainers(persistedPayload)) {
    for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
      const templateFile = record[spec.fileField];
      const templateText = record[spec.textField];
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
        { fieldName: spec.fileField },
      );
      if (!promptFilePath.ok) {
        throw new Error(promptFilePath.error.message);
      }
      await atomicWriteTextFile(
        promptFilePath.value,
        `${templateText.trimEnd()}\n`,
      );
      delete record[spec.textField];
      wroteTemplateFile = true;
    }
  }

  await atomicWriteJsonFile(
    path.join(input.workflowDirectory, input.nodeFile),
    wroteTemplateFile ? persistedPayload : input.payload,
  );
}

async function persistStepDefinition(input: {
  readonly workflowDirectory: string;
  readonly stepFile: string;
  readonly step: WorkflowStepRef;
}): Promise<void> {
  const stepFilePath = resolveWorkflowRelativePath(
    input.workflowDirectory,
    input.stepFile,
    { fieldName: "stepFile" },
  );
  if (!stepFilePath.ok) {
    throw new Error(stepFilePath.error.message);
  }

  await atomicWriteJsonFile(stepFilePath.value, {
    id: input.step.id,
    nodeId: input.step.nodeId,
    ...(input.step.description === undefined
      ? {}
      : { description: input.step.description }),
    ...(input.step.role === undefined ? {} : { role: input.step.role }),
    ...(input.step.promptVariant === undefined
      ? {}
      : { promptVariant: input.step.promptVariant }),
    ...(input.step.timeoutMs === undefined
      ? {}
      : { timeoutMs: input.step.timeoutMs }),
    ...(input.step.sessionPolicy === undefined
      ? {}
      : { sessionPolicy: input.step.sessionPolicy }),
    ...(input.step.transitions === undefined
      ? {}
      : { transitions: input.step.transitions }),
  });
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
    const hydratedPayload = cloneNodeTemplateAwarePayload(payloadRecord);
    for (const {
      path: containerPath,
      record,
    } of listNodeTemplateFieldContainers(hydratedPayload)) {
      for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
        const templateText = record[spec.textField];
        if (typeof templateText === "string" && templateText.length > 0) {
          continue;
        }

        const templateFile = record[spec.fileField];
        if (typeof templateFile !== "string" || templateFile.length === 0) {
          continue;
        }

        const resolvedPath = resolveWorkflowRelativePath(
          input.workflowDirectory,
          templateFile,
          { fieldName: spec.fileField },
        );
        if (!resolvedPath.ok) {
          return err({
            code: "VALIDATION",
            message: "workflow validation failed",
            issues: [
              {
                severity: "error",
                path:
                  containerPath.length === 0
                    ? `bundle.nodePayloads.${nodeFile}.${spec.fileField}`
                    : `bundle.nodePayloads.${nodeFile}.${containerPath}.${spec.fileField}`,
                message: resolvedPath.error.message,
              },
            ],
          });
        }

        try {
          record[spec.textField] = await readFile(resolvedPath.value, "utf8");
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
                  path:
                    containerPath.length === 0
                      ? `bundle.nodePayloads.${nodeFile}.${spec.textField}`
                      : `bundle.nodePayloads.${nodeFile}.${containerPath}.${spec.textField}`,
                  message: `must be provided inline or by an existing ${spec.fileField} '${templateFile}'`,
                },
              ],
            });
          }

          return err({
            code: "IO",
            message: `failed reading ${spec.fileField} '${templateFile}' for validation: ${message}`,
          });
        }
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

  const roots = resolveEffectiveRoots(options);
  const workflowDirectory =
    options.workflowBundleDirectoryOverride !== undefined
      ? path.resolve(
          options.cwd ?? process.cwd(),
          options.workflowBundleDirectoryOverride,
        )
      : path.join(roots.workflowRoot, workflowName);
  const existingAuthoredWorkflow =
    await readExistingAuthoredWorkflow(workflowDirectory);
  if (!existingAuthoredWorkflow.ok) {
    return err(existingAuthoredWorkflow.error);
  }

  const validationPlan = buildWorkflowSaveValidationPlan(input);
  const validationNodePayloads = await hydratePromptTemplateFilesForValidation({
    workflowDirectory,
    nodePayloads: validationPlan.authoredReferencedNodePayloads,
  });
  if (!validationNodePayloads.ok) {
    return err(validationNodePayloads.error);
  }

  const validation = await validateWorkflowBundleAsync(
    {
      workflow: validationPlan.authoredWorkflow,
      nodePayloads: validationNodePayloads.value,
    },
    {
      ...options,
      allowResolvedStepFileFields: true,
    },
  );

  if (!validation.ok) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: [
        ...validationPlan.stepAddressedLegacyIssues,
        ...validation.error,
      ],
    });
  }
  if (validationPlan.stepAddressedLegacyIssues.length > 0) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: validationPlan.stepAddressedLegacyIssues,
    });
  }

  const existingWorkflowFileState = await loadExistingAuthoredWorkflowFileState(
    {
      workflowDirectory,
      existingAuthoredWorkflow: existingAuthoredWorkflow.value,
    },
  );
  if (!existingWorkflowFileState.ok) {
    return err(existingWorkflowFileState.error);
  }
  const persistencePlan = buildWorkflowSavePersistencePlan({
    workflow: validation.value.workflow,
    authoredWorkflow: validationPlan.authoredWorkflow,
    normalizedNodePayloads: validationPlan.normalizedNodePayloads,
    existingFileState: existingWorkflowFileState.value,
  });
  if (!persistencePlan.ok) {
    return err(persistencePlan.error);
  }

  const currentRevision = await computeWorkflowRevisionFromFiles(
    workflowDirectory,
    persistencePlan.value.currentRevisionNodeFiles,
    persistencePlan.value.currentRevisionExtraFiles,
  );
  const revisionConflict = checkWorkflowSaveRevisionConflict({
    expectedRevision: input.expectedRevision,
    currentRevision: currentRevision.ok ? currentRevision.value : undefined,
  });
  if (revisionConflict !== undefined) {
    return err(revisionConflict);
  }

  try {
    await mkdir(workflowDirectory, { recursive: true });
    await atomicWriteJsonFile(
      path.join(workflowDirectory, WORKFLOW_DEFINITION_FILE),
      persistencePlan.value.persistedWorkflow,
    );
    for (const stepPlan of persistencePlan.value.stepsToPersist) {
      await persistStepDefinition({
        workflowDirectory,
        stepFile: stepPlan.stepFile,
        step: stepPlan.step,
      });
    }
    for (const node of persistencePlan.value.nodesToPersist) {
      await persistNodePayload({
        workflowDirectory,
        nodeFile: node.nodeFile,
        payload: node.payload,
      });
    }
    await removeStaleWorkflowFiles({
      workflowDirectory,
      staleNodeFiles: persistencePlan.value.staleFiles.nodeFiles,
      staleStepFiles: persistencePlan.value.staleFiles.stepFiles,
      stalePromptTemplateFiles:
        persistencePlan.value.staleFiles.promptTemplateFiles,
    });
    await rm(
      path.join(workflowDirectory, OBSOLETE_WORKFLOW_VISUALIZATION_FILE),
      {
        force: true,
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed saving workflow files: ${message}`,
    });
  }

  const revision = await computeWorkflowRevisionFromFiles(
    workflowDirectory,
    persistencePlan.value.finalRevisionNodeFiles,
    persistencePlan.value.finalRevisionExtraFiles,
  );
  if (!revision.ok) {
    return err({ code: "IO", message: revision.error.message });
  }

  return ok({ workflowName, workflowDirectory, revision: revision.value });
}
