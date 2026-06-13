import Foundation
import CryptoKit

public struct WorkflowAddonAttachmentValue: Codable, Equatable, Sendable {
  public var id: String
  public var mediaType: String
  public var filename: String?
  public var sizeBytes: Int
  public var sha256: String
  public var contentBase64: String?
  public var contentText: String?

  public init(
    id: String,
    mediaType: String,
    filename: String? = nil,
    sizeBytes: Int,
    sha256: String,
    contentBase64: String? = nil,
    contentText: String? = nil
  ) {
    self.id = id
    self.mediaType = mediaType
    self.filename = filename
    self.sizeBytes = sizeBytes
    self.sha256 = sha256
    self.contentBase64 = contentBase64
    self.contentText = contentText
  }
}

public struct WorkflowAddonAttachmentDescriptor: Codable, Equatable, Sendable {
  public var id: String
  public var mediaType: String?
  public var filename: String?
  public var sizeBytes: Int?
  public var sha256: String?
  public var contentBase64: String?
  public var contentText: String?
  public var localPath: String?
  public var path: String?
  public var pathBase: String?
  public var contentRef: String?
  public var url: String?

  public init(
    id: String,
    mediaType: String? = nil,
    filename: String? = nil,
    sizeBytes: Int? = nil,
    sha256: String? = nil,
    contentBase64: String? = nil,
    contentText: String? = nil,
    localPath: String? = nil,
    path: String? = nil,
    pathBase: String? = nil,
    contentRef: String? = nil,
    url: String? = nil
  ) {
    self.id = id
    self.mediaType = mediaType
    self.filename = filename
    self.sizeBytes = sizeBytes
    self.sha256 = sha256
    self.contentBase64 = contentBase64
    self.contentText = contentText
    self.localPath = localPath
    self.path = path
    self.pathBase = pathBase
    self.contentRef = contentRef
    self.url = url
  }
}

public struct WorkflowAddonAttachmentProjectionRequest: Sendable {
  public var workflowId: String
  public var sessionId: String
  public var stepId: String
  public var nodeId: String
  public var addon: WorkflowNodeAddonRef
  public var preprojectedAttachments: [String: WorkflowAddonAttachmentValue]
  public var descriptors: [String: WorkflowAddonAttachmentDescriptor]

  public init(
    workflowId: String,
    sessionId: String,
    stepId: String,
    nodeId: String,
    addon: WorkflowNodeAddonRef,
    preprojectedAttachments: [String: WorkflowAddonAttachmentValue] = [:],
    descriptors: [String: WorkflowAddonAttachmentDescriptor] = [:]
  ) {
    self.workflowId = workflowId
    self.sessionId = sessionId
    self.stepId = stepId
    self.nodeId = nodeId
    self.addon = addon
    self.preprojectedAttachments = preprojectedAttachments
    self.descriptors = descriptors
  }
}

public protocol WorkflowAddonAttachmentProjecting: Sendable {
  func project(_ request: WorkflowAddonAttachmentProjectionRequest) async throws -> [String: WorkflowAddonAttachmentValue]
}

public enum WorkflowAddonAttachmentProjectionError: Error, Equatable, Sendable {
  case duplicateAttachmentField(String)
  case metadataOnly(String)
  case unsupported(String, String)
  case malformedHash(String)
  case hashMismatch(String)
  case sizeMismatch(String)
  case tooLarge(String, Int, Int)

  public var adapterError: AdapterExecutionError {
    switch self {
    case let .duplicateAttachmentField(field):
      AdapterExecutionError(.policyBlocked, "native_attachment_duplicate: attachment input '\(field)' was supplied by more than one source")
    case let .metadataOnly(field):
      AdapterExecutionError(.policyBlocked, "native_attachment_metadata_only: attachment input '\(field)' did not contain bounded inline content")
    case let .unsupported(field, reason):
      AdapterExecutionError(.policyBlocked, "native_attachment_unsupported: attachment input '\(field)' \(reason)")
    case let .malformedHash(field):
      AdapterExecutionError(.policyBlocked, "native_attachment_hash_malformed: attachment input '\(field)' sha256 was malformed")
    case let .hashMismatch(field):
      AdapterExecutionError(.policyBlocked, "native_attachment_hash_mismatch: attachment input '\(field)' sha256 did not match content bytes")
    case let .sizeMismatch(field):
      AdapterExecutionError(.policyBlocked, "native_attachment_size_mismatch: attachment input '\(field)' sizeBytes did not match content bytes")
    case let .tooLarge(field, size, maxSize):
      AdapterExecutionError(.policyBlocked, "native_attachment_too_large: attachment input '\(field)' was \(size) bytes, max \(maxSize)")
    }
  }
}

public struct InlineWorkflowAddonAttachmentProjector: WorkflowAddonAttachmentProjecting {
  public static let maxAttachmentBytes = 8 * 1024 * 1024

  public init() {}

  public func project(_ request: WorkflowAddonAttachmentProjectionRequest) async throws -> [String: WorkflowAddonAttachmentValue] {
    let duplicateFields = Set(request.preprojectedAttachments.keys).intersection(request.descriptors.keys)
    if let duplicateField = duplicateFields.sorted().first {
      throw WorkflowAddonAttachmentProjectionError.duplicateAttachmentField(duplicateField)
    }

    var projected = request.preprojectedAttachments
    for (field, descriptor) in request.descriptors {
      projected[field] = try project(descriptor, field: field)
    }
    return projected
  }

  private func project(_ descriptor: WorkflowAddonAttachmentDescriptor, field: String) throws -> WorkflowAddonAttachmentValue {
    if descriptor.localPath != nil || descriptor.path != nil || descriptor.pathBase != nil
      || descriptor.contentRef != nil || descriptor.url != nil
    {
      throw WorkflowAddonAttachmentProjectionError.metadataOnly(field)
    }
    guard !descriptor.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw WorkflowAddonAttachmentProjectionError.unsupported(field, "requires id")
    }
    let mediaType = descriptor.mediaType?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let mediaType, !mediaType.isEmpty else {
      throw WorkflowAddonAttachmentProjectionError.unsupported(field, "requires mediaType")
    }

    let content: ProjectedAttachmentContent
    switch (descriptor.contentBase64, descriptor.contentText) {
    case let (.some(base64), nil):
      guard let data = Data(base64Encoded: base64) else {
        throw WorkflowAddonAttachmentProjectionError.unsupported(field, "has malformed contentBase64")
      }
      content = .base64(base64, data)
    case let (nil, .some(text)):
      content = .text(text, Data(text.utf8))
    default:
      throw WorkflowAddonAttachmentProjectionError.metadataOnly(field)
    }

    guard content.data.count <= Self.maxAttachmentBytes else {
      throw WorkflowAddonAttachmentProjectionError.tooLarge(field, content.data.count, Self.maxAttachmentBytes)
    }

    if let expectedSize = descriptor.sizeBytes, expectedSize != content.data.count {
      throw WorkflowAddonAttachmentProjectionError.sizeMismatch(field)
    }
    let digest = sha256Digest(for: content.data)
    if let expectedDigest = descriptor.sha256 {
      guard isValidSHA256Digest(expectedDigest) else {
        throw WorkflowAddonAttachmentProjectionError.malformedHash(field)
      }
      guard expectedDigest == digest else {
        throw WorkflowAddonAttachmentProjectionError.hashMismatch(field)
      }
    }

    return WorkflowAddonAttachmentValue(
      id: descriptor.id,
      mediaType: mediaType,
      filename: descriptor.filename,
      sizeBytes: content.data.count,
      sha256: descriptor.sha256 ?? digest,
      contentBase64: content.base64,
      contentText: content.text
    )
  }
}

private enum ProjectedAttachmentContent {
  case base64(String, Data)
  case text(String, Data)

  var data: Data {
    switch self {
    case let .base64(_, data), let .text(_, data):
      data
    }
  }

  var base64: String? {
    switch self {
    case let .base64(base64, _):
      base64
    case .text:
      nil
    }
  }

  var text: String? {
    switch self {
    case .base64:
      nil
    case let .text(text, _):
      text
    }
  }
}

public struct WorkflowAddonExecutionInput: Codable, Equatable, Sendable {
  public var workflowId: String
  public var stepId: String
  public var nodeId: String
  public var addon: WorkflowNodeAddonRef
  public var variables: JSONObject
  public var resolvedInputPayload: JSONObject
  public var attachments: [String: WorkflowAddonAttachmentValue]

  public init(
    workflowId: String,
    stepId: String,
    nodeId: String,
    addon: WorkflowNodeAddonRef,
    variables: JSONObject = [:],
    resolvedInputPayload: JSONObject = [:],
    attachments: [String: WorkflowAddonAttachmentValue] = [:]
  ) {
    self.workflowId = workflowId
    self.stepId = stepId
    self.nodeId = nodeId
    self.addon = addon
    self.variables = variables
    self.resolvedInputPayload = resolvedInputPayload
    self.attachments = attachments
  }

  private enum CodingKeys: String, CodingKey {
    case workflowId
    case stepId
    case nodeId
    case addon
    case variables
    case resolvedInputPayload
    case attachments
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.workflowId = try container.decode(String.self, forKey: .workflowId)
    self.stepId = try container.decode(String.self, forKey: .stepId)
    self.nodeId = try container.decode(String.self, forKey: .nodeId)
    self.addon = try container.decode(WorkflowNodeAddonRef.self, forKey: .addon)
    self.variables = try container.decodeIfPresent(JSONObject.self, forKey: .variables) ?? [:]
    self.resolvedInputPayload = try container.decodeIfPresent(JSONObject.self, forKey: .resolvedInputPayload) ?? [:]
    self.attachments = try container.decodeIfPresent([String: WorkflowAddonAttachmentValue].self, forKey: .attachments) ?? [:]
  }
}

private func isValidSHA256Digest(_ digest: String) -> Bool {
  digest.range(of: #"^sha256:[0-9a-f]{64}$"#, options: .regularExpression) != nil
}

private func sha256Digest(for data: Data) -> String {
  let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  return "sha256:\(hash)"
}

public protocol WorkflowAddonResolving: Sendable {
  func execute(_ input: WorkflowAddonExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput
}
