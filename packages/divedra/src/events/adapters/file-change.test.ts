import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { FILE_CHANGE_MAX_STABILITY_WINDOW_MS } from "../file-change-constraints";
import { createFileChangeEventSourceAdapter } from "./file-change";
import type { EventSourceStartInput } from "../source-adapter";
import type { ExternalEventEnvelope, FileChangeSourceConfig } from "../types";

type FileChangeRuntime = NonNullable<
  Parameters<typeof createFileChangeEventSourceAdapter>[0]
>;

function fileStat(size: number, mtime: string) {
  return {
    size,
    mtime: new Date(mtime),
    isFile: () => true,
  } as Awaited<ReturnType<FileChangeRuntime["stat"]>>;
}

function createRuntime(input: {
  readonly directory: string;
  readonly files: Map<string, Awaited<ReturnType<FileChangeRuntime["stat"]>>>;
}) {
  let listener:
    | ((eventType: string, fileName: string | Buffer | null) => void)
    | undefined;
  const runtime: FileChangeRuntime = {
    watch: (_directory, _options, nextListener) => {
      listener = nextListener;
      return { close: vi.fn() };
    },
    stat: async (filePath) => {
      const value = input.files.get(filePath);
      if (value !== undefined) {
        return value;
      }
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    listFiles: async () => [...input.files.keys()],
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (timer) => clearTimeout(timer),
  };
  return {
    runtime,
    change(fileName: string): void {
      listener?.("change", fileName);
    },
    rename(fileName: string): void {
      listener?.("rename", fileName);
    },
  };
}

function source(
  overrides: Partial<FileChangeSourceConfig> = {},
): FileChangeSourceConfig {
  return {
    id: "local-docs",
    kind: "file-change",
    directory: "./watched-docs",
    changeTypes: ["create", "modify", "delete"],
    stabilityWindowMs: 0,
    configFilePath: path.join("/repo/.divedra-events/sources/local-docs.json"),
    ...overrides,
  };
}

async function waitForEventCount(
  dispatched: readonly ExternalEventEnvelope[],
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (dispatched.length === count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(dispatched).toHaveLength(count);
}

describe("file change event source adapter", () => {
  test("dispatches create, modify, and delete events from watched file changes", async () => {
    const directory = path.join("/repo/.divedra-events/sources/watched-docs");
    const existingPath = path.join(directory, "existing.md");
    const createdPath = path.join(directory, "created.md");
    const files = new Map([
      [existingPath, fileStat(10, "2026-05-19T00:00:00.000Z")],
    ]);
    const watcher = createRuntime({ directory, files });
    const dispatched: ExternalEventEnvelope[] = [];
    const adapter = createFileChangeEventSourceAdapter(watcher.runtime);

    const handle = await adapter.start({
      source: source(),
      dispatch: async (event) => {
        dispatched.push(event);
      },
      signal: new AbortController().signal,
      now: () => new Date("2026-05-19T00:00:01.000Z"),
    } satisfies EventSourceStartInput);

    files.set(createdPath, fileStat(20, "2026-05-19T00:00:02.000Z"));
    watcher.rename("created.md");
    await waitForEventCount(dispatched, 1);
    files.set(existingPath, fileStat(11, "2026-05-19T00:00:03.000Z"));
    watcher.change("existing.md");
    await waitForEventCount(dispatched, 2);
    files.delete(existingPath);
    watcher.rename("existing.md");

    await waitForEventCount(dispatched, 3);
    expect(dispatched.map((event) => event.eventType)).toEqual([
      "file.change.created",
      "file.change.modified",
      "file.change.deleted",
    ]);
    expect(dispatched.map((event) => event.input)).toEqual([
      {
        change: { type: "create" },
        file: {
          path: "created.md",
          name: "created.md",
          extension: ".md",
          size: 20,
          mtime: "2026-05-19T00:00:02.000Z",
        },
        watch: { sourceId: "local-docs", directory: "./watched-docs" },
      },
      {
        change: { type: "modify" },
        file: {
          path: "existing.md",
          name: "existing.md",
          extension: ".md",
          size: 11,
          mtime: "2026-05-19T00:00:03.000Z",
        },
        watch: { sourceId: "local-docs", directory: "./watched-docs" },
      },
      {
        change: { type: "delete" },
        file: {
          path: "existing.md",
          name: "existing.md",
          extension: ".md",
        },
        watch: { sourceId: "local-docs", directory: "./watched-docs" },
      },
    ]);

    await handle.stop();
  });

  test("honors selected change types and suffix filters before dispatch", async () => {
    const directory = path.join("/repo/.divedra-events/sources/watched-docs");
    const mdPath = path.join(directory, "release.md");
    const txtPath = path.join(directory, "notes.txt");
    const files = new Map<
      string,
      Awaited<ReturnType<FileChangeRuntime["stat"]>>
    >();
    const watcher = createRuntime({ directory, files });
    const dispatched: ExternalEventEnvelope[] = [];
    const adapter = createFileChangeEventSourceAdapter(watcher.runtime);

    await adapter.start({
      source: source({
        changeTypes: ["delete"],
        filters: { suffixes: [".md"] },
      }),
      dispatch: async (event) => {
        dispatched.push(event);
      },
      signal: new AbortController().signal,
      now: () => new Date("2026-05-19T00:00:01.000Z"),
    } satisfies EventSourceStartInput);

    files.set(mdPath, fileStat(20, "2026-05-19T00:00:02.000Z"));
    files.set(txtPath, fileStat(20, "2026-05-19T00:00:02.000Z"));
    watcher.rename("release.md");
    watcher.rename("notes.txt");
    files.delete(mdPath);
    files.delete(txtPath);
    watcher.rename("release.md");
    watcher.rename("notes.txt");

    await waitForEventCount(dispatched, 1);
    expect(dispatched.map((event) => event.eventType)).toEqual([
      "file.change.deleted",
    ]);
    expect(dispatched[0]?.input).toMatchObject({
      change: { type: "delete" },
      file: { path: "release.md" },
    });
  });

  test("normalizes manual file-change fixtures", async () => {
    const adapter = createFileChangeEventSourceAdapter();
    const envelope = await adapter.normalize({
      sourceId: "local-docs",
      source: source({ changeTypes: ["modify"] }),
      receivedAt: "2026-05-19T00:00:00.000Z",
      body: {
        changeType: "modify",
        path: "plans/release.md",
        size: 128,
        mtime: "2026-05-19T00:00:00.000Z",
      },
    });

    expect(envelope.eventType).toBe("file.change.modified");
    expect(envelope.provider).toBe("local-fs");
    expect(envelope.input).toEqual({
      change: { type: "modify" },
      file: {
        path: "plans/release.md",
        name: "release.md",
        extension: ".md",
        size: 128,
        mtime: "2026-05-19T00:00:00.000Z",
      },
      watch: { sourceId: "local-docs", directory: "./watched-docs" },
    });
  });

  test("applies suffix filters when normalizing manual file-change fixtures", async () => {
    const adapter = createFileChangeEventSourceAdapter();

    await expect(
      adapter.normalize({
        sourceId: "local-docs",
        source: source({
          filters: { suffixes: [".md"] },
        }),
        receivedAt: "2026-05-19T00:00:00.000Z",
        body: {
          changeType: "create",
          path: "plans/release.txt",
        },
      }),
    ).rejects.toThrow("does not match source filters");
  });

  test("rejects stability windows above the documented runtime bound", async () => {
    const directory = path.join("/repo/.divedra-events/sources/watched-docs");
    const watcher = createRuntime({ directory, files: new Map() });
    const adapter = createFileChangeEventSourceAdapter(watcher.runtime);

    await expect(
      adapter.start({
        source: source({
          stabilityWindowMs: FILE_CHANGE_MAX_STABILITY_WINDOW_MS + 1,
        }),
        dispatch: async () => {},
        signal: new AbortController().signal,
        now: () => new Date("2026-05-19T00:00:01.000Z"),
      } satisfies EventSourceStartInput),
    ).rejects.toThrow(String(FILE_CHANGE_MAX_STABILITY_WINDOW_MS));
  });

  test("accepts the documented maximum stability window", async () => {
    const directory = path.join("/repo/.divedra-events/sources/watched-docs");
    const watcher = createRuntime({ directory, files: new Map() });
    const adapter = createFileChangeEventSourceAdapter(watcher.runtime);

    const handle = await adapter.start({
      source: source({
        stabilityWindowMs: FILE_CHANGE_MAX_STABILITY_WINDOW_MS,
      }),
      dispatch: async () => {},
      signal: new AbortController().signal,
      now: () => new Date("2026-05-19T00:00:01.000Z"),
    } satisfies EventSourceStartInput);

    await handle.stop();
  });

  test("rejects unsafe suffix filters at runtime", async () => {
    const directory = path.join("/repo/.divedra-events/sources/watched-docs");
    const watcher = createRuntime({ directory, files: new Map() });
    const adapter = createFileChangeEventSourceAdapter(watcher.runtime);

    await expect(
      adapter.start({
        source: source({
          filters: { suffixes: ["docs/.md"] },
        }),
        dispatch: async () => {},
        signal: new AbortController().signal,
        now: () => new Date("2026-05-19T00:00:01.000Z"),
      } satisfies EventSourceStartInput),
    ).rejects.toThrow("suffix must not contain path separators");
  });

  test("rejects unsafe suffix filters while normalizing manual events", async () => {
    const adapter = createFileChangeEventSourceAdapter();

    await expect(
      adapter.normalize({
        sourceId: "local-docs",
        source: source({
          filters: { suffixes: ["docs/.md"] },
        }),
        receivedAt: "2026-05-19T00:00:00.000Z",
        body: {
          changeType: "create",
          path: "plans/release.md",
        },
      }),
    ).rejects.toThrow("suffix must not contain path separators");
  });
});
