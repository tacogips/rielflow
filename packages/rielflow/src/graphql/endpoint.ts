export const DEFAULT_GRAPHQL_PATH = "/graphql";
export const DEFAULT_GRAPHQL_HOST = "127.0.0.1";
export const DEFAULT_GRAPHQL_PORT = 43173;

export function buildLocalGraphqlEndpoint(
  port: number = DEFAULT_GRAPHQL_PORT,
  host: string = DEFAULT_GRAPHQL_HOST,
): string {
  return `http://${host}:${String(port)}${DEFAULT_GRAPHQL_PATH}`;
}

export const DEFAULT_GRAPHQL_ENDPOINT = buildLocalGraphqlEndpoint();
