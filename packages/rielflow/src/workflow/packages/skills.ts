import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "../result";
import { normalizePackageRelativePath } from "./manifest";
import type {
  WorkflowPackageFailure,
  WorkflowPackageSkillSelection,
  WorkflowPackageSkillVendor,
} from "./types";

export const WORKFLOW_PACKAGE_SKILL_VENDORS = [
  "agents",
  "claude",
  "codex",
  "cursor",
  "gemini",
] as const satisfies readonly WorkflowPackageSkillVendor[];

const WORKFLOW_PACKAGE_SKILL_VENDOR_SET: ReadonlySet<string> = new Set(
  WORKFLOW_PACKAGE_SKILL_VENDORS,
);

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

function isSafeSkillName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name);
}

function toPackageRelativePath(
  packageRoot: string,
  absolutePath: string,
): string | undefined {
  const relativePath = path
    .relative(packageRoot, absolutePath)
    .split(path.sep)
    .join("/");
  return normalizePackageRelativePath(relativePath);
}

async function assertInsideDirectory(input: {
  readonly root: string;
  readonly candidate: string;
}): Promise<boolean> {
  const [rootRealPath, candidateRealPath] = await Promise.all([
    realpath(input.root),
    realpath(input.candidate),
  ]);
  const relative = path.relative(rootRealPath, candidateRealPath);
  return (
    relative.length === 0 ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function collectRegularFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`symbolic links are not allowed: ${absolutePath}`);
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

async function computeSkillChecksum(input: {
  readonly packageRoot: string;
  readonly sourcePath: string;
}): Promise<string> {
  const absolutePath = path.join(input.packageRoot, input.sourcePath);
  const stats = await stat(absolutePath);
  const hash = createHash("sha256");
  if (stats.isFile()) {
    hash.update(input.sourcePath);
    hash.update("\0");
    hash.update(await readFile(absolutePath, "utf8"));
    return hash.digest("hex");
  }
  const files = await collectRegularFiles(absolutePath);
  for (const filePath of files) {
    const relativePath = toPackageRelativePath(input.packageRoot, filePath);
    if (relativePath === undefined) {
      throw new Error(`unsafe skill path: ${filePath}`);
    }
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(filePath, "utf8"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function createSkillSelection(input: {
  readonly packageRoot: string;
  readonly vendor: WorkflowPackageSkillVendor;
  readonly name: string;
  readonly sourcePath: string;
}): Promise<WorkflowPackageSkillSelection> {
  return {
    vendor: input.vendor,
    name: input.name,
    sourcePath: input.sourcePath,
    checksum: await computeSkillChecksum({
      packageRoot: input.packageRoot,
      sourcePath: input.sourcePath,
    }),
  };
}

async function validateSkillSourcePath(input: {
  readonly packageRoot: string;
  readonly skillRoot: string;
  readonly sourcePath: string;
}): Promise<Result<void, WorkflowPackageFailure>> {
  const absolutePath = path.join(input.packageRoot, input.sourcePath);
  if (
    !(await assertInsideDirectory({
      root: input.packageRoot,
      candidate: absolutePath,
    })) ||
    !(await assertInsideDirectory({
      root: input.skillRoot,
      candidate: absolutePath,
    }))
  ) {
    return err(
      packageFailure(
        "UNSAFE_PATH",
        `skill source escapes package skill directory: ${input.sourcePath}`,
      ),
    );
  }
  return ok(undefined);
}

async function discoverNamedSkillDirectories(input: {
  readonly packageRoot: string;
  readonly skillRoot: string;
  readonly vendor: "claude" | "codex";
  readonly vendorRoot: string;
}): Promise<
  Result<readonly WorkflowPackageSkillSelection[], WorkflowPackageFailure>
> {
  const entries = await readdir(input.vendorRoot, { withFileTypes: true });
  const skills: WorkflowPackageSkillSelection[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeSkillName(entry.name)) {
      return err(
        packageFailure(
          "INVALID_SKILL_ENTRY",
          `invalid ${input.vendor} skill entry '${entry.name}'`,
        ),
      );
    }
    const skillDirectory = path.join(input.vendorRoot, entry.name);
    const skillFile = path.join(skillDirectory, "SKILL.md");
    if (!(await pathExists(skillFile))) {
      return err(
        packageFailure(
          "INVALID_SKILL_ENTRY",
          `${input.vendor} skill '${entry.name}' is missing SKILL.md`,
        ),
      );
    }
    const sourcePath = toPackageRelativePath(input.packageRoot, skillDirectory);
    if (sourcePath === undefined) {
      return err(
        packageFailure("UNSAFE_PATH", `unsafe ${input.vendor} skill path`),
      );
    }
    const sourceValidation = await validateSkillSourcePath({
      packageRoot: input.packageRoot,
      skillRoot: input.skillRoot,
      sourcePath,
    });
    if (!sourceValidation.ok) {
      return sourceValidation;
    }
    skills.push(
      await createSkillSelection({
        packageRoot: input.packageRoot,
        vendor: input.vendor,
        name: entry.name,
        sourcePath,
      }),
    );
  }
  return ok(skills);
}

async function discoverCursorRules(input: {
  readonly packageRoot: string;
  readonly skillRoot: string;
  readonly vendorRoot: string;
}): Promise<
  Result<readonly WorkflowPackageSkillSelection[], WorkflowPackageFailure>
> {
  const entries = await readdir(input.vendorRoot, { withFileTypes: true });
  const skills: WorkflowPackageSkillSelection[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".mdc")) {
      return err(
        packageFailure(
          "INVALID_SKILL_ENTRY",
          `invalid cursor rule entry '${entry.name}'`,
        ),
      );
    }
    const name = entry.name.slice(0, -".mdc".length);
    if (!isSafeSkillName(name)) {
      return err(
        packageFailure(
          "INVALID_SKILL_ENTRY",
          `invalid cursor rule name '${entry.name}'`,
        ),
      );
    }
    const sourcePath = toPackageRelativePath(
      input.packageRoot,
      path.join(input.vendorRoot, entry.name),
    );
    if (sourcePath === undefined) {
      return err(packageFailure("UNSAFE_PATH", "unsafe cursor rule path"));
    }
    const sourceValidation = await validateSkillSourcePath({
      packageRoot: input.packageRoot,
      skillRoot: input.skillRoot,
      sourcePath,
    });
    if (!sourceValidation.ok) {
      return sourceValidation;
    }
    skills.push(
      await createSkillSelection({
        packageRoot: input.packageRoot,
        vendor: "cursor",
        name,
        sourcePath,
      }),
    );
  }
  return ok(skills);
}

async function discoverSingleFileSkill(input: {
  readonly packageRoot: string;
  readonly skillRoot: string;
  readonly vendor: "agents" | "gemini";
  readonly vendorRoot: string;
  readonly fileName: "AGENTS.md" | "GEMINI.md";
}): Promise<
  Result<readonly WorkflowPackageSkillSelection[], WorkflowPackageFailure>
> {
  const sourceFile = path.join(input.vendorRoot, input.fileName);
  if (!(await pathExists(sourceFile))) {
    return err(
      packageFailure(
        "INVALID_SKILL_ENTRY",
        `${input.vendor} skill directory is missing ${input.fileName}`,
      ),
    );
  }
  const entries = await readdir(input.vendorRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== input.fileName) {
      return err(
        packageFailure(
          "INVALID_SKILL_ENTRY",
          `${input.vendor} skill directory may only contain ${input.fileName}`,
        ),
      );
    }
  }
  const sourcePath = toPackageRelativePath(input.packageRoot, sourceFile);
  if (sourcePath === undefined) {
    return err(packageFailure("UNSAFE_PATH", `unsafe ${input.vendor} path`));
  }
  const sourceValidation = await validateSkillSourcePath({
    packageRoot: input.packageRoot,
    skillRoot: input.skillRoot,
    sourcePath,
  });
  if (!sourceValidation.ok) {
    return sourceValidation;
  }
  return ok([
    await createSkillSelection({
      packageRoot: input.packageRoot,
      vendor: input.vendor,
      name: input.vendor,
      sourcePath,
    }),
  ]);
}

export async function validateWorkflowPackageSkills(input: {
  readonly packageRoot: string;
  readonly skillDirectory?: string;
}): Promise<
  Result<readonly WorkflowPackageSkillSelection[], WorkflowPackageFailure>
> {
  const skillDirectory = input.skillDirectory ?? "skills";
  const skillRoot = path.join(input.packageRoot, skillDirectory);
  if (!(await pathExists(skillRoot))) {
    return ok([]);
  }
  try {
    const skills: WorkflowPackageSkillSelection[] = [];
    const entries = await readdir(skillRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        return err(
          packageFailure(
            "INVALID_SKILL_ENTRY",
            `skill vendor entry must be a directory: ${entry.name}`,
          ),
        );
      }
      if (!WORKFLOW_PACKAGE_SKILL_VENDOR_SET.has(entry.name)) {
        return err(
          packageFailure(
            "INVALID_SKILL_VENDOR",
            `unsupported workflow package skill vendor '${entry.name}'`,
          ),
        );
      }
      const vendor = entry.name as WorkflowPackageSkillVendor;
      const vendorRoot = path.join(skillRoot, vendor);
      const discovered =
        vendor === "claude" || vendor === "codex"
          ? await discoverNamedSkillDirectories({
              packageRoot: input.packageRoot,
              skillRoot,
              vendor,
              vendorRoot,
            })
          : vendor === "cursor"
            ? await discoverCursorRules({
                packageRoot: input.packageRoot,
                skillRoot,
                vendorRoot,
              })
            : await discoverSingleFileSkill({
                packageRoot: input.packageRoot,
                skillRoot,
                vendor,
                vendorRoot,
                fileName: vendor === "agents" ? "AGENTS.md" : "GEMINI.md",
              });
      if (!discovered.ok) {
        return discovered;
      }
      skills.push(...discovered.value);
    }
    return ok(
      skills.sort((left, right) =>
        left.sourcePath.localeCompare(right.sourcePath),
      ),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(packageFailure("IO", `failed to validate skills: ${message}`));
  }
}
