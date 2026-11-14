import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { isSafeAddonName, isSafeAddonVersion } from "../catalog";
import { loadLocalNodeAddonManifest } from "../local-node-addons";
import {
  listNodeTemplateFieldContainers,
  NODE_TEMPLATE_FIELD_SPECS,
} from "../node-template-fields";
import { err, ok, type Result } from "../result";
import type { ResolvedAddonSource } from "../types";
import { normalizePackageRelativePath } from "./manifest";
import type {
  WorkflowPackageAddonArtifact,
  WorkflowPackageAddonInstallTarget,
  WorkflowPackageFailure,
  WorkflowPackageManifestAddonEntry,
} from "./types";

export interface ValidateWorkflowPackageAddonsInput {
  readonly packageRoot: string;
  readonly addons: readonly WorkflowPackageManifestAddonEntry[];
}

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
}

function addonSourceFromEntry(input: {
  readonly packageRoot: string;
  readonly entry: WorkflowPackageManifestAddonEntry;
}): Result<ResolvedAddonSource, WorkflowPackageFailure> {
  const sourcePath = normalizePackageRelativePath(input.entry.sourcePath);
  if (sourcePath === undefined) {
    return err(
      packageFailure(
        "UNSAFE_PATH",
        `unsafe add-on sourcePath for '${input.entry.name}'`,
      ),
    );
  }
  if (!isSafeAddonName(input.entry.name)) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        `invalid add-on name '${input.entry.name}'`,
      ),
    );
  }
  if (input.entry.name.startsWith("rielflow/")) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        `node-addon packages cannot provide built-in add-on '${input.entry.name}'`,
      ),
    );
  }
  if (!isSafeAddonVersion(input.entry.version)) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        `invalid add-on version '${input.entry.version}' for '${input.entry.name}'`,
      ),
    );
  }
  const sourceDirectory = path.resolve(input.packageRoot, sourcePath);
  const relative = path.relative(
    path.resolve(input.packageRoot),
    sourceDirectory,
  );
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return err(
      packageFailure(
        "UNSAFE_PATH",
        `add-on sourcePath escapes package root for '${input.entry.name}'`,
      ),
    );
  }
  return ok({
    scope: "direct",
    addonRoot: path.dirname(path.dirname(path.dirname(sourceDirectory))),
    addonName: input.entry.name,
    version: input.entry.version,
    addonDirectory: sourceDirectory,
    manifestPath: path.join(sourceDirectory, "addon.json"),
  });
}

function shouldRejectFile(relativePath: string): boolean {
  const baseName = path.posix.basename(relativePath);
  const lowerBaseName = baseName.toLowerCase();
  const segments = relativePath.split("/");
  return (
    relativePath === ".git" ||
    relativePath.startsWith(".git/") ||
    relativePath === ".rielflow" ||
    relativePath.startsWith(".rielflow/") ||
    relativePath === "node_modules" ||
    relativePath.startsWith("node_modules/") ||
    segments.some((segment) =>
      [".ssh", ".aws", ".gnupg", ".config"].includes(segment.toLowerCase()),
    ) ||
    lowerBaseName === ".env" ||
    lowerBaseName.startsWith(".env.") ||
    lowerBaseName === ".npmrc" ||
    lowerBaseName === ".netrc" ||
    lowerBaseName.endsWith(".pem") ||
    lowerBaseName.endsWith(".key") ||
    lowerBaseName.endsWith(".p12") ||
    lowerBaseName.endsWith(".pfx") ||
    lowerBaseName.includes("credential") ||
    lowerBaseName.includes("secret") ||
    baseName === "package.json" ||
    baseName === "bun.lock" ||
    baseName === "package-lock.json" ||
    baseName === "pnpm-lock.yaml" ||
    baseName === "yarn.lock" ||
    baseName.endsWith(".js") ||
    baseName.endsWith(".mjs") ||
    baseName.endsWith(".cjs") ||
    baseName.endsWith(".ts") ||
    baseName.endsWith(".sh")
  );
}

async function collectAddonFiles(
  sourceDirectory: string,
): Promise<Result<readonly string[], WorkflowPackageFailure>> {
  const files: string[] = [];
  async function visit(
    directory: string,
  ): Promise<Result<void, WorkflowPackageFailure>> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path
        .relative(sourceDirectory, absolutePath)
        .split(path.sep)
        .join("/");
      const linkStatus = await lstat(absolutePath);
      if (linkStatus.isSymbolicLink()) {
        return err(
          packageFailure(
            "UNSAFE_PATH",
            `node-addon package add-on file '${relativePath}' must not be a symlink`,
          ),
        );
      }
      if (shouldRejectFile(relativePath)) {
        return err(
          packageFailure(
            "VALIDATION",
            `node-addon package add-on file '${relativePath}' is not supported`,
          ),
        );
      }
      if (entry.isDirectory()) {
        const nested = await visit(absolutePath);
        if (!nested.ok) {
          return nested;
        }
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
    return ok(undefined);
  }
  try {
    const visited = await visit(sourceDirectory);
    if (!visited.ok) {
      return visited;
    }
    if (!files.includes("addon.json")) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          "node-addon package requires addon.json",
        ),
      );
    }
    return ok(files.sort((left, right) => left.localeCompare(right)));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure(
        "IO",
        `failed reading node-addon package files: ${message}`,
      ),
    );
  }
}

function normalizeAddonFileReference(relativePath: string): string | undefined {
  const normalized = path.posix.normalize(
    relativePath.replaceAll(path.sep, "/"),
  );
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized)
  ) {
    return undefined;
  }
  const segments = normalized.split("/");
  return segments.some((segment) => segment === "." || segment === "..")
    ? undefined
    : normalized;
}

function referencedAddonFiles(input: {
  readonly addonName: string;
  readonly resolution: Readonly<Record<string, unknown>>;
}): Result<readonly string[], WorkflowPackageFailure> {
  const files = new Set<string>(["addon.json"]);
  const resolution = { ...input.resolution };
  for (const { record } of listNodeTemplateFieldContainers(resolution)) {
    for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
      const templateFile = record[spec.fileField];
      if (templateFile === undefined) {
        continue;
      }
      if (typeof templateFile !== "string" || templateFile.length === 0) {
        return err(
          packageFailure(
            "VALIDATION",
            `node-addon package add-on '${input.addonName}' has invalid ${spec.fileField}`,
          ),
        );
      }
      const normalized = normalizeAddonFileReference(templateFile);
      if (normalized === undefined) {
        return err(
          packageFailure(
            "UNSAFE_PATH",
            `node-addon package add-on '${input.addonName}' references unsafe template file '${templateFile}'`,
          ),
        );
      }
      files.add(normalized);
    }
  }
  return ok([...files].sort((left, right) => left.localeCompare(right)));
}

function restrictToReferencedFiles(input: {
  readonly addonName: string;
  readonly collectedFiles: readonly string[];
  readonly referencedFiles: readonly string[];
}): Result<readonly string[], WorkflowPackageFailure> {
  const collected = new Set(input.collectedFiles);
  for (const referencedFile of input.referencedFiles) {
    if (!collected.has(referencedFile)) {
      return err(
        packageFailure(
          "MISSING_PACKAGE",
          `node-addon package add-on '${input.addonName}' references missing file '${referencedFile}'`,
        ),
      );
    }
  }
  const referenced = new Set(input.referencedFiles);
  const unreferenced = input.collectedFiles.filter(
    (relativePath) => !referenced.has(relativePath),
  );
  if (unreferenced.length > 0) {
    return err(
      packageFailure(
        "VALIDATION",
        `node-addon package add-on file '${unreferenced[0]}' is not referenced by addon.json`,
      ),
    );
  }
  return ok(input.referencedFiles);
}

async function contentDigest(input: {
  readonly sourceDirectory: string;
  readonly allowedFiles: readonly string[];
}): Promise<Result<string, WorkflowPackageFailure>> {
  try {
    const hash = createHash("sha256");
    for (const relativePath of input.allowedFiles) {
      const content = await readFile(
        path.join(input.sourceDirectory, relativePath),
      );
      hash.update(relativePath, "utf8");
      hash.update("\0", "utf8");
      hash.update(String(content.byteLength), "utf8");
      hash.update("\0", "utf8");
      hash.update(content.toString("base64"), "utf8");
      hash.update("\0", "utf8");
    }
    return ok(`sha256:${hash.digest("hex")}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure(
        "IO",
        `failed computing node-addon package content digest: ${message}`,
      ),
    );
  }
}

export async function validateWorkflowPackageAddons(
  input: ValidateWorkflowPackageAddonsInput,
): Promise<
  Result<readonly WorkflowPackageAddonArtifact[], WorkflowPackageFailure>
> {
  if (input.addons.length === 0) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "node-addon package manifest addons must be a non-empty array",
      ),
    );
  }
  const artifacts: WorkflowPackageAddonArtifact[] = [];
  const seen = new Set<string>();
  for (const entry of input.addons) {
    const key = `${entry.name}\0${entry.version}`;
    if (seen.has(key)) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          `duplicate node-addon package add-on '${entry.name}' version '${entry.version}'`,
        ),
      );
    }
    seen.add(key);
    const source = addonSourceFromEntry({
      packageRoot: input.packageRoot,
      entry,
    });
    if (!source.ok) {
      return source;
    }
    try {
      if (!(await stat(source.value.addonDirectory)).isDirectory()) {
        return err(
          packageFailure(
            "MISSING_PACKAGE",
            `add-on source directory not found for '${entry.name}'`,
          ),
        );
      }
    } catch {
      return err(
        packageFailure(
          "MISSING_PACKAGE",
          `add-on source directory not found for '${entry.name}'`,
        ),
      );
    }
    const manifest = await loadLocalNodeAddonManifest(source.value);
    if (!manifest.ok) {
      return err(
        packageFailure(
          manifest.error.code === "IO" ? "IO" : "VALIDATION",
          manifest.error.message,
        ),
      );
    }
    const collectedFiles = await collectAddonFiles(source.value.addonDirectory);
    if (!collectedFiles.ok) {
      return collectedFiles;
    }
    const referencedFiles = referencedAddonFiles({
      addonName: entry.name,
      resolution: manifest.value.resolution,
    });
    if (!referencedFiles.ok) {
      return referencedFiles;
    }
    const allowedFiles = restrictToReferencedFiles({
      addonName: entry.name,
      collectedFiles: collectedFiles.value,
      referencedFiles: referencedFiles.value,
    });
    if (!allowedFiles.ok) {
      return allowedFiles;
    }
    const digest = await contentDigest({
      sourceDirectory: source.value.addonDirectory,
      allowedFiles: allowedFiles.value,
    });
    if (!digest.ok) {
      return digest;
    }
    artifacts.push({
      addonName: entry.name,
      addonVersion: entry.version,
      sourcePath: entry.sourcePath,
      sourceDirectory: source.value.addonDirectory,
      manifestPath: source.value.manifestPath,
      allowedFiles: allowedFiles.value,
      contentDigest: digest.value,
      contentDigestAlgorithm: "sha256",
    });
  }
  return ok(artifacts);
}

export async function installWorkflowPackageAddons(input: {
  readonly artifacts: readonly WorkflowPackageAddonArtifact[];
  readonly addonRoot: string;
  readonly scope: WorkflowPackageAddonInstallTarget["scope"];
  readonly overwrite: boolean;
}): Promise<
  Result<readonly WorkflowPackageAddonInstallTarget[], WorkflowPackageFailure>
> {
  const targets: WorkflowPackageAddonInstallTarget[] = [];
  try {
    for (const artifact of input.artifacts) {
      const [namespace, addonName] = artifact.addonName.split("/");
      const destinationDirectory = path.join(
        input.addonRoot,
        namespace ?? "",
        addonName ?? "",
        artifact.addonVersion,
      );
      await mkdir(path.dirname(destinationDirectory), { recursive: true });
      if (input.overwrite) {
        await rm(destinationDirectory, {
          recursive: true,
          force: true,
        });
      }
      await mkdir(destinationDirectory, { recursive: true });
      for (const relativePath of artifact.allowedFiles) {
        const sourcePath = path.join(artifact.sourceDirectory, relativePath);
        const targetPath = path.join(destinationDirectory, relativePath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await copyFile(sourcePath, targetPath);
      }
      targets.push({
        ...artifact,
        scope: input.scope,
        destinationDirectory,
        manifestPath: path.join(destinationDirectory, "addon.json"),
      });
    }
    return ok(targets);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure(
        "IO",
        `failed installing node-addon package files: ${message}`,
      ),
    );
  }
}
