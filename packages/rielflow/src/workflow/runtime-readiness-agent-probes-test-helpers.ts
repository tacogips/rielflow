import type { AgentCliCommandResult } from "./agent-cli-command-result";
import type { LoadOptions } from "./types";
import {
  resetExecuteAgentCliCommandForTests,
  runCommand as runAgentCliCommand,
  setExecuteAgentCliCommandForTests,
} from "./runtime-readiness-agent-probes";

type AgentCliCommandHandler = (
  args: readonly string[],
) => AgentCliCommandResult | Promise<AgentCliCommandResult>;

export interface MockAgentCliCommandsHandle {
  readonly restore: () => void;
}

export function mockAgentCliCommands(
  handlers: Readonly<Record<string, AgentCliCommandHandler>>,
): MockAgentCliCommandsHandle {
  setExecuteAgentCliCommandForTests(
    async (command, args, _options, _timeoutMs) => {
      const handler = handlers[command];
      if (handler === undefined) {
        return {
          ok: false,
          stdout: "",
          stderr: "",
          message: `unexpected command: ${command} ${args.join(" ")}`,
        };
      }
      return await handler(args);
    },
  );
  return {
    restore: resetExecuteAgentCliCommandForTests,
  };
}

export async function runMockedAgentCliCommand(
  command: string,
  args: readonly string[],
  options: Pick<LoadOptions, "cwd" | "env"> = {},
  timeoutMs?: number,
): Promise<AgentCliCommandResult> {
  return await runAgentCliCommand(command, args, options, timeoutMs);
}
