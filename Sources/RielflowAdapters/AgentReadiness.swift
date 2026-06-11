import Foundation
import RielflowCore

public enum AgentProbeStatus: String, Codable, Equatable, Sendable {
  case available
  case unavailable
  case unknown
  case notChecked = "not_checked"
}

public enum AgentValidationStatus: String, Codable, Equatable, Sendable {
  case valid
  case invalid
  case unknown
}

public struct AgentBackendProbeOptions: Equatable, Sendable {
  public var cwd: String?
  public var environment: [String: String]
  public var timeoutMilliseconds: Int?

  public init(cwd: String? = nil, environment: [String: String] = [:], timeoutMilliseconds: Int? = nil) {
    self.cwd = cwd
    self.environment = environment
    self.timeoutMilliseconds = timeoutMilliseconds
  }
}

public struct AgentBackendToolInfo: Codable, Equatable, Sendable {
  public var name: String
  public var command: String
  public var version: String?
  public var status: AgentProbeStatus
  public var error: String?

  public init(
    name: String,
    command: String,
    version: String? = nil,
    status: AgentProbeStatus,
    error: String? = nil
  ) {
    self.name = name
    self.command = command
    self.version = version
    self.status = status
    self.error = error
  }
}

public struct AgentBackendRequirementCandidate: Equatable, Sendable {
  public var backend: NodeExecutionBackend
  public var models: Set<String>
  public var sourceStepIds: [String]

  public init(backend: NodeExecutionBackend, models: Set<String>, sourceStepIds: [String]) {
    self.backend = backend
    self.models = models
    self.sourceStepIds = sourceStepIds
  }
}

public struct AgentBackendPreflightCandidate: Equatable, Sendable {
  public var backend: NodeExecutionBackend
  public var models: Set<String>
  public var nodeIds: [String]
  public var stepIds: [String]

  public init(backend: NodeExecutionBackend, models: Set<String>, nodeIds: [String], stepIds: [String]) {
    self.backend = backend
    self.models = models
    self.nodeIds = nodeIds
    self.stepIds = stepIds
  }
}

public struct AgentBackendRuntimeRequirement: Codable, Equatable, Sendable {
  public var id: String
  public var kind: String
  public var label: String
  public var status: AgentProbeStatus
  public var detail: String
  public var sourceStepIds: [String]

  public init(
    id: String,
    kind: String = "agent-backend",
    label: String,
    status: AgentProbeStatus,
    detail: String,
    sourceStepIds: [String]
  ) {
    self.id = id
    self.kind = kind
    self.label = label
    self.status = status
    self.detail = detail
    self.sourceStepIds = sourceStepIds
  }
}

public struct AgentBackendValidationResult: Codable, Equatable, Sendable {
  public var status: AgentValidationStatus
  public var message: String
  public var nodeId: String
  public var stepIds: [String]
  public var source: String
  public var backend: NodeExecutionBackend
  public var path: String

  public init(
    status: AgentValidationStatus,
    message: String,
    candidate: AgentBackendPreflightCandidate,
    path: String = "workflow.nodes"
  ) {
    self.status = status
    self.message = redactAdapterSensitiveText(message)
    self.nodeId = candidate.nodeIds.joined(separator: ",")
    self.stepIds = candidate.stepIds
    self.source = "agent-backend"
    self.backend = candidate.backend
    self.path = path
  }
}

public func agentToolIsAvailable(_ tool: AgentBackendToolInfo) -> Bool {
  tool.status == .available && tool.version != nil
}

public func formatAgentToolInfo(_ tool: AgentBackendToolInfo) -> String {
  if agentToolIsAvailable(tool) {
    return "\(tool.name)=\(tool.version ?? "available")"
  }
  return "\(tool.name)=\(redactAdapterSensitiveText(tool.error ?? tool.status.rawValue))"
}

public func sortedAgentModelList(_ models: Set<String>) -> String {
  models.sorted().joined(separator: ", ")
}

public func compactAgentReadinessMessage(
  _ value: String?,
  fallback: String,
  additionalSensitiveValues: [String] = []
) -> String {
  let trimmed = redactAdapterSensitiveText(
    value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
    additionalSensitiveValues: additionalSensitiveValues
  )
  guard !trimmed.isEmpty else {
    return fallback
  }
  return trimmed.split(whereSeparator: \.isNewline).first.map(String.init) ?? fallback
}

public func agentUnknownResult(_ candidate: AgentBackendPreflightCandidate, _ message: String) -> AgentBackendValidationResult {
  AgentBackendValidationResult(status: .unknown, message: message, candidate: candidate)
}

public func agentNotApplicableResult(_ candidate: AgentBackendPreflightCandidate, _ message: String) -> AgentBackendValidationResult {
  AgentBackendValidationResult(status: .valid, message: message, candidate: candidate)
}
