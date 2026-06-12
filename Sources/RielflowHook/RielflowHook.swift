import RielflowCore

public enum HookVendor: String, Codable, CaseIterable, Sendable {
  case claudeCode = "claude-code"
  case codex
  case gemini
}

public struct HookContext: Codable, Equatable, Sendable {
  public var vendor: HookVendor
  public var eventName: String
  public var agentSessionId: String
  public var agentBackend: String?
  public var workingDirectory: String
  public var transcriptPath: String?
  public var model: String?
  public var backendMetadata: JSONObject

  private enum CodingKeys: String, CodingKey {
    case vendor
    case eventName
    case agentSessionId
    case agentBackend
    case workingDirectory
    case transcriptPath
    case model
    case backendMetadata
  }

  public init(
    vendor: HookVendor = .codex,
    eventName: String = "unknown",
    agentSessionId: String,
    agentBackend: String? = nil,
    workingDirectory: String = "",
    transcriptPath: String? = nil,
    model: String? = nil,
    backendMetadata: JSONObject = [:]
  ) {
    self.vendor = vendor
    self.eventName = eventName
    self.agentSessionId = agentSessionId
    self.agentBackend = agentBackend
    self.workingDirectory = workingDirectory
    self.transcriptPath = transcriptPath
    self.model = model
    self.backendMetadata = backendMetadata
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.vendor = try container.decodeIfPresent(HookVendor.self, forKey: .vendor) ?? .codex
    self.eventName = try container.decodeIfPresent(String.self, forKey: .eventName) ?? "unknown"
    self.agentSessionId = try container.decode(String.self, forKey: .agentSessionId)
    self.agentBackend = try container.decodeIfPresent(String.self, forKey: .agentBackend)
    self.workingDirectory = try container.decodeIfPresent(String.self, forKey: .workingDirectory) ?? ""
    self.transcriptPath = try container.decodeIfPresent(String.self, forKey: .transcriptPath)
    self.model = try container.decodeIfPresent(String.self, forKey: .model)
    self.backendMetadata = try container.decodeIfPresent(JSONObject.self, forKey: .backendMetadata) ?? [:]
  }
}
