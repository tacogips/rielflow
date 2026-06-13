import Foundation
import XCTest
@testable import RielflowAdapters
@testable import RielflowCore

final class WorkflowStdioNodeExecutorTests: XCTestCase {
  func testCommandNodePassesInputJSONLOnStdinAndReadsStdoutJSONL() async throws {
    let runner = RecordingStdioNodeProcessRunner { configuration, stdin in
      let lines = stdin.split(whereSeparator: \.isNewline)
      XCTAssertEqual(lines.count, 1)
      let inputData = try XCTUnwrap(String(lines[0]).data(using: .utf8))
      let decoded = try JSONDecoder().decode(WorkflowStdioNodeInvocationEnvelope.self, from: inputData)
      XCTAssertEqual(decoded.workflowId, "workflow")
      XCTAssertEqual(decoded.workflowExecutionId, "session")
      XCTAssertEqual(decoded.stepId, "step")
      XCTAssertEqual(decoded.nodeId, "node")
      XCTAssertEqual(decoded.nodeType, "command")
      XCTAssertEqual(decoded.input["upstream"], .string("ready"))
      XCTAssertEqual(decoded.variables["target"], .string("prod"))
      XCTAssertNil(configuration.environment["RIEL_MAILBOX_DIR"])
      XCTAssertNil(configuration.environment["RIELFLOW_WORKFLOW_INPUT"])
      XCTAssertNil(configuration.environment["RIELFLOW_WORKFLOW_OUTPUT"])
      return #"{"status":"ok"}"# + "\n"
    }
    let executor = LocalWorkflowStdioNodeExecutor(runner: runner)

    let result = try await executor.execute(
      input(kind: .command, node: AgentNodePayload(
        id: "node",
        nodeType: .command,
        model: "",
        command: WorkflowCommandExecution(
          executable: "node",
          arguments: ["worker.js"],
          environment: [
            "RIEL_MAILBOX_DIR": "/tmp/legacy",
            "RIELFLOW_WORKFLOW_INPUT": "legacy-input",
            "RIELFLOW_WORKFLOW_OUTPUT": "legacy-output",
            "KEEP": "1",
          ]
        )
      )),
      context: AdapterExecutionContext()
    )

    XCTAssertEqual(result.payload, ["status": .string("ok")])
    let configurations = await runner.configurations()
    let configuration = try XCTUnwrap(configurations.first)
    XCTAssertEqual(configuration.executableURL.path, "/usr/bin/env")
    XCTAssertEqual(configuration.arguments, ["node", "worker.js"])
    XCTAssertEqual(configuration.environment["KEEP"], "1")
    XCTAssertTrue(configuration.unsetEnvironmentKeys.contains("RIELFLOW_WORKFLOW_INPUT"))
    XCTAssertTrue(configuration.unsetEnvironmentKeys.contains("RIELFLOW_WORKFLOW_OUTPUT"))
  }

  func testEmptyStdoutMeansNoWorkflowOutput() async throws {
    let runner = RecordingStdioNodeProcessRunner { _, _ in
      ""
    }
    let executor = LocalWorkflowStdioNodeExecutor(runner: runner)

    let result = try await executor.execute(
      input(kind: .command, node: AgentNodePayload(
        id: "node",
        nodeType: .command,
        model: "",
        command: WorkflowCommandExecution(executable: "/bin/sh", arguments: ["-c", "true"])
      )),
      context: AdapterExecutionContext()
    )

    XCTAssertNil(result.payload)
  }

  func testInvalidStdoutJSONLFailsBeforePublication() async throws {
    let runner = RecordingStdioNodeProcessRunner { _, _ in
      "{not-json\n"
    }
    let executor = LocalWorkflowStdioNodeExecutor(runner: runner)

    do {
      _ = try await executor.execute(
        input(kind: .command, node: AgentNodePayload(
          id: "node",
          nodeType: .command,
          model: "",
          command: WorkflowCommandExecution(executable: "/bin/sh")
        )),
        context: AdapterExecutionContext()
      )
      XCTFail("expected invalid JSON failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .invalidOutput)
      XCTAssertTrue(error.message.contains("stdout"))
    }
  }

  func testMultipleStdoutJSONLRecordsFailClosed() async throws {
    let runner = RecordingStdioNodeProcessRunner { _, _ in
      #"{"one":1}"# + "\n" + #"{"two":2}"# + "\n"
    }
    let executor = LocalWorkflowStdioNodeExecutor(runner: runner)

    do {
      _ = try await executor.execute(
        input(kind: .command, node: AgentNodePayload(
          id: "node",
          nodeType: .command,
          model: "",
          command: WorkflowCommandExecution(executable: "/bin/sh")
        )),
        context: AdapterExecutionContext()
      )
      XCTFail("expected multiple JSONL output record failure")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .invalidOutput)
      XCTAssertTrue(error.message.contains("at most one JSONL output record"))
    }
  }

  func testContainerNodeUsesStdinAndStdoutJSONLContract() async throws {
    let runner = RecordingStdioNodeProcessRunner { configuration, stdin in
      XCTAssertFalse(stdin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      XCTAssertNil(configuration.environment["RIELFLOW_WORKFLOW_INPUT"])
      XCTAssertNil(configuration.environment["RIELFLOW_WORKFLOW_OUTPUT"])
      return #"{"container":true}"# + "\n"
    }
    let executor = LocalWorkflowStdioNodeExecutor(runner: runner)

    let result = try await executor.execute(
      input(kind: .container, node: AgentNodePayload(
        id: "node",
        nodeType: .container,
        model: "",
        container: WorkflowContainerExecution(
          image: "ghcr.io/example/worker:latest",
          runnerKind: "docker",
          command: ["./run.sh"],
          environment: [
            "RIEL_MAILBOX_DIR": "/tmp/legacy",
            "RIELFLOW_WORKFLOW_INPUT": "legacy-input",
            "RIELFLOW_WORKFLOW_OUTPUT": "legacy-output",
            "APP_ENV": "test",
          ]
        )
      )),
      context: AdapterExecutionContext()
    )

    XCTAssertEqual(result.payload, ["container": .bool(true)])
    let configurations = await runner.configurations()
    let configuration = try XCTUnwrap(configurations.first)
    XCTAssertEqual(configuration.executableURL.path, "/usr/bin/env")
    XCTAssertEqual(Array(configuration.arguments.prefix(4)), ["docker", "run", "--rm", "-i"])
    XCTAssertTrue(configuration.arguments.contains("APP_ENV"))
    XCTAssertFalse(configuration.arguments.contains("RIEL_MAILBOX_DIR"))
    XCTAssertFalse(configuration.arguments.contains("RIELFLOW_WORKFLOW_INPUT"))
    XCTAssertFalse(configuration.arguments.contains("RIELFLOW_WORKFLOW_OUTPUT"))
  }

  private func input(kind: WorkflowStdioNodeExecutionKind, node: AgentNodePayload) -> WorkflowStdioNodeExecutionInput {
    WorkflowStdioNodeExecutionInput(
      workflowId: "workflow",
      sessionId: "session",
      stepId: "step",
      nodeId: "node",
      executionIndex: 1,
      kind: kind,
      node: node,
      variables: ["target": .string("prod")],
      resolvedInputPayload: ["upstream": .string("ready")]
    )
  }
}

private actor RecordingStdioNodeProcessRunner: LocalAgentProcessRunning {
  typealias Handler = @Sendable (LocalAgentProcessConfiguration, String) throws -> String

  private let handler: Handler
  private var capturedConfigurations: [LocalAgentProcessConfiguration] = []

  init(handler: @escaping Handler) {
    self.handler = handler
  }

  func run(
    configuration: LocalAgentProcessConfiguration,
    stdin: String,
    deadline: Date?
  ) async throws -> LocalAgentProcessResult {
    capturedConfigurations.append(configuration)
    let stdout = try handler(configuration, stdin)
    return LocalAgentProcessResult(stdout: stdout, stderr: "", terminationStatus: 0)
  }

  func configurations() -> [LocalAgentProcessConfiguration] {
    capturedConfigurations
  }
}
