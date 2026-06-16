import Foundation
import CryptoKit
import RielflowCore

public struct NativeBundleAddonRegistration: Equatable, Sendable {
  public var packageName: String
  public var addonName: String
  public var version: String
  public var sourceScope: String
  public var packageInstallId: String
  public var bundleURL: URL
  public var bundleIdentifier: String
  public var abiVersion: Int
  public var contentDigest: String
  public var dependencyClosureDigest: String
  public var codeSignatureRequirement: NativeBundleCodeSignatureRequirement?
  public var codeSignatureRequirementDigest: String?
  public var allowCandidatePayload: Bool
  public var allowDispatchIntents: Bool
  public var attachmentReadInputFields: [String]

  public init(
    packageName: String,
    addonName: String,
    version: String,
    sourceScope: String = "project",
    packageInstallId: String = "",
    bundleURL: URL,
    bundleIdentifier: String,
    abiVersion: Int = 1,
    contentDigest: String,
    dependencyClosureDigest: String = "",
    codeSignatureRequirement: NativeBundleCodeSignatureRequirement? = nil,
    codeSignatureRequirementDigest: String? = nil,
    allowCandidatePayload: Bool = true,
    allowDispatchIntents: Bool = false,
    attachmentReadInputFields: [String] = []
  ) {
    self.packageName = packageName
    self.addonName = addonName
    self.version = version
    self.sourceScope = sourceScope
    self.packageInstallId = packageInstallId
    self.bundleURL = bundleURL
    self.bundleIdentifier = bundleIdentifier
    self.abiVersion = abiVersion
    self.contentDigest = contentDigest
    self.dependencyClosureDigest = dependencyClosureDigest
    self.codeSignatureRequirement = codeSignatureRequirement
    self.codeSignatureRequirementDigest = codeSignatureRequirementDigest
    self.allowCandidatePayload = allowCandidatePayload
    self.allowDispatchIntents = allowDispatchIntents
    self.attachmentReadInputFields = attachmentReadInputFields
  }

  public var cacheKey: NativeBundleCacheKey {
    NativeBundleCacheKey(
      sourceScope: sourceScope,
      packageName: packageName,
      packageInstallId: packageInstallId,
      addonName: addonName,
      addonVersion: version,
      bundleIdentifier: bundleIdentifier,
      abiVersion: abiVersion,
      contentDigest: contentDigest,
      dependencyClosureDigest: dependencyClosureDigest,
      signingRequirementDigest: codeSignatureRequirementDigest ?? ""
    )
  }
}

public struct NativeBundleAddonResolver: AddonResolving {
  private let registrations: [NativeBundleAddonRegistration]
  private let loader: any NativeBundlePluginLoading

  public init(registrations: [NativeBundleAddonRegistration], loader: any NativeBundlePluginLoading) {
    self.registrations = registrations
    self.loader = loader
  }

  public func resolve(_ request: AddonResolveRequest) async -> AddonResolveResult {
    let selectedRegistration: NativeBundleAddonRegistration
    switch registration(matching: request) {
    case let .selected(registration):
      selectedRegistration = registration
    case .builtin:
      return .failed([
        .init(
          severity: .error,
          code: "BUILTIN_NATIVE_BUNDLE_ADDON_DENIED",
          message: "built-in add-on names are not loadable native-bundle registrations"
        )
      ])
    case .duplicate:
      return .failed([
        .init(
          severity: .error,
          code: "DUPLICATE_NATIVE_BUNDLE_ADDON",
          message: "native-bundle add-on '\(request.input.addonName)' matched multiple installed registrations; use a package-qualified add-on reference or exact dependency lock"
        )
      ])
    case .unknown:
      return .failed([
        .init(severity: .error, code: "UNKNOWN_NATIVE_BUNDLE_ADDON", message: "no native-bundle registration matched '\(request.input.addonName)'")
      ])
    }

    let nodePayload: JSONObject
    switch nativeNodePayloadByProjectingAttachments(request.input.nodePayload, request: request, registration: selectedRegistration) {
    case let .success(projectedPayload):
      nodePayload = projectedPayload
    case let .failure(diagnostics):
      return .failed(diagnostics)
    }

    let handle: any NativeBundlePluginHandle
    do {
      handle = try await loader.loadPlugin(for: selectedRegistration)
    } catch {
      return .failed([
        .init(severity: .error, code: "NATIVE_BUNDLE_LOAD_FAILED", message: "failed to load native-bundle add-on '\(selectedRegistration.addonName)': \(error)")
      ])
    }

    let descriptor: NativeBundleAddonDescriptor
    do {
      descriptor = try await handle.loadDescriptor()
    } catch {
      return .failed([
        .init(severity: .error, code: "NATIVE_BUNDLE_DESCRIPTOR_FAILED", message: "failed to read native-bundle descriptor for '\(selectedRegistration.addonName)': \(error)")
      ])
    }
    if let diagnostic = validate(descriptor: descriptor, registration: selectedRegistration, request: request) {
      return .failed([diagnostic])
    }

    let envelope = NativeBundleInvocationEnvelope(
      addonName: request.input.addonName,
      version: request.input.version,
      nodePayload: nodePayload,
      source: request.input.source,
      options: .init(
        boundary: request.input.options.boundary,
        timeoutSeconds: request.input.options.timeoutSeconds,
        allowCandidatePayload: selectedRegistration.allowCandidatePayload && request.input.options.allowCandidatePayload,
        allowDispatchIntents: selectedRegistration.allowDispatchIntents
      )
    )

    let output: AddonExecutionOutput
    do {
      output = try await handle.execute(envelope)
    } catch {
      return .failed([
        .init(severity: .error, code: "NATIVE_BUNDLE_EXECUTION_FAILED", message: "native-bundle add-on '\(selectedRegistration.addonName)' failed: \(error)")
      ])
    }

    var diagnostics = output.diagnostics
    if output.candidatePayload != nil, !selectedRegistration.allowCandidatePayload {
      diagnostics.append(.init(severity: .error, code: "NATIVE_CANDIDATE_PAYLOAD_DENIED", message: "native-bundle add-on '\(selectedRegistration.addonName)' returned a candidate payload without permission"))
    }
    if !output.dispatchIntents.isEmpty, !selectedRegistration.allowDispatchIntents {
      diagnostics.append(.init(severity: .error, code: "NATIVE_DISPATCH_INTENT_DENIED", message: "native-bundle add-on '\(selectedRegistration.addonName)' returned dispatch intents without permission"))
    }
    if diagnostics.contains(where: { $0.severity == .error }) {
      return .failed(diagnostics)
    }
    return .resolved(output)
  }

  private func registration(matching request: AddonResolveRequest) -> RegistrationSelection {
    if request.input.addonName.hasPrefix("rielflow/") || request.input.source.packageName == "rielflow" {
      return .builtin
    }

    let matchingRegistrations = registrations.filter { registration in
      registration.addonName == request.input.addonName
        && registration.version == (request.input.version ?? registration.version)
        && (request.input.source.packageName == nil || request.input.source.packageName == registration.packageName)
    }

    if matchingRegistrations.count == 1, let registration = matchingRegistrations.first {
      return .selected(registration)
    }
    if matchingRegistrations.count > 1 {
      return .duplicate
    }
    return .unknown
  }

  private func validate(
    descriptor: NativeBundleAddonDescriptor,
    registration: NativeBundleAddonRegistration,
    request: AddonResolveRequest
  ) -> AddonDiagnostic? {
    guard descriptor.abiVersion == registration.abiVersion,
      descriptor.bundleIdentifier == registration.bundleIdentifier,
      descriptor.exports.contains(where: { export in
        export.addonName == request.input.addonName && export.version == registration.version
      })
    else {
      return .init(severity: .error, code: "INVALID_NATIVE_BUNDLE_DESCRIPTOR", message: "native-bundle descriptor did not match the installed registration")
    }
    return nil
  }
}

extension NativeBundleAddonResolver: WorkflowAddonResolving {
  public func execute(_ input: WorkflowAddonExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    let identity = addonIdentity(for: input.addon)
    let request = AddonResolveRequest(input: AddonExecutionInput(
      addonName: identity.addonName,
      version: input.addon.version,
      nodePayload: nativeNodePayload(from: input),
      variables: [:],
      attachments: input.attachments,
      source: .init(packageName: identity.packageName, addonName: identity.addonName),
      options: .init(
        boundary: .async,
        timeoutSeconds: timeoutSeconds(until: context.deadline),
        allowCandidatePayload: true,
        allowDispatchIntents: false
      )
    ))

    switch await resolve(request) {
    case let .resolved(output):
      return AdapterExecutionOutput(
        provider: "native-bundle-addon",
        model: identity.addonName,
        promptText: "",
        completionPassed: true,
        payload: output.candidatePayload ?? [:]
      )
    case let .failed(diagnostics):
      throw AdapterExecutionError(errorCode(for: diagnostics), diagnosticSummary(diagnostics))
    }
  }

  private func addonIdentity(for addon: WorkflowNodeAddonRef) -> (packageName: String?, addonName: String) {
    if let separator = addon.name.lastIndex(of: "/") {
      let packageName = String(addon.name[..<separator])
      let addonName = String(addon.name[addon.name.index(after: separator)...])
      return (packageName.isEmpty ? nil : packageName, addonName)
    }

    let matchingRegistrations = registrations.filter { registration in
      registration.addonName == addon.name && registration.version == (addon.version ?? registration.version)
    }
    if matchingRegistrations.count == 1, let registration = matchingRegistrations.first {
      return (registration.packageName, addon.name)
    }

    return (nil, addon.name)
  }

  private func nativeNodePayload(from input: WorkflowAddonExecutionInput) -> JSONObject {
    var payload: JSONObject = [
      "workflowId": .string(input.workflowId),
      "stepId": .string(input.stepId),
      "nodeId": .string(input.nodeId),
    ]
    if let config = input.addon.config {
      payload["config"] = .object(config)
    }
    if let env = input.addon.env {
      payload["env"] = .object(env)
    }
    if let inputs = input.addon.inputs {
      payload["inputs"] = .object(inputs)
    }
    if !input.resolvedInputPayload.isEmpty {
      payload["input"] = .object(input.resolvedInputPayload)
    }
    return payload
  }

  private func timeoutSeconds(until deadline: Date?) -> Int? {
    guard let deadline else {
      return nil
    }
    return max(1, Int(ceil(deadline.timeIntervalSinceNow)))
  }

  private func errorCode(for diagnostics: [AddonDiagnostic]) -> AdapterExecutionErrorCode {
    let codes = Set(diagnostics.map(\.code))
    if codes.contains("NATIVE_CANDIDATE_PAYLOAD_DENIED") || codes.contains("NATIVE_DISPATCH_INTENT_DENIED") {
      return .policyBlocked
    }
    if codes.contains(where: { $0.hasPrefix("native_attachment_") }) {
      return .policyBlocked
    }
    if codes.contains("INVALID_NATIVE_BUNDLE_DESCRIPTOR") {
      return .invalidOutput
    }
    return .providerError
  }

  private func diagnosticSummary(_ diagnostics: [AddonDiagnostic]) -> String {
    let errorDiagnostics = diagnostics.filter { $0.severity == .error }
    let selectedDiagnostics = errorDiagnostics.isEmpty ? diagnostics : errorDiagnostics
    let messages = selectedDiagnostics.map { diagnostic in
      "\(diagnostic.code): \(diagnostic.message)"
    }
    return messages.isEmpty ? "native-bundle add-on failed without diagnostics" : messages.joined(separator: "; ")
  }
}

private enum RegistrationSelection {
  case selected(NativeBundleAddonRegistration)
  case builtin
  case duplicate
  case unknown
}

private let nativeBundleAttachmentMaxBytes = 8 * 1024 * 1024
private let nativeBundleInputEnvelopeMaxBytes = 16 * 1024 * 1024

private func nativeNodePayloadByProjectingAttachments(
  _ basePayload: JSONObject,
  request: AddonResolveRequest,
  registration: NativeBundleAddonRegistration
) -> NativeAttachmentPayloadProjection {
  if basePayload["attachments"] != nil {
    return .failure([
      .init(
        severity: .error,
        code: "native_attachment_reserved_field",
        message: "native-bundle add-on '\(registration.addonName)' cannot receive caller-authored nodePayload.attachments",
        path: "nodePayload.attachments"
      )
    ])
  }

  let allowedFields = Set(registration.attachmentReadInputFields)
  let providedFields = Set(request.input.attachments.keys)
  if allowedFields.isEmpty {
    if let ungranted = providedFields.sorted().first {
      return .failure([
        .init(
          severity: .error,
          code: "native_attachment_ungranted",
          message: "native-bundle add-on '\(registration.addonName)' received an attachment for ungranted input '\(ungranted)'",
          path: "attachments.\(ungranted)"
        )
      ])
    }
    return .success(basePayload)
  }

  if let ungranted = providedFields.subtracting(allowedFields).sorted().first {
    return .failure([
      .init(
        severity: .error,
        code: "native_attachment_ungranted",
        message: "native-bundle add-on '\(registration.addonName)' received an attachment for ungranted input '\(ungranted)'",
        path: "attachments.\(ungranted)"
      )
    ])
  }

  var projectedAttachments: JSONObject = [:]
  for field in allowedFields.sorted() {
    guard let attachment = request.input.attachments[field] else {
      return .failure([
        .init(
          severity: .error,
          code: "native_attachment_missing",
          message: "native-bundle add-on '\(registration.addonName)' requires one attachment for input '\(field)'",
          path: "attachments.\(field)"
        )
      ])
    }
    switch projectAttachment(attachment, field: field) {
    case let .success(projected):
      projectedAttachments[field] = .object(projected)
    case let .failure(diagnostic):
      return .failure([diagnostic])
    }
  }

  var payload = basePayload
  payload["attachments"] = .object(projectedAttachments)

  let envelope = NativeBundleInvocationEnvelope(
    addonName: request.input.addonName,
    version: request.input.version,
    nodePayload: payload,
    source: request.input.source,
    options: .init(
      boundary: request.input.options.boundary,
      timeoutSeconds: request.input.options.timeoutSeconds,
      allowCandidatePayload: registration.allowCandidatePayload && request.input.options.allowCandidatePayload,
      allowDispatchIntents: registration.allowDispatchIntents
    )
  )
  guard let encoded = try? JSONEncoder().encode(envelope), encoded.count <= nativeBundleInputEnvelopeMaxBytes else {
    return .failure([
      .init(
        severity: .error,
        code: "native_attachment_too_large",
        message: "native-bundle add-on '\(registration.addonName)' attachment envelope exceeded \(nativeBundleInputEnvelopeMaxBytes) bytes",
        path: "attachments"
      )
    ])
  }

  return .success(payload)
}

private func projectAttachment(
  _ attachment: WorkflowAddonAttachmentValue,
  field: String
) -> NativeAttachmentProjection {
  guard !attachment.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
    return .failure(nativeAttachmentDiagnostic("native_attachment_unsupported", "attachment id is required", field: field))
  }
  guard !attachment.mediaType.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
    return .failure(nativeAttachmentDiagnostic("native_attachment_unsupported", "attachment mediaType is required", field: field))
  }
  guard attachment.sizeBytes >= 0, attachment.sizeBytes <= nativeBundleAttachmentMaxBytes else {
    return .failure(nativeAttachmentDiagnostic("native_attachment_too_large", "attachment exceeded \(nativeBundleAttachmentMaxBytes) bytes", field: field))
  }
  guard isValidSHA256Digest(attachment.sha256) else {
    return .failure(nativeAttachmentDiagnostic("native_attachment_hash_malformed", "attachment sha256 was malformed", field: field))
  }

  let content: AttachmentContent
  switch (attachment.contentBase64, attachment.contentText) {
  case let (.some(base64), nil):
    guard let data = Data(base64Encoded: base64) else {
      return .failure(nativeAttachmentDiagnostic("native_attachment_unsupported", "attachment contentBase64 was malformed", field: field))
    }
    content = .base64(base64, data)
  case let (nil, .some(text)):
    content = .text(text, Data(text.utf8))
  default:
    return .failure(nativeAttachmentDiagnostic("native_attachment_metadata_only", "attachment requires exactly one bounded contentBase64 or contentText value", field: field))
  }

  guard content.data.count == attachment.sizeBytes else {
    return .failure(nativeAttachmentDiagnostic("native_attachment_size_mismatch", "attachment sizeBytes did not match content bytes", field: field))
  }
  guard sha256Digest(for: content.data) == attachment.sha256 else {
    return .failure(nativeAttachmentDiagnostic("native_attachment_hash_mismatch", "attachment sha256 did not match content bytes", field: field))
  }

  var object: JSONObject = [
    "id": .string(attachment.id),
    "mediaType": .string(attachment.mediaType),
    "sizeBytes": .number(Double(attachment.sizeBytes)),
    "sha256": .string(attachment.sha256),
  ]
  if let filename = attachment.filename, !filename.isEmpty {
    object["filename"] = .string(filename)
  }
  switch content {
  case let .base64(base64, _):
    object["contentBase64"] = .string(base64)
  case let .text(text, _):
    object["contentText"] = .string(text)
  }
  return .success(object)
}

private enum NativeAttachmentPayloadProjection {
  case success(JSONObject)
  case failure([AddonDiagnostic])
}

private enum NativeAttachmentProjection {
  case success(JSONObject)
  case failure(AddonDiagnostic)
}

private enum AttachmentContent {
  case base64(String, Data)
  case text(String, Data)

  var data: Data {
    switch self {
    case let .base64(_, data), let .text(_, data):
      data
    }
  }
}

private func nativeAttachmentDiagnostic(_ code: String, _ message: String, field: String) -> AddonDiagnostic {
  .init(severity: .error, code: code, message: message, path: "attachments.\(field)")
}

private func isValidSHA256Digest(_ digest: String) -> Bool {
  digest.range(of: #"^sha256:[0-9a-f]{64}$"#, options: .regularExpression) != nil
}

private func sha256Digest(for data: Data) -> String {
  let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  return "sha256:\(hash)"
}
