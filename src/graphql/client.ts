export { DEFAULT_GRAPHQL_ENDPOINT } from "./endpoint";
import { GRAPHQL_MANAGER_SESSION_HEADER } from "./transport";

export interface GraphqlClientRequest {
  readonly endpoint: string;
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly authToken?: string;
  readonly managerSessionId?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface GraphqlResponseError {
  readonly message: string;
}

export interface GraphqlClientResponse {
  readonly data?: unknown;
  readonly errors?: readonly GraphqlResponseError[];
}

export async function executeGraphqlRequest(
  request: GraphqlClientRequest,
): Promise<GraphqlClientResponse> {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  if (request.authToken !== undefined) {
    headers.set("authorization", `Bearer ${request.authToken}`);
  }
  if (request.managerSessionId !== undefined) {
    headers.set(GRAPHQL_MANAGER_SESSION_HEADER, request.managerSessionId);
  }

  const response = await (request.fetchImpl ?? fetch)(request.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: request.document,
      ...(request.variables === undefined
        ? {}
        : { variables: request.variables }),
    }),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? {} : (JSON.parse(text) as unknown);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid GraphQL response JSON: ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("GraphQL response must be a JSON object");
  }

  const body = parsed as Readonly<Record<string, unknown>>;
  const errorsRaw = body["errors"];
  const errors =
    Array.isArray(errorsRaw) &&
    errorsRaw.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Readonly<Record<string, unknown>>)["message"] ===
          "string",
    )
      ? (errorsRaw as readonly GraphqlResponseError[])
      : undefined;

  if (!response.ok && errors === undefined) {
    throw new Error(
      `GraphQL request failed with HTTP ${String(response.status)} ${response.statusText}`,
    );
  }

  return {
    ...(Object.hasOwn(body, "data") ? { data: body["data"] } : {}),
    ...(errors === undefined ? {} : { errors }),
  };
}
