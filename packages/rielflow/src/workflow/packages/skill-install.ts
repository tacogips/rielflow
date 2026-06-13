import { cp, lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "../result";
import type { WorkflowCheckoutScope } from "../checkout";
import type {
  WorkflowPackageFailure,
  WorkflowPackageSkillInstallTarget,
  WorkflowPackageSkillSelection,
  WorkflowPackageSkillVendor,
} from "./types";

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeRealpath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

async function assertNoSymlinkAncestors(input: {
  readonly rootPath: string;
  readonly destinationPath: string;
}): Promise<Result<void, WorkflowPackageFailure>> {
  const rootPath = path.resolve(input.rootPath);
  const destinationPath = path.resolve(input.destinationPath);
  const relative = path.relative(rootPath, destinationPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return err(
      packageFailure(
        "UNSAFE_PATH",
        `skill projection escapes destination root: ${destinationPath}`,
      ),
    );
  }
  const rootRealpath = await safeRealpath(rootPath);
  const parts = relative.split(path.sep).filter((part) => part.length > 0);
  let cursor = rootPath;
  for (const part of parts.slice(0, -1)) {
    cursor = path.join(cursor, part);
    try {
      const stats = await lstat(cursor);
      if (stats.isSymbolicLink()) {
        return err(
          packageFailure(
            "UNSAFE_PATH",
            `skill projection ancestor is a symlink: ${cursor}`,
          ),
        );
      }
      if (!stats.isDirectory()) {
        return err(
          packageFailure(
            "UNSAFE_PATH",
            `skill projection ancestor is not a directory: ${cursor}`,
          ),
        );
      }
      const cursorRealpath = await realpath(cursor);
      const realRelative = path.relative(rootRealpath, cursorRealpath);
      if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        return err(
          packageFailure(
            "UNSAFE_PATH",
            `skill projection escapes destination root: ${cursor}`,
          ),
        );
      }
    } catch (error: unknown) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { readonly code?: unknown }).code
          : undefined;
      if (code === "ENOENT") {
        return ok(undefined);
      }
      throw error;
    }
  }
  return ok(undefined);
}

function safeStateSegment(value: string): string {
  return value.replaceAll("/", "__").replaceAll("@", "");
}

function projectionPathForSkill(input: {
  readonly scope: WorkflowCheckoutScope;
  readonly projectRoot: string;
  readonly userRoot: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly skill: WorkflowPackageSkillSelection;
}): string | undefined {
  if (input.scope === "user") {
    return userProjectionPathForSkill(input);
  }
  switch (input.skill.vendor) {
    case "agents":
      return path.join(input.projectRoot, "AGENTS.md");
    case "claude":
      return path.join(
        input.projectRoot,
        ".claude",
        "skills",
        input.skill.name,
      );
    case "codex":
      return path.join(input.projectRoot, ".codex", "skills", input.skill.name);
    case "cursor":
      return path.join(
        input.projectRoot,
        ".cursor",
        "rules",
        `${input.skill.name}.mdc`,
      );
    case "gemini":
      return path.join(input.projectRoot, "GEMINI.md");
  }
}

function userHomeFromUserRoot(userRoot: string): string {
  return path.basename(userRoot) === ".rielflow"
    ? path.dirname(userRoot)
    : userRoot;
}

function userProjectionPathForSkill(input: {
  readonly userRoot: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly skill: WorkflowPackageSkillSelection;
}): string | undefined {
  const home = userHomeFromUserRoot(input.userRoot);
  switch (input.skill.vendor) {
    case "claude":
      return path.join(home, ".claude", "skills", input.skill.name);
    case "codex":
      return path.join(
        input.env?.["CODEX_HOME"] ?? path.join(home, ".codex"),
        "skills",
        input.skill.name,
      );
    case "cursor":
      return path.join(
        input.env?.["CURSOR_HOME"] ?? path.join(home, ".cursor"),
        "skills",
        input.skill.name,
        "SKILL.md",
      );
    case "agents":
    case "gemini":
      return undefined;
  }
}

function projectionRootForSkill(input: {
  readonly scope: WorkflowCheckoutScope;
  readonly projectRoot: string;
  readonly userRoot: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly skill: WorkflowPackageSkillSelection;
}): string | undefined {
  if (input.scope === "project") {
    return input.projectRoot;
  }
  const home = userHomeFromUserRoot(input.userRoot);
  switch (input.skill.vendor) {
    case "claude":
      return home;
    case "codex":
      return input.env?.["CODEX_HOME"] ?? path.join(home, ".codex");
    case "cursor":
      return input.env?.["CURSOR_HOME"] ?? path.join(home, ".cursor");
    case "agents":
    case "gemini":
      return undefined;
  }
}

export function resolveWorkflowPackageSkillProjectionPath(input: {
  readonly scope: WorkflowCheckoutScope;
  readonly projectRoot: string;
  readonly userRoot: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly skill: WorkflowPackageSkillSelection;
}): string | undefined {
  return projectionPathForSkill(input);
}

function managedPathForSkill(input: {
  readonly managedSkillRoot: string;
  readonly skill: WorkflowPackageSkillSelection;
}): string {
  return path.join(input.managedSkillRoot, input.skill.sourcePath);
}

async function copySkill(input: {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly overwrite: boolean;
}): Promise<void> {
  if (input.overwrite) {
    await rm(input.destinationPath, { recursive: true, force: true });
  }
  await mkdir(path.dirname(input.destinationPath), { recursive: true });
  await cp(input.sourcePath, input.destinationPath, {
    recursive: true,
    errorOnExist: !input.overwrite,
    force: input.overwrite,
  });
}

export function resolveWorkflowPackageManagedSkillRoot(input: {
  readonly packageName: string;
  readonly version: string;
  readonly scope: WorkflowCheckoutScope;
  readonly projectRoot: string;
  readonly userRoot: string;
}): string {
  const baseRoot =
    input.scope === "user"
      ? path.join(path.dirname(input.userRoot), ".rielflow-managed")
      : path.join(input.projectRoot, ".rielflow", "managed");
  return path.join(
    baseRoot,
    "packages",
    safeStateSegment(input.packageName),
    safeStateSegment(input.version),
    "skills",
  );
}

export async function installWorkflowPackageSkills(input: {
  readonly packageRoot: string;
  readonly packageName: string;
  readonly version: string;
  readonly scope: WorkflowCheckoutScope;
  readonly projectRoot: string;
  readonly userRoot: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly overwrite: boolean;
  readonly projectedVendors?: ReadonlySet<WorkflowPackageSkillVendor>;
  readonly skills: readonly WorkflowPackageSkillSelection[];
}): Promise<
  Result<
    {
      readonly managedSkillRoot: string;
      readonly targets: readonly WorkflowPackageSkillInstallTarget[];
    },
    WorkflowPackageFailure
  >
> {
  const managedSkillRoot = resolveWorkflowPackageManagedSkillRoot(input);
  const targets: WorkflowPackageSkillInstallTarget[] = input.skills.map(
    (skill) => {
      const projectionPath =
        input.projectedVendors !== undefined &&
        !input.projectedVendors.has(skill.vendor)
          ? undefined
          : projectionPathForSkill({
              scope: input.scope,
              projectRoot: input.projectRoot,
              userRoot: input.userRoot,
              ...(input.env === undefined ? {} : { env: input.env }),
              skill,
            });
      return {
        ...skill,
        managedPath: managedPathForSkill({ managedSkillRoot, skill }),
        installMode:
          projectionPath === undefined ? "managed-only" : "projected",
        ...(projectionPath === undefined ? {} : { projectionPath }),
      };
    },
  );

  for (const target of targets) {
    const exists =
      (await pathExists(target.managedPath)) ||
      (target.projectionPath === undefined
        ? false
        : await pathExists(target.projectionPath));
    if (exists && !input.overwrite) {
      return err(
        packageFailure(
          "DUPLICATE_PACKAGE",
          `skill checkout already exists for ${target.vendor}:${target.name}`,
        ),
      );
    }
  }

  for (const target of targets) {
    if (target.projectionPath === undefined) {
      continue;
    }
    const rootPath = projectionRootForSkill({
      scope: input.scope,
      projectRoot: input.projectRoot,
      userRoot: input.userRoot,
      ...(input.env === undefined ? {} : { env: input.env }),
      skill: target,
    });
    if (rootPath === undefined) {
      continue;
    }
    const safeProjection = await assertNoSymlinkAncestors({
      rootPath,
      destinationPath: target.projectionPath,
    });
    if (!safeProjection.ok) {
      return safeProjection;
    }
  }

  try {
    for (const target of targets) {
      const sourcePath = path.join(input.packageRoot, target.sourcePath);
      await copySkill({
        sourcePath,
        destinationPath: target.managedPath,
        overwrite: input.overwrite,
      });
      if (target.projectionPath !== undefined) {
        await copySkill({
          sourcePath,
          destinationPath: target.projectionPath,
          overwrite: input.overwrite,
        });
      }
    }
    return ok({ managedSkillRoot, targets });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(packageFailure("IO", `failed to install skills: ${message}`));
  }
}
