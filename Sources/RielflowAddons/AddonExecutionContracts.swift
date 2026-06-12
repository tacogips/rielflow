import RielflowCore

public enum AddonExecutionBoundary: String, Codable, Sendable {
  case sync
  case async
}

public enum AddonDiagnosticSeverity: String, Codable, Sendable {
  case info
  case warning
  case error
}

public struct AddonSourceMetadata: Codable, Equatable, Sendable {
  public var packageName: String?
  public var addonName: String
  public var sourcePath: String?
  public var builtin: Bool

  public init(packageName: String? = nil, addonName: String, sourcePath: String? = nil, builtin: Bool = false) {
    self.packageName = packageName
    self.addonName = addonName
    self.sourcePath = sourcePath
    self.builtin = builtin
  }
}

public struct AddonExecutionOptions: Codable, Equatable, Sendable {
  public var boundary: AddonExecutionBoundary
  public var timeoutSeconds: Int?
  public var allowCandidatePayload: Bool
  public var allowDispatchIntents: Bool

  public init(
    boundary: AddonExecutionBoundary = .async,
    timeoutSeconds: Int? = nil,
    allowCandidatePayload: Bool = true,
    allowDispatchIntents: Bool = true
  ) {
    self.boundary = boundary
    self.timeoutSeconds = timeoutSeconds
    self.allowCandidatePayload = allowCandidatePayload
    self.allowDispatchIntents = allowDispatchIntents
  }
}

public struct AddonExecutionInput: Codable, Equatable, Sendable {
  public var addonName: String
  public var version: String?
  public var nodePayload: JSONObject
  public var variables: JSONObject
  public var source: AddonSourceMetadata
  public var options: AddonExecutionOptions

  public init(
    addonName: String,
    version: String? = nil,
    nodePayload: JSONObject,
    variables: JSONObject = [:],
    source: AddonSourceMetadata,
    options: AddonExecutionOptions = .init()
  ) {
    self.addonName = addonName
    self.version = version
    self.nodePayload = nodePayload
    self.variables = variables
    self.source = source
    self.options = options
  }
}

public struct AddonDispatchIntent: Codable, Equatable, Sendable {
  public var kind: String
  public var payload: JSONObject

  public init(kind: String, payload: JSONObject) {
    self.kind = kind
    self.payload = payload
  }
}

public struct AddonDiagnostic: Codable, Equatable, Sendable {
  public var severity: AddonDiagnosticSeverity
  public var code: String
  public var message: String
  public var path: String?

  public init(severity: AddonDiagnosticSeverity, code: String, message: String, path: String? = nil) {
    self.severity = severity
    self.code = code
    self.message = message
    self.path = path
  }
}

public struct AddonExecutionOutput: Codable, Equatable, Sendable {
  public var candidatePayload: JSONObject?
  public var dispatchIntents: [AddonDispatchIntent]
  public var diagnostics: [AddonDiagnostic]

  public init(
    candidatePayload: JSONObject? = nil,
    dispatchIntents: [AddonDispatchIntent] = [],
    diagnostics: [AddonDiagnostic] = []
  ) {
    self.candidatePayload = candidatePayload
    self.dispatchIntents = dispatchIntents
    self.diagnostics = diagnostics
  }
}

public struct AddonResolveRequest: Codable, Equatable, Sendable {
  public var input: AddonExecutionInput
  public var allowedBuiltins: [String]

  public init(input: AddonExecutionInput, allowedBuiltins: [String] = []) {
    self.input = input
    self.allowedBuiltins = allowedBuiltins
  }
}

public enum AddonResolveResult: Codable, Equatable, Sendable {
  case resolved(AddonExecutionOutput)
  case failed([AddonDiagnostic])
}

public protocol AddonResolving: Sendable {
  func resolve(_ request: AddonResolveRequest) async -> AddonResolveResult
}

public struct DeterministicAddonResolver: AddonResolving {
  public init() {}

  public func resolve(_ request: AddonResolveRequest) async -> AddonResolveResult {
    if request.input.source.builtin && request.allowedBuiltins.contains(request.input.addonName) {
      return .resolved(.init(diagnostics: [
        .init(severity: .info, code: "ADDON_DECLARATIVE_ONLY", message: "add-on boundary accepted as declarative contract")
      ]))
    }
    return .failed([
      .init(
        severity: .error,
        code: "UNKNOWN_ADDON",
        message: "no add-on resolver was injected for '\(request.input.addonName)'"
      )
    ])
  }
}
