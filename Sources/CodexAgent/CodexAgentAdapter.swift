import RielflowAdapters
import RielflowCore

public struct CodexAgentAdapter: NodeAdapter {
  private let adapter: LocalAgentCommandAdapter

  public init(executableName: String = "codex", runner: any LocalAgentProcessRunning = FoundationLocalAgentProcessRunner()) {
    self.adapter = LocalAgentCommandAdapter(
      provider: CliAgentBackend.codexAgent.rawValue,
      executableName: executableName,
      baseArguments: ["exec", "--json"],
      runner: runner
    )
  }

  public func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    try await adapter.execute(input, context: context)
  }
}
