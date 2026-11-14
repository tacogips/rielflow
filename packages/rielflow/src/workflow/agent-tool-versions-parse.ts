export interface AgentToolVersionsParseResult {
  readonly available: boolean;
  readonly commandSummary: string;
}

interface AgentToolVersionEntry {
  readonly version: string | null;
  readonly error: string | null;
}

export function parseAgentToolVersionsOutput(input: {
  readonly stdout: string;
  readonly requiredTool: string;
  readonly agentLabel: string;
}): AgentToolVersionsParseResult {
  try {
    const parsed = JSON.parse(input.stdout) as {
      readonly agent?: string;
      readonly packageVersion?: string;
      readonly tools?: Readonly<
        | Record<string, AgentToolVersionEntry>
        | ReadonlyArray<{
            name: string;
            version: string | null;
            status?: string;
            error?: string | null;
          }>
      >;
    };
    const tools: Readonly<Record<string, AgentToolVersionEntry>> =
      parsed.tools === undefined
        ? {}
        : Array.isArray(parsed.tools)
          ? Object.fromEntries(
              parsed.tools.map((tool) => [
                tool.name,
                {
                  version: tool.version,
                  error:
                    tool.error ??
                    (tool.status === "available" ? null : "unavailable"),
                },
              ]),
            )
          : parsed.tools;
    const requiredTool = tools[input.requiredTool];
    const available =
      requiredTool?.version !== null && requiredTool?.version !== undefined;
    const toolSummary = Object.entries(tools)
      .map(([name, value]) =>
        value.version === null
          ? `${name}=${value.error ?? "unavailable"}`
          : `${name}=${value.version}`,
      )
      .join(", ");
    return {
      available,
      commandSummary:
        `agent=${parsed.agent ?? parsed.packageVersion ?? "unknown"}` +
        (toolSummary.length === 0 ? "" : `, ${toolSummary}`),
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown JSON parse error";
    return {
      available: false,
      commandSummary: `${input.agentLabel} version output was invalid JSON: ${message}`,
    };
  }
}
