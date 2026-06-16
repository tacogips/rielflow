import Foundation
import RielflowCore

public struct EventDryRunRequest: Codable, Equatable, Sendable {
  public var sources: [EventSourceContract]
  public var bindings: [EventBindingContract]
  public var envelope: ExternalEventEnvelope

  public init(sources: [EventSourceContract], bindings: [EventBindingContract], envelope: ExternalEventEnvelope) {
    self.sources = sources
    self.bindings = bindings
    self.envelope = envelope
  }
}

public struct EventDryRunTriggerSummary: Codable, Equatable, Sendable {
  public var bindingId: String
  public var workflowName: String?
  public var executionMode: EventExecutionMode
  public var input: JSONObject
  public var runtimeVariables: JSONObject
  public var outputDestinations: [String]?

  public init(
    bindingId: String,
    workflowName: String?,
    executionMode: EventExecutionMode,
    input: JSONObject,
    runtimeVariables: JSONObject = [:],
    outputDestinations: [String]? = nil
  ) {
    self.bindingId = bindingId
    self.workflowName = workflowName
    self.executionMode = executionMode
    self.input = input
    self.runtimeVariables = runtimeVariables
    self.outputDestinations = outputDestinations
  }
}

public struct EventDryRunResult: Codable, Equatable, Sendable {
  public var accepted: Bool
  public var diagnostics: [EventValidationDiagnostic]
  public var triggers: [EventDryRunTriggerSummary]
  public var receipt: EventReceipt?
  public var replyDispatches: [ReplyDispatch]

  public init(
    accepted: Bool,
    diagnostics: [EventValidationDiagnostic] = [],
    triggers: [EventDryRunTriggerSummary] = [],
    receipt: EventReceipt? = nil,
    replyDispatches: [ReplyDispatch] = []
  ) {
    self.accepted = accepted
    self.diagnostics = diagnostics
    self.triggers = triggers
    self.receipt = receipt
    self.replyDispatches = replyDispatches
  }
}

public protocol EventDryRunTriggering: Sendable {
  func dryRun(_ request: EventDryRunRequest) async -> EventDryRunResult
}

public struct DeterministicEventDryRunTrigger: EventDryRunTriggering {
  public init() {}

  public func dryRun(_ request: EventDryRunRequest) async -> EventDryRunResult {
    let diagnostics = EventContractValidator.validate(sources: request.sources, bindings: request.bindings)
    guard diagnostics.isEmpty else {
      return .init(accepted: false, diagnostics: diagnostics)
    }
    let enabledSourceIds = Set(request.sources.filter(\.enabled).map(\.id))
    let triggers = request.bindings
      .filter { binding in
        bindingMatchesEnvelope(binding, envelope: request.envelope, enabledSourceIds: enabledSourceIds)
      }
      .map { binding in
        let source = request.sources.first { $0.id == binding.sourceId }
        let input = buildWorkflowInput(binding: binding, envelope: request.envelope, source: source)
        return EventDryRunTriggerSummary(
          bindingId: binding.id,
          workflowName: binding.workflowName,
          executionMode: binding.execution?.mode ?? .direct,
          input: input,
          runtimeVariables: buildRuntimeVariables(binding: binding, input: input, envelope: request.envelope, source: source),
          outputDestinations: binding.outputDestinations
        )
      }
    return .init(
      accepted: !triggers.isEmpty,
      triggers: triggers,
      receipt: .init(
        sourceId: request.envelope.sourceId,
        eventId: request.envelope.eventId,
        dedupeKey: request.envelope.dedupeKey,
        status: triggers.isEmpty ? "ignored" : "dry-run"
      ),
      replyDispatches: []
    )
  }
}

private func bindingMatchesEnvelope(_ binding: EventBindingContract, envelope: ExternalEventEnvelope, enabledSourceIds: Set<String>) -> Bool {
  guard binding.enabled,
    enabledSourceIds.contains(binding.sourceId),
    binding.sourceId == envelope.sourceId
  else {
    return false
  }
  if let eventType = binding.eventType, eventType != envelope.eventType {
    return false
  }
  if let match = binding.match {
    if let eventType = match.eventType, eventType != envelope.eventType {
      return false
    }
    if let conversationId = match.conversationId, conversationId != stringField(envelope.conversation, key: "id") {
      return false
    }
    if let pathPrefix = match.pathPrefix, eventFilePath(envelope)?.hasPrefix(pathPrefix) != true {
      return false
    }
  }
  return true
}

private func stringField(_ object: JSONObject?, key: String) -> String? {
  guard case let .string(value)? = object?[key] else {
    return nil
  }
  return value
}

private func eventFilePath(_ envelope: ExternalEventEnvelope) -> String? {
  guard case let .object(file)? = envelope.input["file"], case let .string(path)? = file["path"] else {
    return nil
  }
  return path
}

private func buildWorkflowInput(binding: EventBindingContract, envelope: ExternalEventEnvelope, source: EventSourceContract?) -> JSONObject {
  switch binding.inputMapping.mode {
  case .eventInput:
    return envelope.input
  case .template:
    let rendered = renderEventTemplateValue(
      binding.inputMapping.template ?? .object([:]),
      roots: eventTemplateRoots(envelope: envelope, source: source, binding: binding)
    )
    if case let .object(object) = rendered {
      return object
    }
    return ["value": rendered]
  }
}

private func buildRuntimeVariables(binding: EventBindingContract, input: JSONObject, envelope: ExternalEventEnvelope, source: EventSourceContract?) -> JSONObject {
  var runtimeVariables: JSONObject = [
    "workflowInput": .object(input),
    "event": eventRoot(envelope),
    "eventBindingId": .string(binding.id),
    "eventMailboxBridgePolicy": mailboxBridgePolicyRoot(binding)
  ]
  if let outputDestinations = binding.outputDestinations {
    runtimeVariables["eventOutputDestinations"] = .array(outputDestinations.map { .string($0) })
  }
  if shouldMirrorToHumanInput(binding: binding, source: source) {
    runtimeVariables["humanInput"] = .object(input)
  }
  return runtimeVariables
}

private func shouldMirrorToHumanInput(binding: EventBindingContract, source: EventSourceContract?) -> Bool {
  if let mirrorToHumanInput = binding.inputMapping.mirrorToHumanInput {
    return mirrorToHumanInput
  }
  return source?.kind == .webhook || source?.kind == .chatSdk
}

private func mailboxBridgePolicyRoot(_ binding: EventBindingContract) -> JSONValue {
  let mode = binding.execution?.mode
  let supervisedLike = mode == .supervised || mode == .supervisorDispatch
  let authored = binding.mailboxBridge
  let inputConsumer = authored?.input?.consumer.rawValue ?? (supervisedLike ? "supervisor" : "direct-workflow")
  let replyMode = authored?.output?.reply?.mode.rawValue ?? "final"
  let progressMode = authored?.output?.progress?.mode.rawValue ?? "status-only"
  let controlMode = authored?.output?.control?.mode.rawValue ?? (supervisedLike ? "status-only" : "none")
  return .object([
    "input": .object([
      "consumer": .string(inputConsumer)
    ]),
    "output": .object([
      "reply": .object(["mode": .string(replyMode)]),
      "progress": .object(["mode": .string(progressMode)]),
      "control": .object(["mode": .string(controlMode)])
    ])
  ])
}

private func eventTemplateRoots(envelope: ExternalEventEnvelope, source: EventSourceContract?, binding: EventBindingContract) -> [String: JSONValue] {
  var bindingRoot: JSONObject = [
    "id": .string(binding.id),
    "sourceId": .string(binding.sourceId)
  ]
  if let workflowName = binding.workflowName {
    bindingRoot["workflowName"] = .string(workflowName)
  }
  var roots: [String: JSONValue] = [
    "event": eventRoot(envelope),
    "binding": .object(bindingRoot)
  ]
  if let source {
    roots["source"] = sourceRoot(source)
  }
  return roots
}

private func eventRoot(_ envelope: ExternalEventEnvelope) -> JSONValue {
  var object: JSONObject = [
    "sourceId": .string(envelope.sourceId),
    "eventId": .string(envelope.eventId),
    "provider": .string(envelope.provider),
    "eventType": .string(envelope.eventType),
    "receivedAt": .number(envelope.receivedAt.timeIntervalSince1970),
    "input": .object(envelope.input),
    "artifacts": .array(envelope.artifacts.map { .object(["root": .string($0.root), "path": .string($0.path)]) })
  ]
  if let dedupeKey = envelope.dedupeKey {
    object["dedupeKey"] = .string(dedupeKey)
  }
  if let actor = envelope.actor {
    object["actor"] = .object(actor)
  }
  if let conversation = envelope.conversation {
    object["conversation"] = .object(conversation)
  }
  return .object(object)
}

private func sourceRoot(_ source: EventSourceContract) -> JSONValue {
  var object: JSONObject = [
    "id": .string(source.id),
    "kind": .string(source.kind.rawValue),
    "enabled": .bool(source.enabled)
  ]
  if let provider = source.provider {
    object["provider"] = .string(provider)
  }
  if let routePath = source.routePath {
    object["routePath"] = .string(routePath)
  }
  if let bucket = source.bucket {
    object["bucket"] = .string(bucket)
  }
  if let eventReceiverPath = source.eventReceiverPath {
    object["eventReceiverPath"] = .string(eventReceiverPath)
  }
  if let objectAccessMode = source.objectAccessMode {
    object["objectAccessMode"] = .string(objectAccessMode)
  }
  if let rootPrefix = source.rootPrefix {
    object["rootPrefix"] = .string(rootPrefix)
  }
  return .object(object)
}

private func renderEventTemplateValue(_ value: JSONValue, roots: [String: JSONValue]) -> JSONValue {
  switch value {
  case let .string(string):
    if let exactReference = exactTemplateReference(in: string) {
      return resolveTemplateReference(exactReference, roots: roots) ?? .null
    }
    return .string(renderStringTemplate(string, roots: roots))
  case let .array(values):
    return .array(values.map { renderEventTemplateValue($0, roots: roots) })
  case let .object(object):
    return .object(object.mapValues { renderEventTemplateValue($0, roots: roots) })
  default:
    return value
  }
}

private func exactTemplateReference(in string: String) -> String? {
  let pattern = #"^\{\{\s*([^}]+?)\s*\}\}$"#
  guard let regex = try? NSRegularExpression(pattern: pattern) else {
    return nil
  }
  let range = NSRange(string.startIndex..<string.endIndex, in: string)
  guard let match = regex.firstMatch(in: string, range: range),
    match.range.location == 0,
    match.range.length == range.length,
    let refRange = Range(match.range(at: 1), in: string)
  else {
    return nil
  }
  return String(string[refRange])
}

private func renderStringTemplate(_ string: String, roots: [String: JSONValue]) -> String {
  let pattern = #"\{\{\s*([^}]+?)\s*\}\}"#
  guard let regex = try? NSRegularExpression(pattern: pattern) else {
    return string
  }
  var rendered = ""
  var cursor = string.startIndex
  let range = NSRange(string.startIndex..<string.endIndex, in: string)
  for match in regex.matches(in: string, range: range) {
    guard let matchRange = Range(match.range, in: string), let refRange = Range(match.range(at: 1), in: string) else {
      continue
    }
    rendered += string[cursor..<matchRange.lowerBound]
    rendered += stringifyTemplateValue(resolveTemplateReference(String(string[refRange]), roots: roots))
    cursor = matchRange.upperBound
  }
  rendered += string[cursor..<string.endIndex]
  return rendered
}

private func resolveTemplateReference(_ reference: String, roots: [String: JSONValue]) -> JSONValue? {
  let segments = reference.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ".").map(String.init)
  guard let rootName = segments.first, var current = roots[rootName] else {
    return nil
  }
  for segment in segments.dropFirst() {
    switch current {
    case let .object(object):
      guard let next = object[segment] else {
        return nil
      }
      current = next
    case let .array(values):
      guard let index = Int(segment), values.indices.contains(index) else {
        return nil
      }
      current = values[index]
    default:
      return nil
    }
  }
  return current
}

private func stringifyTemplateValue(_ value: JSONValue?) -> String {
  guard let value else {
    return ""
  }
  switch value {
  case .null:
    return ""
  case let .bool(bool):
    return bool ? "true" : "false"
  case let .number(number):
    return String(number)
  case let .string(string):
    return string
  case .array, .object:
    let data = (try? JSONEncoder().encode(value)) ?? Data()
    return String(data: data, encoding: .utf8) ?? ""
  }
}
