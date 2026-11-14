import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  checkSourceFilenames,
  isForbiddenSourcePartBasename,
} from "./check-source-filenames";

const tempDirs: string[] = [];

async function makeTempRepository(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-source-filename-policy-"),
  );
  tempDirs.push(directory);
  await mkdir(path.join(directory, "packages", "example", "src"), {
    recursive: true,
  });
  await writeFile(path.join(directory, "vitest.config.ts"), "", "utf8");
  return directory;
}

async function writeFixture(root: string, relativePath: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, "", "utf8");
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("isForbiddenSourcePartBasename", () => {
  test("rejects only numbered part TypeScript basenames", () => {
    expect(isForbiddenSourcePartBasename("part-1.ts")).toBe(true);
    expect(isForbiddenSourcePartBasename("part-01.ts")).toBe(true);
    expect(isForbiddenSourcePartBasename("part-1.tsx")).toBe(true);
    expect(isForbiddenSourcePartBasename("part-01.tsx")).toBe(true);

    expect(isForbiddenSourcePartBasename("workflow-loader.ts")).toBe(false);
    expect(isForbiddenSourcePartBasename("node-output-contract.ts")).toBe(
      false,
    );
    expect(isForbiddenSourcePartBasename("session-partition.ts")).toBe(false);
    expect(isForbiddenSourcePartBasename("feature-part-1.ts")).toBe(false);
    expect(isForbiddenSourcePartBasename("part-alpha.ts")).toBe(false);
    expect(isForbiddenSourcePartBasename("part-1.test.ts")).toBe(false);
  });
});

describe("checkSourceFilenames", () => {
  test("reports every forbidden filename in Biome source scope", async () => {
    const root = await makeTempRepository();
    await writeFixture(root, "packages/example/src/part-1.ts");
    await writeFixture(root, "packages/example/src/nested/part-01.ts");
    await writeFixture(root, "packages/example/src/components/part-1.tsx");
    await writeFixture(root, "packages/example/src/components/part-01.tsx");

    const result = await checkSourceFilenames(root);

    expect(result.violations).toEqual([
      {
        path: "packages/example/src/components/part-01.tsx",
        basename: "part-01.tsx",
      },
      {
        path: "packages/example/src/components/part-1.tsx",
        basename: "part-1.tsx",
      },
      {
        path: "packages/example/src/nested/part-01.ts",
        basename: "part-01.ts",
      },
      { path: "packages/example/src/part-1.ts", basename: "part-1.ts" },
    ]);
    expect(result.rootSourceTreePresent).toBe(false);
  });

  test("allows descriptive filenames and non-source substring matches", async () => {
    const root = await makeTempRepository();
    await writeFixture(root, "packages/example/src/workflow-loader.ts");
    await writeFixture(root, "packages/example/src/node-output-contract.ts");
    await writeFixture(root, "packages/example/src/session-partition.ts");
    await writeFixture(root, "packages/example/src/feature-part-1.ts");
    await writeFixture(root, "docs/part-1.ts");

    const result = await checkSourceFilenames(root);

    expect(result.violations).toEqual([]);
    expect(result.rootSourceTreePresent).toBe(false);
  });

  test("reports a recreated root source tree", async () => {
    const root = await makeTempRepository();
    await writeFixture(root, "src/main.ts");

    const result = await checkSourceFilenames(root);

    expect(result.rootSourceTreePresent).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
