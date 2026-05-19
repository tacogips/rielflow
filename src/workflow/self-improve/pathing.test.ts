import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  resolveSelfImproveExecutionDirectory,
  resolveSelfImproveLogRoot,
  resolveWorkflowSelfImproveDirectory,
  workflowDirectoryIdentity,
} from "./pathing";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-self-improve-pathing-"),
  );
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

describe("workflow self-improve pathing", () => {
  test("resolves configured log roots with shared relative-root conventions", async () => {
    const root = await makeTempDir();

    expect(
      resolveSelfImproveLogRoot({
        cwd: root,
        env: {},
        selfImproveLogRoot: "relative-log",
      }),
    ).toBe(path.join(root, "relative-log"));
  });

  test("uses collision-resistant workflow directory identities", async () => {
    const root = await makeTempDir();
    const first = path.join(root, "one", "demo");
    const second = path.join(root, "two", "demo");

    expect(workflowDirectoryIdentity(first)).not.toBe(
      workflowDirectoryIdentity(second),
    );
    expect(workflowDirectoryIdentity(first)).toMatch(/^demo-[0-9a-f]{12}$/u);
  });

  test("scopes execution directories under the self-improve log root", async () => {
    const root = await makeTempDir();
    const logRoot = path.join(root, "logs");
    const workflowDirectory = path.join(root, "workflow");

    const workflowLogRoot = resolveWorkflowSelfImproveDirectory({
      logRoot,
      workflowDirectory,
    });
    expect(workflowLogRoot.startsWith(`${logRoot}${path.sep}`)).toBe(true);
    expect(() =>
      resolveSelfImproveExecutionDirectory({
        logRoot,
        workflowDirectory,
        selfImproveId: "../escape",
      }),
    ).toThrow("must be a safe path segment");
  });
});
