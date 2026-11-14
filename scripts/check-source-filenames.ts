import { readdir } from "node:fs/promises";
import path from "node:path";

export interface FilenamePolicyViolation {
  readonly path: string;
  readonly basename: string;
}

export interface FilenamePolicyCheckResult {
  readonly violations: readonly FilenamePolicyViolation[];
}

const FORBIDDEN_SOURCE_PART_BASENAME = /^part-\d+\.tsx?$/u;

export function isForbiddenSourcePartBasename(basename: string): boolean {
  return FORBIDDEN_SOURCE_PART_BASENAME.test(basename);
}

function normalizePathForReport(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isTypeScriptSourceFilename(basename: string): boolean {
  return basename.endsWith(".ts") || basename.endsWith(".tsx");
}

async function collectSourceFiles(
  rootDir: string,
  relativeDir: string,
): Promise<string[]> {
  const absoluteDir = path.join(rootDir, relativeDir);
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(rootDir, relativePath)));
      continue;
    }

    if (entry.isFile() && isTypeScriptSourceFilename(entry.name)) {
      files.push(normalizePathForReport(relativePath));
    }
  }

  return files;
}

async function collectPackageSourceRoots(rootDir: string): Promise<string[]> {
  const packagesDir = path.join(rootDir, "packages");
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(packagesDir, { withFileTypes: true });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join("packages", entry.name, "src"));
}

export async function checkSourceFilenames(
  rootDir: string,
): Promise<FilenamePolicyCheckResult> {
  const sourceRoots = ["src", ...(await collectPackageSourceRoots(rootDir))];
  const sourceFiles = (
    await Promise.all(
      sourceRoots.map((sourceRoot) => collectSourceFiles(rootDir, sourceRoot)),
    )
  )
    .flat()
    .sort((a, b) => a.localeCompare(b));
  const filesInBiomeScope = [...sourceFiles, "vitest.config.ts"];
  const violations = filesInBiomeScope
    .filter((filePath) =>
      isForbiddenSourcePartBasename(path.posix.basename(filePath)),
    )
    .map((filePath) => ({
      path: filePath,
      basename: path.posix.basename(filePath),
    }));

  return { violations };
}

async function main(): Promise<void> {
  const rootDir = process.argv[2] ?? process.cwd();
  const result = await checkSourceFilenames(rootDir);

  if (result.violations.length === 0) {
    return;
  }

  console.error(
    "Forbidden source filenames found. Use descriptive split filenames instead of part-<digits>.ts or part-<digits>.tsx:",
  );

  for (const violation of result.violations) {
    console.error(`- ${violation.path}`);
  }

  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
