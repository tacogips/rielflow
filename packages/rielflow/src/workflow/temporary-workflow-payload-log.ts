import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile } from "../shared/fs";
import { err, ok, type Result } from "./result";
import type { LoadFailure } from "./load";
import type { SessionStoreFailure } from "./session-store";
import type {
  LoadOptions,
  NormalizedWorkflowBundle,
  TemporaryWorkflowSourceInputKind,
  TemporaryWorkflowSourceMetadata,
} from "./types";
import {
  loadedTemporaryWorkflowFromNormalizedPayload,
  temporaryWorkflowContentDigest,
  type LoadedTemporaryWorkflow,
} from "./temporary-workflow";

const TEMPORARY_WORKFLOW_PAYLOAD_DIRECTORY = "temporary-workflow-payload";
const TEMPORARY_WORKFLOW_PAYLOAD_SCHEMA_VERSION = 1;

export interface TemporaryWorkflowPayloadLogInput {
  readonly artifactWorkflowRoot: string;
  readonly workflowExecutionId: string;
  readonly inputPayload: unknown;
  readonly normalizedPayload: NormalizedWorkflowBundle;
  readonly metadata: TemporaryWorkflowSourceMetadata;
}

export interface TemporaryWorkflowPayloadLogRecord {
  readonly payloadDirectory: string;
  readonly inputPath: string;
  readonly normalizedPath: string;
  readonly metadataPath: string;
}

interface PersistedTemporaryWorkflowMetadata
  extends TemporaryWorkflowSourceMetadata {
  readonly sourceKind: TemporaryWorkflowSourceInputKind;
  readonly persistedAt: string;
  readonly schemaVersion: number;
}

function temporaryWorkflowPayloadDirectory(input: {
  readonly artifactWorkflowRoot: string;
  readonly workflowExecutionId: string;
}): string {
  return path.join(
    input.artifactWorkflowRoot,
    input.workflowExecutionId,
    TEMPORARY_WORKFLOW_PAYLOAD_DIRECTORY,
  );
}

function temporaryWorkflowPayloadLogRecord(input: {
  readonly artifactWorkflowRoot: string;
  readonly workflowExecutionId: string;
}): TemporaryWorkflowPayloadLogRecord {
  const payloadDirectory = temporaryWorkflowPayloadDirectory(input);
  return {
    payloadDirectory,
    inputPath: path.join(payloadDirectory, "input.json"),
    normalizedPath: path.join(payloadDirectory, "normalized.json"),
    metadataPath: path.join(payloadDirectory, "metadata.json"),
  };
}

export async function persistTemporaryWorkflowPayloadLog(
  input: TemporaryWorkflowPayloadLogInput,
): Promise<Result<TemporaryWorkflowPayloadLogRecord, SessionStoreFailure>> {
  const record = temporaryWorkflowPayloadLogRecord(input);
  const metadata: PersistedTemporaryWorkflowMetadata = {
    ...input.metadata,
    sourceKind: input.metadata.input,
    payloadDirectory: record.payloadDirectory,
    normalizedPayloadPath: record.normalizedPath,
    contentDigest:
      input.metadata.contentDigest ??
      temporaryWorkflowContentDigest(input.inputPayload),
    persistedAt: new Date().toISOString(),
    schemaVersion: TEMPORARY_WORKFLOW_PAYLOAD_SCHEMA_VERSION,
  };
  try {
    await mkdir(record.payloadDirectory, { recursive: true });
    await atomicWriteJsonFile(record.inputPath, input.inputPayload);
    await atomicWriteJsonFile(record.normalizedPath, input.normalizedPayload);
    await atomicWriteJsonFile(record.metadataPath, metadata);
    return ok(record);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed writing temporary workflow payload log: ${message}`,
    });
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonFile(
  filePath: string,
): Promise<Result<unknown, LoadFailure>> {
  try {
    return ok(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("ENOENT")) {
      return err({
        code: "NOT_FOUND",
        message: `required file was not found: ${filePath}`,
      });
    }
    return err({
      code: "IO",
      message: `failed reading JSON file '${filePath}': ${message}`,
    });
  }
}

function readTemporaryWorkflowMetadata(
  raw: unknown,
  record: TemporaryWorkflowPayloadLogRecord,
): Result<TemporaryWorkflowSourceMetadata, LoadFailure> {
  if (!isRecord(raw)) {
    return err({
      code: "VALIDATION",
      message: "temporary workflow metadata must be an object",
    });
  }
  const input = raw["input"] ?? raw["sourceKind"];
  if (
    input !== "inline-json" &&
    input !== "json-file" &&
    input !== "persisted-normalized"
  ) {
    return err({
      code: "VALIDATION",
      message:
        "temporary workflow metadata input must be inline-json, json-file, or persisted-normalized",
    });
  }
  const displayPath = raw["displayPath"];
  const contentDigest = raw["contentDigest"];
  return ok({
    input: "persisted-normalized",
    ...(typeof displayPath === "string" && displayPath.length > 0
      ? { displayPath }
      : {}),
    payloadDirectory: record.payloadDirectory,
    normalizedPayloadPath: record.normalizedPath,
    ...(typeof contentDigest === "string" && contentDigest.length > 0
      ? { contentDigest }
      : {}),
  });
}

function readNormalizedWorkflowBundle(
  raw: unknown,
): Result<NormalizedWorkflowBundle, LoadFailure> {
  if (
    !isRecord(raw) ||
    !isRecord(raw["workflow"]) ||
    !isRecord(raw["nodePayloads"])
  ) {
    return err({
      code: "VALIDATION",
      message: "persisted temporary normalized workflow payload is invalid",
    });
  }
  return ok(raw as unknown as NormalizedWorkflowBundle);
}

export async function loadPersistedTemporaryWorkflowPayload(input: {
  readonly artifactWorkflowRoot: string;
  readonly workflowExecutionId: string;
  readonly options?: LoadOptions;
}): Promise<Result<LoadedTemporaryWorkflow, LoadFailure>> {
  const record = temporaryWorkflowPayloadLogRecord(input);
  const [inputPayload, normalizedPayload, metadataPayload] = await Promise.all([
    readJsonFile(record.inputPath),
    readJsonFile(record.normalizedPath),
    readJsonFile(record.metadataPath),
  ]);
  if (!inputPayload.ok) {
    return err(inputPayload.error);
  }
  if (!normalizedPayload.ok) {
    return err(normalizedPayload.error);
  }
  if (!metadataPayload.ok) {
    return err(metadataPayload.error);
  }
  const normalized = readNormalizedWorkflowBundle(normalizedPayload.value);
  if (!normalized.ok) {
    return err(normalized.error);
  }
  const metadata = readTemporaryWorkflowMetadata(metadataPayload.value, record);
  if (!metadata.ok) {
    return err(metadata.error);
  }
  return loadedTemporaryWorkflowFromNormalizedPayload({
    inputPayload: inputPayload.value,
    normalizedPayload: normalized.value,
    metadata: metadata.value,
    options: input.options ?? {},
  });
}
