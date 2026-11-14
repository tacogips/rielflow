import { DEFAULT_SERVE_PORT } from "../server/serve";

export const DEFAULT_GRAPHQL_PATH = "/graphql";
export const DEFAULT_GRAPHQL_HOST = "127.0.0.1";

export function buildLocalGraphqlEndpoint(
  port: number = DEFAULT_SERVE_PORT,
  host: string = DEFAULT_GRAPHQL_HOST,
): string {
  return `http://${host}:${String(port)}${DEFAULT_GRAPHQL_PATH}`;
}

export const DEFAULT_GRAPHQL_ENDPOINT = buildLocalGraphqlEndpoint();
