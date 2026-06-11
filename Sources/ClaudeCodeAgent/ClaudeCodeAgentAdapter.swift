import RielflowAdapters
import RielflowCore

public struct ClaudeCodeAgentAdapter: NodeAdapter {
  private let adapter: LocalAgentCommandAdapter

  public init(executableName: String = "claude", runner: any LocalAgentProcessRunning = FoundationLocalAgentProcessRunner()) {
    self.adapter = LocalAgentCommandAdapter(
      provider: CliAgentBackend.claudeCodeAgent.rawValue,
      executableName: executableName,
      baseArguments: ["--print"],
      runner: runner
    )
  }

  public func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    try await adapter.execute(input, context: context)
  }
}
