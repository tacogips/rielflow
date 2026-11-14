/**
 * Vitest is used for the Vitest API (`describe`, `expect`, `vi`, …) while the
 * default `bun run test` path executes tests with `bun test`, which provides
 * Bun-only modules such as `bun:sqlite`.
 *
 * When tooling runs Vitest under Node, Vite must still be able to resolve
 * workspace packages to TypeScript sources and to load a stand-in for
 * `bun:sqlite` (see `vitest-support/bun-sqlite-stub.ts`). That stub is intentionally
 * non-functional: it only satisfies the module surface so files load; real SQLite
 * behaviour is exercised via `bun test` / `scripts/run-bun-tests.sh`.
 *
 * A full `vitest run` of this repository is not a supported CI target because many
 * suites expect a real database.
 *
 * Workspace `resolve.alias` entries are derived from the same `compilerOptions.paths`
 * TypeScript computes for `tsconfig.json` (JSONC, `extends`, and `baseUrl` are honored via
 * `parseJsonSourceFileConfigFileContent`) so Vitest stays aligned with `tsc` path resolution.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function toPosixPath(absolutePath: string): string {
  return absolutePath.replace(/\\/g, "/");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readCompilerPaths(
  root: string,
): Readonly<Record<string, readonly string[]>> {
  const tsconfigPath = path.join(root, "tsconfig.json");
  const sourceFile = ts.readJsonConfigFile(tsconfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonSourceFileConfigFileContent(
    sourceFile,
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  );

  const errors = parsed.errors.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    const message = errors
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      )
      .join("\n");
    throw new Error(`Vitest config: invalid ${tsconfigPath}:\n${message}`);
  }

  const paths = parsed.options.paths;
  if (paths === undefined) {
    return {};
  }

  const result: Record<string, readonly string[]> = {};
  for (const [key, value] of Object.entries(paths)) {
    if (!Array.isArray(value) || typeof value[0] !== "string") {
      continue;
    }
    result[key] = value as readonly string[];
  }
  return result;
}

function vitestAliasesFromTsconfigPaths(options: {
  readonly rootDir: string;
  readonly paths: Readonly<Record<string, readonly string[]>>;
}): ReadonlyArray<{ find: RegExp; replacement: string }> {
  const { rootDir, paths } = options;
  const aliases: Array<{ find: RegExp; replacement: string }> = [];

  for (const [importPattern, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (target === undefined) {
      continue;
    }

    if (importPattern.endsWith("/*")) {
      const starPathMatch = target.match(/^(.*)\/\*\.(ts|tsx)$/);
      if (starPathMatch === null) {
        continue;
      }

      const modulePrefix = importPattern.slice(0, -2);
      const baseDir = toPosixPath(path.join(rootDir, starPathMatch[1]));
      const extension = starPathMatch[2];
      aliases.push({
        find: new RegExp(`^${escapeRegExp(modulePrefix)}/(.*)$`),
        replacement: `${baseDir}/$1.${extension}`,
      });
      continue;
    }

    aliases.push({
      find: new RegExp(`^${escapeRegExp(importPattern)}$`),
      replacement: toPosixPath(path.join(rootDir, target)),
    });
  }

  return aliases;
}

const workspaceAliases = vitestAliasesFromTsconfigPaths({
  rootDir,
  paths: readCompilerPaths(rootDir),
});

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^bun:sqlite$/,
        replacement: toPosixPath(
          path.join(rootDir, "vitest-support/bun-sqlite-stub.ts"),
        ),
      },
      ...workspaceAliases,
    ],
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "packages/*/dist/**", ".direnv/**"],
  },
});
