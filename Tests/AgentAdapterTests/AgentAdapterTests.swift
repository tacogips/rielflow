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
    XCTAssertFalse(stdin.isEmpty)
    XCTAssertEqual(configuration.environment["RIEL_AGENT_BACKEND"]?.isEmpty, false)
    return LocalAgentProcessResult(stdout: output, stderr: error, terminationStatus: status)
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
    let adapter = CodexAgentAdapter(runner: CapturingRunner(output: "", error: stderr, status: 1))

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

  private func input(backend: NodeExecutionBackend, output: NodeOutputContract? = nil) -> AdapterExecutionInput {
    AdapterExecutionInput(
      node: AgentNodePayload(id: "worker", executionBackend: backend, model: "model", output: output),
      promptText: "hello"
    )
  }
}
