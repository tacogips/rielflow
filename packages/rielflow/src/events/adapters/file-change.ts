import { createHash } from "node:crypto";
import { watch, type FSWatcher, type Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "../../shared/json";
import {
  resolveFileChangeStabilityWindowMs,
  resolveFileChangeSuffixes,
} from "../file-change-constraints";
import type {
  EventSourceAdapter,
  EventSourceHandle,
  RawExternalEvent,
} from "../source-adapter";
import type {
  ExternalEventEnvelope,
  FileChangeSourceConfig,
  FileChangeType,
} from "../types";

const FILE_CHANGE_EVENT_TYPES: Record<FileChangeType, string> = {
  create: "file.change.created",
  modify: "file.change.modified",
  delete: "file.change.deleted",
};

interface FileChangeMetadata {
  readonly size: number;
  readonly mtime: string;
}

interface FileChangeWatcher {
  close(): void;
}

interface FileChangeWatcherRuntime {
  watch(
    directory: string,
    options: { readonly recursive: boolean; readonly signal: AbortSignal },
    listener: (eventType: string, fileName: string | Buffer | null) => void,
  ): FileChangeWatcher;
  stat(filePath: string): Promise<Stats>;
  listFiles(directory: string, recursive: boolean): Promise<readonly string[]>;
  setTimer(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

interface PendingFileChange {
  readonly changeType: FileChangeType;
  readonly relativePath: string;
  readonly filePath: string;
}

const DEFAULT_FILE_CHANGE_WATCHER_RUNTIME: FileChangeWatcherRuntime = {
  watch: (directory, options, listener) =>
    watch(
      directory,
      { recursive: options.recursive, signal: options.signal },
      listener,
    ) as FSWatcher,
  stat,
  listFiles: listExistingFiles,
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isFileChangeSource(source: unknown): source is FileChangeSourceConfig {
  return isJsonObject(source) && source["kind"] === "file-change";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isFileChangeType(value: unknown): value is FileChangeType {
  return value === "create" || value === "modify" || value === "delete";
}

function resolveConfiguredDirectory(source: FileChangeSourceConfig): string {
  if (path.isAbsolute(source.directory)) {
    return source.directory;
  }
  const base =
    source.configFilePath === undefined
      ? process.cwd()
      : path.dirname(source.configFilePath);
  return path.resolve(base, source.directory);
}

function toSafeRelativePath(input: {
  readonly directory: string;
  readonly filePath: string;
}): string {
  const relativePath = path
    .relative(input.directory, input.filePath)
    .split(path.sep)
    .join("/");
  const segments = relativePath.split("/");
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.startsWith("../") ||
    relativePath === ".." ||
    relativePath.includes("\\") ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("file change path is outside the watched directory");
  }
  return relativePath;
}

function resolveSuffixFilters(
  source: FileChangeSourceConfig,
): readonly string[] | undefined {
  return resolveFileChangeSuffixes(source.filters?.suffixes);
}

function matchesSuffixFilter(
  suffixes: readonly string[] | undefined,
  relativePath: string,
): boolean {
  return (
    suffixes === undefined ||
    suffixes.some((suffix) => relativePath.endsWith(suffix))
  );
}

async function listExistingFiles(
  directory: string,
  recursive: boolean,
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile()) {
      files.push(entryPath);
      continue;
    }
    if (recursive && entry.isDirectory()) {
      files.push(...(await listExistingFiles(entryPath, true)));
    }
  }
  return files;
}

async function readMetadata(
  runtime: FileChangeWatcherRuntime,
  filePath: string,
): Promise<FileChangeMetadata | undefined> {
  try {
    const fileStat = await runtime.stat(filePath);
    if (!fileStat.isFile()) {
      return undefined;
    }
    return {
      size: fileStat.size,
      mtime: fileStat.mtime.toISOString(),
    };
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

function buildFileInput(input: {
  readonly source: FileChangeSourceConfig;
  readonly changeType: FileChangeType;
  readonly relativePath: string;
  readonly metadata?: FileChangeMetadata;
}): ExternalEventEnvelope["input"] {
  const name = path.posix.basename(input.relativePath);
  const extension = path.posix.extname(input.relativePath);
  return {
    change: {
      type: input.changeType,
    },
    file: {
      path: input.relativePath,
      name,
      ...(extension.length === 0 ? {} : { extension }),
      ...(input.metadata === undefined
        ? {}
        : { size: input.metadata.size, mtime: input.metadata.mtime }),
    },
    watch: {
      sourceId: input.source.id,
      directory: input.source.directory,
    },
  };
}

function buildFileChangeEnvelope(input: {
  readonly source: FileChangeSourceConfig;
  readonly changeType: FileChangeType;
  readonly relativePath: string;
  readonly receivedAt: string;
  readonly sequence: number;
  readonly metadata?: FileChangeMetadata;
  readonly rawRef?: RawExternalEvent["rawRef"];
}): ExternalEventEnvelope {
  const eventType = FILE_CHANGE_EVENT_TYPES[input.changeType];
  const eventId = [
    input.source.id,
    input.changeType,
    input.relativePath,
    String(input.sequence),
  ].join(":");
  return {
    sourceId: input.source.id,
    eventId,
    provider: input.source.provider ?? "local-fs",
    eventType,
    occurredAt: input.receivedAt,
    receivedAt: input.receivedAt,
    dedupeKey: hash(eventId),
    input: buildFileInput({
      source: input.source,
      changeType: input.changeType,
      relativePath: input.relativePath,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    }),
    ...(input.rawRef === undefined ? {} : { rawRef: input.rawRef }),
  };
}

function rawBodyToFileChange(input: RawExternalEvent): {
  readonly changeType: FileChangeType;
  readonly relativePath: string;
  readonly metadata?: FileChangeMetadata;
} {
  if (!isJsonObject(input.body)) {
    throw new Error("file-change event body must be a JSON object");
  }
  const changeType = input.body["changeType"] ?? input.body["type"];
  if (!isFileChangeType(changeType)) {
    throw new Error("file-change event body requires changeType");
  }
  const relativePath = readString(input.body["path"]);
  if (relativePath === undefined) {
    throw new Error("file-change event body requires path");
  }
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("file-change event path must be safe and relative");
  }
  const file = isJsonObject(input.body["file"]) ? input.body["file"] : {};
  const size = readNumber(file["size"] ?? input.body["size"]);
  const mtime = readString(file["mtime"] ?? input.body["mtime"]);
  const metadata =
    size === undefined || mtime === undefined ? undefined : { size, mtime };
  return {
    changeType,
    relativePath,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function shouldEmitChange(
  source: FileChangeSourceConfig,
  suffixes: readonly string[] | undefined,
  changeType: FileChangeType,
  relativePath: string,
): boolean {
  return (
    source.changeTypes.includes(changeType) &&
    matchesSuffixFilter(suffixes, relativePath)
  );
}

export function createFileChangeEventSourceAdapter(
  runtime: FileChangeWatcherRuntime = DEFAULT_FILE_CHANGE_WATCHER_RUNTIME,
): EventSourceAdapter {
  return {
    kind: "file-change",
    capabilities: {
      eventTypes: Object.values(FILE_CHANGE_EVENT_TYPES),
      supportsStart: true,
      webhook: false,
    },
    async start(input): Promise<EventSourceHandle> {
      if (!isFileChangeSource(input.source)) {
        throw new Error(
          `file-change adapter cannot use source kind '${input.source.kind}'`,
        );
      }
      const source = input.source;
      const directory = resolveConfiguredDirectory(source);
      const recursive = source.recursive ?? false;
      const stabilityWindowMs = resolveFileChangeStabilityWindowMs(
        source.stabilityWindowMs,
      );
      const suffixes = resolveSuffixFilters(source);
      let sequence = 0;
      const knownFiles = new Set(
        (await runtime.listFiles(directory, recursive)).map((filePath) =>
          toSafeRelativePath({ directory, filePath }),
        ),
      );
      const pending = new Map<
        string,
        {
          readonly change: PendingFileChange;
          readonly timer: ReturnType<typeof setTimeout>;
        }
      >();

      const emit = async (change: PendingFileChange): Promise<void> => {
        const metadata =
          change.changeType === "delete"
            ? undefined
            : await readMetadata(runtime, change.filePath);
        if (change.changeType !== "delete" && metadata === undefined) {
          return;
        }
        sequence += 1;
        const receivedAt = input.now().toISOString();
        await input.dispatch(
          buildFileChangeEnvelope({
            source,
            changeType: change.changeType,
            relativePath: change.relativePath,
            receivedAt,
            sequence,
            ...(metadata === undefined ? {} : { metadata }),
          }),
          {
            sourceId: source.id,
            changeType: change.changeType,
            path: change.relativePath,
          },
        );
      };

      const scheduleEmit = (change: PendingFileChange): void => {
        const pendingCreateKey = `create:${change.relativePath}`;
        if (change.changeType === "modify" && pending.has(pendingCreateKey)) {
          return;
        }
        const key = `${change.changeType}:${change.relativePath}`;
        const existing = pending.get(key);
        if (existing !== undefined) {
          runtime.clearTimer(existing.timer);
        }
        const run = (): void => {
          pending.delete(key);
          emit(change).catch((error: unknown) => {
            input.diagnosticSink?.({
              sourceId: source.id,
              errorClass:
                error instanceof Error ? error.message : "file-change-error",
            });
          });
        };
        if (stabilityWindowMs <= 0 || change.changeType === "delete") {
          run();
          return;
        }
        pending.set(key, {
          change,
          timer: runtime.setTimer(run, stabilityWindowMs),
        });
      };

      const handlePath = async (fileName: string | Buffer | null) => {
        if (fileName === null) {
          return;
        }
        const filePath = path.resolve(directory, fileName.toString());
        let relativePath: string;
        try {
          relativePath = toSafeRelativePath({ directory, filePath });
        } catch {
          return;
        }
        const metadata = await readMetadata(runtime, filePath);
        const existed = knownFiles.has(relativePath);
        const changeType: FileChangeType =
          metadata === undefined ? "delete" : existed ? "modify" : "create";
        if (metadata === undefined) {
          knownFiles.delete(relativePath);
        } else {
          knownFiles.add(relativePath);
        }
        if (!existed && changeType === "delete") {
          return;
        }
        if (!shouldEmitChange(source, suffixes, changeType, relativePath)) {
          return;
        }
        scheduleEmit({ changeType, relativePath, filePath });
      };

      const watcher = runtime.watch(
        directory,
        { recursive, signal: input.signal },
        (_eventType, fileName) => {
          handlePath(fileName).catch((error: unknown) => {
            input.diagnosticSink?.({
              sourceId: source.id,
              errorClass:
                error instanceof Error ? error.message : "file-change-error",
            });
          });
        },
      );
      return {
        sourceId: source.id,
        stop: async () => {
          for (const entry of pending.values()) {
            runtime.clearTimer(entry.timer);
          }
          pending.clear();
          watcher.close();
        },
      };
    },
    async normalize(raw): Promise<ExternalEventEnvelope> {
      const source = isFileChangeSource(raw.source)
        ? raw.source
        : ({
            id: raw.sourceId,
            kind: "file-change",
            provider: "local-fs",
            directory: ".",
            changeTypes: ["create", "modify", "delete"],
          } satisfies FileChangeSourceConfig);
      const change = rawBodyToFileChange(raw);
      const suffixes = resolveSuffixFilters(source);
      if (
        !shouldEmitChange(
          source,
          suffixes,
          change.changeType,
          change.relativePath,
        )
      ) {
        throw new Error("file-change event does not match source filters");
      }
      return buildFileChangeEnvelope({
        source,
        changeType: change.changeType,
        relativePath: change.relativePath,
        receivedAt: raw.receivedAt,
        sequence: 0,
        ...(change.metadata === undefined ? {} : { metadata: change.metadata }),
        ...(raw.rawRef === undefined ? {} : { rawRef: raw.rawRef }),
      });
    },
  };
}
