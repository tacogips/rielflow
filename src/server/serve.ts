import net from "node:net";
import { handleApiRequest, type ApiContext } from "./api";

export interface ServeStartOptions extends ApiContext {
  readonly host?: string;
  readonly port?: number;
}

export interface StartedServe {
  readonly host: string;
  readonly port: number;
  stop(): void;
}

interface ServeRuntime {
  readonly serve: (options: {
    readonly hostname: string;
    readonly port: number;
    readonly fetch: (request: Request) => Response | Promise<Response>;
  }) => {
    readonly port: number;
    stop(): void;
  };
  readonly reservePort?: (host: string) => Promise<number>;
}

const DEFAULT_RUNTIME: ServeRuntime = {
  serve: (options) => Bun.serve(options),
  reservePort: reserveEphemeralPort,
};
export const DEFAULT_SERVE_PORT = 43173;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const value = error.code;
  return typeof value === "string" ? value : undefined;
}

function isEphemeralPortListenFailure(
  error: unknown,
  requestedPort: number,
): boolean {
  return requestedPort === 0 && errorCode(error) === "EADDRINUSE";
}

async function reserveEphemeralPort(host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => {
          reject(new Error("failed to reserve an ephemeral serve port"));
        });
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function startServe(
  options: ServeStartOptions = {},
  runtime: ServeRuntime = DEFAULT_RUNTIME,
): Promise<StartedServe> {
  const host =
    options.host ?? options.env?.["DIVEDRA_SERVE_HOST"] ?? "127.0.0.1";
  const rawPort =
    options.port ?? options.env?.["DIVEDRA_SERVE_PORT"] ?? DEFAULT_SERVE_PORT;
  const port = typeof rawPort === "number" ? rawPort : Number(rawPort);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid serve port '${String(rawPort)}'`);
  }

  const fetch = (request: Request) => handleApiRequest(request, options);

  let server:
    | {
        readonly port: number;
        stop(): void;
      }
    | undefined;
  let candidatePort = port;
  let lastError: unknown;
  const reservePort = runtime.reservePort ?? reserveEphemeralPort;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      server = runtime.serve({
        hostname: host,
        port: candidatePort,
        fetch,
      });
      break;
    } catch (error: unknown) {
      lastError = error;
      if (!isEphemeralPortListenFailure(error, candidatePort)) {
        throw error;
      }

      candidatePort = await reservePort(host);
    }
  }

  if (server === undefined) {
    throw lastError instanceof Error
      ? lastError
      : new Error("failed to start server");
  }

  return {
    host,
    port: server.port,
    stop: () => {
      server.stop();
    },
  };
}
