import Foundation
import RielflowAdapters
import RielflowCore

private let defaultCursorAuthPreflightTimeout: TimeInterval = 30

public enum CursorCLIMode: String, Sendable {
  case `default`
  case plan
  case ask
}

public struct CursorCLIAgentCommandBuilder: LocalAgentCommandBuilding {
  public var executableName: String
  public var mode: CursorCLIMode?
  public var environment: [String: String]
  public var additionalArguments: [String]

  public var provider: String { CliAgentBackend.cursorCliAgent.rawValue }

  public init(
    executableName: String = "cursor-agent",
    mode: CursorCLIMode? = nil,
    environment: [String: String] = [:],
    additionalArguments: [String] = []
  ) {
    self.executableName = executableName
    self.mode = mode
    self.environment = environment
    self.additionalArguments = additionalArguments
  }

  public func buildCommand(for input: AdapterExecutionInput) throws -> LocalAgentCommand {
    let cliModel = CursorCLIAgentEffortResolution.resolveModelForEffort(
      model: input.node.model,
      effort: input.node.effort
    )
    var arguments = [executableName, "--print", "--output-format", "stream-json", "--model", cliModel]
    let resolvedMode = mode ?? stringValue(input.node.variables["cursorMode"]).flatMap(CursorCLIMode.init(rawValue:))
    if let resolvedMode, resolvedMode != .default {
      arguments.append(contentsOf: ["--mode", resolvedMode.rawValue])
    }

    for imagePath in resolveAdapterImagePaths(input) {
      arguments.append(contentsOf: ["--image", imagePath])
    }

    arguments.append(contentsOf: additionalArguments)
    arguments.append(contentsOf: stringArray(input.node.variables["cursorAdditionalArgs"]))
    arguments.append(contentsOf: ["--", buildCombinedPromptText(promptText: input.promptText, systemPromptText: input.systemPromptText)])

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
      stdin: "",
      normalizeStdout: normalizeCursorStreamJSONStdout
    )
  }
}

public struct CursorCLIAgentAdapter: NodeAdapter {
  private let adapter: LocalAgentCommandAdapter
  private let executableName: String
  private let runner: any LocalAgentProcessRunning
  private let environment: [String: String]
  private let authPreflight: Bool
  private let checkAuthPreflight: (@Sendable (AdapterExecutionInput) async throws -> Void)?

  public init(
    executableName: String = "cursor-agent",
    runner: any LocalAgentProcessRunning = FoundationLocalAgentProcessRunner(),
    mode: CursorCLIMode? = nil,
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
      commandBuilder: CursorCLIAgentCommandBuilder(
        executableName: executableName,
        mode: mode,
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
          throw AdapterExecutionError(.policyBlocked, "cursor-cli-agent authentication is unavailable: \(redactAdapterSensitiveText(error.localizedDescription))")
        }
      } else {
        try await runCursorDefaultAuthPreflight(input: input, executableName: executableName, environment: environment, runner: runner, deadline: context.deadline)
      }
    }
    return try await adapter.execute(input, context: context)
  }
}

private func runCursorDefaultAuthPreflight(
  input: AdapterExecutionInput,
  executableName: String,
  environment: [String: String],
  runner: any LocalAgentProcessRunning,
  deadline: Date?
) async throws {
  var preflightEnvironment = environment
  preflightEnvironment["RIEL_AGENT_BACKEND"] = CliAgentBackend.cursorCliAgent.rawValue
  let sensitiveValues = sensitiveAdapterEnvironmentValues(preflightEnvironment)
  let versionDeadline = defaultAgentPreflightDeadline(existingDeadline: deadline, timeout: defaultCursorAuthPreflightTimeout)
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
      "cursor-cli-agent CLI is unavailable: \(agentPreflightErrorDetail(error, fallback: "cursor-agent command timed out", additionalSensitiveValues: sensitiveValues))"
    )
  }
  guard version.terminationStatus == 0 else {
    throw AdapterExecutionError(
      .policyBlocked,
      "cursor-cli-agent CLI is unavailable: \(preflightFailureDetail(version, fallback: "cursor-agent command is unavailable", additionalSensitiveValues: sensitiveValues))"
    )
  }

  let modelDeadline = defaultAgentPreflightDeadline(existingDeadline: deadline, timeout: defaultCursorAuthPreflightTimeout)
  let preflightModel = CursorCLIAgentEffortResolution.resolveModelForEffort(
    model: input.node.model,
    effort: input.node.effort
  )
  let model: LocalAgentProcessResult
  do {
    model = try await runner.run(
      configuration: LocalAgentProcessConfiguration(
        executableURL: URL(fileURLWithPath: "/usr/bin/env"),
        arguments: [executableName, "--print", "--output-format", "text", "--model", preflightModel, "--", "Reply with exactly OK."],
        environment: preflightEnvironment,
        workingDirectoryURL: input.node.workingDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) }
      ),
      stdin: "",
      deadline: modelDeadline
    )
  } catch {
    throw AdapterExecutionError(
      .policyBlocked,
      "cursor-cli-agent model '\(preflightModel)' is unavailable: \(agentPreflightErrorDetail(error, fallback: "model probe timed out", additionalSensitiveValues: sensitiveValues))"
    )
  }
  let combined = [model.stderr, model.stdout].joined(separator: "\n")
  if model.terminationStatus != 0 {
    let authPrefix = hasCursorAuthFailureText(combined)
      ? "cursor-cli-agent authentication is unavailable"
      : "cursor-cli-agent model '\(preflightModel)' is unavailable"
    throw AdapterExecutionError(
      .policyBlocked,
      "\(authPrefix): \(preflightFailureDetail(model, fallback: "model probe failed", additionalSensitiveValues: sensitiveValues))"
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

private func hasCursorAuthFailureText(_ text: String) -> Bool {
  text.range(of: #"auth|login|credential|unauthorized|permission|forbidden|expired"#, options: [.regularExpression, .caseInsensitive]) != nil
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

private func objectValue(_ value: JSONValue?) -> JSONObject? {
  guard case let .object(object) = value else {
    return nil
  }
  return object
}

private func normalizeCursorStreamJSONStdout(_ text: String) -> String {
  let lines = text
    .split(whereSeparator: \.isNewline)
    .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
  guard !lines.isEmpty else {
    return text
  }

  var containsCursorEvent = false
  var responseText = ""
  var completedResult = ""

  for line in lines {
    guard
      let data = line.data(using: .utf8),
      let decoded = try? JSONDecoder().decode(JSONValue.self, from: data),
      case let .object(object) = decoded
    else {
      return text
    }

    switch stringValue(object["type"]) {
    case "session.started", "session.pending", "session.materialized", "session.user_message", "session.thinking", "session.assistant_message", "session.completed", "session.error":
      containsCursorEvent = true
    default:
      continue
    }

    if let assistantText = cursorAssistantText(from: object) {
      responseText = assistantText
    }
    if stringValue(object["type"]) == "session.completed", let result = stringValue(object["result"]), !result.isEmpty {
      completedResult = result
    }
  }

  guard containsCursorEvent else {
    return text
  }
  if !responseText.isEmpty {
    return responseText
  }
  return completedResult
}

private func cursorAssistantText(from object: JSONObject) -> String? {
  guard stringValue(object["type"]) == "session.assistant_message", let message = objectValue(object["message"]) else {
    return nil
  }
  if let displayText = stringValue(message["displayText"]), !displayText.isEmpty {
    return displayText
  }
  if let rawText = stringValue(message["rawText"]), !rawText.isEmpty {
    return rawText
  }
  return nil
}
