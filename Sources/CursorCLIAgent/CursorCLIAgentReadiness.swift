import Foundation
import RielflowAdapters
import RielflowCore

public struct CursorBackendToolVersions: Equatable, Sendable {
  public var packageVersion: String
  public var tools: [AgentBackendToolInfo]

  public init(packageVersion: String, tools: [AgentBackendToolInfo]) {
    self.packageVersion = packageVersion
    self.tools = tools
  }
}

public struct CursorBackendAuthAvailability: Equatable, Sendable {
  public var status: AgentProbeStatus
  public var detail: String

  public init(status: AgentProbeStatus, detail: String) {
    self.status = status
    self.detail = detail
  }
}

public struct CursorBackendModelReachability: Equatable, Sendable {
  public var status: AgentProbeStatus
  public var probed: Bool
  public var output: String?
  public var error: String?

  public init(status: AgentProbeStatus, probed: Bool, output: String? = nil, error: String? = nil) {
    self.status = status
    self.probed = probed
    self.output = output
    self.error = error
  }
}

public struct CursorBackendModelAvailability: Equatable, Sendable {
  public var model: String
  public var binary: AgentBackendToolInfo
  public var auth: CursorBackendAuthAvailability
  public var modelReachability: CursorBackendModelReachability

  public init(
    model: String,
    binary: AgentBackendToolInfo,
    auth: CursorBackendAuthAvailability,
    modelReachability: CursorBackendModelReachability
  ) {
    self.model = model
    self.binary = binary
    self.auth = auth
    self.modelReachability = modelReachability
  }
}

public protocol CursorCLIAgentReadinessOperations: Sendable {
  func getToolVersions(options: AgentBackendProbeOptions) async -> CursorBackendToolVersions
  func checkModelAvailability(model: String, options: AgentBackendProbeOptions) async -> CursorBackendModelAvailability
}

public enum CursorCLIAgentReadiness {
  public static func runtimeRequirement(
    candidate: AgentBackendRequirementCandidate,
    operations: any CursorCLIAgentReadinessOperations,
    options: AgentBackendProbeOptions = AgentBackendProbeOptions()
  ) async -> AgentBackendRuntimeRequirement {
    await runtimeRequirement(
      candidate: candidate,
      toolVersions: operations.getToolVersions(options: options)
    )
  }

  public static func modelValidation(
    candidate: AgentBackendPreflightCandidate,
    model: String,
    operations: any CursorCLIAgentReadinessOperations,
    options: AgentBackendProbeOptions = AgentBackendProbeOptions()
  ) async -> AgentBackendValidationResult {
    await modelValidation(
      candidate: candidate,
      availability: operations.checkModelAvailability(model: model, options: options)
    )
  }

  public static func runtimeRequirement(
    candidate: AgentBackendRequirementCandidate,
    toolVersions: CursorBackendToolVersions
  ) -> AgentBackendRuntimeRequirement {
    let cursorAgent = findToolInfo(toolVersions.tools, name: "cursor-agent")
    let commandSummary = toolVersions.tools.isEmpty
      ? formatAgentToolInfo(cursorAgent)
      : toolVersions.tools.map(formatAgentToolInfo).joined(separator: ", ")
    return AgentBackendRuntimeRequirement(
      id: "agent-backend:\(candidate.backend.rawValue)",
      label: "\(candidate.backend.rawValue) backend",
      status: agentToolIsAvailable(cursorAgent) ? .available : .unavailable,
      detail: "local SDK execution; bundled sdk=cursor-cli-agent@\(toolVersions.packageVersion); models=\(sortedAgentModelList(candidate.models)); local tools: \(commandSummary)",
      sourceStepIds: candidate.sourceStepIds
    )
  }

  public static func authValidation(candidate: AgentBackendPreflightCandidate) -> AgentBackendValidationResult {
    agentUnknownResult(candidate, "cursor-cli-agent authentication has no stable local auth-status command")
  }

  public static func modelValidation(
    candidate: AgentBackendPreflightCandidate,
    availability: CursorBackendModelAvailability
  ) -> AgentBackendValidationResult {
    let combined = [
      availability.auth.detail,
      availability.modelReachability.error,
      availability.modelReachability.output,
      availability.binary.error,
    ]
      .compactMap { $0 }
      .joined(separator: "\n")
    if availability.auth.status == .unavailable || (availability.modelReachability.status != .available && hasAuthLikeFailure(combined)) {
      return AgentBackendValidationResult(
        status: .invalid,
        message: "cursor-cli-agent model '\(availability.model)' probe reported an authentication failure: \(compactAgentReadinessMessage(combined, fallback: "auth failure"))",
        candidate: candidate
      )
    }
    if !agentToolIsAvailable(availability.binary) {
      return AgentBackendValidationResult(
        status: .invalid,
        message: "cursor-cli-agent model '\(availability.model)' is not reachable: \(availability.binary.name) is unavailable: \(compactAgentReadinessMessage(availability.binary.error, fallback: "tool unavailable"))",
        candidate: candidate
      )
    }
    if availability.modelReachability.status != .available {
      return AgentBackendValidationResult(
        status: .invalid,
        message: "cursor-cli-agent model '\(availability.model)' is not reachable: \(compactAgentReadinessMessage(availability.modelReachability.error ?? availability.modelReachability.output, fallback: "model check failed"))",
        candidate: candidate
      )
    }
    return AgentBackendValidationResult(
      status: .valid,
      message: "cursor-cli-agent model '\(availability.model)' is reachable",
      candidate: candidate
    )
  }

  private static func findToolInfo(_ tools: [AgentBackendToolInfo], name: String) -> AgentBackendToolInfo {
    tools.first { $0.name == name || $0.command == name } ??
      AgentBackendToolInfo(
        name: name,
        command: name,
        status: .unavailable,
        error: "tool was not reported by the bundled SDK"
      )
  }

  private static func hasAuthLikeFailure(_ value: String) -> Bool {
    value.range(of: #"auth|login|credential|unauthorized|permission|forbidden|expired"#, options: [.regularExpression, .caseInsensitive]) != nil
  }
}
