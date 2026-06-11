import Foundation
import RielflowAdapters
import RielflowCore

private let defaultClaudeAuthPreflightTimeout: TimeInterval = 5

public enum ClaudeCodePermissionMode: String, Sendable {
  case `default`
  case acceptEdits
  case plan
  case bypassPermissions
}

public struct ClaudeCodeAgentCommandBuilder: LocalAgentCommandBuilding {
  public var executableName: String
  public var permissionMode: ClaudeCodePermissionMode?
  public var environment: [String: String]
  public var additionalArguments: [String]

  public var provider: String { CliAgentBackend.claudeCodeAgent.rawValue }

  public init(
    executableName: String = "claude",
    permissionMode: ClaudeCodePermissionMode? = nil,
    environment: [String: String] = [:],
    additionalArguments: [String] = []
  ) {
    self.executableName = executableName
    self.permissionMode = permissionMode
    self.environment = environment
    self.additionalArguments = additionalArguments
  }

  public func buildCommand(for input: AdapterExecutionInput) throws -> LocalAgentCommand {
    var arguments = [executableName, "-p", "--output-format", "text", "--model", input.node.model]
    if let effort = input.node.effort {
      arguments.append(contentsOf: ["--effort", effort.rawValue])
    }

    let resolvedPermissionMode = permissionMode ?? stringValue(input.node.variables["claudePermissionMode"]).flatMap(ClaudeCodePermissionMode.init(rawValue:))
    if let resolvedPermissionMode {
      arguments.append(contentsOf: ["--permission-mode", resolvedPermissionMode.rawValue])
    }

    let attachmentPaths = deduplicatedPaths(
      stringArray(input.node.variables["attachmentPaths"]) + resolveAdapterImagePaths(input)
    )
    for directory in uniqueSortedDirectories(containing: attachmentPaths) {
      arguments.append(contentsOf: ["--add-dir", directory])
    }

    arguments.append(contentsOf: additionalArguments)
    arguments.append(contentsOf: stringArray(input.node.variables["claudeAdditionalArgs"]))

    var environment = environment
    environment["RIEL_AGENT_BACKEND"] = provider
    return LocalAgentCommand(
      provider: provider,
      configuration: LocalAgentProcessConfiguration(
        executableURL: URL(fileURLWithPath: "/usr/bin/env"),
        arguments: arguments,
        environment: environment,
        workingDirectoryURL: input.node.workingDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) }
      ),
      stdin: buildClaudePrompt(
        prompt: input.promptText,
        systemPrompt: input.systemPromptText,
        attachmentPaths: attachmentPaths
      )
    )
  }
}

public struct ClaudeCodeAgentAdapter: NodeAdapter {
  private let adapter: LocalAgentCommandAdapter
  private let executableName: String
  private let runner: any LocalAgentProcessRunning
  private let environment: [String: String]
  private let authPreflight: Bool
  private let checkAuthPreflight: (@Sendable (AdapterExecutionInput) async throws -> Void)?

  public init(
    executableName: String = "claude",
    runner: any LocalAgentProcessRunning = FoundationLocalAgentProcessRunner(),
    permissionMode: ClaudeCodePermissionMode? = nil,
    environment: [String: String] = [:],
    additionalArguments: [String] = [],
    authPreflight: Bool = true,
    checkAuthPreflight: (@Sendable (AdapterExecutionInput) async throws -> Void)? = nil
  ) {
    self.executableName = executableName
    self.runner = runner
    self.environment = environment
    self.authPreflight = authPreflight
    self.adapter = LocalAgentCommandAdapter(
      commandBuilder: ClaudeCodeAgentCommandBuilder(
        executableName: executableName,
        permissionMode: permissionMode,
        environment: environment,
        additionalArguments: additionalArguments
      ),
      runner: runner
    )
    self.checkAuthPreflight = checkAuthPreflight
  }

  public func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    if authPreflight {
      if let checkAuthPreflight {
        do {
          try await checkAuthPreflight(input)
        } catch let error as AdapterExecutionError {
          throw error
        } catch {
          throw AdapterExecutionError(.policyBlocked, "claude-code-agent authentication is unavailable: \(redactAdapterSensitiveText(error.localizedDescription))")
        }
      } else {
        try await runClaudeDefaultAuthPreflight(input: input, executableName: executableName, environment: environment, runner: runner, deadline: context.deadline)
      }
    }
    return try await adapter.execute(input, context: context)
  }
}

private func runClaudeDefaultAuthPreflight(
  input: AdapterExecutionInput,
  executableName: String,
  environment: [String: String],
  runner: any LocalAgentProcessRunning,
  deadline: Date?
) async throws {
  var preflightEnvironment = environment
  preflightEnvironment["RIEL_AGENT_BACKEND"] = CliAgentBackend.claudeCodeAgent.rawValue
  let sensitiveValues = sensitiveAdapterEnvironmentValues(preflightEnvironment)
  let versionDeadline = defaultAgentPreflightDeadline(existingDeadline: deadline, timeout: defaultClaudeAuthPreflightTimeout)
  let version: LocalAgentProcessResult
  do {
    version = try await runner.run(
      configuration: LocalAgentProcessConfiguration(
        executableURL: URL(fileURLWithPath: "/usr/bin/env"),
        arguments: [executableName, "--version"],
        environment: preflightEnvironment,
        workingDirectoryURL: input.node.workingDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) }
      ),
      stdin: "",
      deadline: versionDeadline
    )
  } catch {
    throw AdapterExecutionError(
      .policyBlocked,
      "claude-code-agent CLI is unavailable: \(agentPreflightErrorDetail(error, fallback: "claude command timed out", additionalSensitiveValues: sensitiveValues))"
    )
  }
  guard version.terminationStatus == 0 else {
    throw AdapterExecutionError(
      .policyBlocked,
      "claude-code-agent CLI is unavailable: \(preflightFailureDetail(version, fallback: "claude command is unavailable", additionalSensitiveValues: sensitiveValues))"
    )
  }

  let authDeadline = defaultAgentPreflightDeadline(existingDeadline: deadline, timeout: defaultClaudeAuthPreflightTimeout)
  let auth: LocalAgentProcessResult
  do {
    auth = try await runner.run(
      configuration: LocalAgentProcessConfiguration(
        executableURL: URL(fileURLWithPath: "/usr/bin/env"),
        arguments: [executableName, "auth", "status"],
        environment: preflightEnvironment,
        workingDirectoryURL: input.node.workingDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) }
      ),
      stdin: "",
      deadline: authDeadline
    )
  } catch {
    throw AdapterExecutionError(
      .policyBlocked,
      "claude-code-agent authentication is unavailable: \(agentPreflightErrorDetail(error, fallback: "auth verify timed out", additionalSensitiveValues: sensitiveValues))"
    )
  }
  let combined = [auth.stderr, auth.stdout].joined(separator: "\n")
  if auth.terminationStatus != 0 || combined.range(of: #""loggedIn"\s*:\s*false"#, options: [.regularExpression]) != nil {
    throw AdapterExecutionError(
      .policyBlocked,
      "claude-code-agent authentication is unavailable: \(preflightFailureDetail(auth, fallback: "auth verify failed", additionalSensitiveValues: sensitiveValues))"
    )
  }
}

private func preflightFailureDetail(
  _ result: LocalAgentProcessResult,
  fallback: String,
  additionalSensitiveValues: [String]
) -> String {
  compactAgentReadinessMessage(
    [result.stderr, result.stdout].joined(separator: "\n"),
    fallback: fallback,
    additionalSensitiveValues: additionalSensitiveValues
  )
}

private func buildClaudePrompt(prompt: String, systemPrompt: String?, attachmentPaths: [String]) -> String {
  var parts: [String]
  if let systemPrompt, !systemPrompt.isEmpty {
    parts = ["System instruction:", systemPrompt, "", "User instruction:", prompt]
  } else {
    parts = [prompt]
  }
  if !attachmentPaths.isEmpty {
    parts.append(contentsOf: ["", "Attached files:"])
    parts.append(contentsOf: attachmentPaths.map { "- \($0)" })
  }
  return parts.joined(separator: "\n")
}

private func uniqueSortedDirectories(containing paths: [String]) -> [String] {
  let directories = Set(paths.map { URL(fileURLWithPath: $0).deletingLastPathComponent().path })
  return directories.sorted()
}

private func deduplicatedPaths(_ paths: [String]) -> [String] {
  var seen = Set<String>()
  return paths.filter { path in
    guard !path.isEmpty, !seen.contains(path) else {
      return false
    }
    seen.insert(path)
    return true
  }
}

private func stringArray(_ value: JSONValue?) -> [String] {
  guard case let .array(entries) = value else {
    return []
  }
  return entries.compactMap { entry in
    guard case let .string(text) = entry else {
      return nil
    }
    return text
  }
}

private func stringValue(_ value: JSONValue?) -> String? {
  guard case let .string(text) = value else {
    return nil
  }
  return text
}
