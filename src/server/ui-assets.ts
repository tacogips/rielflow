import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseBuiltFrontendModeMetadata,
  resolveBuiltFrontendModeMetadataPath,
} from "../../scripts/ui-built-assets.mjs";
import {
  detectUiFramework,
  frontendModeFromUiFramework,
} from "../../scripts/ui-framework.mjs";
import type { FrontendMode } from "../shared/ui-contract";

export interface UiAssetContext {
  readonly uiDistRoot?: string;
  readonly frontendMode?: FrontendMode;
  readonly frontendModeModuleUrl?: string;
}

function resolvePackageRoot(moduleUrl: string = import.meta.url): string {
  return fileURLToPath(new URL("../../", moduleUrl));
}

export function resolveDefaultUiDistRoot(
  moduleUrl: string = import.meta.url,
): string {
  return path.join(resolvePackageRoot(moduleUrl), "ui", "dist");
}

function resolveUiDistRoot(
  context: UiAssetContext,
  moduleUrl: string = import.meta.url,
): string {
  if (context.uiDistRoot !== undefined) {
    return context.uiDistRoot;
  }

  const resolvedModuleUrl = context.frontendModeModuleUrl ?? moduleUrl;
  return resolveDefaultUiDistRoot(resolvedModuleUrl);
}

function tryReadBuiltFrontendMode(
  context: UiAssetContext,
  moduleUrl: string = import.meta.url,
): FrontendMode | null {
  const metadataPath = resolveBuiltFrontendModeMetadataPath({
    uiDistRoot: resolveUiDistRoot(context, moduleUrl),
  });
  if (!existsSync(metadataPath)) {
    return null;
  }

  return parseBuiltFrontendModeMetadata(readFileSync(metadataPath, "utf8"));
}

export function detectFrontendMode(
  context: UiAssetContext = {},
  moduleUrl: string = import.meta.url,
): FrontendMode {
  if (context.frontendMode !== undefined) {
    return context.frontendMode;
  }

  const builtFrontendMode = tryReadBuiltFrontendMode(context, moduleUrl);
  if (builtFrontendMode !== null) {
    return builtFrontendMode;
  }

  const resolvedModuleUrl = context.frontendModeModuleUrl ?? moduleUrl;
  return frontendModeFromUiFramework(
    detectUiFramework({
      uiRoot: path.join(resolvePackageRoot(resolvedModuleUrl), "ui"),
    }),
  );
}

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const details = await stat(filePath);
    return details.isFile();
  } catch {
    return false;
  }
}

function contentTypeForUiAsset(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export async function tryServeBuiltUiAsset(
  urlPath: string,
  context: UiAssetContext,
): Promise<Response | undefined> {
  const normalizedPath =
    urlPath === "/" || urlPath === "/ui" || urlPath === "/ui/"
      ? "/index.html"
      : urlPath;
  const relativePath = normalizedPath.startsWith("/")
    ? normalizedPath.slice(1)
    : normalizedPath;
  if (relativePath.length === 0) {
    return undefined;
  }

  const segments = relativePath
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return undefined;
  }

  const root = resolveUiDistRoot(context);
  const candidatePath = path.join(root, ...segments);
  const relativeToRoot = path.relative(root, candidatePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return undefined;
  }

  if (!(await fileExists(candidatePath))) {
    return undefined;
  }

  const body = await readFile(candidatePath);
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "content-type": contentTypeForUiAsset(candidatePath),
    },
  });
}

function renderMissingUiPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>divedra UI unavailable</title>
</head>
<body>
  <main>
    <h1>divedra UI is unavailable</h1>
    <p>The server expects built browser UI assets under <code>ui/dist/</code>.</p>
    <p>Run <code>bun run build:ui</code> before starting <code>divedra serve</code>.</p>
  </main>
</body>
</html>`;
}

export function missingUiResponse(): Response {
  return html(renderMissingUiPage(), 503);
}
