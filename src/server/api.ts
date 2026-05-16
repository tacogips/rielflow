import type { SessionStoreOptions } from "../workflow/session-store";
import type { LoadOptions, ResolvedWorkflowSource } from "../workflow/types";
import { inferRootDataDirFromExplicitStorageRoots } from "../workflow/paths";
import {
  BROWSER_WORKFLOW_OVERVIEW_RECENT_LIMIT,
  buildBrowserWorkflowOverviewViewModel,
  overviewBrowserHtml,
} from "./browser-overview";
import { handleGraphqlRequest } from "./graphql";

export interface ApiContext extends LoadOptions, SessionStoreOptions {
  readonly readOnly?: boolean;
  readonly noExec?: boolean;
  readonly fixedWorkflowName?: string;
  readonly fixedResolvedWorkflowSource?: ResolvedWorkflowSource;
}

export { BROWSER_WORKFLOW_OVERVIEW_RECENT_LIMIT };

function normalizeApiPathname(pathname: string): string {
  return pathname.endsWith("/") && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;
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
  const pathname = normalizeApiPathname(url.pathname);

  if (pathname === "/" || pathname === "/overview") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405 });
    }

    async function overviewJson(): Promise<Response> {
      const built =
        await buildBrowserWorkflowOverviewViewModel(normalizedContext);
      if (!built.ok) {
        return json({ error: built.error.message }, 500);
      }
      return json(built.value);
    }

    if (pathname === "/") {
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }
      return overviewBrowserHtml();
    }

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    return await overviewJson();
  }

  if (pathname === "/graphql") {
    return handleGraphqlRequest(request, normalizedContext);
  }

  if (pathname === "/healthz") {
    return json({ service: "divedra-serve", status: "ok" });
  }

  return json({ error: "not found" }, 404);
}
