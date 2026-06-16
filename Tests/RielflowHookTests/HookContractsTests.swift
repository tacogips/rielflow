import XCTest
@testable import RielflowCore
@testable import RielflowHook

final class HookContractsTests: XCTestCase {
  func testHookContextDecodesPreTask006MinimalShapeWithDefaults() throws {
    let context = try JSONDecoder().decode(HookContext.self, from: Data(#"{"agentSessionId":"session-a","agentBackend":"codex"}"#.utf8))

    XCTAssertEqual(context.vendor, .codex)
    XCTAssertEqual(context.eventName, "unknown")
    XCTAssertEqual(context.agentSessionId, "session-a")
    XCTAssertEqual(context.agentBackend, "codex")
    XCTAssertEqual(context.workingDirectory, "")
    XCTAssertEqual(context.backendMetadata, [:])
  }

  func testHookPayloadParsingNormalizesKnownEventsAndValidatesFields() throws {
    let parsed = try HookParsing.parse([
      "session_id": .string("session-a"),
      "hook_event_name": .string("post_tool_use"),
      "cwd": .string("/tmp/project"),
      "transcript_path": .null,
      "model": .string("gpt-5")
    ], vendor: .codex)

    XCTAssertEqual(parsed.context.vendor, .codex)
    XCTAssertEqual(parsed.context.eventName, "PostToolUse")
    XCTAssertEqual(parsed.context.agentSessionId, "session-a")
    XCTAssertEqual(parsed.context.workingDirectory, "/tmp/project")
    XCTAssertNil(parsed.context.transcriptPath)
  }

  func testHookPayloadParsingRedactsBackendMetadata() throws {
    let parsed = try HookParsing.parse([
      "session_id": .string("session-a"),
      "hook_event_name": .string("post_tool_use"),
      "cwd": .string("/tmp/project"),
      "api_key": .string("secret"),
      "nested": .object([
        "authorization": .string("Bearer token"),
        "stdout": .string("tool output"),
        "safe": .string("ok")
      ])
    ], vendor: .codex)

    XCTAssertEqual(parsed.context.backendMetadata["api_key"], .string("[REDACTED]"))
    XCTAssertEqual(parsed.context.backendMetadata["nested"], .object([
      "authorization": .string("[REDACTED]"),
      "stdout": .string("[REDACTED]"),
      "safe": .string("ok")
    ]))
  }

  func testHookPayloadParsingPreservesUnknownEventsAndRejectsMalformedOptionalFields() {
    XCTAssertNoThrow(try HookParsing.parse([
      "session_id": .string("session-a"),
      "hook_event_name": .string("FutureEvent"),
      "cwd": .string("/tmp/project")
    ]))

    XCTAssertThrowsError(try HookParsing.parse([
      "session_id": .string("session-a"),
      "hook_event_name": .string("PostToolUse"),
      "cwd": .string("/tmp/project"),
      "model": .number(1)
    ]))
  }

  func testHookPayloadParsingNormalizesFullKnownEventCatalogVariants() throws {
    let cases: [(String, String)] = [
      ("session-start", "SessionStart"),
      ("permission_denied", "PermissionDenied"),
      ("task completed", "TaskCompleted"),
      ("session_end", "SessionEnd"),
      ("pre-compact", "PreCompact"),
      ("post compact", "PostCompact")
    ]

    for (raw, expected) in cases {
      let parsed = try HookParsing.parse([
        "session_id": .string("session-a"),
        "hook_event_name": .string(raw),
        "cwd": .string("/tmp/project")
      ])

      XCTAssertEqual(parsed.context.eventName, expected)
    }
  }

  func testRedactionSafeRecorderRedactsSensitiveKeysByDefault() async {
    let context = HookContext(vendor: .codex, eventName: "PostToolUse", agentSessionId: "session-a", workingDirectory: "/tmp/project")
    let result = await RedactionSafeHookRecorder().record(.init(
      context: context,
      payload: [
        "api_key": .string("secret"),
        "nested": .object(["stdout": .string("tool output"), "safe": .string("ok")])
      ],
      controls: .init(recording: .auto, captureRaw: .redacted)
    ))

    XCTAssertTrue(result.recorded)
    XCTAssertNotNil(result.payloadHash)
    XCTAssertEqual(result.redactedPayload?["api_key"], .string("[REDACTED]"))
    XCTAssertEqual(result.redactedPayload?["nested"], .object(["stdout": .string("[REDACTED]"), "safe": .string("ok")]))
  }

  func testRedactionSafeRecorderPayloadHashIsStableAcrossDictionaryOrder() async {
    let context = HookContext(vendor: .codex, eventName: "PostToolUse", agentSessionId: "session-a", workingDirectory: "/tmp/project")
    let first = await RedactionSafeHookRecorder().record(.init(
      context: context,
      payload: [
        "z": .string("last"),
        "nested": .object(["b": .number(2), "a": .number(1)]),
        "a": .string("first")
      ],
      controls: .init(recording: .auto, captureRaw: .metadataOnly)
    ))
    let second = await RedactionSafeHookRecorder().record(.init(
      context: context,
      payload: [
        "a": .string("first"),
        "nested": .object(["a": .number(1), "b": .number(2)]),
        "z": .string("last")
      ],
      controls: .init(recording: .auto, captureRaw: .metadataOnly)
    ))

    XCTAssertTrue(first.recorded)
    XCTAssertEqual(first.payloadHash, second.payloadHash)
  }

  func testRecordingControlsPreserveEnvironmentContract() throws {
    let controls = try HookRecordingControls(env: [
      "RIEL_HOOK_RECORDING": "required",
      "RIEL_HOOK_STRICT": "true",
      "RIEL_HOOK_CAPTURE_RAW": "metadata-only"
    ])

    XCTAssertEqual(controls.recording, .required)
    XCTAssertTrue(controls.strict)
    XCTAssertEqual(controls.captureRaw, .metadataOnly)
  }

  func testRecordingControlsRejectInvalidEnvironmentValues() {
    XCTAssertThrowsError(try HookRecordingControls(env: ["RIEL_HOOK_RECORDING": "always"]))
    XCTAssertThrowsError(try HookRecordingControls(env: ["RIEL_HOOK_CAPTURE_RAW": "plain"]))
  }

  func testRielflowHookContextResolverUsesNodeAndManagerEnvAliases() throws {
    let context = try HookContextResolver.resolveRielflowHookContext(
      payload: ["session_id": .string("agent-session")],
      env: [
        "RIEL_WORKFLOW_ID": "workflow-a",
        "RIEL_WORKFLOW_EXECUTION_ID": "session-a",
        "RIEL_MANAGER_STEP_ID": "step-a",
        "RIEL_MANAGER_NODE_EXEC_ID": "exec-a",
        "RIEL_MANAGER_SESSION_ID": "manager-session",
        "RIEL_AGENT_BACKEND": "codex"
      ],
      controls: .init(recording: .required)
    )

    XCTAssertEqual(context?.workflowId, "workflow-a")
    XCTAssertEqual(context?.workflowExecutionId, "session-a")
    XCTAssertEqual(context?.nodeId, "step-a")
    XCTAssertEqual(context?.nodeExecId, "exec-a")
    XCTAssertEqual(context?.agentSessionId, "agent-session")
    XCTAssertEqual(context?.managerSessionId, "manager-session")
    XCTAssertEqual(context?.agentBackend, "codex")
  }

  func testRequiredRielflowHookContextFailsWhenIncomplete() {
    XCTAssertThrowsError(try HookContextResolver.resolveRielflowHookContext(
      payload: ["session_id": .string("agent-session")],
      env: [
        "RIEL_WORKFLOW_ID": "workflow-a",
        "RIEL_WORKFLOW_EXECUTION_ID": "session-a",
        "RIEL_NODE_ID": "step-a"
      ],
      controls: .init(recording: .required)
    ))

    XCTAssertNoThrow(try HookContextResolver.resolveRielflowHookContext(
      payload: ["session_id": .string("agent-session")],
      env: [:],
      controls: .init(recording: .auto)
    ))
  }
}
