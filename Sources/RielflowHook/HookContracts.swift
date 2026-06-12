import CryptoKit
import Foundation
import RielflowCore

public enum HookRecordingMode: String, Codable, Sendable {
  case auto
  case off
  case required
}

public enum HookRawCaptureMode: String, Codable, Sendable {
  case redacted
  case metadataOnly = "metadata-only"
  case full
}

public struct HookRecordingControls: Codable, Equatable, Sendable {
  public var recording: HookRecordingMode
  public var strict: Bool
  public var captureRaw: HookRawCaptureMode

  public init(recording: HookRecordingMode = .auto, strict: Bool = false, captureRaw: HookRawCaptureMode = .redacted) {
    self.recording = recording
    self.strict = strict
    self.captureRaw = captureRaw
  }

  public init(env: [String: String]) throws {
    let recordingValue = env["RIEL_HOOK_RECORDING"]?.nilIfEmpty ?? "auto"
    let captureValue = env["RIEL_HOOK_CAPTURE_RAW"]?.nilIfEmpty ?? "redacted"
    guard let recording = HookRecordingMode(rawValue: recordingValue) else {
      throw HookContractError.invalidPayload("RIEL_HOOK_RECORDING must be 'auto', 'off', or 'required'")
    }
    guard let captureRaw = HookRawCaptureMode(rawValue: captureValue) else {
      throw HookContractError.invalidPayload("RIEL_HOOK_CAPTURE_RAW must be 'redacted', 'metadata-only', or 'full'")
    }
    self.recording = recording
    self.strict = ["1", "true", "yes"].contains((env["RIEL_HOOK_STRICT"] ?? "").lowercased())
    self.captureRaw = captureRaw
  }
}

public struct RielflowHookContext: Codable, Equatable, Sendable {
  public var workflowId: String
  public var workflowExecutionId: String
  public var nodeId: String
  public var nodeExecId: String
  public var agentSessionId: String
  public var managerSessionId: String?
  public var agentBackend: String?

  public init(
    workflowId: String,
    workflowExecutionId: String,
    nodeId: String,
    nodeExecId: String,
    agentSessionId: String,
    managerSessionId: String? = nil,
    agentBackend: String? = nil
  ) {
    self.workflowId = workflowId
    self.workflowExecutionId = workflowExecutionId
    self.nodeId = nodeId
    self.nodeExecId = nodeExecId
    self.agentSessionId = agentSessionId
    self.managerSessionId = managerSessionId
    self.agentBackend = agentBackend
  }
}

public struct ParsedHookPayload: Codable, Equatable, Sendable {
  public var context: HookContext
  public var rawEventName: String
  public var payload: JSONObject

  public init(context: HookContext, rawEventName: String, payload: JSONObject) {
    self.context = context
    self.rawEventName = rawEventName
    self.payload = payload
  }
}

public struct HookRecordRequest: Codable, Equatable, Sendable {
  public var context: HookContext
  public var payload: JSONObject
  public var controls: HookRecordingControls

  public init(context: HookContext, payload: JSONObject, controls: HookRecordingControls = .init()) {
    self.context = context
    self.payload = payload
    self.controls = controls
  }
}

public struct HookRecordResult: Codable, Equatable, Sendable {
  public var recorded: Bool
  public var payloadHash: String?
  public var payloadRef: String?
  public var redactedPayload: JSONObject?
  public var diagnostics: [String]

  public init(
    recorded: Bool,
    payloadHash: String? = nil,
    payloadRef: String? = nil,
    redactedPayload: JSONObject? = nil,
    diagnostics: [String] = []
  ) {
    self.recorded = recorded
    self.payloadHash = payloadHash
    self.payloadRef = payloadRef
    self.redactedPayload = redactedPayload
    self.diagnostics = diagnostics
  }
}

public protocol HookRecording: Sendable {
  func record(_ request: HookRecordRequest) async -> HookRecordResult
}

public enum HookParsing {
  public static func parse(_ payload: JSONObject, vendor: HookVendor = .codex) throws -> ParsedHookPayload {
    let sessionId = try requireNonEmptyString(payload, key: "session_id")
    let rawEventName = try requireNonEmptyString(payload, key: "hook_event_name")
    let cwd = try requireNonEmptyString(payload, key: "cwd")
    let transcriptPath = try optionalNullableString(payload, key: "transcript_path")
    let model = try optionalString(payload, key: "model")
    let context = HookContext(
      vendor: vendor,
      eventName: normalizeEventName(rawEventName),
      agentSessionId: sessionId,
      agentBackend: vendor.rawValue,
      workingDirectory: cwd,
      transcriptPath: transcriptPath,
      model: model,
      backendMetadata: redactedBackendMetadata(from: payload)
    )
    return .init(context: context, rawEventName: rawEventName, payload: payload)
  }

  public static func normalizeEventName(_ value: String) -> String {
    let normalized = String(value.filter { $0.isLetter || $0.isNumber }).lowercased()
    let known = [
      "sessionstart": "SessionStart",
      "pretooluse": "PreToolUse",
      "posttooluse": "PostToolUse",
      "beforetool": "BeforeTool",
      "aftertool": "AfterTool",
      "userpromptsubmit": "UserPromptSubmit",
      "beforeagent": "BeforeAgent",
      "afteragent": "AfterAgent",
      "beforemodel": "BeforeModel",
      "beforetoolselection": "BeforeToolSelection",
      "aftermodel": "AfterModel",
      "notification": "Notification",
      "stop": "Stop",
      "posttoolusefailure": "PostToolUseFailure",
      "permissionrequest": "PermissionRequest",
      "permissiondenied": "PermissionDenied",
      "subagentstart": "SubagentStart",
      "subagentstop": "SubagentStop",
      "instructionsloaded": "InstructionsLoaded",
      "taskcreated": "TaskCreated",
      "taskcompleted": "TaskCompleted",
      "configchange": "ConfigChange",
      "cwdchanged": "CwdChanged",
      "filechanged": "FileChanged",
      "stopfailure": "StopFailure",
      "elicitation": "Elicitation",
      "elicitationresult": "ElicitationResult",
      "worktreecreate": "WorktreeCreate",
      "worktreeremove": "WorktreeRemove",
      "precompress": "PreCompress",
      "precompact": "PreCompact",
      "postcompact": "PostCompact",
      "sessionend": "SessionEnd",
      "teammateidle": "TeammateIdle"
    ]
    return known[normalized] ?? value
  }

  private static func requireNonEmptyString(_ payload: JSONObject, key: String) throws -> String {
    guard case let .string(value)? = payload[key], !value.isEmpty else {
      throw HookContractError.invalidPayload("hook payload field '\(key)' must be a non-empty string")
    }
    return value
  }

  private static func optionalNullableString(_ payload: JSONObject, key: String) throws -> String? {
    guard let value = payload[key] else {
      return nil
    }
    switch value {
    case .null:
      return nil
    case let .string(string):
      return string
    default:
      throw HookContractError.invalidPayload("hook payload field '\(key)' must be a string, null, or omitted")
    }
  }

  private static func optionalString(_ payload: JSONObject, key: String) throws -> String? {
    guard let value = payload[key] else {
      return nil
    }
    guard case let .string(string) = value else {
      throw HookContractError.invalidPayload("hook payload field '\(key)' must be a string when present")
    }
    return string
  }

  private static func redactedBackendMetadata(from payload: JSONObject) -> JSONObject {
    guard case let .object(redacted) = HookRedaction.redact(.object(payload)) else {
      return [:]
    }
    return redacted
  }
}

public enum HookContextResolver {
  public static func resolveRielflowHookContext(payload: JSONObject, env: [String: String], controls: HookRecordingControls? = nil) throws -> RielflowHookContext? {
    let controls = try controls ?? HookRecordingControls(env: env)
    if controls.recording == .off {
      return nil
    }
    let workflowId = readEnvValue(env, key: "RIEL_WORKFLOW_ID")
    let workflowExecutionId = readEnvValue(env, key: "RIEL_WORKFLOW_EXECUTION_ID")
    let nodeId = readEnvValue(env, key: "RIEL_NODE_ID") ?? readEnvValue(env, key: "RIEL_MANAGER_STEP_ID")
    let nodeExecId = readEnvValue(env, key: "RIEL_NODE_EXEC_ID") ?? readEnvValue(env, key: "RIEL_MANAGER_NODE_EXEC_ID")
    guard let workflowId, let workflowExecutionId, let nodeId, let nodeExecId else {
      if controls.recording == .required {
        throw HookContractError.invalidPayload("missing rielflow hook context; required env vars are RIEL_WORKFLOW_ID, RIEL_WORKFLOW_EXECUTION_ID, RIEL_NODE_ID, and RIEL_NODE_EXEC_ID")
      }
      return nil
    }
    guard case let .string(agentSessionId)? = payload["session_id"], !agentSessionId.isEmpty else {
      throw HookContractError.invalidPayload("hook payload field 'session_id' must be a non-empty string")
    }
    return .init(
      workflowId: workflowId,
      workflowExecutionId: workflowExecutionId,
      nodeId: nodeId,
      nodeExecId: nodeExecId,
      agentSessionId: agentSessionId,
      managerSessionId: readEnvValue(env, key: "RIEL_MANAGER_SESSION_ID"),
      agentBackend: readEnvValue(env, key: "RIEL_AGENT_BACKEND")
    )
  }

  private static func readEnvValue(_ env: [String: String], key: String) -> String? {
    env[key]?.nilIfEmpty
  }
}

public enum HookContractError: Error, Equatable {
  case invalidPayload(String)
}

public enum HookRedaction {
  public static func redact(_ payload: JSONValue) -> JSONValue {
    redact(payload, depth: 0)
  }

  private static func redact(_ value: JSONValue, depth: Int) -> JSONValue {
    if depth > 20 {
      return .string("[REDACTED: depth limit]")
    }
    switch value {
    case let .array(values):
      return .array(values.map { redact($0, depth: depth + 1) })
    case let .object(object):
      return .object(object.mapValuesWithKeys { key, entry in
        sensitiveKey(key) ? .string("[REDACTED]") : redact(entry, depth: depth + 1)
      })
    default:
      return value
    }
  }

  private static func sensitiveKey(_ key: String) -> Bool {
    key.range(
      of: #"(authorization|api[_-]?key|secret|token|password|credential|private[_-]?key|stdout|stderr|output|command[_-]?output)"#,
      options: [.regularExpression, .caseInsensitive]
    ) != nil
  }
}

public struct RedactionSafeHookRecorder: HookRecording {
  public init() {}

  public func record(_ request: HookRecordRequest) async -> HookRecordResult {
    switch request.controls.recording {
    case .off:
      return .init(recorded: false, diagnostics: ["hook recording is disabled"])
    case .auto, .required:
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      let encoded = (try? encoder.encode(JSONValue.object(request.payload))) ?? Data()
      let hash = SHA256.hash(data: encoded).map { String(format: "%02x", $0) }.joined()
      switch request.controls.captureRaw {
      case .metadataOnly:
        return .init(recorded: true, payloadHash: hash)
      case .redacted:
        if case let .object(redacted) = HookRedaction.redact(.object(request.payload)) {
          return .init(recorded: true, payloadHash: hash, redactedPayload: redacted)
        }
        return .init(recorded: true, payloadHash: hash)
      case .full:
        return .init(recorded: true, payloadHash: hash, redactedPayload: request.payload)
      }
    }
  }
}

private extension String {
  var nilIfEmpty: String? {
    isEmpty ? nil : self
  }
}

private extension Dictionary where Key == String, Value == JSONValue {
  func mapValuesWithKeys(_ transform: (String, JSONValue) -> JSONValue) -> [String: JSONValue] {
    var result: [String: JSONValue] = [:]
    for (key, value) in self {
      result[key] = transform(key, value)
    }
    return result
  }
}
