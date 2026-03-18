import type { FrontendMode, UiConfigResponse } from "../shared/ui-contract";
import type { SessionStoreOptions } from "../workflow/session-store";
import type { LoadOptions } from "../workflow/types";
import {
  detectFrontendMode,
  missingUiResponse,
  tryServeBuiltUiAsset,
} from "./ui-assets";
import { handleGraphqlRequest } from "./graphql";

export { resolveDefaultUiDistRoot } from "./ui-assets";

export interface ApiContext extends LoadOptions, SessionStoreOptions {
  readonly readOnly?: boolean;
  readonly noExec?: boolean;
  readonly fixedWorkflowName?: string;
  readonly uiDistRoot?: string;
  readonly frontendMode?: FrontendMode;
  readonly frontendModeModuleUrl?: string;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function buildUiConfigResponse(context: ApiContext): UiConfigResponse {
  return {
    fixedWorkflowName: context.fixedWorkflowName ?? null,
    readOnly: context.readOnly === true,
    noExec: context.noExec === true,
    frontend: detectFrontendMode(context),
  };
}

export async function handleApiRequest(
  request: Request,
  context: ApiContext,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/graphql") {
    return handleGraphqlRequest(request, context);
  }

  if (url.pathname === "/api/ui-config" && request.method === "GET") {
    try {
      return json(buildUiConfigResponse(context));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: message }, 500);
    }
  }

  if (url.pathname === "/" || url.pathname === "/ui") {
    const builtUi = await tryServeBuiltUiAsset(url.pathname, context);
    if (builtUi !== undefined) {
      return builtUi;
    }

    return missingUiResponse();
  }

  if (url.pathname === "/healthz") {
    return json({ service: "divedra-serve", status: "ok" });
  }

  if (request.method === "GET") {
    const builtUi = await tryServeBuiltUiAsset(url.pathname, context);
    if (builtUi !== undefined) {
      return builtUi;
    }
  }

  return json({ error: "not found" }, 404);
}
