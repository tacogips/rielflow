import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteJsonFile } from "../../shared/fs";
import { loadWorkflowFromCatalog, loadWorkflowFromDisk } from "../load";
import { err, ok, type Result } from "../result";
import {
  computeWorkflowPackageChecksum,
  computeWorkflowPackageIntegrityDigest,
} from "./checksum";
import {
  createWorkflowPackageSignature,
  loadWorkflowPackageSigningConfig,
} from "./integrity";
import {
  isSafeWorkflowPackageName,
  normalizeWorkflowPackageMetadataFromWorkflowJson,
  normalizePackageRelativePath,
} from "./manifest";
import {
  isSupportedGitHubRepositoryUrl,
  loadWorkflowPackageRegistryConfig,
  resolveWorkflowPackageRegistryEntry,
} from "./registry-config";
import {
  WORKFLOW_PACKAGE_MANIFEST_FILE,
  type WorkflowPackageFailure,
  type WorkflowPackageRegistryConfigOptions,
  type WorkflowPackageManifest,
} from "./types";

export interface WorkflowPackagePublishInput {
  readonly workflowDirectory: string;
  readonly packageName?: string;
  readonly registry?: string;
  readonly registryUrl?: string;
  readonly registryLocalPath?: string;
  readonly branch?: string;
  readonly dryRun?: boolean;
  readonly createPr?: boolean;
  readonly pullRequestAdapter?: WorkflowPackagePullRequestAdapter;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}

export interface WorkflowPackagePullRequestInput {
  readonly cwd: string;
  readonly branch: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

export interface WorkflowPackagePullRequestResult {
  readonly prUrl: string;
}

export interface WorkflowPackagePullRequestAdapter {
  createPullRequest(
    input: WorkflowPackagePullRequestInput,
  ): Promise<Result<WorkflowPackagePullRequestResult, WorkflowPackageFailure>>;
}

export interface WorkflowPackagePublishResult {
  readonly packageName: string;
  readonly packageId: string;
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly packageDirectory: string;
  readonly registryUrl: string;
  readonly registryId: string;
  readonly registryRef: string;
  readonly branch: string;
  readonly checksum: string;
  readonly checksumAlgorithm: "md5";
  readonly integrityDigest: string;
  readonly integrityDigestAlgorithm: "sha256";
  readonly gitPushed: boolean;
  readonly dryRun: boolean;
  readonly mode: "direct" | "pull-request";
  readonly changedPaths: readonly string[];
  readonly commitSha?: string;
  readonly prUrl?: string;
}

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
}

async function runProcess(
  cwd: string,
  command: string,
  args: readonly string[],
): Promise<Result<string, WorkflowPackageFailure>> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve(err(packageFailure("GIT_FAILED", error.message)));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(ok(stdout.trim()));
      } else {
        resolve(
          err(
            packageFailure(
              "GIT_FAILED",
              `${command} ${args.join(" ")} failed: ${
                stderr.trim() || stdout.trim()
              }`,
            ),
          ),
        );
      }
    });
  });
}

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<Result<string, WorkflowPackageFailure>> {
  return await runProcess(cwd, "git", args);
}

const ghPullRequestAdapter: WorkflowPackagePullRequestAdapter = {
  async createPullRequest(input) {
    const created = await runProcess(input.cwd, "gh", [
      "pr",
      "create",
      "--base",
      input.base,
      "--head",
      input.branch,
      "--title",
      input.title,
      "--body",
      input.body,
    ]);
    return created.ok ? ok({ prUrl: created.value }) : created;
  },
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDirectRegistryId(registryUrl: string): string {
  try {
    const parsed = new URL(registryUrl);
    const [owner = "unknown", repo = "registry"] = parsed.pathname
      .split("/")
      .filter(Boolean);
    return `github-${owner}-${repo}`.replace(/[^A-Za-z0-9._-]/g, "-");
  } catch {
    return "github-registry";
  }
}

function resolvePublishRegistry(input: {
  readonly config: Awaited<
    ReturnType<typeof loadWorkflowPackageRegistryConfig>
  > extends Result<infer Config, WorkflowPackageFailure>
    ? Config
    : never;
  readonly selector?: string;
  readonly registryUrl?: string;
  readonly registryLocalPath?: string;
  readonly branch?: string;
}): Result<
  {
    readonly id: string;
    readonly url: string;
    readonly defaultBranch: string;
    readonly localPath?: string;
  },
  WorkflowPackageFailure
> {
  const explicitUrl =
    input.registryUrl ??
    (input.selector !== undefined &&
    isSupportedGitHubRepositoryUrl(input.selector)
      ? input.selector
      : undefined);
  if (explicitUrl === undefined) {
    const registry = resolveWorkflowPackageRegistryEntry(
      input.config,
      input.selector,
    );
    if (!registry.ok) {
      return registry;
    }
    const localPath = input.registryLocalPath ?? registry.value.localPath;
    return ok({
      id: registry.value.id,
      url: registry.value.url,
      defaultBranch: registry.value.defaultBranch,
      ...(localPath === undefined ? {} : { localPath }),
    });
  }
  if (!isSupportedGitHubRepositoryUrl(explicitUrl)) {
    return err(
      packageFailure(
        "INVALID_REGISTRY",
        "registry URL must be https://github.com/<owner>/<repo>",
      ),
    );
  }
  const registered = input.config.registries.find(
    (entry) => entry.url === explicitUrl || entry.id === input.selector,
  );
  const localPath = input.registryLocalPath ?? registered?.localPath;
  return ok({
    id: registered?.id ?? createDirectRegistryId(explicitUrl),
    url: explicitUrl,
    defaultBranch: input.branch ?? registered?.defaultBranch ?? "main",
    ...(localPath === undefined ? {} : { localPath }),
  });
}

async function readJsonObject(
  filePath: string,
): Promise<Readonly<Record<string, unknown>>> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readJsonArray(
  filePath: string,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

async function readWorkflowPackagePublishMetadata(
  workflowDirectory: string,
): Promise<
  Result<WorkflowPackageManifest["workflow"], WorkflowPackageFailure>
> {
  const raw = await readFile(
    path.join(workflowDirectory, "workflow.json"),
    "utf8",
  );
  try {
    const workflowJson = JSON.parse(raw) as unknown;
    return normalizeWorkflowPackageMetadataFromWorkflowJson(workflowJson);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure(
        "VALIDATION",
        `workflow.json metadata is invalid: ${message}`,
      ),
    );
  }
}

async function workflowBundleExists(directory: string): Promise<boolean> {
  try {
    return (await stat(path.join(directory, "workflow.json"))).isFile();
  } catch {
    return false;
  }
}

function shouldCopyPackageEntry(source: string): boolean {
  const parts = source.split(path.sep);
  return (
    !parts.includes(".git") &&
    !parts.includes(".rielflow") &&
    !source.endsWith(".tmp") &&
    !source.endsWith(".published-branch") &&
    !source.endsWith(".rielflow-package-provenance.json")
  );
}

async function assertCleanRegistryWorktree(
  registryRoot: string,
): Promise<Result<void, WorkflowPackageFailure>> {
  const status = await runGit(registryRoot, ["status", "--porcelain"]);
  if (!status.ok) {
    return status;
  }
  if (status.value.length > 0) {
    return err(
      packageFailure(
        "GIT_FAILED",
        "registry worktree has uncommitted changes; commit or clean it before publishing",
      ),
    );
  }
  return ok(undefined);
}

async function writeRegistryPublishMetadata(input: {
  readonly registryRoot: string;
  readonly registryId: string;
  readonly registryUrl: string;
  readonly branch: string;
  readonly packageName: string;
  readonly workflowName: string;
  readonly packagePath: string;
  readonly workflowDirectory: string;
  readonly description: string;
  readonly checksum: string;
  readonly checksumAlgorithm: "md5";
  readonly integrityDigest: string;
  readonly integrityDigestAlgorithm: "sha256";
  readonly includedFiles: readonly string[];
  readonly now: Date;
}): Promise<void> {
  const registryDirectory = path.join(input.registryRoot, "registry");
  await mkdir(registryDirectory, { recursive: true });
  const indexPath = path.join(registryDirectory, "index.json");
  const checksumsPath = path.join(registryDirectory, "checksums.json");
  const nextRecord = {
    registryId: input.registryId,
    registryUrl: input.registryUrl,
    packageName: input.packageName,
    version: "0.1.0",
    title: input.workflowName,
    description: input.description,
    tags: [],
    backends: [],
    workflowId: input.workflowName,
    workflowDescription: input.description,
    workflowDirectory: input.workflowDirectory,
    sourceBranch: input.branch,
    sourcePath: path.posix.join("packages", input.packagePath),
    checksum: input.checksum,
    checksumAlgorithm: input.checksumAlgorithm,
    integrity: {
      digestAlgorithm: input.integrityDigestAlgorithm,
      digest: input.integrityDigest,
    },
    updatedAt: input.now.toISOString(),
  };
  const existingIndex = await readJsonArray(indexPath);
  await atomicWriteJsonFile(indexPath, [
    ...existingIndex.filter(
      (record) => record["packageName"] !== input.packageName,
    ),
    nextRecord,
  ]);
  const existingChecksums = await readJsonObject(checksumsPath);
  const existingPackages = isRecord(existingChecksums["packages"])
    ? existingChecksums["packages"]
    : {};
  await atomicWriteJsonFile(checksumsPath, {
    ...existingChecksums,
    packages: {
      ...existingPackages,
      [input.packageName]: {
        checksum: input.checksum,
        checksumAlgorithm: input.checksumAlgorithm,
        integrity: {
          digestAlgorithm: input.integrityDigestAlgorithm,
          digest: input.integrityDigest,
        },
        files: input.includedFiles,
      },
    },
  });
}

export async function publishWorkflowPackage(
  input: WorkflowPackagePublishInput,
): Promise<Result<WorkflowPackagePublishResult, WorkflowPackageFailure>> {
  const config = await loadWorkflowPackageRegistryConfig(input.options);
  if (!config.ok) {
    return config;
  }
  const registry = resolvePublishRegistry({
    config: config.value,
    ...(input.registry === undefined ? {} : { selector: input.registry }),
    ...(input.registryUrl === undefined
      ? {}
      : { registryUrl: input.registryUrl }),
    ...(input.registryLocalPath === undefined
      ? {}
      : { registryLocalPath: input.registryLocalPath }),
    ...(input.branch === undefined ? {} : { branch: input.branch }),
  });
  if (!registry.ok) {
    return registry;
  }
  if (registry.value.localPath === undefined) {
    return err(
      packageFailure(
        "GIT_FAILED",
        `registry '${registry.value.id}' has no localPath to publish into`,
      ),
    );
  }
  const branch = input.branch ?? registry.value.defaultBranch;
  const cwd = input.options?.cwd ?? process.cwd();
  const candidateWorkflowDirectory = path.resolve(cwd, input.workflowDirectory);
  const loadOptions = {
    ...(input.options?.cwd === undefined ? {} : { cwd: input.options.cwd }),
    ...(input.options?.env === undefined ? {} : { env: input.options.env }),
    ...(input.options?.userRoot === undefined
      ? {}
      : { userRoot: input.options.userRoot }),
    ...(input.options?.projectRoot === undefined
      ? {}
      : { projectRoot: input.options.projectRoot }),
  };
  const loaded = (await workflowBundleExists(candidateWorkflowDirectory))
    ? await loadWorkflowFromDisk(path.basename(candidateWorkflowDirectory), {
        ...loadOptions,
        workflowRoot: path.dirname(candidateWorkflowDirectory),
      })
    : await loadWorkflowFromCatalog(input.workflowDirectory, loadOptions);
  if (!loaded.ok) {
    return err(
      packageFailure(
        "VALIDATION",
        `workflow validation failed before publish: ${loaded.error.message}`,
      ),
    );
  }
  const workflowDirectory = loaded.value.workflowDirectory;
  const workflowName = loaded.value.workflowName;
  const packageName = input.packageName ?? workflowName;
  if (!isSafeWorkflowPackageName(packageName)) {
    return err(
      packageFailure(
        "INVALID_PACKAGE_NAME",
        `invalid package name '${packageName}'`,
      ),
    );
  }
  const packagePath = normalizePackageRelativePath(
    packageName.replace(/^@/, "").replace("/", "__"),
  );
  if (packagePath === undefined) {
    return err(packageFailure("UNSAFE_PATH", "package path is unsafe"));
  }
  const packageDirectory = path.join(
    registry.value.localPath,
    "packages",
    packagePath,
  );
  const stagingRoot =
    input.dryRun === true
      ? await mkdtemp(path.join(os.tmpdir(), "rielflow-package-publish-"))
      : undefined;
  const writePackageDirectory =
    stagingRoot === undefined
      ? packageDirectory
      : path.join(stagingRoot, "packages", packagePath);
  const workflowTarget = path.join(writePackageDirectory, "workflow");
  try {
    if (input.dryRun !== true) {
      const clean = await assertCleanRegistryWorktree(registry.value.localPath);
      if (!clean.ok) {
        return clean;
      }
      const checkout = await runGit(registry.value.localPath, [
        "checkout",
        branch,
      ]);
      if (!checkout.ok) {
        const createBranch = await runGit(registry.value.localPath, [
          "checkout",
          "-B",
          branch,
        ]);
        if (!createBranch.ok) {
          return createBranch;
        }
      }
    }
    await mkdir(writePackageDirectory, { recursive: true });
    await rm(workflowTarget, { recursive: true, force: true });
    await cp(workflowDirectory, workflowTarget, {
      recursive: true,
      filter: (source) =>
        shouldCopyPackageEntry(path.relative(workflowDirectory, source)),
    });
    const workflowMetadata =
      await readWorkflowPackagePublishMetadata(workflowDirectory);
    if (!workflowMetadata.ok) {
      return workflowMetadata;
    }
    const signing = await loadWorkflowPackageSigningConfig(input.options);
    if (!signing.ok) {
      return signing;
    }
    const manifest: WorkflowPackageManifest = {
      name: packageName,
      version: "0.1.0",
      title: workflowMetadata.value.title ?? workflowName,
      description: workflowMetadata.value.description,
      tags: workflowMetadata.value.tags,
      workflow: workflowMetadata.value,
      registry: registry.value.id,
      checksum: "pending",
      checksumAlgorithm: "md5",
      integrity: {
        digestAlgorithm: "sha256",
        digest: "",
      },
      workflowDirectory: "workflow",
      repository: registry.value.url,
    };
    await atomicWriteJsonFile(
      path.join(writePackageDirectory, WORKFLOW_PACKAGE_MANIFEST_FILE),
      manifest,
    );
    const checksum = await computeWorkflowPackageChecksum({
      packageRoot: writePackageDirectory,
      workflowDirectory: "workflow",
    });
    if (!checksum.ok) {
      return checksum;
    }
    const integrity = await computeWorkflowPackageIntegrityDigest({
      packageRoot: writePackageDirectory,
      workflowDirectory: "workflow",
    });
    if (!integrity.ok) {
      return integrity;
    }
    const signature =
      signing.value === undefined
        ? undefined
        : createWorkflowPackageSignature({
            digest: integrity.value.digest,
            signing: signing.value,
          });
    if (signature !== undefined && !signature.ok) {
      return signature;
    }
    await atomicWriteJsonFile(
      path.join(writePackageDirectory, WORKFLOW_PACKAGE_MANIFEST_FILE),
      {
        ...manifest,
        checksum: checksum.value.checksum,
        integrity: {
          digestAlgorithm: integrity.value.digestAlgorithm,
          digest: integrity.value.digest,
          ...(signature === undefined ? {} : { signatures: [signature.value] }),
        },
      },
    );
    await writeRegistryPublishMetadata({
      registryRoot: stagingRoot ?? registry.value.localPath,
      registryId: registry.value.id,
      registryUrl: registry.value.url,
      branch,
      packageName: packageName,
      workflowName,
      packagePath,
      workflowDirectory: "workflow",
      description: workflowMetadata.value.description,
      checksum: checksum.value.checksum,
      checksumAlgorithm: checksum.value.checksumAlgorithm,
      integrityDigest: integrity.value.digest,
      integrityDigestAlgorithm: integrity.value.digestAlgorithm,
      includedFiles: checksum.value.includedFiles,
      now: input.options?.now ?? new Date(),
    });
    const changedPaths = [
      path.posix.join("packages", packagePath),
      "registry/index.json",
      "registry/checksums.json",
    ];
    if (input.dryRun === true) {
      return ok({
        packageName: packageName,
        packageId: packageName,
        workflowName,
        workflowDirectory: "workflow",
        packageDirectory,
        registryId: registry.value.id,
        registryUrl: registry.value.url,
        registryRef: branch,
        branch,
        checksum: checksum.value.checksum,
        checksumAlgorithm: checksum.value.checksumAlgorithm,
        integrityDigest: integrity.value.digest,
        integrityDigestAlgorithm: integrity.value.digestAlgorithm,
        gitPushed: false,
        dryRun: true,
        mode: input.createPr === true ? "pull-request" : "direct",
        changedPaths,
      });
    }
    const pushProbe = await runGit(registry.value.localPath, [
      "push",
      "--dry-run",
      "origin",
      branch,
    ]);
    if (!pushProbe.ok && input.createPr !== true) {
      return pushProbe;
    }
    await runGit(registry.value.localPath, ["add", packageDirectory]);
    await runGit(registry.value.localPath, ["add", "registry/index.json"]);
    await runGit(registry.value.localPath, ["add", "registry/checksums.json"]);
    const commit = await runGit(registry.value.localPath, [
      "commit",
      "-m",
      `publish workflow package ${packageName}`,
    ]);
    if (!commit.ok && !commit.error.message.includes("nothing to commit")) {
      return commit;
    }
    const commitSha = await runGit(registry.value.localPath, [
      "rev-parse",
      "HEAD",
    ]);
    const push =
      input.createPr === true
        ? err(packageFailure("GIT_FAILED", "pull request mode requested"))
        : await runGit(registry.value.localPath, ["push", "origin", branch]);
    if (!push.ok) {
      if (input.createPr !== true) {
        return push;
      }
      const publishBranch = `publish/${packageName.replace(/[^A-Za-z0-9._-]/g, "-")}`;
      const checkout = await runGit(registry.value.localPath, [
        "checkout",
        "-B",
        publishBranch,
      ]);
      if (!checkout.ok) {
        return checkout;
      }
      const branchPush = await runGit(registry.value.localPath, [
        "push",
        "-u",
        "origin",
        publishBranch,
      ]);
      if (!branchPush.ok) {
        return branchPush;
      }
      const gh = await (
        input.pullRequestAdapter ?? ghPullRequestAdapter
      ).createPullRequest({
        cwd: registry.value.localPath,
        branch: publishBranch,
        base: branch,
        title: `Publish ${packageName}`,
        body: `Adds workflow package ${packageName}.`,
      });
      if (!gh.ok) {
        return gh;
      }
      return ok({
        packageName: packageName,
        packageId: packageName,
        workflowName,
        workflowDirectory: "workflow",
        packageDirectory,
        registryId: registry.value.id,
        registryUrl: registry.value.url,
        registryRef: branch,
        branch,
        checksum: checksum.value.checksum,
        checksumAlgorithm: checksum.value.checksumAlgorithm,
        integrityDigest: integrity.value.digest,
        integrityDigestAlgorithm: integrity.value.digestAlgorithm,
        gitPushed: true,
        dryRun: false,
        mode: "pull-request",
        changedPaths,
        ...(commitSha.ok ? { commitSha: commitSha.value } : {}),
        prUrl: gh.value.prUrl,
      });
    }
    return ok({
      packageName: packageName,
      packageId: packageName,
      workflowName,
      workflowDirectory: "workflow",
      packageDirectory,
      registryId: registry.value.id,
      registryUrl: registry.value.url,
      registryRef: branch,
      branch,
      checksum: checksum.value.checksum,
      checksumAlgorithm: checksum.value.checksumAlgorithm,
      integrityDigest: integrity.value.digest,
      integrityDigestAlgorithm: integrity.value.digestAlgorithm,
      gitPushed: true,
      dryRun: false,
      mode: "direct",
      changedPaths,
      ...(commitSha.ok ? { commitSha: commitSha.value } : {}),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(packageFailure("IO", `package publish failed: ${message}`));
  } finally {
    if (stagingRoot !== undefined) {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}
