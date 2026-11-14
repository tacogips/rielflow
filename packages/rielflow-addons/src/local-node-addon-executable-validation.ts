import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  listNodeTemplateFieldContainers,
  NODE_TEMPLATE_FIELD_SPECS,
  type ResolvedAddonSource,
  type ValidationIssue,
} from "../../rielflow-core/src/index";
import { err, ok, type Result } from "../../rielflow-core/src/index";
import type { LocalNodeAddonManifest } from "./local-node-addons";

function makeIssue(path: string, message: string): ValidationIssue {
  return { severity: "error", path, message };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isExecutableLocalAddon(
  manifest: LocalNodeAddonManifest,
): boolean {
  return (
    (manifest.execution !== undefined &&
      manifest.execution.kind !== "declarative") ||
    manifest.resolution.nodeType === "command" ||
    manifest.resolution.nodeType === "container"
  );
}

export function validateExecutableResolutionMetadata(input: {
  readonly manifest: LocalNodeAddonManifest;
  readonly path: string;
}): readonly ValidationIssue[] {
  const nodeType = input.manifest.resolution.nodeType;
  if (nodeType !== "command" && nodeType !== "container") {
    return [];
  }
  const execution = input.manifest.execution;
  if (execution === undefined) {
    return [
      makeIssue(
        input.path,
        `executable local node add-on '${input.manifest.name}' must declare matching execution metadata`,
      ),
    ];
  }
  const expectedKind = nodeType === "command" ? "local-command" : "container";
  const issues =
    execution.kind === expectedKind
      ? []
      : [
          makeIssue(
            input.path,
            `executable local node add-on '${input.manifest.name}' execution.kind must be ${expectedKind}`,
          ),
        ];
  if (nodeType === "command" && execution.kind === "local-command") {
    const command = input.manifest.resolution["command"];
    if (!isRecord(command)) {
      return [
        ...issues,
        makeIssue(
          `${input.path}.resolution.command`,
          `executable local command add-on '${input.manifest.name}' must declare command metadata`,
        ),
      ];
    }
    if (execution.entrypoint === undefined) {
      issues.push(
        makeIssue(
          `${input.path}.execution.entrypoint`,
          `executable local command add-on '${input.manifest.name}' must declare execution.entrypoint`,
        ),
      );
    } else if (command["scriptPath"] !== execution.entrypoint) {
      issues.push(
        makeIssue(
          `${input.path}.resolution.command.scriptPath`,
          "must match addon.execution.entrypoint for executable local command add-ons",
        ),
      );
    }
  }
  if (nodeType === "container" && execution.kind === "container") {
    const container = input.manifest.resolution["container"];
    const build = isRecord(container) ? container["build"] : undefined;
    if (!isRecord(container) || !isRecord(build)) {
      return [
        ...issues,
        makeIssue(
          `${input.path}.resolution.container.build`,
          `executable container add-on '${input.manifest.name}' must declare container build metadata`,
        ),
      ];
    }
    if (execution.containerfilePath === undefined) {
      issues.push(
        makeIssue(
          `${input.path}.execution.containerfilePath`,
          `executable container add-on '${input.manifest.name}' must declare execution.containerfilePath`,
        ),
      );
    } else if (
      build["containerfilePath"] !== undefined &&
      build["containerfilePath"] !== execution.containerfilePath
    ) {
      issues.push(
        makeIssue(
          `${input.path}.resolution.container.build.containerfilePath`,
          "must match addon.execution.containerfilePath for executable container add-ons",
        ),
      );
    }
  }
  return issues;
}

function normalizeAddonFileReference(value: string): string | undefined {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.length === 0 || path.posix.isAbsolute(normalized)) {
    return undefined;
  }
  const segments = normalized.split("/");
  return segments.some((segment) => segment === "." || segment === "..")
    ? undefined
    : normalized;
}

function executableAddonReferencedFiles(
  manifest: LocalNodeAddonManifest,
): readonly string[] {
  const files = new Set<string>(["addon.json"]);
  if (manifest.execution?.entrypoint !== undefined) {
    files.add(manifest.execution.entrypoint);
  }
  if (manifest.execution?.containerfilePath !== undefined) {
    files.add(manifest.execution.containerfilePath);
  }
  const resolution = { ...manifest.resolution };
  for (const { record } of listNodeTemplateFieldContainers(resolution)) {
    for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
      const templateFile = record[spec.fileField];
      if (typeof templateFile !== "string" || templateFile.length === 0) {
        continue;
      }
      const normalized = normalizeAddonFileReference(templateFile);
      if (normalized !== undefined) {
        files.add(normalized);
      }
    }
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

export async function computeInstalledAddonContentDigest(input: {
  readonly source: ResolvedAddonSource;
  readonly manifest: LocalNodeAddonManifest;
  readonly path: string;
}): Promise<Result<string, readonly ValidationIssue[]>> {
  try {
    const hash = createHash("sha256");
    for (const relativePath of executableAddonReferencedFiles(input.manifest)) {
      const content = await readFile(
        path.join(input.source.addonDirectory, relativePath),
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
    return err([
      makeIssue(
        input.path,
        `executable local node add-on '${input.source.addonName}' contentDigest verification failed: ${message}`,
      ),
    ]);
  }
}
