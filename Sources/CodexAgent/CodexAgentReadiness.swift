import Foundation
import RielflowAdapters
import RielflowCore

public struct CodexBackendToolVersions: Equatable, Sendable {
  public var codex: AgentBackendToolInfo
  public var git: AgentBackendToolInfo

  public init(codex: AgentBackendToolInfo, git: AgentBackendToolInfo) {
    self.codex = codex
    self.git = git
  }
}

public struct CodexBackendLoginStatus: Equatable, Sendable {
  public var ok: Bool
  public var status: String?
  public var error: String?
  public var exitCode: Int?

  public init(ok: Bool, status: String? = nil, error: String? = nil, exitCode: Int? = nil) {
    self.ok = ok
    self.status = status
    self.error = error
    self.exitCode = exitCode
  }
}

public struct CodexBackendModelProbe: Equatable, Sendable {
  public var ok: Bool
  public var model: String
  public var output: String?
  public var error: String?
  public var exitCode: Int?

  public init(ok: Bool, model: String, output: String? = nil, error: String? = nil, exitCode: Int? = nil) {
    self.ok = ok
    self.model = model
    self.output = output
    self.error = error
    self.exitCode = exitCode
  }
}

public struct CodexBackendModelAvailability: Equatable, Sendable {
  public var ok: Bool
  public var model: String
  public var auth: CodexBackendLoginStatus
  public var probe: CodexBackendModelProbe

  public init(ok: Bool, model: String, auth: CodexBackendLoginStatus, probe: CodexBackendModelProbe) {
    self.ok = ok
    self.model = model
    self.auth = auth
    self.probe = probe
  }
}

public protocol CodexAgentReadinessOperations: Sendable {
  func getToolVersions(options: AgentBackendProbeOptions) async -> CodexBackendToolVersions
  func getLoginStatus(options: AgentBackendProbeOptions) async -> CodexBackendLoginStatus
  func checkModelAvailability(model: String, options: AgentBackendProbeOptions) async -> CodexBackendModelAvailability
}

public enum CodexAgentReadiness {
  public static func runtimeRequirement(
    candidate: AgentBackendRequirementCandidate,
    operations: any CodexAgentReadinessOperations,
    options: AgentBackendProbeOptions = AgentBackendProbeOptions()
  ) async -> AgentBackendRuntimeRequirement {
    await runtimeRequirement(
      candidate: candidate,
      toolVersions: operations.getToolVersions(options: options)
    )
  }

  public static func authValidation(
    candidate: AgentBackendPreflightCandidate,
    operations: any CodexAgentReadinessOperations,
    options: AgentBackendProbeOptions = AgentBackendProbeOptions()
  ) async -> AgentBackendValidationResult {
    await authValidation(candidate: candidate, status: operations.getLoginStatus(options: options))
  }

  public static func modelValidation(
    candidate: AgentBackendPreflightCandidate,
    model: String,
    operations: any CodexAgentReadinessOperations,
    options: AgentBackendProbeOptions = AgentBackendProbeOptions()
  ) async -> AgentBackendValidationResult {
    await modelValidation(
      candidate: candidate,
      availability: operations.checkModelAvailability(model: model, options: options)
    )
  }

  public static func runtimeRequirement(
    candidate: AgentBackendRequirementCandidate,
    toolVersions: CodexBackendToolVersions
  ) -> AgentBackendRuntimeRequirement {
    let commandSummary = [formatAgentToolInfo(toolVersions.codex), formatAgentToolInfo(toolVersions.git)].joined(separator: ", ")
    return AgentBackendRuntimeRequirement(
      id: "agent-backend:\(candidate.backend.rawValue)",
      label: "\(candidate.backend.rawValue) backend",
      status: agentToolIsAvailable(toolVersions.codex) && agentToolIsAvailable(toolVersions.git) ? .available : .unavailable,
      detail: "local SDK execution; bundled sdk=codex-agent; models=\(sortedAgentModelList(candidate.models)); local tools: \(commandSummary)",
      sourceStepIds: candidate.sourceStepIds
    )
  }

  public static func authValidation(
    candidate: AgentBackendPreflightCandidate,
    status: CodexBackendLoginStatus
  ) -> AgentBackendValidationResult {
    AgentBackendValidationResult(
      status: status.ok ? .valid : .invalid,
      message: status.ok
        ? "codex-agent authentication status is valid"
        : "codex-agent authentication is unavailable: \(compactAgentReadinessMessage(status.error ?? status.status, fallback: "codex login status failed"))",
      candidate: candidate
    )
  }

  public static func accountReadinessValidation(
    candidate: AgentBackendPreflightCandidate,
    availability: CodexBackendModelAvailability?
  ) -> AgentBackendValidationResult {
    guard let availability else {
      return agentUnknownResult(candidate, "codex-agent account readiness could not be verified because no model is authored")
    }
    guard availability.ok else {
      return AgentBackendValidationResult(
        status: .invalid,
        message: "codex-agent account is not usable for model '\(availability.model)': \(compactAgentReadinessMessage(availability.probe.error ?? availability.auth.error ?? availability.probe.output, fallback: "model check failed"))",
        candidate: candidate
      )
    }
    return AgentBackendValidationResult(
      status: .valid,
      message: "codex-agent account readiness is valid for model '\(availability.model)'",
      candidate: candidate
    )
  }

  public static func modelValidation(
    candidate: AgentBackendPreflightCandidate,
    availability: CodexBackendModelAvailability
  ) -> AgentBackendValidationResult {
    guard availability.ok else {
      return AgentBackendValidationResult(
        status: .invalid,
        message: "codex-agent model '\(availability.model)' is not reachable: \(compactAgentReadinessMessage(availability.probe.error ?? availability.auth.error ?? availability.probe.output, fallback: "model check failed"))",
        candidate: candidate
      )
    }
    return AgentBackendValidationResult(
      status: .valid,
      message: "codex-agent model '\(availability.model)' is reachable",
      candidate: candidate
    )
  }
}
