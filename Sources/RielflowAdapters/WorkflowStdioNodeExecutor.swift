import Foundation
import RielflowCore

public struct LocalWorkflowStdioNodeExecutor: WorkflowStdioNodeExecuting {
  public var runner: any LocalAgentProcessRunning

  public init(
    runner: any LocalAgentProcessRunning = FoundationLocalAgentProcessRunner()
  ) {
    self.runner = runner
  }

  public func execute(
    _ input: WorkflowStdioNodeExecutionInput,
    context: AdapterExecutionContext
  ) async throws -> WorkflowStdioNodeExecutionResult {
    let inputLine = try invocationInputJSONL(for: input)
    let configuration = try processConfiguration(for: input)
    let result = try await runner.run(configuration: configuration, stdin: inputLine, deadline: context.deadline)
    guard result.terminationStatus == 0 else {
      let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
      throw AdapterExecutionError(
        .providerError,
        "\(input.kind.rawValue) node '\(input.nodeId)' failed with exit code \(result.terminationStatus): \(detail)"
      )
    }
    return WorkflowStdioNodeExecutionResult(payload: try outputPayload(fromStdout: result.stdout, kind: input.kind))
  }

  private func processConfiguration(
    for input: WorkflowStdioNodeExecutionInput
  ) throws -> LocalAgentProcessConfiguration {
    switch input.kind {
    case .command:
      guard let command = input.node.command else {
        throw AdapterExecutionError(.providerError, "command node '\(input.nodeId)' is missing command execution metadata")
      }
      let invocation = processInvocation(executable: command.executable, arguments: command.arguments)
      return LocalAgentProcessConfiguration(
        executableURL: invocation.executableURL,
        arguments: invocation.arguments,
        environment: environment(base: command.environment, input: input),
        unsetEnvironmentKeys: strippedEnvironmentKeys,
        workingDirectoryURL: workingDirectoryURL(command.workingDirectory ?? input.node.workingDirectory)
      )
    case .container:
      guard let container = input.node.container else {
        throw AdapterExecutionError(.providerError, "container node '\(input.nodeId)' is missing container execution metadata")
      }
      let runnerPath = container.runnerPath ?? container.runnerKind ?? "docker"
      let invocation = processInvocation(
        executable: runnerPath,
        arguments: containerArguments(container)
      )
      return LocalAgentProcessConfiguration(
        executableURL: invocation.executableURL,
        arguments: invocation.arguments,
        environment: environment(base: container.environment, input: input),
        unsetEnvironmentKeys: strippedEnvironmentKeys,
        workingDirectoryURL: workingDirectoryURL(container.workingDirectory ?? input.node.workingDirectory)
      )
    }
  }

  private func environment(
    base: [String: String],
    input: WorkflowStdioNodeExecutionInput
  ) -> [String: String] {
    var environment = base
    for key in strippedEnvironmentKeys {
      environment.removeValue(forKey: key)
    }
    environment["RIEL_WORKFLOW_ID"] = input.workflowId
    environment["RIEL_WORKFLOW_EXECUTION_ID"] = input.sessionId
    environment["RIEL_NODE_ID"] = input.nodeId
    environment["RIEL_NODE_EXEC_ID"] = "\(input.stepId)#\(input.executionIndex)"
    return environment
  }

  private func containerArguments(_ container: WorkflowContainerExecution) -> [String] {
    var arguments = ["run", "--rm", "-i"]
    for key in container.environment.keys.sorted() where !strippedEnvironmentKeys.contains(key) {
      arguments += ["-e", key]
    }
    arguments.append(container.image)
    arguments.append(contentsOf: container.command)
    return arguments
  }

  private func invocationInputJSONL(for input: WorkflowStdioNodeExecutionInput) throws -> String {
    let envelope = WorkflowStdioNodeInvocationEnvelope(
      workflowId: input.workflowId,
      workflowExecutionId: input.sessionId,
      stepId: input.stepId,
      nodeId: input.nodeId,
      executionIndex: input.executionIndex,
      nodeType: input.kind.rawValue,
      variables: input.variables,
      input: input.resolvedInputPayload
    )
    let data = try JSONEncoder().encode(envelope)
    guard let text = String(data: data, encoding: .utf8) else {
      throw AdapterExecutionError(.providerError, "failed to encode stdio node input as UTF-8")
    }
    return text + "\n"
  }

  private func outputPayload(fromStdout stdout: String, kind: WorkflowStdioNodeExecutionKind) throws -> JSONObject? {
    let records = stdout
      .split(whereSeparator: \.isNewline)
      .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    guard !records.isEmpty else {
      return nil
    }
    guard records.count == 1 else {
      throw AdapterExecutionError(.invalidOutput, "\(kind.rawValue) node stdout must contain at most one JSONL output record")
    }
    guard let data = records[0].data(using: .utf8) else {
      throw AdapterExecutionError(.invalidOutput, "\(kind.rawValue) node stdout JSONL output must be UTF-8")
    }
    let decoded: JSONValue
    do {
      decoded = try JSONDecoder().decode(JSONValue.self, from: data)
    } catch {
      throw AdapterExecutionError(.invalidOutput, "\(kind.rawValue) node stdout must contain valid JSONL: \(error.localizedDescription)")
    }
    guard case let .object(object) = decoded else {
      throw AdapterExecutionError(.invalidOutput, "\(kind.rawValue) node stdout JSONL output must contain a top-level JSON object")
    }
    return object
  }

  private func workingDirectoryURL(_ path: String?) -> URL? {
    path.map { URL(fileURLWithPath: $0) }
  }

  private func processInvocation(executable: String, arguments: [String]) -> (executableURL: URL, arguments: [String]) {
    if executable.hasPrefix("/") {
      return (URL(fileURLWithPath: executable), arguments)
    }
    return (URL(fileURLWithPath: "/usr/bin/env"), [executable] + arguments)
  }

  private var strippedEnvironmentKeys: Set<String> {
    ["RIEL_MAILBOX_DIR", "RIELFLOW_WORKFLOW_INPUT", "RIELFLOW_WORKFLOW_OUTPUT"]
  }
}
