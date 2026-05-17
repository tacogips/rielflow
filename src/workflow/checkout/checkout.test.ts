import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkflowTemplate } from "../create";
import {
  checkoutWorkflow,
  fetchGitHubDirectoryToStaging,
  parseGitHubDirectoryUrl,
  resolveWorkflowCheckoutDestination,
} from "./index";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-checkout-test-"),
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

interface FakeGitHubFile {
  readonly repoPath: string;
  readonly content: string;
}

async function collectWorkflowFiles(input: {
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly repoDirectoryPath: string;
}): Promise<readonly FakeGitHubFile[]> {
  const workflowDirectory = path.join(input.workflowRoot, input.workflowName);
  const files: FakeGitHubFile[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath = path
        .relative(workflowDirectory, entryPath)
        .split(path.sep)
        .join("/");
      files.push({
        repoPath: `${input.repoDirectoryPath}/${relativePath}`,
        content: await readFile(entryPath, "utf8"),
      });
    }
  }
  await visit(workflowDirectory);
  return files;
}

function parentDirectoriesForFile(filePath: string): readonly string[] {
  const segments = filePath.split("/");
  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

function createFakeGitHubFetch(input: {
  readonly owner?: string;
  readonly repository?: string;
  readonly ref?: string;
  readonly files: readonly FakeGitHubFile[];
}): typeof fetch {
  const owner = input.owner ?? "org";
  const repository = input.repository ?? "repo";
  const ref = input.ref ?? "main";
  const directoryEntries = new Map<
    string,
    { type: "dir" | "file"; path: string; download_url?: string }[]
  >();
  const fileContents = new Map<string, string>();

  for (const file of input.files) {
    fileContents.set(file.repoPath, file.content);
    for (const directory of parentDirectoriesForFile(file.repoPath)) {
      if (!directoryEntries.has(directory)) {
        directoryEntries.set(directory, []);
      }
    }
  }

  for (const file of input.files) {
    const segments = file.repoPath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const directory = segments.slice(0, index).join("/");
      const childPath = segments.slice(0, index + 1).join("/");
      const isFile = index === segments.length - 1;
      const entries = directoryEntries.get(directory);
      if (
        entries === undefined ||
        entries.some((entry) => entry.path === childPath)
      ) {
        continue;
      }
      entries.push(
        isFile
          ? {
              type: "file",
              path: childPath,
              download_url: `https://download.local/${encodeURIComponent(childPath)}`,
            }
          : { type: "dir", path: childPath },
      );
    }
  }

  return (async (url: string | URL | Request): Promise<Response> => {
    const urlString =
      typeof url === "string" || url instanceof URL ? url.toString() : url.url;
    const parsed = new URL(urlString);
    if (parsed.hostname === "download.local") {
      const repoPath = decodeURIComponent(parsed.pathname.slice(1));
      const content = fileContents.get(repoPath);
      return content === undefined
        ? new Response("missing", { status: 404 })
        : new Response(content);
    }
    const prefix = `/repos/${owner}/${repository}/contents/`;
    if (
      parsed.hostname !== "api.github.com" ||
      parsed.searchParams.get("ref") !== ref ||
      !parsed.pathname.startsWith(prefix)
    ) {
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      });
    }
    const repoPath = decodeURIComponent(parsed.pathname.slice(prefix.length));
    const entries = directoryEntries.get(repoPath);
    return entries === undefined
      ? new Response(JSON.stringify({ message: "Not Found" }), { status: 404 })
      : new Response(JSON.stringify(entries), {
          headers: { "content-type": "application/json" },
        });
  }) as typeof fetch;
}

async function createRemoteTemplate(input: {
  readonly root: string;
  readonly workflowName: string;
  readonly repoDirectoryPath?: string;
}): Promise<readonly FakeGitHubFile[]> {
  const created = await createWorkflowTemplate(input.workflowName, {
    workflowRoot: input.root,
    templateMode: "worker-only",
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  return collectWorkflowFiles({
    workflowRoot: input.root,
    workflowName: input.workflowName,
    repoDirectoryPath:
      input.repoDirectoryPath ?? `.divedra/workflows/${input.workflowName}`,
  });
}

describe("workflow checkout GitHub directory support", () => {
  test("parses supported GitHub directory URLs and rejects unsafe names", () => {
    const parsed = parseGitHubDirectoryUrl(
      "https://github.com/org/repo/tree/main/.divedra/workflows/demo-flow",
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual({
        owner: "org",
        repository: "repo",
        ref: "main",
        directoryPath: ".divedra/workflows/demo-flow",
        workflowName: "demo-flow",
      });
    }

    const unsafe = parseGitHubDirectoryUrl(
      "https://github.com/org/repo/tree/main/.divedra/workflows/bad.name",
    );
    expect(unsafe.ok).toBe(false);
    if (!unsafe.ok) {
      expect(unsafe.error.code).toBe("INVALID_WORKFLOW_NAME");
    }

    const malformedPercent = parseGitHubDirectoryUrl(
      "https://github.com/org/repo/tree/main/.divedra/workflows/%E0%A4%A",
    );
    expect(malformedPercent.ok).toBe(false);
    if (!malformedPercent.ok) {
      expect(malformedPercent.error.code).toBe("INVALID_SOURCE_URL");
    }
  });

  test("resolves slash-containing refs through GitHub contents metadata", async () => {
    const root = await makeTempDir();
    const files = await createRemoteTemplate({
      root,
      workflowName: "demo",
      repoDirectoryPath: ".divedra/workflows/demo",
    });
    const staging = path.join(root, "staging");
    const fetched = await fetchGitHubDirectoryToStaging({
      sourceUrl:
        "https://github.com/org/repo/tree/feature/foo/.divedra/workflows/demo",
      destinationDirectory: staging,
      fetchImpl: createFakeGitHubFetch({ ref: "feature/foo", files }),
    });

    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(fetched.value.ref).toBe("feature/foo");
      expect(await stat(path.join(staging, "workflow.json"))).toBeDefined();
    }
  });

  test("installs valid project checkout and writes registry metadata", async () => {
    const root = await makeTempDir();
    const sourceRoot = path.join(root, "source");
    const projectRoot = path.join(root, "project");
    const userRoot = path.join(root, "user", ".divedra");
    await mkdir(projectRoot, { recursive: true });
    const files = await createRemoteTemplate({
      root: sourceRoot,
      workflowName: "demo",
    });

    const checkedOut = await checkoutWorkflow({
      sourceUrl:
        "https://github.com/org/repo/tree/main/.divedra/workflows/demo",
      cwd: projectRoot,
      userRoot,
      fetchImpl: createFakeGitHubFetch({ files }),
      now: () => new Date("2026-05-17T00:00:00.000Z"),
    });

    expect(checkedOut.ok).toBe(true);
    if (!checkedOut.ok) {
      return;
    }
    expect(checkedOut.value.scope).toBe("project");
    expect(checkedOut.value.destinationDirectory).toBe(
      path.join(projectRoot, ".divedra", "workflows", "demo"),
    );
    expect(checkedOut.value.registryPath).toBe(
      path.join(
        userRoot,
        "workflow-registry",
        "checkouts",
        "project-demo.json",
      ),
    );
    const registry = JSON.parse(
      await readFile(checkedOut.value.registryPath, "utf8"),
    ) as {
      workflowName: string;
      sourceUrl: string;
      scope: string;
      checkedOutAt: string;
      destinationDirectory: string;
    };
    expect(registry).toEqual({
      workflowName: "demo",
      sourceUrl:
        "https://github.com/org/repo/tree/main/.divedra/workflows/demo",
      scope: "project",
      checkedOutAt: "2026-05-17T00:00:00.000Z",
      destinationDirectory: checkedOut.value.destinationDirectory,
    });
  });

  test("invalid remote workflow fails before destination or registry mutation", async () => {
    const root = await makeTempDir();
    const projectRoot = path.join(root, "project");
    const userRoot = path.join(root, "user", ".divedra");
    const files = [
      {
        repoPath: ".divedra/workflows/demo/workflow.json",
        content: "{ invalid json",
      },
    ];

    const checkedOut = await checkoutWorkflow({
      sourceUrl:
        "https://github.com/org/repo/tree/main/.divedra/workflows/demo",
      cwd: projectRoot,
      userRoot,
      fetchImpl: createFakeGitHubFetch({ files }),
    });

    expect(checkedOut.ok).toBe(false);
    if (!checkedOut.ok) {
      expect(checkedOut.error.code).toBe("VALIDATION");
    }
    expect(
      await stat(path.join(projectRoot, ".divedra", "workflows", "demo")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(
      await stat(
        path.join(
          userRoot,
          "workflow-registry",
          "checkouts",
          "project-demo.json",
        ),
      ).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });

  test("duplicate checkout fails unless overwrite is requested", async () => {
    const root = await makeTempDir();
    const sourceRoot = path.join(root, "source");
    const projectRoot = path.join(root, "project");
    const userRoot = path.join(root, "user", ".divedra");
    const files = await createRemoteTemplate({
      root: sourceRoot,
      workflowName: "demo",
    });
    const fetchImpl = createFakeGitHubFetch({ files });
    const options = {
      sourceUrl:
        "https://github.com/org/repo/tree/main/.divedra/workflows/demo",
      cwd: projectRoot,
      userRoot,
      fetchImpl,
    };

    const first = await checkoutWorkflow(options);
    expect(first.ok).toBe(true);

    const duplicate = await checkoutWorkflow(options);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe("DUPLICATE_CHECKOUT");
    }

    const overwritten = await checkoutWorkflow({ ...options, overwrite: true });
    expect(overwritten.ok).toBe(true);
    if (overwritten.ok) {
      expect(overwritten.value.overwritten).toBe(true);
    }
  });

  test("registry write failure rolls back destination changes", async () => {
    const root = await makeTempDir();
    const sourceRoot = path.join(root, "source");
    const projectRoot = path.join(root, "project");
    const goodUserRoot = path.join(root, "user", ".divedra");
    const badUserRoot = path.join(root, "not-a-directory");
    await writeFile(badUserRoot, "blocks registry parent creation");
    const files = await createRemoteTemplate({
      root: sourceRoot,
      workflowName: "demo",
    });
    const fetchImpl = createFakeGitHubFetch({ files });
    const sourceUrl =
      "https://github.com/org/repo/tree/main/.divedra/workflows/demo";

    const initial = await checkoutWorkflow({
      sourceUrl,
      cwd: projectRoot,
      userRoot: goodUserRoot,
      fetchImpl,
    });
    expect(initial.ok).toBe(true);
    if (!initial.ok) {
      return;
    }
    const destinationWorkflowJson = path.join(
      initial.value.destinationDirectory,
      "workflow.json",
    );
    const originalWorkflowJson = await readFile(
      destinationWorkflowJson,
      "utf8",
    );

    const failedOverwrite = await checkoutWorkflow({
      sourceUrl,
      cwd: projectRoot,
      userRoot: badUserRoot,
      fetchImpl,
      overwrite: true,
    });

    expect(failedOverwrite.ok).toBe(false);
    if (!failedOverwrite.ok) {
      expect(failedOverwrite.error.code).toBe("IO");
    }
    await expect(readFile(destinationWorkflowJson, "utf8")).resolves.toBe(
      originalWorkflowJson,
    );
  });

  test("resolves user-scope destination and registry path", () => {
    const resolved = resolveWorkflowCheckoutDestination("demo", {
      cwd: "/tmp/project",
      userRoot: "/tmp/user/.divedra",
      userScope: true,
    });

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.scope).toBe("user");
      expect(resolved.value.workflowDirectory).toBe(
        "/tmp/user/.divedra/workflows/demo",
      );
      expect(resolved.value.registryPath).toBe(
        "/tmp/user/.divedra/workflow-registry/checkouts/user-demo.json",
      );
    }
  });
});
