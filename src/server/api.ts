import type { SessionStoreOptions } from "../workflow/session-store";
import { inferRootDataDirFromExplicitStorageRoots } from "../workflow/paths";
import type { LoadOptions } from "../workflow/types";
import { handleGraphqlRequest } from "./graphql";
import {
  WORKFLOW_VIEWER_SCRIPT_PATH,
  isWorkflowViewerDocumentPath,
  renderWorkflowViewerHtml,
  renderWorkflowViewerScript,
} from "./web-viewer";

export interface ApiContext extends LoadOptions, SessionStoreOptions {
  readonly readOnly?: boolean;
  readonly noExec?: boolean;
  readonly fixedWorkflowName?: string;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export async function handleApiRequest(
  request: Request,
  context: ApiContext,
): Promise<Response> {
  const inferredRootDataDir = inferRootDataDirFromExplicitStorageRoots({
    ...(context.artifactRoot === undefined
      ? {}
      : { artifactRoot: context.artifactRoot }),
    ...(context.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: context.sessionStoreRoot }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });
  const normalizedContext =
    context.rootDataDir !== undefined || inferredRootDataDir === undefined
      ? context
      : {
          ...context,
          rootDataDir: inferredRootDataDir,
        };
  const url = new URL(request.url);

  if (isWorkflowViewerDocumentPath(url.pathname)) {
    return renderWorkflowViewerHtml(normalizedContext);
  }

  if (url.pathname === WORKFLOW_VIEWER_SCRIPT_PATH) {
    return renderWorkflowViewerScript();
  }

  if (url.pathname === "/graphql") {
    return handleGraphqlRequest(request, normalizedContext);
  }

  if (url.pathname === "/healthz") {
    return json({ service: "divedra-serve", status: "ok" });
  }

  return json({ error: "not found" }, 404);
}
