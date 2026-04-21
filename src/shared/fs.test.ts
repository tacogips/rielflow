import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { atomicWriteJsonFile, atomicWriteTextFile } from "./fs";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-shared-fs-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("atomicWriteTextFile", () => {
  test("writes and overwrites files through a temp path", async () => {
    const root = await makeTempDir();
    const filePath = path.join(root, "nested", "artifact.txt");

    await atomicWriteTextFile(filePath, "first");
    expect(await readFile(filePath, "utf8")).toBe("first");

    await atomicWriteTextFile(filePath, "second");
    expect(await readFile(filePath, "utf8")).toBe("second");
    await expect(access(`${filePath}.tmp`)).rejects.toThrow();
  });

  test("ignores stale legacy .tmp siblings when generating a temp path", async () => {
    const root = await makeTempDir();
    const filePath = path.join(root, "artifact.txt");
    await mkdir(`${filePath}.tmp`, { recursive: true });

    await atomicWriteTextFile(filePath, "content");

    expect(await readFile(filePath, "utf8")).toBe("content");
    expect((await readdir(root)).sort()).toEqual([
      "artifact.txt",
      "artifact.txt.tmp",
    ]);
  });

  test("cleans up the temp file when rename fails", async () => {
    const root = await makeTempDir();
    const filePath = path.join(root, "target");
    await mkdir(filePath, { recursive: true });

    await expect(atomicWriteTextFile(filePath, "content")).rejects.toThrow();
    expect(await readdir(root)).toEqual(["target"]);
  });
});

describe("atomicWriteJsonFile", () => {
  test("writes pretty JSON with a trailing newline", async () => {
    const root = await makeTempDir();
    const filePath = path.join(root, "artifact.json");

    await atomicWriteJsonFile(filePath, { ok: true, value: 1 });

    expect(await readFile(filePath, "utf8")).toBe(
      '{\n  "ok": true,\n  "value": 1\n}\n',
    );
  });
});
