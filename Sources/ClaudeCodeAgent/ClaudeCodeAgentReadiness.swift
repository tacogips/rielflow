import Foundation
import RielflowAdapters
import RielflowCore

public enum ClaudeBackendAuthState: String, Equatable, Sendable {
  case missing
  case expired
  case configured
}

public struct ClaudeBackendAuthReadiness: Equatable, Sendable {
  public var state: ClaudeBackendAuthState
  public var available: Bool
  public var verified: Bool
  public var message: String?

  public init(state: ClaudeBackendAuthState, available: Bool, verified: Bool, message: String? = nil) {
    self.state = state
    self.available = available
    self.verified = verified
    self.message = message
  }
}

public struct ClaudeBackendCliReadiness: Equatable, Sendable {
  public var checked: Bool
  public var available: Bool
  public var command: String
  public var exitCode: Int?
  public var message: String?

  public init(checked: Bool, available: Bool, command: String = "claude", exitCode: Int? = nil, message: String? = nil) {
    self.checked = checked
    self.available = available
    self.command = command
    self.exitCode = exitCode
    self.message = message
  }
}

public struct ClaudeBackendModelReadiness: Equatable, Sendable {
  public var requested: String?
  public var checked: Bool
  public var available: Bool
  public var timedOut: Bool
  public var exitCode: Int?
  public var message: String?

  public init(requested: String?, checked: Bool, available: Bool, timedOut: Bool, exitCode: Int? = nil, message: String? = nil) {
    self.requested = requested
    self.checked = checked
    self.available = available
    self.timedOut = timedOut
    self.exitCode = exitCode
    self.message = message
  }
}

public struct ClaudeBackendReadiness: Equatable, Sendable {
  public var ready: Bool
  public var auth: ClaudeBackendAuthReadiness
  public var cli: ClaudeBackendCliReadiness
  public var model: ClaudeBackendModelReadiness

  public init(
    ready: Bool,
    auth: ClaudeBackendAuthReadiness,
    cli: ClaudeBackendCliReadiness,
    model: ClaudeBackendModelReadiness
  ) {
    self.ready = ready
    self.auth = auth
    self.cli = cli
    self.model = model
  }
}

public protocol ClaudeCodeAgentReadinessOperations: Sendable {
  func getToolVersion(options: AgentBackendProbeOptions) async -> AgentBackendToolInfo
  func verifyReadiness(model: String?, options: AgentBackendProbeOptions) async -> ClaudeBackendReadiness
}

public enum ClaudeCodeAgentReadiness {
  public static func runtimeRequirement(
    candidate: AgentBackendRequirementCandidate,
    operations: any ClaudeCodeAgentReadinessOperations,
    options: AgentBackendProbeOptions = AgentBackendProbeOptions()
  ) async -> AgentBackendRuntimeRequirement {
    await runtimeRequirement(
      candidate: candidate,
      tool: operations.getToolVersion(options: options)
    )
  }

  public static func authValidation(
    candidate: AgentBackendPreflightCandidate,
    operations: any ClaudeCodeAgentReadinessOperations,
    options: AgentBackendProbeOptions = AgentBackendProbeOptions()
  ) async -> AgentBackendValidationResult {
    await authValidation(
      candidate: candidate,
      readiness: operations.verifyReadiness(model: nil, options: options)
    )
  }

  public static func modelValidation(
    candidate: AgentBackendPreflightCandidate,
    model: String,
    operations: any ClaudeCodeAgentReadinessOperations,
    options: AgentBackendProbeOptions = AgentBackendProbeOptions()
  ) async -> AgentBackendValidationResult {
    await modelValidation(
      candidate: candidate,
      model: model,
      readiness: operations.verifyReadiness(model: model, options: options)
    )
  }

  public static func runtimeRequirement(
    candidate: AgentBackendRequirementCandidate,
    tool: AgentBackendToolInfo
  ) -> AgentBackendRuntimeRequirement {
    AgentBackendRuntimeRequirement(
      id: "agent-backend:\(candidate.backend.rawValue)",
      label: "\(candidate.backend.rawValue) backend",
      status: agentToolIsAvailable(tool) ? .available : .unavailable,
      detail: "local SDK execution; bundled sdk=claude-code-agent; models=\(sortedAgentModelList(candidate.models)); local tools: \(formatAgentToolInfo(tool))",
      sourceStepIds: candidate.sourceStepIds
    )
  }

  public static func authValidation(
    candidate: AgentBackendPreflightCandidate,
    readiness: ClaudeBackendReadiness
  ) -> AgentBackendValidationResult {
    AgentBackendValidationResult(
      status: readiness.auth.available ? .valid : .invalid,
      message: readiness.auth.available
        ? "claude-code-agent authentication is valid"
        : "claude-code-agent authentication is unavailable: \(compactAgentReadinessMessage(readiness.auth.message, fallback: "auth verify failed"))",
      candidate: candidate
    )
  }

  public static func modelValidation(
    candidate: AgentBackendPreflightCandidate,
    model: String,
    readiness: ClaudeBackendReadiness
  ) -> AgentBackendValidationResult {
    if readiness.ready && readiness.model.available {
      return AgentBackendValidationResult(
        status: .valid,
        message: "claude-code-agent model '\(model)' is reachable",
        candidate: candidate
      )
    }
    if !readiness.auth.available {
      return AgentBackendValidationResult(
        status: .invalid,
        message: "claude-code-agent model '\(model)' probe reported an authentication failure: \(compactAgentReadinessMessage(readiness.auth.message, fallback: "auth failure"))",
        candidate: candidate
      )
    }
    if !readiness.cli.available {
      return AgentBackendValidationResult(
        status: .invalid,
        message: "claude-code-agent model '\(model)' is not reachable: \(readiness.cli.command) is unavailable: \(compactAgentReadinessMessage(readiness.cli.message, fallback: "tool unavailable"))",
        candidate: candidate
      )
    }
    return AgentBackendValidationResult(
      status: .invalid,
      message: "claude-code-agent model '\(model)' is not reachable: \(compactAgentReadinessMessage(readiness.model.message, fallback: "model check failed"))",
      candidate: candidate
    )
  }
}
