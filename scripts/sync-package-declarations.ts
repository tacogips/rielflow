import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const rootDistDir = path.join(rootDir, "dist");
const packageNames = ["divedra", "divedra-core", "divedra-addons"] as const;
const supportDirs = [
  "cli",
  "events",
  "graphql",
  "hook",
  "server",
  "shared",
  "workflow",
] as const;

async function copyIfPresent(source: string, target: string): Promise<void> {
  try {
    await cp(source, target, { recursive: true });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

async function copyDeclarationSupport(packageDistDir: string): Promise<void> {
  await mkdir(packageDistDir, { recursive: true });
  const packageDistEntries = await readdir(packageDistDir, {
    withFileTypes: true,
  });
  for (const entry of packageDistEntries) {
    if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      await rm(path.join(packageDistDir, entry.name), { force: true });
    }
  }
  for (const dirName of supportDirs) {
    await rm(path.join(packageDistDir, dirName), {
      recursive: true,
      force: true,
    });
  }
  const rootDistEntries = await readdir(rootDistDir, { withFileTypes: true });
  for (const entry of rootDistEntries) {
    if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      await cp(
        path.join(rootDistDir, entry.name),
        path.join(packageDistDir, entry.name),
      );
    }
  }
  for (const dirName of supportDirs) {
    await copyIfPresent(
      path.join(rootDistDir, dirName),
      path.join(packageDistDir, dirName),
    );
  }
}

async function writeRewrittenDeclaration(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const source = await readFile(sourcePath, "utf8");
  const rewritten = source
    .replaceAll("../../../src/", "./")
    .replace(/^\/\/# sourceMappingURL=.*$/gm, "")
    .trimEnd();
  await writeFile(targetPath, `${rewritten}\n`, "utf8");
}

for (const packageName of packageNames) {
  const packageDistDir = path.join(rootDir, "packages", packageName, "dist");
  await copyDeclarationSupport(packageDistDir);
}

await cp(
  path.join(rootDistDir, "src", "lib.d.ts"),
  path.join(rootDir, "packages", "divedra", "dist", "lib.d.ts"),
);
await writeFile(
  path.join(rootDir, "packages", "divedra-core", "dist", "index.js"),
  'export * from "./core-runtime.js";\n',
  "utf8",
);
await writeRewrittenDeclaration(
  path.join(rootDistDir, "packages", "divedra", "src", "cli.d.ts"),
  path.join(rootDir, "packages", "divedra", "dist", "cli.d.ts"),
);
await writeRewrittenDeclaration(
  path.join(rootDistDir, "packages", "divedra", "src", "bin.d.ts"),
  path.join(rootDir, "packages", "divedra", "dist", "main.d.ts"),
);
await writeRewrittenDeclaration(
  path.join(rootDistDir, "packages", "divedra-core", "src", "index.d.ts"),
  path.join(rootDir, "packages", "divedra-core", "dist", "index.d.ts"),
);
await writeRewrittenDeclaration(
  path.join(rootDistDir, "packages", "divedra-addons", "src", "index.d.ts"),
  path.join(rootDir, "packages", "divedra-addons", "dist", "index.d.ts"),
);
