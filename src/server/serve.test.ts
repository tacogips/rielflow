import { describe, expect, test } from "vitest";
import { startServe } from "./serve";

describe("startServe", () => {
  test("uses 43173 as the default serve port", async () => {
    let capturedPort = -1;

    const started = await startServe(
      {
        host: "127.0.0.1",
      },
      {
        serve: ({ port }) => {
          capturedPort = port;
          return {
            port,
            stop: () => {},
          };
        },
      },
    );

    expect(started.host).toBe("127.0.0.1");
    expect(capturedPort).toBe(43173);
    expect(started.port).toBe(43173);
  });

  test("allocates a concrete port when port 0 is requested", async () => {
    let capturedPort = -1;

    const started = await startServe(
      {
        host: "127.0.0.1",
        port: 0,
      },
      {
        serve: ({ port }) => {
          capturedPort = port;
          return {
            port: 48321,
            stop: () => {},
          };
        },
      },
    );

    expect(started.host).toBe("127.0.0.1");
    expect(capturedPort).toBe(0);
    expect(started.port).toBe(48321);
  });

  test("surfaces runtime listen failures for port-0 binds without masking them", async () => {
    await expect(
      startServe(
        {
          host: "127.0.0.1",
          port: 0,
        },
        {
          serve: () => {
            throw new Error("Failed to listen at 127.0.0.1");
          },
        },
      ),
    ).rejects.toThrow("Failed to listen at 127.0.0.1");
  });

  test("retries port-0 serve startup with a concrete ephemeral port when the runtime rejects port 0", async () => {
    const attemptedPorts: number[] = [];

    const started = await startServe(
      {
        host: "127.0.0.1",
        port: 0,
      },
      {
        serve: ({ port }) => {
          attemptedPorts.push(port);
          if (port === 0) {
            const error = new Error(
              "Failed to start server. Is port 0 in use?",
            ) as Error & { code?: string };
            error.code = "EADDRINUSE";
            throw error;
          }

          return {
            port,
            stop: () => {},
          };
        },
        reservePort: async () => 48321,
      },
    );

    expect(attemptedPorts[0]).toBe(0);
    expect(attemptedPorts[1]).toBe(48321);
    expect(started.port).toBe(48321);
  });

  test("reports the actual bound port from the server", async () => {
    const started = await startServe(
      {
        host: "127.0.0.1",
        port: 41000,
      },
      {
        serve: () => ({
          port: 41001,
          stop: () => {},
        }),
      },
    );

    expect(started.port).toBe(41001);
  });

  test("rejects negative ports", async () => {
    await expect(
      startServe(
        {
          host: "127.0.0.1",
          port: -1,
        },
        {
          serve: ({ port }) => ({
            port,
            stop: () => {},
          }),
        },
      ),
    ).rejects.toThrow("invalid serve port '-1'");
  });

  test("rejects invalid serve port values coming from the environment", async () => {
    await expect(
      startServe(
        {
          host: "127.0.0.1",
          env: {
            DIVEDRA_SERVE_PORT: "abc",
          },
        },
        {
          serve: ({ port }) => ({
            port,
            stop: () => {},
          }),
        },
      ),
    ).rejects.toThrow("invalid serve port 'abc'");
  });

  test("rejects non-integer ports", async () => {
    await expect(
      startServe(
        {
          host: "127.0.0.1",
          port: 5173.5,
        },
        {
          serve: ({ port }) => ({
            port,
            stop: () => {},
          }),
        },
      ),
    ).rejects.toThrow("invalid serve port '5173.5'");
  });
});
