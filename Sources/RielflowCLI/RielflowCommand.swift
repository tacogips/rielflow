import Foundation
import RielflowCore

public let rielflowSwiftMigrationVersion = "0.1.17"

public enum CLIExitCode: Int32, Codable, Equatable, Sendable {
  case success = 0
  case failure = 1
  case usage = 2
}

public enum WorkflowOutputFormat: String, Codable, Sendable {
  case text
  case json
}

public enum WorkflowScope: String, Codable, Sendable {
  case auto
  case project
  case user
  case direct
}

public enum RielflowCommand: Equatable, Sendable {
  case help
  case version
  case workflow(WorkflowCommand)
  case session(SessionCommand)
}

public enum SessionCommand: Equatable, Sendable {
  case rerun(SessionRerunOptions)
  case resume(SessionResumeOptions)
}

public enum WorkflowCommand: Equatable, Sendable {
  case validate(WorkflowValidateOptions)
  case inspect(WorkflowInspectOptions)
  case usage(WorkflowInspectOptions)
  case run(WorkflowRunOptions)
}

public struct WorkflowResolutionOptions: Codable, Equatable, Sendable {
  public var workflowName: String
  public var scope: WorkflowScope
  public var workflowDefinitionDir: String?
  public var workingDirectory: String

  public init(
    workflowName: String,
    scope: WorkflowScope = .auto,
    workflowDefinitionDir: String? = nil,
    workingDirectory: String = FileManager.default.currentDirectoryPath
  ) {
    self.workflowName = workflowName
    self.scope = workflowDefinitionDir == nil ? scope : .direct
    self.workflowDefinitionDir = workflowDefinitionDir
    self.workingDirectory = workingDirectory
  }
}

public struct WorkflowValidateOptions: Equatable, Sendable {
  public var workflowName: String
  public var resolution: WorkflowResolutionOptions
  public var output: WorkflowOutputFormat
  public var executable: Bool
  public var nodePatch: String?

  public init(
    workflowName: String,
    resolution: WorkflowResolutionOptions,
    output: WorkflowOutputFormat = .text,
    executable: Bool = false,
    nodePatch: String? = nil
  ) {
    self.workflowName = workflowName
    self.resolution = resolution
    self.output = output
    self.executable = executable
    self.nodePatch = nodePatch
  }
}

public struct WorkflowInspectOptions: Equatable, Sendable {
  public var workflowName: String
  public var resolution: WorkflowResolutionOptions
  public var output: WorkflowOutputFormat
  public var structure: Bool

  public init(
    workflowName: String,
    resolution: WorkflowResolutionOptions,
    output: WorkflowOutputFormat = .text,
    structure: Bool = false
  ) {
    self.workflowName = workflowName
    self.resolution = resolution
    self.output = output
    self.structure = structure
  }
}

public struct WorkflowRunOptions: Equatable, Sendable {
  public var target: String
  public var resolution: WorkflowResolutionOptions?
  public var variables: String?
  public var nodePatch: String?
  public var mockScenarioPath: String?
  public var output: WorkflowOutputFormat
  public var maxSteps: Int?
  public var maxConcurrency: Int?
  public var maxLoopIterations: Int?
  public var defaultTimeoutMs: Int?
  public var timeoutMs: Int?
  public var artifactRoot: String?
  public var sessionStore: String?
  public var workingDirectory: String

  public init(
    target: String,
    resolution: WorkflowResolutionOptions? = nil,
    variables: String? = nil,
    nodePatch: String? = nil,
    mockScenarioPath: String? = nil,
    output: WorkflowOutputFormat = .text,
    maxSteps: Int? = nil,
    maxConcurrency: Int? = nil,
    maxLoopIterations: Int? = nil,
    defaultTimeoutMs: Int? = nil,
    timeoutMs: Int? = nil,
    artifactRoot: String? = nil,
    sessionStore: String? = nil,
    workingDirectory: String = FileManager.default.currentDirectoryPath
  ) {
    self.target = target
    self.resolution = resolution
    self.variables = variables
    self.nodePatch = nodePatch
    self.mockScenarioPath = mockScenarioPath
    self.output = output
    self.maxSteps = maxSteps
    self.maxConcurrency = maxConcurrency
    self.maxLoopIterations = maxLoopIterations
    self.defaultTimeoutMs = defaultTimeoutMs
    self.timeoutMs = timeoutMs
    self.artifactRoot = artifactRoot
    self.sessionStore = sessionStore
    self.workingDirectory = workingDirectory
  }
}

public protocol CLIArgumentParsing: Sendable {
  func parse(_ arguments: [String]) throws -> RielflowCommand
}

public struct CLIUsageError: Error, Equatable, Sendable {
  public var message: String

  public init(_ message: String) {
    self.message = message
  }
}

public struct RielflowArgumentParser: CLIArgumentParsing {
  public init() {}

  public func parse(_ arguments: [String]) throws -> RielflowCommand {
    if arguments == ["--help"] || arguments == ["-h"] || arguments == ["help"] {
      return .help
    }
    if arguments.isEmpty || arguments == ["--version"] || arguments == ["version"] {
      return .version
    }
    if arguments.first == "session" {
      return try parseSession(Array(arguments.dropFirst()))
    }
    guard arguments.first == "workflow" else {
      throw CLIUsageError("expected 'workflow' or 'session' command")
    }
    guard arguments.count >= 3 else {
      throw CLIUsageError("workflow command requires a subcommand and workflow name")
    }
    let subcommand = arguments[1]
    let target = arguments[2]
    guard !target.hasPrefix("--") else {
      throw CLIUsageError("workflow \(subcommand) requires a workflow name")
    }
    let optionTokens = Array(arguments.dropFirst(3))
    switch subcommand {
    case "validate":
      return .workflow(.validate(try parseValidate(target: target, tokens: optionTokens)))
    case "inspect":
      return .workflow(.inspect(try parseInspect(target: target, tokens: optionTokens)))
    case "usage":
      return .workflow(.usage(try parseInspect(target: target, tokens: optionTokens)))
    case "run":
      return .workflow(.run(try parseRun(target: target, tokens: optionTokens)))
    default:
      throw CLIUsageError("unsupported workflow subcommand '\(subcommand)'")
    }
  }

  private func parseSession(_ arguments: [String]) throws -> RielflowCommand {
    guard let subcommand = arguments.first else {
      throw CLIUsageError("session command requires a subcommand")
    }
    let optionTokens = Array(arguments.dropFirst(subcommand == "rerun" ? 3 : 2))
    let parsed = try ParsedWorkflowOptions(optionTokens, allowRunOptions: true)
    if parsed.endpoint != nil || parsed.fromRegistry {
      throw CLIUsageError("Swift TASK-007 supports local session commands only")
    }
    let workingDirectory = parsed.workingDirectory ?? FileManager.default.currentDirectoryPath
    switch subcommand {
    case "rerun":
      guard arguments.count >= 3, !arguments[1].hasPrefix("--"), !arguments[2].hasPrefix("--") else {
        throw CLIUsageError("usage: rielflow session rerun <session-id> <step-id> [options]")
      }
      return .session(.rerun(SessionRerunOptions(
        sessionId: arguments[1],
        stepId: arguments[2],
        output: parsed.output,
        scope: parsed.scope,
        workflowDefinitionDir: parsed.workflowDefinitionDir,
        workingDirectory: workingDirectory,
        mockScenarioPath: parsed.mockScenarioPath,
        sessionStore: parsed.sessionStore,
        nestedSuperviser: parsed.nestedSuperviser
      )))
    case "resume":
      guard arguments.count >= 2, !arguments[1].hasPrefix("--") else {
        throw CLIUsageError("usage: rielflow session resume <session-id> [options]")
      }
      return .session(.resume(SessionResumeOptions(
        sessionId: arguments[1],
        output: parsed.output,
        scope: parsed.scope,
        workflowDefinitionDir: parsed.workflowDefinitionDir,
        workingDirectory: workingDirectory,
        mockScenarioPath: parsed.mockScenarioPath,
        sessionStore: parsed.sessionStore
      )))
    default:
      throw CLIUsageError("unsupported session subcommand '\(subcommand)'")
    }
  }

  private func parseValidate(target: String, tokens: [String]) throws -> WorkflowValidateOptions {
    let parsed = try ParsedWorkflowOptions(tokens)
    try rejectUnsafeScopedWorkflowName(target, parsed: parsed)
    try rejectRemoteResolutionOptions(parsed, subcommand: "validate")
    let resolution = WorkflowResolutionOptions(
      workflowName: target,
      scope: parsed.scope,
      workflowDefinitionDir: parsed.workflowDefinitionDir,
      workingDirectory: parsed.workingDirectory ?? FileManager.default.currentDirectoryPath
    )
    return WorkflowValidateOptions(
      workflowName: target,
      resolution: resolution,
      output: parsed.output,
      executable: parsed.executable,
      nodePatch: parsed.nodePatch
    )
  }

  private func parseInspect(target: String, tokens: [String]) throws -> WorkflowInspectOptions {
    let parsed = try ParsedWorkflowOptions(tokens)
    try rejectUnsafeScopedWorkflowName(target, parsed: parsed)
    try rejectRemoteResolutionOptions(parsed, subcommand: "inspect")
    let resolution = WorkflowResolutionOptions(
      workflowName: target,
      scope: parsed.scope,
      workflowDefinitionDir: parsed.workflowDefinitionDir,
      workingDirectory: parsed.workingDirectory ?? FileManager.default.currentDirectoryPath
    )
    return WorkflowInspectOptions(
      workflowName: target,
      resolution: resolution,
      output: parsed.output,
      structure: parsed.structure
    )
  }

  private func parseRun(target: String, tokens: [String]) throws -> WorkflowRunOptions {
    let parsed = try ParsedWorkflowOptions(tokens, allowRunOptions: true)
    if parsed.endpoint != nil || parsed.fromRegistry {
      throw CLIUsageError("Swift TASK-007 supports deterministic local workflow run only")
    }
    try rejectUnsafeScopedRunTarget(target, parsed: parsed)
    let resolution = WorkflowResolutionOptions(
      workflowName: target,
      scope: parsed.scope,
      workflowDefinitionDir: parsed.workflowDefinitionDir,
      workingDirectory: parsed.workingDirectory ?? FileManager.default.currentDirectoryPath
    )
    return WorkflowRunOptions(
      target: target,
      resolution: resolution,
      variables: parsed.variables,
      nodePatch: parsed.nodePatch,
      mockScenarioPath: parsed.mockScenarioPath,
      output: parsed.output,
      maxSteps: parsed.maxSteps,
      maxConcurrency: parsed.maxConcurrency,
      maxLoopIterations: parsed.maxLoopIterations,
      defaultTimeoutMs: parsed.defaultTimeoutMs,
      timeoutMs: parsed.timeoutMs,
      artifactRoot: parsed.artifactRoot,
      sessionStore: parsed.sessionStore,
      workingDirectory: resolution.workingDirectory
    )
  }

  private func rejectRemoteResolutionOptions(_ parsed: ParsedWorkflowOptions, subcommand: String) throws {
    if parsed.endpoint != nil || parsed.fromRegistry {
      throw CLIUsageError("Swift TASK-007 supports local workflow \(subcommand) only")
    }
  }

  private func rejectUnsafeScopedWorkflowName(_ target: String, parsed: ParsedWorkflowOptions) throws {
    guard parsed.workflowDefinitionDir == nil, !isSafeScopedWorkflowName(target) else {
      return
    }
    throw CLIUsageError("invalid scoped workflow name '\(target)'; expected /^[a-zA-Z0-9][a-zA-Z0-9-_]{0,63}$/")
  }

  private func rejectUnsafeScopedRunTarget(_ target: String, parsed: ParsedWorkflowOptions) throws {
    guard parsed.workflowDefinitionDir == nil, !isTemporaryWorkflowRunTarget(target, workingDirectory: parsed.workingDirectory) else {
      return
    }
    try rejectUnsafeScopedWorkflowName(target, parsed: parsed)
  }

  private func isTemporaryWorkflowRunTarget(_ target: String, workingDirectory: String?) -> Bool {
    if target.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("{") {
      return true
    }
    let directory = URL(fileURLWithPath: workingDirectory ?? FileManager.default.currentDirectoryPath)
    let url = absoluteURL(target, relativeTo: directory)
    return FileManager.default.fileExists(atPath: url.path) && url.pathExtension == "json"
  }
}

private struct ParsedWorkflowOptions {
  var workflowDefinitionDir: String?
  var scope: WorkflowScope = .auto
  var output: WorkflowOutputFormat = .text
  var executable = false
  var structure = false
  var variables: String?
  var nodePatch: String?
  var mockScenarioPath: String?
  var maxSteps: Int?
  var maxConcurrency: Int?
  var maxLoopIterations: Int?
  var defaultTimeoutMs: Int?
  var timeoutMs: Int?
  var artifactRoot: String?
  var sessionStore: String?
  var workingDirectory: String?
  var endpoint: String?
  var fromRegistry = false
  var nestedSuperviser = false

  init(_ tokens: [String], allowRunOptions: Bool = false) throws {
    var index = 0
    while index < tokens.count {
      let token = tokens[index]
      guard token.hasPrefix("--") else {
        throw CLIUsageError("unexpected positional argument '\(token)'")
      }
      func readValue() throws -> String {
        guard index + 1 < tokens.count, !tokens[index + 1].hasPrefix("--") else {
          throw CLIUsageError("\(token) requires a value")
        }
        index += 1
        return tokens[index]
      }
      switch token {
      case "--workflow-definition-dir":
        workflowDefinitionDir = try readValue()
      case "--scope":
        let raw = try readValue()
        guard let value = WorkflowScope(rawValue: raw), value != .direct else {
          throw CLIUsageError("invalid --scope value '\(raw)'; expected auto, project, or user")
        }
        scope = value
      case "--output":
        let raw = try readValue()
        guard let value = WorkflowOutputFormat(rawValue: raw) else {
          throw CLIUsageError("invalid --output value '\(raw)'; expected text or json")
        }
        output = value
      case "--executable":
        executable = true
      case "--structure":
        structure = true
      case "--node-patch":
        nodePatch = try readValue()
      case "--variables":
        try requireRunOption(token, allowRunOptions: allowRunOptions)
        variables = try readValue()
      case "--mock-scenario":
        try requireRunOption(token, allowRunOptions: allowRunOptions)
        mockScenarioPath = try readValue()
      case "--max-steps":
        try requireRunOption(token, allowRunOptions: allowRunOptions)
        maxSteps = try positiveInt(token, readValue())
      case "--max-concurrency":
        try requireRunOption(token, allowRunOptions: allowRunOptions)
        maxConcurrency = try positiveInt(token, readValue())
      case "--max-loop-iterations":
        try requireRunOption(token, allowRunOptions: allowRunOptions)
        maxLoopIterations = try positiveInt(token, readValue())
      case "--default-timeout-ms":
        try requireRunOption(token, allowRunOptions: allowRunOptions)
        defaultTimeoutMs = try positiveInt(token, readValue())
      case "--timeout-ms":
        try requireRunOption(token, allowRunOptions: allowRunOptions)
        timeoutMs = try positiveInt(token, readValue())
      case "--artifact-root":
        try requireRunOption(token, allowRunOptions: allowRunOptions)
        artifactRoot = try readValue()
      case "--session-store":
        try requireRunOption(token, allowRunOptions: allowRunOptions)
        sessionStore = try readValue()
      case "--working-dir", "--working-directory":
        workingDirectory = try readValue()
      case "--endpoint":
        endpoint = try readValue()
      case "--from-registry":
        fromRegistry = true
      case "--nested-superviser", "--nested-supervisor":
        nestedSuperviser = true
      default:
        throw CLIUsageError("unknown option '\(token)'")
      }
      index += 1
    }
  }
}

private func requireRunOption(_ token: String, allowRunOptions: Bool) throws {
  if !allowRunOptions {
    throw CLIUsageError("\(token) is supported only by workflow run")
  }
}

private func positiveInt(_ token: String, _ raw: String) throws -> Int {
  guard let value = Int(raw), value > 0 else {
    throw CLIUsageError("\(token) requires a positive integer")
  }
  return value
}

func isSafeScopedWorkflowName(_ value: String) -> Bool {
  let scalars = Array(value.unicodeScalars)
  guard (1...64).contains(scalars.count), let first = scalars.first, isASCIIAlphaNumeric(first) else {
    return false
  }
  return scalars.allSatisfy { scalar in
    isASCIIAlphaNumeric(scalar) || scalar == "-" || scalar == "_"
  }
}

private func isASCIIAlphaNumeric(_ scalar: UnicodeScalar) -> Bool {
  let value = scalar.value
  return (48...57).contains(value) || (65...90).contains(value) || (97...122).contains(value)
}
