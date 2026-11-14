import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile } from "../shared/fs";
import { resolveRootDataDir } from "./paths";
import type { RielflowOptions } from "../lib";

const DEFAULT_USER_BACKEND_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface UserBackendSessionRecord {
  readonly workflowId: string;
  readonly nodeId: string;
  readonly nodeRegistryId?: string;
  readonly backend: string;
  readonly provider: string;
  readonly sessionId: string;
  readonly workingDirectory?: string;
  readonly updatedAt: string;
}

export interface UserBackendSessionKeyInput {
  readonly workflowId: string;
  readonly nodeId: string;
  readonly nodeRegistryId?: string;
  readonly backend: string;
}

export function buildUserBackendSessionKey(
  input: UserBackendSessionKeyInput,
): string {
  return [
    input.workflowId,
    input.nodeId,
    input.nodeRegistryId ?? "",
    input.backend,
  ].join("\u0000");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(
  value: Readonly<Record<string, unknown>>,
  key: keyof UserBackendSessionRecord,
): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function readOptionalString(
  value: Readonly<Record<string, unknown>>,
  key: keyof UserBackendSessionRecord,
): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function parseUserBackendSessionRecord(
  value: unknown,
): UserBackendSessionRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const workflowId = readRequiredString(value, "workflowId");
  const nodeId = readRequiredString(value, "nodeId");
  const backend = readRequiredString(value, "backend");
  const provider = readRequiredString(value, "provider");
  const sessionId = readRequiredString(value, "sessionId");
  const updatedAt = readRequiredString(value, "updatedAt");
  if (
    workflowId === null ||
    nodeId === null ||
    backend === null ||
    provider === null ||
    sessionId === null ||
    updatedAt === null
  ) {
    return null;
  }
  const nodeRegistryId = readOptionalString(value, "nodeRegistryId");
  const workingDirectory = readOptionalString(value, "workingDirectory");
  return {
    workflowId,
    nodeId,
    ...(nodeRegistryId === undefined ? {} : { nodeRegistryId }),
    backend,
    provider,
    sessionId,
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    updatedAt,
  };
}

function resolveMaxAgeMs(options: RielflowOptions = {}): number {
  const env = options.env ?? process.env;
  const raw = env["RIELFLOW_USER_BACKEND_SESSION_MAX_AGE_MS"];
  if (raw !== undefined && raw.length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_USER_BACKEND_SESSION_MAX_AGE_MS;
}

function isExpired(
  record: UserBackendSessionRecord,
  maxAgeMs: number,
): boolean {
  const updatedAtMs = new Date(record.updatedAt).getTime();
  if (Number.isNaN(updatedAtMs)) {
    return true;
  }
  return Date.now() - updatedAtMs > maxAgeMs;
}

function userBackendSessionDirectory(options: RielflowOptions = {}): string {
  return path.join(resolveRootDataDir(options), "backend-sessions", "user");
}

function userBackendSessionFilePath(
  key: string,
  options: RielflowOptions = {},
): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return path.join(userBackendSessionDirectory(options), `${digest}.json`);
}

function userBackendSessionTargetPath(
  input: UserBackendSessionKeyInput,
  options: RielflowOptions = {},
): string {
  return userBackendSessionFilePath(buildUserBackendSessionKey(input), options);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

export async function deleteUserBackendSession(
  input: UserBackendSessionKeyInput,
  options: RielflowOptions = {},
): Promise<void> {
  await rm(userBackendSessionTargetPath(input, options), { force: true });
}

export async function loadUserBackendSession(
  input: UserBackendSessionKeyInput,
  options: RielflowOptions = {},
): Promise<UserBackendSessionRecord | null> {
  const target = userBackendSessionTargetPath(input, options);
  const maxAgeMs = resolveMaxAgeMs(options);
  try {
    const raw = await readFile(target, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      await deleteUserBackendSession(input, options);
      return null;
    }
    const record = parseUserBackendSessionRecord(parsed);
    if (record === null) {
      await deleteUserBackendSession(input, options);
      return null;
    }
    if (isExpired(record, maxAgeMs)) {
      await deleteUserBackendSession(input, options);
      return null;
    }
    return record;
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

export async function saveUserBackendSession(
  record: UserBackendSessionRecord,
  options: RielflowOptions = {},
): Promise<void> {
  const key = buildUserBackendSessionKey({
    workflowId: record.workflowId,
    nodeId: record.nodeId,
    ...(record.nodeRegistryId === undefined
      ? {}
      : { nodeRegistryId: record.nodeRegistryId }),
    backend: record.backend,
  });
  const target = userBackendSessionFilePath(key, options);
  await mkdir(path.dirname(target), { recursive: true });
  await atomicWriteJsonFile(target, record);
}
