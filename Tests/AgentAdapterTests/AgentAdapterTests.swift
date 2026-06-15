import Darwin
import Foundation
import XCTest
@testable import ClaudeCodeAgent
@testable import CodexAgent
@testable import CursorCLIAgent
@testable import RielflowAdapters
@testable import RielflowCore

private struct CapturingRunner: LocalAgentProcessRunning {
  let output: String
  let error: String
  let status: Int32

  init(output: String, error: String = "", status: Int32 = 0) {
    self.output = output
    self.error = error
    self.status = status
  }

  func run(configuration: LocalAgentProcessConfiguration, stdin: String, deadline: Date?) async throws -> LocalAgentProcessResult {
    XCTAssertEqual(configuration.environment["RIEL_AGENT_BACKEND"]?.isEmpty, false)
    return LocalAgentProcessResult(stdout: output, stderr: error, terminationStatus: status)
  }
}

private struct RecordedRun: Equatable {
  var configuration: LocalAgentProcessConfiguration
  var stdin: String
  var deadline: Date?
}

private actor RecordingRunnerStore {
  private var recordedRuns: [RecordedRun] = []

  func append(_ run: RecordedRun) {
    recordedRuns.append(run)
  }

  func runs() -> [RecordedRun] {
    recordedRuns
  }
}

private final class RecordingRunner: LocalAgentProcessRunning, @unchecked Sendable {
  private let store = RecordingRunnerStore()
  private let output: String
  private let error: String
  private let status: Int32

  init(output: String = "done", error: String = "", status: Int32 = 0) {
    self.output = output
    self.error = error
    self.status = status
  }

  func run(configuration: LocalAgentProcessConfiguration, stdin: String, deadline: Date?) async throws -> LocalAgentProcessResult {
    await store.append(RecordedRun(configuration: configuration, stdin: stdin, deadline: deadline))
    return LocalAgentProcessResult(stdout: output, stderr: error, terminationStatus: status)
  }

  func runs() async -> [RecordedRun] {
    await store.runs()
  }
}

private actor SequencedRunnerStore {
  private var results: [LocalAgentProcessResult]
  private var recordedRuns: [RecordedRun] = []

  init(results: [LocalAgentProcessResult]) {
    self.results = results
  }

  func run(configuration: LocalAgentProcessConfiguration, stdin: String, deadline: Date?) -> LocalAgentProcessResult {
    recordedRuns.append(RecordedRun(configuration: configuration, stdin: stdin, deadline: deadline))
    if results.isEmpty {
      return LocalAgentProcessResult(stdout: "", stderr: "missing sequenced result", terminationStatus: 1)
    }
    return results.removeFirst()
  }

  func runs() -> [RecordedRun] {
    recordedRuns
  }
}

private final class SequencedRunner: LocalAgentProcessRunning, @unchecked Sendable {
  private let store: SequencedRunnerStore

  init(_ results: [LocalAgentProcessResult]) {
    self.store = SequencedRunnerStore(results: results)
  }

  func run(configuration: LocalAgentProcessConfiguration, stdin: String, deadline: Date?) async throws -> LocalAgentProcessResult {
    await store.run(configuration: configuration, stdin: stdin, deadline: deadline)
  }

  func runs() async -> [RecordedRun] {
    await store.runs()
  }
}

private enum ProcessRunOutcome: Sendable {
  case result(LocalAgentProcessResult)
  case error(AdapterExecutionError)
}

private actor OutcomeRunnerStore {
  private var outcomes: [ProcessRunOutcome]
  private var recordedRuns: [RecordedRun] = []

  init(outcomes: [ProcessRunOutcome]) {
    self.outcomes = outcomes
  }

  func run(configuration: LocalAgentProcessConfiguration, stdin: String, deadline: Date?) throws -> LocalAgentProcessResult {
    recordedRuns.append(RecordedRun(configuration: configuration, stdin: stdin, deadline: deadline))
    guard !outcomes.isEmpty else {
      throw AdapterExecutionError(.providerError, "missing sequenced outcome")
    }
    switch outcomes.removeFirst() {
    case let .result(result):
      return result
    case let .error(error):
      throw error
    }
  }

  func runs() -> [RecordedRun] {
    recordedRuns
  }
}

private final class OutcomeRunner: LocalAgentProcessRunning, @unchecked Sendable {
  private let store: OutcomeRunnerStore

  init(_ outcomes: [ProcessRunOutcome]) {
    self.store = OutcomeRunnerStore(outcomes: outcomes)
  }

  func run(configuration: LocalAgentProcessConfiguration, stdin: String, deadline: Date?) async throws -> LocalAgentProcessResult {
    try await store.run(configuration: configuration, stdin: stdin, deadline: deadline)
  }

  func runs() async -> [RecordedRun] {
    await store.runs()
  }
}

private struct MockCodexReadinessOperations: CodexAgentReadinessOperations {
  func getToolVersions(options _: AgentBackendProbeOptions) async -> CodexBackendToolVersions {
    CodexBackendToolVersions(
      codex: AgentBackendToolInfo(name: "codex", command: "codex", version: "codex-cli 0.135.0", status: .available),
      git: AgentBackendToolInfo(name: "git", command: "git", version: "git version 2.53.0", status: .available)
    )
  }

  func getLoginStatus(options _: AgentBackendProbeOptions) async -> CodexBackendLoginStatus {
    CodexBackendLoginStatus(ok: true, status: "Logged in using ChatGPT", exitCode: 0)
  }

  func checkModelAvailability(model: String, options _: AgentBackendProbeOptions) async -> CodexBackendModelAvailability {
    CodexBackendModelAvailability(
      ok: true,
      model: model,
      auth: CodexBackendLoginStatus(ok: true, status: "Logged in using ChatGPT", exitCode: 0),
      probe: CodexBackendModelProbe(ok: true, model: model, output: "OK", exitCode: 0)
    )
  }
}

private struct MockClaudeReadinessOperations: ClaudeCodeAgentReadinessOperations {
  func getToolVersion(options _: AgentBackendProbeOptions) async -> AgentBackendToolInfo {
    AgentBackendToolInfo(name: "claude", command: "claude", version: "2.1.86", status: .available)
  }

  func verifyReadiness(model: String?, options _: AgentBackendProbeOptions) async -> ClaudeBackendReadiness {
    ClaudeBackendReadiness(
      ready: model != nil,
      auth: ClaudeBackendAuthReadiness(state: .configured, available: true, verified: model != nil),
      cli: ClaudeBackendCliReadiness(checked: model != nil, available: true, exitCode: model == nil ? nil : 0),
      model: ClaudeBackendModelReadiness(requested: model, checked: model != nil, available: model != nil, timedOut: false, exitCode: model == nil ? nil : 0)
    )
  }
}

private struct MockCursorReadinessOperations: CursorCLIAgentReadinessOperations {
  func getToolVersions(options _: AgentBackendProbeOptions) async -> CursorBackendToolVersions {
    CursorBackendToolVersions(
      packageVersion: "0.1.0",
      tools: [
        AgentBackendToolInfo(name: "cursor-agent", command: "cursor-agent", version: "0.45.0", status: .available),
      ]
    )
  }

  func checkModelAvailability(model: String, options _: AgentBackendProbeOptions) async -> CursorBackendModelAvailability {
    CursorBackendModelAvailability(
      model: model,
      binary: AgentBackendToolInfo(name: "cursor-agent", command: "cursor-agent", version: "0.45.0", status: .available),
      auth: CursorBackendAuthAvailability(status: .available, detail: "cursor-agent authentication is usable"),
      modelReachability: CursorBackendModelReachability(status: .available, probed: true, output: "OK")
    )
  }
}

private final class SignalRecorder: @unchecked Sendable {
  private let lock = NSLock()
  private var recordedSignals: [(pid: pid_t, signal: Int32)] = []
  private var liveProbeResults: [Int32]

  init(liveProbeResults: [Int32] = [0]) {
    self.liveProbeResults = liveProbeResults
  }

  func record(pid: pid_t, signal: Int32) -> Int32 {
    lock.lock()
    if signal == 0 {
      let result = liveProbeResults.isEmpty ? 0 : liveProbeResults.removeFirst()
      lock.unlock()
      return result
    }
    recordedSignals.append((pid: pid, signal: signal))
    lock.unlock()
    return 0
  }

  func signals() -> [(pid: pid_t, signal: Int32)] {
    lock.lock()
    defer { lock.unlock() }
    return recordedSignals
  }
}

final class AgentAdapterTests: XCTestCase {
  func testCodexAgentProducesProviderOutput() async throws {
    let adapter = CodexAgentAdapter(runner: CapturingRunner(output: "done"))
    let output = try await adapter.execute(input(backend: .codexAgent), context: AdapterExecutionContext())

    XCTAssertEqual(output.provider, "codex-agent")
    XCTAssertEqual(output.payload["text"], .string("done"))
  }

  func testClaudeAgentProducesProviderOutput() async throws {
    let adapter = ClaudeCodeAgentAdapter(runner: CapturingRunner(output: "done"))
    let output = try await adapter.execute(input(backend: .claudeCodeAgent), context: AdapterExecutionContext())

    XCTAssertEqual(output.provider, "claude-code-agent")
  }

  func testCursorAgentProducesProviderOutput() async throws {
    let adapter = CursorCLIAgentAdapter(runner: CapturingRunner(output: "done"))
    let output = try await adapter.execute(input(backend: .cursorCliAgent), context: AdapterExecutionContext())

    XCTAssertEqual(output.provider, "cursor-cli-agent")
  }

  func testCodexCommandBuilderOwnsExactArgvAndPromptBoundary() async throws {
    let runner = RecordingRunner(output: "done")
    let deadline = Date(timeIntervalSinceNow: 10)
    let adapter = CodexAgentAdapter(
      executableName: "codex-dev",
      runner: runner,
      environment: ["CODEX_HOME": "/tmp/codex-home"],
      additionalArguments: ["--sandbox", "workspace-write"]
    )

    _ = try await adapter.execute(
      input(
        backend: .codexAgent,
        effort: .high,
        workingDirectory: "/tmp/work",
        systemPromptText: "system",
        variables: [
          "codexAdditionalArgs": .array([.string("--dangerously-bypass-approvals-and-sandbox")])
        ],
        arguments: [
          "imagePaths": .array([.string("/tmp/argument.png"), .string("/tmp/duplicate.png")])
        ],
        mergedVariables: [
          "imagePaths": .array([.string("/tmp/screenshot.png"), .string("/tmp/duplicate.png")]),
          "message": .object([
            "attachments": .array([
              .object(["kind": .string("image"), "localPath": .string("/tmp/nested.png")]),
              .object([
                "mediaType": .string("image/png"),
                "source": .object(["downloadPath": .string("/tmp/source.png")])
              ]),
            ])
          ]),
        ]
      ),
      context: AdapterExecutionContext(deadline: deadline)
    )

    let runs = await runner.runs()
    let preflightRun = try XCTUnwrap(runs.first)
    XCTAssertEqual(preflightRun.configuration.arguments, ["codex-dev", "login", "status"])
    XCTAssertEqual(preflightRun.configuration.environment["RIEL_AGENT_BACKEND"], "codex-agent")
    XCTAssertEqual(preflightRun.configuration.environment["CODEX_HOME"], "/tmp/codex-home")
    let run = try XCTUnwrap(runs.last)
    XCTAssertEqual(run.configuration.executableURL.path, "/usr/bin/env")
    XCTAssertEqual(
      run.configuration.arguments,
      [
        "codex-dev", "exec", "--json", "--model", "model", "-c", #"model_reasoning_effort="high""#,
        "--sandbox", "workspace-write", "--dangerously-bypass-approvals-and-sandbox", "--image",
        "/tmp/screenshot.png", "--image", "/tmp/duplicate.png", "--image", "/tmp/nested.png",
        "--image", "/tmp/source.png", "--image", "/tmp/argument.png", "--", "system\n\nhello",
      ]
    )
    XCTAssertEqual(run.configuration.environment["RIEL_AGENT_BACKEND"], "codex-agent")
    XCTAssertEqual(run.configuration.environment["CODEX_HOME"], "/tmp/codex-home")
    XCTAssertEqual(run.configuration.workingDirectoryURL?.path, "/tmp/work")
    XCTAssertEqual(run.stdin, "")
    XCTAssertEqual(run.deadline, deadline)
  }

  func testCodexCommandBuilderTerminatesOptionsBeforeFlagLikePrompt() async throws {
    let runner = RecordingRunner(output: "done")
    let adapter = CodexAgentAdapter(runner: runner, authPreflight: false)

    _ = try await adapter.execute(
      input(backend: .codexAgent, promptText: "--model other"),
      context: AdapterExecutionContext()
    )

    let runs = await runner.runs()
    let run = try XCTUnwrap(runs.last)
    XCTAssertEqual(Array(run.configuration.arguments.suffix(2)), ["--", "--model other"])
    XCTAssertEqual(run.configuration.arguments.filter { $0 == "--model" }.count, 1)
  }

  func testClaudeCommandBuilderOwnsPrintModeArgvAndAttachmentPrompt() async throws {
    let runner = RecordingRunner(output: "done")
    let adapter = ClaudeCodeAgentAdapter(
      executableName: "claude-dev",
      runner: runner,
      permissionMode: .plan,
      environment: ["CLAUDE_CONFIG_DIR": "/tmp/claude-home"],
      additionalArguments: ["--verbose"]
    )

    _ = try await adapter.execute(
      input(
        backend: .claudeCodeAgent,
        effort: .medium,
        systemPromptText: "system",
        variables: [
          "attachmentPaths": .array([.string("/tmp/b/note.txt")]),
          "claudeAdditionalArgs": .array([.string("--allowedTools"), .string("Read")]),
        ],
        arguments: [
          "imagePaths": .array([.string("/tmp/a/image.png")])
        ],
        mergedVariables: [
          "message": .object([
            "attachments": .array([
              .object(["contentType": .string("image/jpeg"), "imagePath": .string("/tmp/c/photo.jpg")])
            ])
          ])
        ]
      ),
      context: AdapterExecutionContext()
    )

    let runs = await runner.runs()
    XCTAssertEqual(runs.prefix(2).map(\.configuration.arguments), [["claude-dev", "--version"], ["claude-dev", "auth", "status"]])
    XCTAssertEqual(runs.first?.configuration.environment["RIEL_AGENT_BACKEND"], "claude-code-agent")
    XCTAssertEqual(runs.first?.configuration.environment["CLAUDE_CONFIG_DIR"], "/tmp/claude-home")
    let run = try XCTUnwrap(runs.last)
    XCTAssertEqual(
      run.configuration.arguments,
      [
        "claude-dev", "-p", "--output-format", "text", "--model", "model", "--effort", "medium",
        "--permission-mode", "plan", "--add-dir", "/tmp/a", "--add-dir", "/tmp/b", "--add-dir",
        "/tmp/c", "--verbose", "--allowedTools", "Read",
      ]
    )
    XCTAssertEqual(run.configuration.environment["RIEL_AGENT_BACKEND"], "claude-code-agent")
    XCTAssertEqual(run.configuration.environment["CLAUDE_CONFIG_DIR"], "/tmp/claude-home")
    XCTAssertEqual(
      run.stdin,
      """
      System instruction:
      system

      User instruction:
      hello

      Attached files:
      - /tmp/b/note.txt
      - /tmp/c/photo.jpg
      - /tmp/a/image.png
      """
    )
  }

  func testCursorCommandBuilderOwnsCursorOptionsWithoutCoreLeakage() async throws {
    let runner = RecordingRunner(output: "done")
    let adapter = CursorCLIAgentAdapter(
      executableName: "cursor-dev",
      runner: runner,
      mode: .ask,
      environment: ["CURSOR_CONFIG_DIR": "/tmp/cursor-home"],
      additionalArguments: ["--force"]
    )

    _ = try await adapter.execute(
      input(
        backend: .cursorCliAgent,
        effort: .low,
        systemPromptText: "system",
        variables: [
          "cursorAdditionalArgs": .array([.string("--workspace"), .string("/tmp/work")])
        ],
        mergedVariables: [
          "imagePaths": .array([.string("/tmp/screenshot.png")])
        ]
      ),
      context: AdapterExecutionContext()
    )

    let runs = await runner.runs()
    XCTAssertEqual(
      runs.prefix(2).map(\.configuration.arguments),
      [
        ["cursor-dev", "--version"],
        ["cursor-dev", "--print", "--output-format", "text", "--model", "model", "--", "Reply with exactly OK."],
      ]
    )
    XCTAssertEqual(runs.first?.configuration.environment["RIEL_AGENT_BACKEND"], "cursor-cli-agent")
    XCTAssertEqual(runs.first?.configuration.environment["CURSOR_CONFIG_DIR"], "/tmp/cursor-home")
    let run = try XCTUnwrap(runs.last)
    XCTAssertEqual(
      run.configuration.arguments,
      [
        "cursor-dev", "--print", "--output-format", "stream-json", "--model", "model", "--mode",
        "ask", "--image", "/tmp/screenshot.png", "--force", "--workspace", "/tmp/work", "--",
        "system\n\nhello",
      ]
    )
    XCTAssertEqual(run.configuration.environment["RIEL_AGENT_BACKEND"], "cursor-cli-agent")
    XCTAssertEqual(run.configuration.environment["CURSOR_CONFIG_DIR"], "/tmp/cursor-home")
    XCTAssertEqual(run.stdin, "")
  }

  func testCursorCLIAgentEffortResolutionMatchesTypeScriptComposerRule() {
    XCTAssertFalse(CursorCLIAgentEffortResolution.modelSupportsCursorEffortSuffix(model: "composer-2.5"))
    XCTAssertTrue(CursorCLIAgentEffortResolution.modelSupportsCursorEffortSuffix(model: "gpt-5.5"))
    XCTAssertNil(CursorCLIAgentEffortResolution.resolveCursorAgentEffort(model: "composer-2.5", effort: .high))
    XCTAssertEqual(
      CursorCLIAgentEffortResolution.resolveCursorAgentEffort(model: "gpt-5.5", effort: .high),
      .high
    )
    XCTAssertEqual(
      CursorCLIAgentEffortResolution.resolveModelForEffort(model: "gpt-5.3-codex", effort: .high),
      "gpt-5.3-codex-high"
    )
    XCTAssertEqual(
      CursorCLIAgentEffortResolution.resolveModelForEffort(model: "gpt-5.3-codex-low-fast", effort: .high),
      "gpt-5.3-codex-high-fast"
    )
    XCTAssertEqual(
      CursorCLIAgentEffortResolution.resolveModelForEffort(model: "gpt-5.5", effort: .high),
      "gpt-5.5-high"
    )
    XCTAssertEqual(
      CursorCLIAgentEffortResolution.resolveModelForEffort(model: "gpt-5.5", effort: .medium),
      "gpt-5.5-medium"
    )
    XCTAssertEqual(
      CursorCLIAgentEffortResolution.resolveModelForEffort(model: "gpt-5.5-fast", effort: .medium),
      "gpt-5.5-medium-fast"
    )
    XCTAssertEqual(
      CursorCLIAgentEffortResolution.resolveModelForEffort(model: "gpt-5.5", effort: .xhigh),
      "gpt-5.5-extra-high"
    )
    XCTAssertEqual(
      CursorCLIAgentEffortResolution.resolveModelForEffort(model: "gpt-5.5-extra-high", effort: .low),
      "gpt-5.5-low"
    )
    XCTAssertEqual(
      CursorCLIAgentEffortResolution.resolveModelForEffort(model: "gpt-5.5-extra-high-fast", effort: .low),
      "gpt-5.5-low-fast"
    )
    XCTAssertEqual(
      CursorCLIAgentEffortResolution.resolveModelForEffort(model: "composer-2.5", effort: .high),
      "composer-2.5"
    )
  }

  func testCursorForwardsEffortForNonComposerModels() async throws {
    let runner = RecordingRunner(output: "done")
    let adapter = CursorCLIAgentAdapter(
      executableName: "cursor-dev",
      runner: runner,
      authPreflight: false
    )

    _ = try await adapter.execute(
      input(
        backend: .cursorCliAgent,
        model: "gpt-5.3-codex",
        effort: .high
      ),
      context: AdapterExecutionContext()
    )

    let runs = await runner.runs()
    let run = try XCTUnwrap(runs.last)
    XCTAssertTrue(run.configuration.arguments.contains("gpt-5.3-codex-high"))
    XCTAssertFalse(run.configuration.arguments.contains("composer-2.5"))
  }

  func testCursorDoesNotForwardEffortForComposerModels() async throws {
    let runner = RecordingRunner(output: "done")
    let adapter = CursorCLIAgentAdapter(
      executableName: "cursor-dev",
      runner: runner,
      authPreflight: false
    )

    _ = try await adapter.execute(
      input(
        backend: .cursorCliAgent,
        model: "composer-2.5",
        effort: .high
      ),
      context: AdapterExecutionContext()
    )

    let runs = await runner.runs()
    let run = try XCTUnwrap(runs.last)
    XCTAssertTrue(run.configuration.arguments.contains("composer-2.5"))
    XCTAssertFalse(run.configuration.arguments.contains("--effort"))
    XCTAssertFalse(run.configuration.arguments.contains("high"))
  }

  func testResolveAdapterImagePathsUsesRuntimeInputsDescriptorsDedupeAndForwardPolicy() {
    let resolved = resolveAdapterImagePaths(
      input(
        backend: .codexAgent,
        arguments: [
          "imagePaths": .array([.string("/tmp/argument.png"), .string("/tmp/duplicate.png")])
        ],
        mergedVariables: [
          "imagePaths": .array([.string("/tmp/merged.png"), .string("/tmp/duplicate.png")]),
          "message": .object([
            "attachments": .array([
              .object(["kind": .string("image"), "localPath": .string("/tmp/local.png")]),
              .object([
                "mimetype": .string("image/webp"),
                "source": .object(["imagePath": .string("/tmp/source.webp")])
              ]),
            ])
          ]),
        ]
      )
    )

    XCTAssertEqual(resolved, ["/tmp/merged.png", "/tmp/duplicate.png", "/tmp/local.png", "/tmp/source.webp", "/tmp/argument.png"])

    let disabled = resolveAdapterImagePaths(
      input(
        backend: .codexAgent,
        variables: ["forwardImageAttachments": .bool(false)],
        arguments: ["imagePaths": .array([.string("/tmp/argument.png")])],
        mergedVariables: ["imagePaths": .array([.string("/tmp/merged.png")])]
      )
    )

    XCTAssertEqual(disabled, [])
  }

  func testForwardImageAttachmentsFalseDisablesCodexClaudeAndCursorImageForwarding() async throws {
    let inputWithImagesDisabled = input(
      backend: .codexAgent,
      variables: ["forwardImageAttachments": .bool(false)],
      arguments: ["imagePaths": .array([.string("/tmp/argument.png")])],
      mergedVariables: ["imagePaths": .array([.string("/tmp/merged.png")])]
    )

    let codexRunner = RecordingRunner(output: "done")
    _ = try await CodexAgentAdapter(runner: codexRunner, authPreflight: false).execute(
      inputWithImagesDisabled,
      context: AdapterExecutionContext()
    )
    let codexRuns = await codexRunner.runs()
    let codexRun = try XCTUnwrap(codexRuns.last)
    XCTAssertFalse(codexRun.configuration.arguments.contains("--image"))

    let claudeRunner = RecordingRunner(output: "done")
    _ = try await ClaudeCodeAgentAdapter(runner: claudeRunner, authPreflight: false).execute(
      inputWithImagesDisabled,
      context: AdapterExecutionContext()
    )
    let claudeRuns = await claudeRunner.runs()
    let claudeRun = try XCTUnwrap(claudeRuns.last)
    XCTAssertFalse(claudeRun.configuration.arguments.contains("--add-dir"))
    XCTAssertFalse(claudeRun.stdin.contains("Attached files:"))

    let cursorRunner = RecordingRunner(output: "done")
    _ = try await CursorCLIAgentAdapter(runner: cursorRunner, authPreflight: false).execute(
      inputWithImagesDisabled,
      context: AdapterExecutionContext()
    )
    let cursorRuns = await cursorRunner.runs()
    let cursorRun = try XCTUnwrap(cursorRuns.last)
    XCTAssertFalse(cursorRun.configuration.arguments.contains("--image"))
  }

  func testAdapterAuthPreflightFailuresMapToPolicyBlocked() async throws {
    let adapter = CodexAgentAdapter(
      runner: RecordingRunner(),
      checkAuthPreflight: { _ in
        throw AdapterExecutionError(.policyBlocked, "codex-agent authentication is unavailable: not logged in")
      }
    )

    do {
      _ = try await adapter.execute(input(backend: .codexAgent), context: AdapterExecutionContext())
      XCTFail("Expected policy-blocked preflight failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("not logged in"))
    }
  }

  func testAuthPreflightFalseSkipsInjectedPreflightForLocalAgents() async throws {
    let codexRunner = RecordingRunner(output: "done")
    _ = try await CodexAgentAdapter(
      runner: codexRunner,
      authPreflight: false,
      checkAuthPreflight: { _ in
        throw AdapterExecutionError(.policyBlocked, "codex preflight should not run")
      }
    ).execute(input(backend: .codexAgent), context: AdapterExecutionContext())
    let codexRuns = await codexRunner.runs()
    XCTAssertEqual(codexRuns.count, 1)

    let claudeRunner = RecordingRunner(output: "done")
    _ = try await ClaudeCodeAgentAdapter(
      runner: claudeRunner,
      authPreflight: false,
      checkAuthPreflight: { _ in
        throw AdapterExecutionError(.policyBlocked, "claude preflight should not run")
      }
    ).execute(input(backend: .claudeCodeAgent), context: AdapterExecutionContext())
    let claudeRuns = await claudeRunner.runs()
    XCTAssertEqual(claudeRuns.count, 1)

    let cursorRunner = RecordingRunner(output: "done")
    _ = try await CursorCLIAgentAdapter(
      runner: cursorRunner,
      authPreflight: false,
      checkAuthPreflight: { _ in
        throw AdapterExecutionError(.policyBlocked, "cursor preflight should not run")
      }
    ).execute(input(backend: .cursorCliAgent), context: AdapterExecutionContext())
    let cursorRuns = await cursorRunner.runs()
    XCTAssertEqual(cursorRuns.count, 1)
  }

  func testCodexDefaultAuthPreflightMapsLoginFailureToPolicyBlockedBeforeCommand() async throws {
    let runner = SequencedRunner([
      LocalAgentProcessResult(stdout: "", stderr: "not logged in", terminationStatus: 1),
      LocalAgentProcessResult(stdout: "should not run", stderr: "", terminationStatus: 0),
    ])
    let adapter = CodexAgentAdapter(runner: runner, environment: ["CODEX_HOME": "/tmp/codex-home"])

    do {
      _ = try await adapter.execute(input(backend: .codexAgent), context: AdapterExecutionContext())
      XCTFail("Expected policy-blocked codex preflight failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("not logged in"))
    }

    let runs = await runner.runs()
    XCTAssertEqual(runs.map(\.configuration.arguments), [["codex", "login", "status"]])
    XCTAssertEqual(runs.first?.configuration.environment["CODEX_HOME"], "/tmp/codex-home")
  }

  func testClaudeDefaultPreflightMapsUnavailableCliAndAuthToPolicyBlockedBeforeCommand() async throws {
    let unavailableCliRunner = SequencedRunner([
      LocalAgentProcessResult(stdout: "", stderr: "claude: command not found", terminationStatus: 127),
    ])
    let unavailableCliAdapter = ClaudeCodeAgentAdapter(runner: unavailableCliRunner)

    do {
      _ = try await unavailableCliAdapter.execute(input(backend: .claudeCodeAgent), context: AdapterExecutionContext())
      XCTFail("Expected policy-blocked claude CLI preflight failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("CLI is unavailable"))
    }

    let authFailureRunner = SequencedRunner([
      LocalAgentProcessResult(stdout: "2.1.86", stderr: "", terminationStatus: 0),
      LocalAgentProcessResult(stdout: #"{"loggedIn":false}"#, stderr: "", terminationStatus: 0),
    ])
    let authFailureAdapter = ClaudeCodeAgentAdapter(runner: authFailureRunner, environment: ["CLAUDE_CONFIG_DIR": "/tmp/claude-home"])

    do {
      _ = try await authFailureAdapter.execute(input(backend: .claudeCodeAgent), context: AdapterExecutionContext())
      XCTFail("Expected policy-blocked claude auth preflight failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("authentication is unavailable"))
    }

    let runs = await authFailureRunner.runs()
    XCTAssertEqual(runs.map(\.configuration.arguments), [["claude", "--version"], ["claude", "auth", "status"]])
    XCTAssertEqual(runs.map { $0.configuration.environment["CLAUDE_CONFIG_DIR"] }, ["/tmp/claude-home", "/tmp/claude-home"])
  }

  func testCursorDefaultPreflightMapsUnavailableCliAuthAndModelToPolicyBlockedBeforeCommand() async throws {
    let unavailableCliRunner = SequencedRunner([
      LocalAgentProcessResult(stdout: "", stderr: "cursor-agent: command not found", terminationStatus: 127),
    ])
    let unavailableCliAdapter = CursorCLIAgentAdapter(runner: unavailableCliRunner)

    do {
      _ = try await unavailableCliAdapter.execute(input(backend: .cursorCliAgent), context: AdapterExecutionContext())
      XCTFail("Expected policy-blocked cursor CLI preflight failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("CLI is unavailable"))
    }

    let authFailureRunner = SequencedRunner([
      LocalAgentProcessResult(stdout: "0.45.0", stderr: "", terminationStatus: 0),
      LocalAgentProcessResult(stdout: "", stderr: "login expired", terminationStatus: 1),
    ])
    let authFailureAdapter = CursorCLIAgentAdapter(runner: authFailureRunner)

    do {
      _ = try await authFailureAdapter.execute(input(backend: .cursorCliAgent), context: AdapterExecutionContext())
      XCTFail("Expected policy-blocked cursor auth preflight failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("authentication is unavailable"))
    }

    let modelFailureRunner = SequencedRunner([
      LocalAgentProcessResult(stdout: "0.45.0", stderr: "", terminationStatus: 0),
      LocalAgentProcessResult(stdout: "", stderr: "model is not enabled", terminationStatus: 1),
    ])
    let modelFailureAdapter = CursorCLIAgentAdapter(runner: modelFailureRunner, environment: ["CURSOR_CONFIG_DIR": "/tmp/cursor-home"])

    do {
      _ = try await modelFailureAdapter.execute(input(backend: .cursorCliAgent), context: AdapterExecutionContext())
      XCTFail("Expected policy-blocked cursor model preflight failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("model 'model' is unavailable"))
    }

    let runs = await modelFailureRunner.runs()
    XCTAssertEqual(
      runs.map(\.configuration.arguments),
      [
        ["cursor-agent", "--version"],
        ["cursor-agent", "--print", "--output-format", "text", "--model", "model", "--", "Reply with exactly OK."],
      ]
    )
    XCTAssertEqual(runs.map { $0.configuration.environment["CURSOR_CONFIG_DIR"] }, ["/tmp/cursor-home", "/tmp/cursor-home"])
  }

  func testCursorDefaultPreflightUsesResolvedGpt55ModelInProbeAndDiagnostics() async throws {
    let modelFailureRunner = SequencedRunner([
      LocalAgentProcessResult(stdout: "0.45.0", stderr: "", terminationStatus: 0),
      LocalAgentProcessResult(stdout: "", stderr: "model is not enabled", terminationStatus: 1),
    ])
    let modelFailureAdapter = CursorCLIAgentAdapter(runner: modelFailureRunner)

    do {
      _ = try await modelFailureAdapter.execute(
        input(backend: .cursorCliAgent, model: "gpt-5.5", effort: .high),
        context: AdapterExecutionContext()
      )
      XCTFail("Expected policy-blocked cursor model preflight failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("model 'gpt-5.5-high' is unavailable"))
      XCTAssertFalse(error.message.contains("model 'gpt-5.5' is unavailable"))
    }

    let runs = await modelFailureRunner.runs()
    XCTAssertEqual(
      runs.map(\.configuration.arguments),
      [
        ["cursor-agent", "--version"],
        ["cursor-agent", "--print", "--output-format", "text", "--model", "gpt-5.5-high", "--", "Reply with exactly OK."],
      ]
    )
  }

  func testDefaultAuthPreflightsUseBoundedDeadlineWhenContextDeadlineIsNil() async throws {
    let codexRunner = RecordingRunner(output: "done")
    _ = try await CodexAgentAdapter(runner: codexRunner).execute(
      input(backend: .codexAgent),
      context: AdapterExecutionContext()
    )
    let codexRuns = await codexRunner.runs()
    XCTAssertNotNil(codexRuns.first?.deadline)
    XCTAssertNil(codexRuns.last?.deadline)

    let claudeRunner = RecordingRunner(output: "done")
    _ = try await ClaudeCodeAgentAdapter(runner: claudeRunner).execute(
      input(backend: .claudeCodeAgent),
      context: AdapterExecutionContext()
    )
    let claudeRuns = await claudeRunner.runs()
    XCTAssertEqual(claudeRuns.prefix(2).filter { $0.deadline != nil }.count, 2)
    XCTAssertNil(claudeRuns.last?.deadline)

    let cursorRunner = RecordingRunner(output: "done")
    _ = try await CursorCLIAgentAdapter(runner: cursorRunner).execute(
      input(backend: .cursorCliAgent),
      context: AdapterExecutionContext()
    )
    let cursorRuns = await cursorRunner.runs()
    XCTAssertEqual(cursorRuns.prefix(2).filter { $0.deadline != nil }.count, 2)
    XCTAssertNil(cursorRuns.last?.deadline)
  }

  func testDefaultAuthPreflightTimeoutsMapToPolicyBlocked() async throws {
    let timeout = AdapterExecutionError(.timeout, "local agent process timed out")
    let codexRunner = OutcomeRunner([.error(timeout)])
    do {
      _ = try await CodexAgentAdapter(runner: codexRunner).execute(
        input(backend: .codexAgent),
        context: AdapterExecutionContext()
      )
      XCTFail("Expected policy-blocked codex preflight timeout")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("authentication is unavailable"))
      XCTAssertTrue(error.message.contains("timed out"))
    }

    let claudeCliRunner = OutcomeRunner([.error(timeout)])
    do {
      _ = try await ClaudeCodeAgentAdapter(runner: claudeCliRunner).execute(
        input(backend: .claudeCodeAgent),
        context: AdapterExecutionContext()
      )
      XCTFail("Expected policy-blocked claude CLI preflight timeout")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("CLI is unavailable"))
      XCTAssertTrue(error.message.contains("timed out"))
    }

    let claudeAuthRunner = OutcomeRunner([
      .result(LocalAgentProcessResult(stdout: "2.1.86", stderr: "", terminationStatus: 0)),
      .error(timeout),
    ])
    do {
      _ = try await ClaudeCodeAgentAdapter(runner: claudeAuthRunner).execute(
        input(backend: .claudeCodeAgent),
        context: AdapterExecutionContext()
      )
      XCTFail("Expected policy-blocked claude auth preflight timeout")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("authentication is unavailable"))
      XCTAssertTrue(error.message.contains("timed out"))
    }

    let cursorCliRunner = OutcomeRunner([.error(timeout)])
    do {
      _ = try await CursorCLIAgentAdapter(runner: cursorCliRunner).execute(
        input(backend: .cursorCliAgent),
        context: AdapterExecutionContext()
      )
      XCTFail("Expected policy-blocked cursor CLI preflight timeout")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("CLI is unavailable"))
      XCTAssertTrue(error.message.contains("timed out"))
    }

    let cursorModelRunner = OutcomeRunner([
      .result(LocalAgentProcessResult(stdout: "0.45.0", stderr: "", terminationStatus: 0)),
      .error(timeout),
    ])
    do {
      _ = try await CursorCLIAgentAdapter(runner: cursorModelRunner).execute(
        input(backend: .cursorCliAgent),
        context: AdapterExecutionContext()
      )
      XCTFail("Expected policy-blocked cursor model preflight timeout")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertTrue(error.message.contains("model 'model' is unavailable"))
      XCTAssertTrue(error.message.contains("timed out"))
    }
  }

  func testNoOutputContractPreservesJSONLookingTextAsTextPayload() async throws {
    let text = """
    Here is an example response:
    ```json
    {"when":{"always":false},"payload":{"status":"wrong"}}
    ```
    """
    let adapter = CodexAgentAdapter(runner: CapturingRunner(output: text))
    let output = try await adapter.execute(input(backend: .codexAgent), context: AdapterExecutionContext())

    XCTAssertEqual(output.when, ["always": true])
    XCTAssertEqual(output.payload["text"], .string(text))
  }

  func testOutputContractParsesEnvelope() async throws {
    let adapter = CodexAgentAdapter(
      runner: CapturingRunner(
        output: #"{"completionPassed":false,"when":{"needs_revision":true},"payload":{"status":"review"}}"#
      )
    )
    let output = try await adapter.execute(
      input(backend: .codexAgent, output: NodeOutputContract(description: "business JSON")),
      context: AdapterExecutionContext()
    )

    XCTAssertEqual(output.completionPassed, false)
    XCTAssertEqual(output.when, ["needs_revision": true])
    XCTAssertEqual(output.payload["status"], .string("review"))
  }

  func testCodexJSONStreamUsesFinalAssistantContentForOutputContract() async throws {
    let codexJSONL = """
    {"type":"session_meta","payload":{"meta":{"id":"codex-session-1","source":"exec"}}}
    {"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"{\\"summary\\":\\"ok\\"}"}]}}
    """
    let adapter = CodexAgentAdapter(runner: CapturingRunner(output: codexJSONL))
    let output = try await adapter.execute(
      input(backend: .codexAgent, output: NodeOutputContract(description: "business JSON")),
      context: AdapterExecutionContext()
    )

    XCTAssertEqual(output.payload["summary"], .string("ok"))
    XCTAssertNil(output.payload["type"])
  }

  func testCodexJSONStreamUsesFinalAssistantContentForTextPayload() async throws {
    let codexJSONL = """
    {"type":"session_meta","payload":{"meta":{"id":"codex-session-1","source":"exec"}}}
    {"type":"assistant.snapshot","content":"final text"}
    """
    let adapter = CodexAgentAdapter(runner: CapturingRunner(output: codexJSONL))
    let output = try await adapter.execute(input(backend: .codexAgent), context: AdapterExecutionContext())

    XCTAssertEqual(output.payload["text"], .string("final text"))
  }

  func testCursorStreamJSONUsesFinalAssistantContentForTextPayload() async throws {
    let cursorJSONL = """
    {"type":"session.started","sessionId":"cursor-session-1","cwd":"/tmp","model":"model"}
    {"type":"session.assistant_message","sessionId":"cursor-session-1","message":{"displayText":"draft","rawText":"draft"}}
    {"type":"session.assistant_message","sessionId":"cursor-session-1","message":{"displayText":"","rawText":"final text"}}
    """
    let adapter = CursorCLIAgentAdapter(runner: CapturingRunner(output: cursorJSONL), authPreflight: false)
    let output = try await adapter.execute(input(backend: .cursorCliAgent), context: AdapterExecutionContext())

    XCTAssertEqual(output.payload["text"], .string("final text"))
  }

  func testCursorStreamJSONUsesCompletedResultForOutputContract() async throws {
    let cursorJSONL = """
    {"type":"session.started","sessionId":"cursor-session-1","cwd":"/tmp","model":"model"}
    {"type":"session.completed","sessionId":"cursor-session-1","result":"{\\"summary\\":\\"ok\\"}"}
    """
    let adapter = CursorCLIAgentAdapter(runner: CapturingRunner(output: cursorJSONL), authPreflight: false)
    let output = try await adapter.execute(
      input(backend: .cursorCliAgent, output: NodeOutputContract(description: "business JSON")),
      context: AdapterExecutionContext()
    )

    XCTAssertEqual(output.payload["summary"], .string("ok"))
    XCTAssertNil(output.payload["type"])
  }

  func testOutputContractRejectsPlainTextOutput() async throws {
    let adapter = CodexAgentAdapter(runner: CapturingRunner(output: "plain text"))

    do {
      _ = try await adapter.execute(
        input(backend: .codexAgent, output: NodeOutputContract(description: "business JSON")),
        context: AdapterExecutionContext()
      )
      XCTFail("Expected invalid output")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .invalidOutput)
    }
  }

  func testProviderFailureRedactsSecretsFromStderr() async throws {
    let openAIKey = "sk-" + "testsecret" + "123456"
    let anthropicKey = "anthropic-" + "secret-" + "123456"
    let cursorKey = "cursor-" + "secret-" + "123456"
    let bearerToken = "abcdefghijklmnopqrstuvwxyz" + "123456"
    let stderr = [
      "OPENAI_API_KEY=\(openAIKey) ANTHROPIC_API_KEY=\(anthropicKey) CURSOR_API_KEY=\(cursorKey)",
      "Authorization: Bearer \(bearerToken)",
    ].joined(separator: "\n")
    let adapter = CodexAgentAdapter(runner: CapturingRunner(output: "", error: stderr, status: 1), authPreflight: false)

    do {
      _ = try await adapter.execute(input(backend: .codexAgent), context: AdapterExecutionContext())
      XCTFail("Expected provider failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .providerError)
      XCTAssertFalse(error.message.contains(openAIKey))
      XCTAssertFalse(error.message.contains(anthropicKey))
      XCTAssertFalse(error.message.contains(cursorKey))
      XCTAssertFalse(error.message.contains(bearerToken))
      XCTAssertTrue(error.message.contains("<redacted"))
    }
  }

  func testProviderFailureRedactsConfiguredEnvironmentSecretValue() async throws {
    let configuredSecret = "/tmp/rielflow-codex-home-\(UUID().uuidString)"
    let adapter = CodexAgentAdapter(
      runner: CapturingRunner(output: "", error: "failed using \(configuredSecret)", status: 1),
      environment: ["CODEX_HOME": configuredSecret],
      authPreflight: false
    )

    do {
      _ = try await adapter.execute(input(backend: .codexAgent), context: AdapterExecutionContext())
      XCTFail("Expected provider failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .providerError)
      XCTAssertFalse(error.message.contains(configuredSecret))
      XCTAssertTrue(error.message.contains("<redacted>"))
    }
  }

  func testDefaultPreflightRedactsConfiguredEnvironmentSecretValue() async throws {
    let configuredSecret = "/tmp/rielflow-claude-config-\(UUID().uuidString)"
    let runner = SequencedRunner([
      LocalAgentProcessResult(stdout: "", stderr: "failed using \(configuredSecret)", terminationStatus: 1)
    ])
    let adapter = ClaudeCodeAgentAdapter(
      runner: runner,
      environment: ["CLAUDE_CONFIG_DIR": configuredSecret]
    )

    do {
      _ = try await adapter.execute(input(backend: .claudeCodeAgent), context: AdapterExecutionContext())
      XCTFail("Expected policy blocked failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertFalse(error.message.contains(configuredSecret))
      XCTAssertTrue(error.message.contains("<redacted>"))
    }
  }

  func testFoundationRunnerDrainsLargeOutput() async throws {
    let runner = FoundationLocalAgentProcessRunner()
    let result = try await runner.run(
      configuration: LocalAgentProcessConfiguration(
        executableURL: URL(fileURLWithPath: "/bin/sh"),
        arguments: ["-c", "dd if=/dev/zero bs=1024 count=256 2>/dev/null | tr '\\0' x; dd if=/dev/zero bs=1024 count=256 2>/dev/null | tr '\\0' e >&2"]
      ),
      stdin: "",
      deadline: Date(timeIntervalSinceNow: 5)
    )

    XCTAssertEqual(result.terminationStatus, 0)
    XCTAssertEqual(result.stdout.count, 262_144)
    XCTAssertEqual(result.stderr.count, 262_144)
  }

  func testFoundationRunnerUnsetsAmbientEnvironmentKeys() async throws {
    let runner = FoundationLocalAgentProcessRunner()
    let result = try await runner.run(
      configuration: LocalAgentProcessConfiguration(
        executableURL: URL(fileURLWithPath: "/usr/bin/env"),
        unsetEnvironmentKeys: ["PATH"]
      ),
      stdin: "",
      deadline: Date(timeIntervalSinceNow: 2)
    )

    XCTAssertEqual(result.terminationStatus, 0)
    XCTAssertFalse(result.stdout.split(separator: "\n").contains { $0.hasPrefix("PATH=") })
  }

  func testFoundationRunnerClosesChildUnusedPipeDescriptorsForStdinEOF() async throws {
    let runner = FoundationLocalAgentProcessRunner()
    let result = try await runner.run(
      configuration: LocalAgentProcessConfiguration(executableURL: URL(fileURLWithPath: "/bin/cat")),
      stdin: "hello from stdin",
      deadline: Date(timeIntervalSinceNow: 2)
    )

    XCTAssertEqual(result.terminationStatus, 0)
    XCTAssertEqual(result.stdout, "hello from stdin")
    XCTAssertEqual(result.stderr, "")
  }

  func testFoundationRunnerClosesUnrelatedInheritedFileDescriptors() async throws {
    let fileURL = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("rielflow-inherited-fd-\(UUID().uuidString).txt")
    try "secret".write(to: fileURL, atomically: true, encoding: .utf8)
    defer { try? FileManager.default.removeItem(at: fileURL) }

    let descriptor = open(fileURL.path, O_RDONLY)
    XCTAssertGreaterThanOrEqual(descriptor, 0)
    defer { close(descriptor) }
    let flags = fcntl(descriptor, F_GETFD)
    XCTAssertGreaterThanOrEqual(flags, 0)
    XCTAssertEqual(fcntl(descriptor, F_SETFD, flags & ~FD_CLOEXEC), 0)

    let runner = FoundationLocalAgentProcessRunner()
    let result = try await runner.run(
      configuration: LocalAgentProcessConfiguration(
        executableURL: URL(fileURLWithPath: "/bin/sh"),
        arguments: [
          "-c",
          "if : <&$1 2>/dev/null; then echo inherited; else echo closed; fi",
          "rielflow-fd-test",
          String(descriptor),
        ]
      ),
      stdin: "",
      deadline: Date(timeIntervalSinceNow: 2)
    )

    XCTAssertEqual(result.terminationStatus, 0)
    XCTAssertEqual(result.stdout.trimmingCharacters(in: .whitespacesAndNewlines), "closed")
  }

  func testFoundationRunnerTerminatesAfterDeadline() async throws {
    let runner = FoundationLocalAgentProcessRunner()

    do {
      _ = try await runner.run(
        configuration: LocalAgentProcessConfiguration(
          executableURL: URL(fileURLWithPath: "/bin/sleep"),
          arguments: ["5"]
        ),
        stdin: "",
        deadline: Date(timeIntervalSinceNow: 0.05)
      )
      XCTFail("Expected deadline timeout")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .timeout)
    }
  }

  func testFoundationRunnerTimeoutDoesNotWaitForPipeEOF() async throws {
    let runner = FoundationLocalAgentProcessRunner()
    let startedAt = Date()

    do {
      _ = try await runner.run(
        configuration: LocalAgentProcessConfiguration(
          executableURL: URL(fileURLWithPath: "/bin/sh"),
          arguments: ["-c", "trap '' TERM; while :; do :; done"]
        ),
        stdin: "",
        deadline: Date(timeIntervalSinceNow: 0.05)
      )
      XCTFail("Expected deadline timeout")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .timeout)
      XCTAssertLessThan(Date().timeIntervalSince(startedAt), 2)
    }
  }

  func testLocalProcessHandleCancelsDelayedKillAfterProcessReap() throws {
    let recorder = SignalRecorder()
    let handle = LocalProcessHandle(signalProcess: recorder.record(pid:signal:))
    handle.store(processId: 12_345)

    XCTAssertTrue(handle.terminateGroupOrProcess())
    XCTAssertTrue(handle.scheduleKillIfRunning(after: 0.05))
    handle.markExited()
    usleep(150_000)

    let signals = recorder.signals()
    XCTAssertEqual(signals.count, 1)
    XCTAssertEqual(signals.first?.pid, -12_345)
    XCTAssertEqual(signals.first?.signal, SIGTERM)
    XCTAssertFalse(handle.scheduleKillIfRunning(after: 0))
  }

  func testLocalProcessHandlePreservesDelayedKillAfterTimeoutReap() throws {
    let recorder = SignalRecorder()
    let handle = LocalProcessHandle(signalProcess: recorder.record(pid:signal:))
    handle.store(processId: 12_345)

    XCTAssertTrue(handle.terminateGroupOrProcess())
    XCTAssertTrue(handle.scheduleKillIfRunning(after: 0.05))
    handle.markExited(afterTimeout: true)
    usleep(150_000)

    let signals = recorder.signals()
    XCTAssertEqual(signals.map { $0.signal }, [SIGTERM, SIGKILL])
    XCTAssertEqual(signals.map { $0.pid }, [-12_345, -12_345])
    XCTAssertFalse(handle.scheduleKillIfRunning(after: 0))
  }

  func testLocalProcessHandleCancelsDelayedKillAfterTimeoutReapWhenGroupIsGone() throws {
    let recorder = SignalRecorder(liveProbeResults: [-1])
    let handle = LocalProcessHandle(signalProcess: recorder.record(pid:signal:))
    handle.store(processId: 12_345)

    XCTAssertTrue(handle.terminateGroupOrProcess())
    XCTAssertTrue(handle.scheduleKillIfRunning(after: 0.05))
    handle.markExited(afterTimeout: true)
    usleep(150_000)

    let signals = recorder.signals()
    XCTAssertEqual(signals.count, 1)
    XCTAssertEqual(signals.first?.pid, -12_345)
    XCTAssertEqual(signals.first?.signal, SIGTERM)
    XCTAssertFalse(handle.scheduleKillIfRunning(after: 0))
  }

  func testLocalProcessHandleCancelsDelayedKillWhenGroupDiesBeforeEscalation() throws {
    let recorder = SignalRecorder(liveProbeResults: [0, -1])
    let handle = LocalProcessHandle(signalProcess: recorder.record(pid:signal:))
    handle.store(processId: 12_345)

    XCTAssertTrue(handle.terminateGroupOrProcess())
    XCTAssertTrue(handle.scheduleKillIfRunning(after: 0.05))
    handle.markExited(afterTimeout: true)
    usleep(150_000)

    let signals = recorder.signals()
    XCTAssertEqual(signals.count, 1)
    XCTAssertEqual(signals.first?.pid, -12_345)
    XCTAssertEqual(signals.first?.signal, SIGTERM)
    XCTAssertFalse(handle.scheduleKillIfRunning(after: 0))
  }

  func testFoundationRunnerTimeoutKillsTermResistantDescendantAfterParentReap() async throws {
    let runner = FoundationLocalAgentProcessRunner()
    let pidFile = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("rielflow-term-resistant-child-\(UUID().uuidString).pid")
    defer { try? FileManager.default.removeItem(at: pidFile) }

    let script = """
    trap 'exit 0' TERM
    /bin/sh -c 'trap "" TERM; echo $$ > "$1"; while :; do :; done' child "$1" &
    wait
    """

    do {
      _ = try await runner.run(
        configuration: LocalAgentProcessConfiguration(
          executableURL: URL(fileURLWithPath: "/bin/sh"),
          arguments: ["-c", script, "rielflow-test", pidFile.path]
        ),
        stdin: "",
        deadline: Date(timeIntervalSinceNow: 0.2)
      )
      XCTFail("Expected deadline timeout")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .timeout)
    }

    let childProcessId = try waitForPidFile(pidFile)
    let deadline = Date(timeIntervalSinceNow: 3)
    while Date() < deadline {
      if kill(childProcessId, 0) != 0 {
        return
      }
      usleep(50_000)
    }
    XCTFail("Expected TERM-resistant child process group member to be killed after timeout")
  }

  func testFoundationRunnerDeadlineTerminatesSpawnedChildProcessGroup() async throws {
    let runner = FoundationLocalAgentProcessRunner()
    let pidFile = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("rielflow-child-\(UUID().uuidString).pid")
    defer { try? FileManager.default.removeItem(at: pidFile) }

    do {
      _ = try await runner.run(
        configuration: LocalAgentProcessConfiguration(
          executableURL: URL(fileURLWithPath: "/bin/sh"),
          arguments: ["-c", "sleep 5 & echo $! > \"$1\"; wait", "rielflow-test", pidFile.path]
        ),
        stdin: "",
        deadline: Date(timeIntervalSinceNow: 0.2)
      )
      XCTFail("Expected deadline timeout")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .timeout)
    }

    let pidText = try String(contentsOf: pidFile).trimmingCharacters(in: .whitespacesAndNewlines)
    let childProcessId = try XCTUnwrap(pid_t(pidText))
    let deadline = Date(timeIntervalSinceNow: 2)
    while Date() < deadline {
      if kill(childProcessId, 0) != 0 {
        return
      }
      usleep(50_000)
    }
    XCTFail("Expected spawned child process group member to be terminated")
  }

  private func waitForPidFile(_ pidFile: URL) throws -> pid_t {
    let deadline = Date(timeIntervalSinceNow: 2)
    while Date() < deadline {
      if let pidText = try? String(contentsOf: pidFile).trimmingCharacters(in: .whitespacesAndNewlines),
         let processId = pid_t(pidText)
      {
        return processId
      }
      usleep(50_000)
    }
    let missingProcessId: pid_t? = nil
    return try XCTUnwrap(missingProcessId, "Expected child pid file at \(pidFile.path)")
  }

  func testReadinessSummariesAndValidationMirrorRuntimeAgentProbeCategories() {
    let codexRequirement = CodexAgentReadiness.runtimeRequirement(
      candidate: AgentBackendRequirementCandidate(backend: .codexAgent, models: ["gpt-5-nano"], sourceStepIds: ["worker"]),
      toolVersions: CodexBackendToolVersions(
        codex: AgentBackendToolInfo(name: "codex", command: "codex", version: "codex-cli 0.135.0", status: .available),
        git: AgentBackendToolInfo(name: "git", command: "git", status: .unavailable, error: "missing")
      )
    )
    XCTAssertEqual(codexRequirement.status, .unavailable)
    XCTAssertTrue(codexRequirement.detail.contains("bundled sdk=codex-agent"))
    XCTAssertEqual(codexRequirement.sourceStepIds, ["worker"])

    let codexCandidate = AgentBackendPreflightCandidate(backend: .codexAgent, models: ["gpt-5-nano"], nodeIds: ["worker"], stepIds: ["worker"])
    let codexAuth = CodexAgentReadiness.authValidation(
      candidate: codexCandidate,
      status: CodexBackendLoginStatus(ok: false, error: "not logged in", exitCode: 1)
    )
    XCTAssertEqual(codexAuth.status, .invalid)
    XCTAssertTrue(codexAuth.message.contains("authentication is unavailable"))

    let claudeCandidate = AgentBackendPreflightCandidate(backend: .claudeCodeAgent, models: ["claude-sonnet-4"], nodeIds: ["manager"], stepIds: ["manager"])
    let claudeModel = ClaudeCodeAgentReadiness.modelValidation(
      candidate: claudeCandidate,
      model: "claude-sonnet-4",
      readiness: ClaudeBackendReadiness(
        ready: false,
        auth: ClaudeBackendAuthReadiness(state: .expired, available: false, verified: true, message: "Stored credentials are expired."),
        cli: ClaudeBackendCliReadiness(checked: false, available: false),
        model: ClaudeBackendModelReadiness(requested: "claude-sonnet-4", checked: false, available: false, timedOut: false)
      )
    )
    XCTAssertEqual(claudeModel.status, .invalid)
    XCTAssertTrue(claudeModel.message.contains("authentication failure"))

    let cursorCandidate = AgentBackendPreflightCandidate(backend: .cursorCliAgent, models: ["claude-sonnet-4-5"], nodeIds: ["cursor"], stepIds: ["cursor"])
    let cursorAuth = CursorCLIAgentReadiness.authValidation(candidate: cursorCandidate)
    XCTAssertEqual(cursorAuth.status, .unknown)
    XCTAssertTrue(cursorAuth.message.contains("no stable local auth-status command"))

    let cursorModel = CursorCLIAgentReadiness.modelValidation(
      candidate: cursorCandidate,
      availability: CursorBackendModelAvailability(
        model: "claude-sonnet-4-5",
        binary: AgentBackendToolInfo(name: "cursor-agent", command: "cursor-agent", status: .available),
        auth: CursorBackendAuthAvailability(status: .unavailable, detail: "login expired"),
        modelReachability: CursorBackendModelReachability(status: .unavailable, probed: true, error: "permission denied")
      )
    )
    XCTAssertEqual(cursorModel.status, .invalid)
    XCTAssertTrue(cursorModel.message.contains("authentication failure"))
  }

  func testReadinessAPIsUseInjectedProbeOperations() async {
    let codexCandidate = AgentBackendRequirementCandidate(backend: .codexAgent, models: ["gpt-5-nano"], sourceStepIds: ["worker"])
    let codexRequirement = await CodexAgentReadiness.runtimeRequirement(
      candidate: codexCandidate,
      operations: MockCodexReadinessOperations()
    )
    XCTAssertEqual(codexRequirement.status, .available)
    XCTAssertTrue(codexRequirement.detail.contains("codex=codex-cli 0.135.0"))

    let claudeCandidate = AgentBackendPreflightCandidate(backend: .claudeCodeAgent, models: ["claude-sonnet-4"], nodeIds: ["manager"], stepIds: ["manager"])
    let claudeModel = await ClaudeCodeAgentReadiness.modelValidation(
      candidate: claudeCandidate,
      model: "claude-sonnet-4",
      operations: MockClaudeReadinessOperations()
    )
    XCTAssertEqual(claudeModel.status, .valid)

    let cursorCandidate = AgentBackendPreflightCandidate(backend: .cursorCliAgent, models: ["claude-sonnet-4-5"], nodeIds: ["cursor"], stepIds: ["cursor"])
    let cursorRequirement = await CursorCLIAgentReadiness.runtimeRequirement(
      candidate: AgentBackendRequirementCandidate(backend: .cursorCliAgent, models: ["claude-sonnet-4-5"], sourceStepIds: ["cursor"]),
      operations: MockCursorReadinessOperations()
    )
    XCTAssertEqual(cursorRequirement.status, .available)
    let cursorModel = await CursorCLIAgentReadiness.modelValidation(
      candidate: cursorCandidate,
      model: "claude-sonnet-4-5",
      operations: MockCursorReadinessOperations()
    )
    XCTAssertEqual(cursorModel.status, .valid)
  }

  private func input(
    backend: NodeExecutionBackend,
    promptText: String = "hello",
    output: NodeOutputContract? = nil,
    model: String = "model",
    effort: NodeReasoningEffort? = nil,
    workingDirectory: String? = nil,
    systemPromptText: String? = nil,
    variables: JSONObject = [:],
    arguments: JSONObject = [:],
    mergedVariables: JSONObject = [:]
  ) -> AdapterExecutionInput {
    AdapterExecutionInput(
      node: AgentNodePayload(
        id: "worker",
        executionBackend: backend,
        model: model,
        effort: effort,
        workingDirectory: workingDirectory,
        variables: variables,
        output: output
      ),
      promptText: promptText,
      systemPromptText: systemPromptText,
      arguments: arguments,
      mergedVariables: mergedVariables
    )
  }
}
