import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ApiContext } from "./api";
import { buildWorkflowViewerClientScriptFromSource } from "./web-viewer-build";

export const WORKFLOW_VIEWER_DOCUMENT_PATHS = ["/", "/web", "/ui"] as const;
export const WORKFLOW_VIEWER_SCRIPT_PATH = "/assets/workflow-viewer.js";

interface WorkflowViewerConfig {
  readonly fixedWorkflowName: string | null;
  readonly readOnly: boolean;
  readonly noExec: boolean;
}

let cachedClientScript: Promise<string> | undefined;

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function workflowViewerConfig(context: ApiContext): WorkflowViewerConfig {
  return {
    fixedWorkflowName: context.fixedWorkflowName ?? null,
    readOnly: context.readOnly === true,
    noExec: context.noExec === true,
  };
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function scriptResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === "ENOENT";
}

async function readTextIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function bundledAssetCandidates(): readonly string[] {
  return [
    path.join(import.meta.dirname, "web", "workflow-viewer.js"),
    path.resolve(import.meta.dirname, "../../dist/web/workflow-viewer.js"),
  ];
}

async function readBundledClientScript(): Promise<string | null> {
  for (const candidate of bundledAssetCandidates()) {
    const content = await readTextIfPresent(candidate);
    if (content !== null) {
      return content;
    }
  }
  return null;
}

async function buildClientScriptFromSource(): Promise<string> {
  const entrypoint = path.resolve(
    import.meta.dirname,
    "../web/workflow-viewer.tsx",
  );
  return buildWorkflowViewerClientScriptFromSource(entrypoint);
}

async function loadClientScript(): Promise<string> {
  const bundled = await readBundledClientScript();
  if (bundled !== null) {
    return bundled;
  }
  return buildClientScriptFromSource();
}

export function renderWorkflowViewerHtml(context: ApiContext): Response {
  const config = workflowViewerConfig(context);
  return htmlResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>divedra workflow viewer</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7f9;
        --panel: #ffffff;
        --panel-soft: #eef2f6;
        --text: #171a1f;
        --muted: #5f6b7a;
        --line: #d8dee6;
        --line-strong: #aab4c0;
        --accent: #136f63;
        --accent-weak: #dbeee9;
        --blue: #2457a6;
        --red: #af2f35;
        --yellow: #8a5b00;
        --shadow: 0 8px 28px rgba(25, 33, 43, 0.09);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * { box-sizing: border-box; }
      html, body, #root { min-height: 100%; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
      }

      button, select {
        font: inherit;
      }

      .shell {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 64px;
        padding: 12px 20px;
        border-bottom: 1px solid var(--line);
        background: #ffffff;
      }

      .brand {
        display: flex;
        align-items: baseline;
        gap: 10px;
        min-width: 0;
      }

      .brand h1 {
        margin: 0;
        font-size: 18px;
        line-height: 24px;
        font-weight: 700;
      }

      .brand span {
        color: var(--muted);
        font-size: 13px;
        white-space: nowrap;
      }

      .toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .select {
        min-width: 220px;
        max-width: 36vw;
        height: 36px;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
        background: #ffffff;
        color: var(--text);
        padding: 0 34px 0 10px;
      }

      .button {
        height: 36px;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
        background: #ffffff;
        color: var(--text);
        padding: 0 12px;
        cursor: pointer;
      }

      .button:hover:not(:disabled) {
        border-color: var(--accent);
        color: var(--accent);
      }

      .button:disabled, .select:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 380px;
        gap: 16px;
        padding: 16px;
        min-height: 0;
      }

      .main, .side {
        min-width: 0;
        min-height: calc(100vh - 96px);
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
      }

      .main {
        display: grid;
        grid-template-rows: auto 1fr;
      }

      .summary {
        padding: 16px 18px;
        border-bottom: 1px solid var(--line);
      }

      .summary h2 {
        margin: 0 0 6px;
        font-size: 17px;
        line-height: 24px;
      }

      .summary p {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 19px;
      }

      .graph-wrap {
        overflow: auto;
        min-height: 420px;
        background:
          linear-gradient(#ffffff, #ffffff) padding-box,
          repeating-linear-gradient(0deg, transparent 0, transparent 31px, rgba(31, 42, 55, 0.05) 32px),
          repeating-linear-gradient(90deg, transparent 0, transparent 31px, rgba(31, 42, 55, 0.05) 32px);
      }

      .graph {
        display: block;
        min-width: 100%;
      }

      .edge {
        fill: none;
        stroke: #718096;
        stroke-width: 2;
      }

      .edge-label {
        fill: #465160;
        font-size: 11px;
      }

      .node rect {
        fill: #ffffff;
        stroke: #9ca8b6;
        stroke-width: 1.5;
        rx: 8;
      }

      .node.status-running rect { stroke: var(--blue); }
      .node.status-succeeded rect { stroke: var(--accent); }
      .node.status-failed rect { stroke: var(--red); }
      .node.status-cancelled rect { stroke: var(--yellow); }
      .node .title {
        fill: var(--text);
        font-size: 13px;
        font-weight: 700;
      }

      .node .meta {
        fill: var(--muted);
        font-size: 11px;
      }

      .node .badge {
        fill: var(--panel-soft);
        stroke: var(--line);
      }

      .node .badge-text {
        fill: var(--muted);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .side {
        display: grid;
        grid-template-rows: minmax(180px, 36%) minmax(0, 1fr);
        gap: 16px;
      }

      .section {
        min-height: 0;
        display: grid;
        grid-template-rows: auto 1fr;
      }

      .section h2 {
        margin: 0;
        padding: 14px 16px;
        font-size: 14px;
        line-height: 20px;
        border-bottom: 1px solid var(--line);
      }

      .scroll {
        overflow: auto;
      }

      .run-list, .log-list {
        display: grid;
        gap: 8px;
        padding: 10px;
      }

      .run {
        width: 100%;
        text-align: left;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #ffffff;
        padding: 10px;
        cursor: pointer;
      }

      .run.selected {
        border-color: var(--accent);
        background: var(--accent-weak);
      }

      .run strong {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
      }

      .run span, .empty, .error {
        color: var(--muted);
        font-size: 12px;
        line-height: 18px;
      }

      .log {
        border-left: 3px solid var(--line-strong);
        background: #ffffff;
        padding: 8px 10px;
      }

      .log.warning { border-left-color: var(--yellow); }
      .log.error { border-left-color: var(--red); }
      .log.info { border-left-color: var(--accent); }

      .log-time {
        color: var(--muted);
        font-size: 11px;
        margin-bottom: 2px;
      }

      .log-message {
        font-size: 12px;
        line-height: 18px;
        overflow-wrap: anywhere;
      }

      .empty, .error {
        padding: 16px;
      }

      .error {
        color: var(--red);
      }

      @media (max-width: 980px) {
        .topbar {
          align-items: stretch;
          flex-direction: column;
        }

        .toolbar {
          width: 100%;
        }

        .select {
          min-width: 0;
          max-width: none;
          flex: 1;
        }

        .layout {
          grid-template-columns: 1fr;
        }

        .side {
          grid-template-rows: 260px 420px;
        }
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      window.__DIVEDRA_VIEWER_CONFIG__ = ${jsonForInlineScript(config)};
    </script>
    <script type="module" src="${WORKFLOW_VIEWER_SCRIPT_PATH}"></script>
  </body>
</html>`);
}

export function isWorkflowViewerDocumentPath(pathname: string): boolean {
  const normalizedPathname =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return WORKFLOW_VIEWER_DOCUMENT_PATHS.some(
    (candidate) => candidate === normalizedPathname,
  );
}

export async function renderWorkflowViewerScript(): Promise<Response> {
  cachedClientScript ??= loadClientScript();
  try {
    return scriptResponse(await cachedClientScript);
  } catch (error: unknown) {
    cachedClientScript = undefined;
    const message = error instanceof Error ? error.message : String(error);
    return scriptResponse(
      `document.body.textContent = ${JSON.stringify(`workflow viewer failed to load: ${message}`)};`,
    );
  }
}
