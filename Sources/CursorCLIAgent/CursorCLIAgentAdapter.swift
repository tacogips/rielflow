import RielflowAdapters
import RielflowCore

public struct CursorCLIAgentAdapter: NodeAdapter {
  private let adapter: LocalAgentCommandAdapter

  public init(executableName: String = "cursor-agent", runner: any LocalAgentProcessRunning = FoundationLocalAgentProcessRunner()) {
    self.adapter = LocalAgentCommandAdapter(
      provider: CliAgentBackend.cursorCliAgent.rawValue,
      executableName: executableName,
      baseArguments: [],
      runner: runner
    )
  }

  public func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    try await adapter.execute(input, context: context)
  }
}
