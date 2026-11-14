import { createYoga } from "graphql-yoga";
import type {
  GraphqlRequestContext,
  GraphqlSchemaDependencies,
} from "../graphql/types";
import { GRAPHQL_MANAGER_SESSION_HEADER } from "../graphql/transport";
import { stripAmbientManagerExecutionContext } from "../workflow/manager-session-store";
import { createExecutableGraphqlSchema } from "./graphql-executable-schema";

interface GraphqlRequestEnvelope {
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly operationName?: string;
}

interface GraphqlErrorEntry {
  readonly message: string;
}

interface GraphqlExecutionResult {
  readonly data?: unknown;
  readonly errors?: readonly GraphqlErrorEntry[];
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function graphqlErrorResponse(
  message: string,
  status = 200,
  data: unknown = null,
): Response {
  return jsonResponse(
    {
      data,
      errors: [{ message }],
    } satisfies GraphqlExecutionResult,
    status,
  );
}

function readBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization === null) {
    return undefined;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match === null) {
    return undefined;
  }
  const token = match[1]?.trim();
  return token !== undefined && token.length > 0 ? token : undefined;
}

function readManagerSessionId(request: Request): string | undefined {
  const value = request.headers.get(GRAPHQL_MANAGER_SESSION_HEADER);
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeVariables(value: unknown): Readonly<Record<string, unknown>> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GraphQL variables must be a JSON object when provided");
  }
  return value as Readonly<Record<string, unknown>>;
}

function parseGraphqlRequestEnvelope(value: unknown): GraphqlRequestEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GraphQL request body must be a JSON object");
  }

  const body = value as Readonly<Record<string, unknown>>;
  const query = typeof body["query"] === "string" ? body["query"].trim() : "";
  if (query.length === 0) {
    throw new Error("GraphQL request body must include a non-empty query string");
  }

  const operationName =
    typeof body["operationName"] === "string" &&
    body["operationName"].trim().length > 0
      ? body["operationName"].trim()
      : undefined;

  return {
    query,
    variables: normalizeVariables(body["variables"]),
    ...(operationName === undefined ? {} : { operationName }),
  };
}

function toGraphqlErrorEntries(value: unknown): readonly GraphqlErrorEntry[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const entries = value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }
      const message = entry["message"];
      return typeof message === "string" ? { message } : null;
    })
    .filter((entry): entry is GraphqlErrorEntry => entry !== null);
  return entries.length > 0 ? entries : undefined;
}

function parseGraphqlExecutionResult(value: unknown): GraphqlExecutionResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GraphQL response body must be a JSON object");
  }

  const payload = value as Readonly<Record<string, unknown>>;
  const errors = toGraphqlErrorEntries(payload["errors"]);
  return {
    ...(payload["data"] === undefined ? {} : { data: payload["data"] }),
    ...(errors === undefined ? {} : { errors }),
  };
}

function createGraphqlPostRequest(
  url: string,
  envelope: GraphqlRequestEnvelope,
  requestHeaders?: HeadersInit,
): Request {
  const headers = new Headers(requestHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(envelope),
  });
}

function buildHttpExecutionContext(
  request: Request,
  context: GraphqlRequestContext,
): GraphqlRequestContext {
  const authToken = readBearerToken(request);
  const managerSessionId = readManagerSessionId(request);
  const {
    authToken: _ignoredAuthToken,
    managerSessionId: _ignoredManagerSessionId,
    ...requestLocalContext
  } = context;
  const sanitizedEnv =
    context.env === undefined
      ? undefined
      : stripAmbientManagerExecutionContext(context.env);

  return {
    ...requestLocalContext,
    ...(sanitizedEnv === undefined ? {} : { env: sanitizedEnv }),
    ...(authToken === undefined ? {} : { authToken }),
    ...(managerSessionId === undefined ? {} : { managerSessionId }),
  };
}

function createGraphqlYogaServer(deps: GraphqlSchemaDependencies = {}) {
  return createYoga<GraphqlRequestContext>({
    schema: createExecutableGraphqlSchema(deps),
    graphqlEndpoint: "/graphql",
    graphiql: false,
    landingPage: false,
    logging: false,
    maskedErrors: false,
  });
}

export async function executeGraphqlDocument(
  document: string,
  context: GraphqlRequestContext,
  options: {
    readonly variables?: Readonly<Record<string, unknown>>;
    readonly operationName?: string;
    readonly deps?: GraphqlSchemaDependencies;
  } = {},
): Promise<unknown> {
  const request = createGraphqlPostRequest("http://127.0.0.1/graphql", {
    query: document,
    variables: options.variables ?? {},
    ...(options.operationName === undefined
      ? {}
      : { operationName: options.operationName }),
  });
  const response = await createGraphqlYogaServer(options.deps).fetch(
    request,
    context,
  );
  const payload = parseGraphqlExecutionResult((await response.json()) as unknown);

  if (payload.errors !== undefined && payload.errors.length > 0) {
    const [firstError] = payload.errors;
    if (firstError !== undefined) {
      throw new Error(firstError.message);
    }
  }

  return payload.data ?? null;
}

export async function handleGraphqlRequest(
  request: Request,
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return graphqlErrorResponse("GraphQL endpoint only supports POST", 405);
  }

  let parsedBody: GraphqlRequestEnvelope;
  try {
    parsedBody = parseGraphqlRequestEnvelope((await request.json()) as unknown);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return graphqlErrorResponse(message, 400);
  }

  try {
    const forwardedRequest = createGraphqlPostRequest(
      request.url,
      parsedBody,
      request.headers,
    );
    const response = await createGraphqlYogaServer(deps).fetch(
      forwardedRequest,
      buildHttpExecutionContext(request, context),
    );
    const execution = parseGraphqlExecutionResult((await response.json()) as unknown);
    return jsonResponse({
      data: execution.data ?? null,
      ...(execution.errors === undefined ? {} : { errors: execution.errors }),
    } satisfies GraphqlExecutionResult);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return graphqlErrorResponse(message);
  }
}
