import { Database } from "bun:sqlite";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile } from "../../shared/fs";
import { resolveWorkflowPackageRoot } from "./registry-config";
import type {
  WorkflowPackageCacheBackendKind,
  WorkflowPackageIndexRecord,
  WorkflowPackageRegistryConfigOptions,
} from "./types";

export interface WorkflowPackageCacheKey {
  readonly registryId: string;
  readonly registryUrl?: string;
  readonly branch: string;
  readonly sourcePath?: string;
}

export interface WorkflowPackageCacheWrite extends WorkflowPackageCacheKey {
  readonly records: readonly WorkflowPackageIndexRecord[];
}

export interface WorkflowPackageCacheBackend {
  readIndex(
    input: WorkflowPackageCacheKey,
  ): Promise<readonly WorkflowPackageIndexRecord[] | undefined>;
  writeIndex(input: WorkflowPackageCacheWrite): Promise<void>;
  clearRegistry(input: { readonly registryId: string }): Promise<void>;
}

export function encodeWorkflowPackageCacheSegment(value: string): string {
  return encodeURIComponent(value).replaceAll(".", "%2E");
}

export function decodeWorkflowPackageCacheSegment(value: string): string {
  return decodeURIComponent(value);
}

function cacheFilePath(
  options: WorkflowPackageRegistryConfigOptions,
  input: WorkflowPackageCacheKey,
): string {
  const registryKey =
    input.registryUrl === undefined
      ? input.registryId
      : `${input.registryId}-${input.registryUrl}`;
  const sourceKey =
    input.sourcePath === undefined ? "" : `-${input.sourcePath}`;
  return path.join(
    resolveWorkflowPackageRoot(options),
    "cache",
    `${encodeWorkflowPackageCacheSegment(registryKey)}-${encodeWorkflowPackageCacheSegment(
      input.branch,
    )}${encodeWorkflowPackageCacheSegment(sourceKey)}.json`,
  );
}

function sqliteCacheFilePath(
  options: WorkflowPackageRegistryConfigOptions,
): string {
  return path.join(
    resolveWorkflowPackageRoot(options),
    "cache",
    "packages.sqlite",
  );
}

function sqliteCacheKey(input: WorkflowPackageCacheKey): string {
  return `${input.registryId}\0${input.registryUrl ?? ""}\0${input.branch}\0${
    input.sourcePath ?? ""
  }`;
}

function createSqliteWorkflowPackageCacheBackend(
  options: WorkflowPackageRegistryConfigOptions,
): WorkflowPackageCacheBackend {
  const db = new Database(sqliteCacheFilePath(options), { create: true });
  db.exec(`
    create table if not exists workflow_package_index_cache (
      cache_key text primary key,
      registry_id text not null,
      branch text not null,
      records_json text not null,
      updated_at text not null
    )
  `);
  return {
    async readIndex(input) {
      const row = db
        .query(
          "select records_json from workflow_package_index_cache where cache_key = ?",
        )
        .get(sqliteCacheKey(input)) as
        | { readonly records_json?: string }
        | undefined;
      if (row?.records_json === undefined) {
        return undefined;
      }
      const parsed = JSON.parse(row.records_json) as unknown;
      return Array.isArray(parsed)
        ? (parsed as readonly WorkflowPackageIndexRecord[])
        : undefined;
    },
    async writeIndex(input) {
      db.query(
        `insert into workflow_package_index_cache
          (cache_key, registry_id, branch, records_json, updated_at)
         values (?, ?, ?, ?, ?)
         on conflict(cache_key) do update set
          records_json = excluded.records_json,
          updated_at = excluded.updated_at`,
      ).run(
        sqliteCacheKey(input),
        input.registryId,
        input.branch,
        JSON.stringify(input.records),
        new Date().toISOString(),
      );
    },
    async clearRegistry(input) {
      db.query(
        "delete from workflow_package_index_cache where registry_id = ?",
      ).run(input.registryId);
    },
  };
}

export function createWorkflowPackageCacheBackend(
  kind: WorkflowPackageCacheBackendKind,
  options: WorkflowPackageRegistryConfigOptions = {},
): WorkflowPackageCacheBackend {
  if (kind === "sqlite") {
    return createSqliteWorkflowPackageCacheBackend(options);
  }
  return {
    async readIndex(input) {
      try {
        const raw = await readFile(cacheFilePath(options, input), "utf8");
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed)
          ? (parsed as readonly WorkflowPackageIndexRecord[])
          : undefined;
      } catch {
        return undefined;
      }
    },
    async writeIndex(input) {
      await atomicWriteJsonFile(cacheFilePath(options, input), input.records);
    },
    async clearRegistry(input) {
      await rm(path.join(resolveWorkflowPackageRoot(options), "cache"), {
        recursive: true,
        force: true,
      });
      void input;
    },
  };
}
