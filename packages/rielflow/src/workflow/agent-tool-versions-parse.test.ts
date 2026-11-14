import { describe, expect, test } from "vitest";
import { parseAgentToolVersionsOutput } from "./agent-tool-versions-parse";

describe("parseAgentToolVersionsOutput", () => {
  test("marks cursor-cli-agent available when cursor-agent reports a version", () => {
    expect(
      parseAgentToolVersionsOutput({
        stdout: JSON.stringify({
          agent: "1.0.0",
          tools: {
            "cursor-agent": { version: "0.45.0", error: null },
          },
        }),
        requiredTool: "cursor-agent",
        agentLabel: "cursor-cli-agent",
      }),
    ).toEqual({
      available: true,
      commandSummary: "agent=1.0.0, cursor-agent=0.45.0",
    });
  });

  test("marks cursor-cli-agent available with current tool versions array output", () => {
    expect(
      parseAgentToolVersionsOutput({
        stdout: JSON.stringify({
          packageVersion: "0.1.0",
          tools: [
            {
              name: "cursor-agent",
              command: "cursor-agent",
              version: "2026.05.24-dda726e",
              status: "available",
            },
            {
              name: "git",
              command: "git",
              version: "git version 2.53.0",
              status: "available",
            },
          ],
        }),
        requiredTool: "cursor-agent",
        agentLabel: "cursor-cli-agent",
      }),
    ).toEqual({
      available: true,
      commandSummary:
        "agent=0.1.0, cursor-agent=2026.05.24-dda726e, git=git version 2.53.0",
    });
  });

  test("marks claude-code-agent unavailable when claude tool reports an error", () => {
    expect(
      parseAgentToolVersionsOutput({
        stdout: JSON.stringify({
          agent: "0.1.0",
          tools: {
            claude: { version: null, error: "claude binary not found" },
          },
        }),
        requiredTool: "claude",
        agentLabel: "claude-code-agent",
      }),
    ).toMatchObject({
      available: false,
      commandSummary: "agent=0.1.0, claude=claude binary not found",
    });
  });
});
