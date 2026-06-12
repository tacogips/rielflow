import RielflowAdapters
import RielflowCore
import XCTest
@testable import RielflowCLI

final class WorkflowCommandTests: XCTestCase {
  func testValidateInspectAndDeterministicRunWorkerFixture() async throws {
    let root = repositoryRoot()
    let app = RielflowCLIApplication()

    let validate = await app.run([
      "workflow", "validate", "worker-only-single-step",
      "--workflow-definition-dir", "\(root)/examples",
      "--output", "json",
    ])
    XCTAssertEqual(validate.exitCode, .success)
    XCTAssertTrue(validate.stderr.isEmpty)
    let validation = try decodeJSON(WorkflowValidationCommandResult.self, from: validate.stdout)
    XCTAssertTrue(validation.valid)
    XCTAssertEqual(validation.workflowId, "worker-only-single-step")
    XCTAssertEqual(validation.sourceScope, .direct)

    let inspect = await app.run([
      "workflow", "inspect", "worker-only-single-step",
      "--workflow-definition-dir", "\(root)/examples",
      "--output", "json",
      "--structure",
    ])
    XCTAssertEqual(inspect.exitCode, .success)
    let summary = try decodeJSON(WorkflowInspectionSummary.self, from: inspect.stdout)
    XCTAssertEqual(summary.entryStepId, "main-worker")
    XCTAssertEqual(summary.stepIds, ["main-worker"])
    XCTAssertEqual(summary.counts.steps, 1)
    XCTAssertEqual(summary.counts.crossWorkflowDispatches, 0)

    let run = await app.run([
      "workflow", "run", "worker-only-single-step",
      "--workflow-definition-dir", "\(root)/examples",
      "--mock-scenario", "\(root)/examples/worker-only-single-step/mock-scenario.json",
      "--output", "json",
    ])
    XCTAssertEqual(run.exitCode, .success)
    let result = try decodeJSON(WorkflowRunResult.self, from: run.stdout)
    XCTAssertEqual(result.workflowId, "worker-only-single-step")
    XCTAssertEqual(result.status, .completed)
    XCTAssertEqual(result.nodeExecutions, 1)
    XCTAssertEqual(result.transitions, 0)
    XCTAssertEqual(result.rootOutput?["status"], .string("ready"))
  }

  func testNodePatchIsInMemoryOnly() async throws {
    let root = repositoryRoot()
    let nodePath = "\(root)/examples/worker-only-single-step/nodes/node-main-worker.json"
    let before = try String(contentsOfFile: nodePath, encoding: .utf8)
    let app = RielflowCLIApplication()
    let result = await app.run([
      "workflow", "validate", "worker-only-single-step",
      "--workflow-definition-dir", "\(root)/examples",
      "--node-patch", #"{"main-worker":{"model":"gpt-5-mini","effort":"low"}}"#,
      "--executable",
      "--output", "json",
    ])
    XCTAssertEqual(result.exitCode, .success)
    let after = try String(contentsOfFile: nodePath, encoding: .utf8)
    XCTAssertEqual(after, before)
  }

  func testInspectReportsCallableInputAndOutputContracts() async throws {
    let root = repositoryRoot()
    let result = await RielflowCLIApplication().run([
      "workflow", "inspect", "codex-design-and-implement-review-loop",
      "--scope", "project",
      "--working-dir", root,
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .success)
    XCTAssertTrue(result.stderr.isEmpty)
    let summary = try decodeJSON(WorkflowInspectionSummary.self, from: result.stdout)
    XCTAssertEqual(summary.callable.stepId, "rielflow-manager")
    XCTAssertEqual(summary.callable.role, .manager)
    XCTAssertEqual(
      summary.callable.input?.description,
      "Provide either issue reference details for full issue resolution or Codex-reference planning details for a design-plan-only run. Preferred fields are executionMode, issueUrl, issueNumber, issueRepository, issueTitle, issueBody, targetFeatureArea, requestedBehavior, codexAgentReferences, referenceRepositoryRoot, and referenceRepositoryUrl."
    )
    XCTAssertEqual(
      summary.callable.output?.description,
      "Return either the final accepted issue-resolution summary or the accepted design-and-implementation-plan handoff, including any required documentation refresh, the final commit-message, and commit/push status, depending on the requested workflow mode."
    )
  }

  func testRunAcceptsTemporaryWorkflowJSONFileTarget() async throws {
    let root = repositoryRoot()
    let app = RielflowCLIApplication()
    let result = await app.run([
      "workflow", "run", "\(root)/examples/temporary-workflow/temp-workflow.json",
      "--mock-scenario", "\(root)/examples/worker-only-single-step/mock-scenario.json",
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .success)
    let run = try decodeJSON(WorkflowRunResult.self, from: result.stdout)
    XCTAssertEqual(run.workflowId, "temporary-embedded-status")
    XCTAssertEqual(run.status, .completed)
    XCTAssertEqual(run.nodeExecutions, 1)
  }

  func testRunRejectsUnsupportedPersistenceAndConcurrencyOptions() async throws {
    let root = repositoryRoot()
    let unsupportedOptions = [
      ["--artifact-root", "\(root)/.tmp-artifacts"],
      ["--session-store", "\(root)/.tmp-session-store"],
      ["--max-concurrency", "2"],
    ]

    for option in unsupportedOptions {
      let result = await RielflowCLIApplication().run([
        "workflow", "run", "worker-only-single-step",
        "--workflow-definition-dir", "\(root)/examples",
      ] + option)

      XCTAssertEqual(result.exitCode, .usage, "expected usage rejection for \(option)")
      XCTAssertTrue(result.stderr.contains("not supported by the Swift TASK-007"))
    }
  }

  func testValidateAndInspectRejectRemoteResolutionFlagsWithUsageExit() async throws {
    let app = RielflowCLIApplication()

    let validate = await app.run([
      "workflow", "validate", "worker-only-single-step",
      "--endpoint", "http://localhost:4000/graphql",
    ])
    XCTAssertEqual(validate.exitCode, .usage)
    XCTAssertEqual(validate.stderr, "Swift TASK-007 supports local workflow validate only")

    let inspect = await app.run([
      "workflow", "inspect", "worker-only-single-step",
      "--from-registry",
    ])
    XCTAssertEqual(inspect.exitCode, .usage)
    XCTAssertEqual(inspect.stderr, "Swift TASK-007 supports local workflow inspect only")
  }

  func testRunJSONFailureReturnsParseableFailureEnvelope() async throws {
    let root = repositoryRoot()
    let result = await RielflowCLIApplication().run([
      "workflow", "run", "worker-only-single-step",
      "--workflow-definition-dir", "\(root)/examples",
      "--variables", #"{"unterminated": true"#,
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .failure)
    XCTAssertTrue(result.stderr.isEmpty)
    let failure = try decodeJSON(WorkflowRunFailureResult.self, from: result.stdout)
    XCTAssertEqual(failure.target, "worker-only-single-step")
    XCTAssertEqual(failure.status, .failed)
    XCTAssertEqual(failure.exitCode, CLIExitCode.failure.rawValue)
    XCTAssertFalse(failure.error.isEmpty)
  }

  func testParserRunJSONFailureReturnsParseableEnvelopeForUnsupportedEndpoint() async throws {
    let result = await RielflowCLIApplication().run([
      "workflow", "run", "worker-only-single-step",
      "--endpoint", "http://localhost:4000/graphql",
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .usage)
    XCTAssertTrue(result.stderr.isEmpty)
    let failure = try decodeJSON(WorkflowRunFailureResult.self, from: result.stdout)
    XCTAssertEqual(failure.target, "worker-only-single-step")
    XCTAssertEqual(failure.status, .failed)
    XCTAssertEqual(failure.exitCode, CLIExitCode.usage.rawValue)
    XCTAssertTrue(failure.error.contains("deterministic local workflow run only"))
  }

  func testParserValidateJSONFailureReturnsParseableEnvelopeForUnknownOption() async throws {
    let result = await RielflowCLIApplication().run([
      "workflow", "validate", "worker-only-single-step",
      "--unknown",
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .usage)
    XCTAssertTrue(result.stderr.isEmpty)
    let failure = try decodeJSON(WorkflowValidationFailureResult.self, from: result.stdout)
    XCTAssertFalse(failure.valid)
    XCTAssertEqual(failure.workflowId, "worker-only-single-step")
    XCTAssertEqual(failure.exitCode, CLIExitCode.usage.rawValue)
    XCTAssertTrue(failure.error.contains("unknown option '--unknown'"))
  }

  func testParserInspectJSONFailureReturnsParseableEnvelopeForMissingOptionValue() async throws {
    let result = await RielflowCLIApplication().run([
      "workflow", "inspect", "worker-only-single-step",
      "--workflow-definition-dir",
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .usage)
    XCTAssertTrue(result.stderr.isEmpty)
    let failure = try decodeJSON(WorkflowInspectionFailureResult.self, from: result.stdout)
    XCTAssertEqual(failure.workflowId, "worker-only-single-step")
    XCTAssertEqual(failure.exitCode, CLIExitCode.usage.rawValue)
    XCTAssertTrue(failure.error.contains("--workflow-definition-dir requires a value"))
  }

  func testScopedWorkflowNamesRejectTraversalAndSlashTargets() async throws {
    let validate = await RielflowCLIApplication().run([
      "workflow", "validate", "../../examples/worker-only-single-step",
      "--scope", "project",
      "--output", "json",
    ])
    XCTAssertEqual(validate.exitCode, .usage)
    XCTAssertTrue(validate.stderr.isEmpty)
    let validateFailure = try decodeJSON(WorkflowValidationFailureResult.self, from: validate.stdout)
    XCTAssertEqual(validateFailure.workflowId, "../../examples/worker-only-single-step")
    XCTAssertEqual(validateFailure.exitCode, CLIExitCode.usage.rawValue)
    XCTAssertTrue(validateFailure.error.contains("invalid scoped workflow name"))

    let inspect = await RielflowCLIApplication().run([
      "workflow", "inspect", "nested/workflow",
      "--scope", "project",
      "--output", "json",
    ])
    XCTAssertEqual(inspect.exitCode, .usage)
    XCTAssertTrue(inspect.stderr.isEmpty)
    let inspectFailure = try decodeJSON(WorkflowInspectionFailureResult.self, from: inspect.stdout)
    XCTAssertEqual(inspectFailure.workflowId, "nested/workflow")
    XCTAssertEqual(inspectFailure.exitCode, CLIExitCode.usage.rawValue)
    XCTAssertTrue(inspectFailure.error.contains("invalid scoped workflow name"))

    let run = await RielflowCLIApplication().run([
      "workflow", "run", "../worker-only-single-step",
      "--scope", "project",
      "--output", "json",
    ])
    XCTAssertEqual(run.exitCode, .usage)
    XCTAssertTrue(run.stderr.isEmpty)
    let runFailure = try decodeJSON(WorkflowRunFailureResult.self, from: run.stdout)
    XCTAssertEqual(runFailure.target, "../worker-only-single-step")
    XCTAssertEqual(runFailure.exitCode, CLIExitCode.usage.rawValue)
    XCTAssertTrue(runFailure.error.contains("invalid scoped workflow name"))
  }

  func testScopedWorkflowResolutionRejectsSymlinkEscapes() async throws {
    let root = repositoryRoot()
    let tempDir = FileManager.default.temporaryDirectory
      .appendingPathComponent("rielflow-cli-symlink-escape-\(UUID().uuidString)", isDirectory: true)
    let scopedRoot = tempDir
      .appendingPathComponent(".rielflow", isDirectory: true)
      .appendingPathComponent("workflows", isDirectory: true)
    try FileManager.default.createDirectory(at: scopedRoot, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }
    try FileManager.default.createSymbolicLink(
      at: scopedRoot.appendingPathComponent("escape"),
      withDestinationURL: URL(fileURLWithPath: "\(root)/examples/worker-only-single-step").standardizedFileURL
    )

    let validate = await RielflowCLIApplication().run([
      "workflow", "validate", "escape",
      "--scope", "project",
      "--working-dir", tempDir.path,
      "--output", "json",
    ])
    XCTAssertEqual(validate.exitCode, .failure)
    XCTAssertTrue(validate.stderr.isEmpty)
    let validateFailure = try decodeJSON(WorkflowValidationFailureResult.self, from: validate.stdout)
    XCTAssertFalse(validateFailure.valid)
    XCTAssertEqual(validateFailure.workflowId, "escape")
    XCTAssertTrue(validateFailure.error.contains("escapes"))

    let inspect = await RielflowCLIApplication().run([
      "workflow", "inspect", "escape",
      "--scope", "project",
      "--working-dir", tempDir.path,
      "--output", "json",
    ])
    XCTAssertEqual(inspect.exitCode, .failure)
    XCTAssertTrue(inspect.stderr.isEmpty)
    let inspectFailure = try decodeJSON(WorkflowInspectionFailureResult.self, from: inspect.stdout)
    XCTAssertEqual(inspectFailure.workflowId, "escape")
    XCTAssertTrue(inspectFailure.error.contains("escapes"))

    let run = await RielflowCLIApplication().run([
      "workflow", "run", "escape",
      "--scope", "project",
      "--working-dir", tempDir.path,
      "--output", "json",
    ])
    XCTAssertEqual(run.exitCode, .failure)
    XCTAssertTrue(run.stderr.isEmpty)
    let runFailure = try decodeJSON(WorkflowRunFailureResult.self, from: run.stdout)
    XCTAssertEqual(runFailure.target, "escape")
    XCTAssertTrue(runFailure.error.contains("escapes"))
  }

  func testScopedWorkflowResolutionRejectsSymlinkedWorkflowJSON() async throws {
    let root = repositoryRoot()
    let tempDir = FileManager.default.temporaryDirectory
      .appendingPathComponent("rielflow-cli-workflow-json-symlink-\(UUID().uuidString)", isDirectory: true)
    let workflowDir = tempDir
      .appendingPathComponent(".rielflow", isDirectory: true)
      .appendingPathComponent("workflows", isDirectory: true)
      .appendingPathComponent("escape", isDirectory: true)
    try FileManager.default.createDirectory(at: workflowDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }
    try FileManager.default.createSymbolicLink(
      at: workflowDir.appendingPathComponent("workflow.json"),
      withDestinationURL: URL(fileURLWithPath: "\(root)/examples/worker-only-single-step/workflow.json").standardizedFileURL
    )

    try await assertScopedProjectWorkflowEscapeRejected(workingDirectory: tempDir)
  }

  func testScopedWorkflowResolutionRejectsSymlinkedNodePayload() async throws {
    let root = repositoryRoot()
    let tempDir = FileManager.default.temporaryDirectory
      .appendingPathComponent("rielflow-cli-node-payload-symlink-\(UUID().uuidString)", isDirectory: true)
    let workflowDir = tempDir
      .appendingPathComponent(".rielflow", isDirectory: true)
      .appendingPathComponent("workflows", isDirectory: true)
      .appendingPathComponent("escape", isDirectory: true)
    let nodesDir = workflowDir.appendingPathComponent("nodes", isDirectory: true)
    try FileManager.default.createDirectory(at: nodesDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }
    let workflowJSON = try String(
      contentsOfFile: "\(root)/examples/worker-only-single-step/workflow.json",
      encoding: .utf8
    )
    try workflowJSON.write(to: workflowDir.appendingPathComponent("workflow.json"), atomically: true, encoding: .utf8)
    try FileManager.default.createSymbolicLink(
      at: nodesDir.appendingPathComponent("node-main-worker.json"),
      withDestinationURL: URL(fileURLWithPath: "\(root)/examples/worker-only-single-step/nodes/node-main-worker.json").standardizedFileURL
    )

    try await assertScopedProjectWorkflowEscapeRejected(workingDirectory: tempDir)
  }

  func testAddonOnlyExecutableValidationMatchesDeterministicRunFailure() async throws {
    let tempDir = FileManager.default.temporaryDirectory
      .appendingPathComponent("rielflow-cli-addon-only-\(UUID().uuidString)", isDirectory: true)
    let workflowDir = tempDir.appendingPathComponent("addon-demo", isDirectory: true)
    try FileManager.default.createDirectory(at: workflowDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }
    try """
    {
      "workflowId": "addon-demo",
      "defaults": { "maxLoopIterations": 3, "nodeTimeoutMs": 120000 },
      "entryStepId": "addon-step",
      "nodes": [
        { "id": "addon-node", "addon": { "name": "missing-addon" } }
      ],
      "steps": [
        { "id": "addon-step", "nodeId": "addon-node", "role": "worker" }
      ]
    }
    """.write(to: workflowDir.appendingPathComponent("workflow.json"), atomically: true, encoding: .utf8)

    let validate = await RielflowCLIApplication().run([
      "workflow", "validate", "addon-demo",
      "--workflow-definition-dir", tempDir.path,
      "--executable",
      "--output", "json",
    ])
    XCTAssertEqual(validate.exitCode, .failure)
    XCTAssertTrue(validate.stderr.isEmpty)
    let validation = try decodeJSON(WorkflowValidationCommandResult.self, from: validate.stdout)
    XCTAssertFalse(validation.valid)
    XCTAssertEqual(validation.nodeValidationResults.count, 1)
    XCTAssertEqual(validation.nodeValidationResults.first?.nodeId, "addon-node")
    XCTAssertEqual(validation.nodeValidationResults.first?.valid, false)
    XCTAssertTrue(validation.nodeValidationResults.first?.message.contains("addon-only nodes are not executable") == true)

    let run = await RielflowCLIApplication().run([
      "workflow", "run", "addon-demo",
      "--workflow-definition-dir", tempDir.path,
      "--output", "json",
    ])
    XCTAssertEqual(run.exitCode, .failure)
    XCTAssertTrue(run.stderr.isEmpty)
    let failure = try decodeJSON(WorkflowRunFailureResult.self, from: run.stdout)
    XCTAssertEqual(failure.target, "addon-demo")
    XCTAssertTrue(failure.error.contains("missingNodePayload"))
  }

  func testValidateJSONFailureReturnsParseableEnvelopeForMissingWorkflow() async throws {
    let result = await RielflowCLIApplication().run([
      "workflow", "validate", "definitely-missing-workflow",
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .failure)
    XCTAssertTrue(result.stderr.isEmpty)
    let failure = try decodeJSON(WorkflowValidationFailureResult.self, from: result.stdout)
    XCTAssertFalse(failure.valid)
    XCTAssertEqual(failure.workflowId, "definitely-missing-workflow")
    XCTAssertEqual(failure.exitCode, CLIExitCode.failure.rawValue)
    XCTAssertTrue(failure.error.contains("notFound"))
  }

  func testValidateJSONFailureReturnsDiagnosticsForInvalidWorkflow() async throws {
    let tempDir = FileManager.default.temporaryDirectory
      .appendingPathComponent("rielflow-cli-invalid-workflow-\(UUID().uuidString)", isDirectory: true)
    let workflowDir = tempDir.appendingPathComponent("broken", isDirectory: true)
    try FileManager.default.createDirectory(at: workflowDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }
    try """
    {
      "workflowId": "broken",
      "defaults": { "maxLoopIterations": 3, "nodeTimeoutMs": 120000 },
      "entryStepId": "missing-entry",
      "nodes": [{ "id": "node", "nodeFile": "nodes/node.json" }],
      "steps": [{ "id": "step", "nodeId": "node", "role": "worker" }]
    }
    """.write(to: workflowDir.appendingPathComponent("workflow.json"), atomically: true, encoding: .utf8)

    let result = await RielflowCLIApplication().run([
      "workflow", "validate", "broken",
      "--workflow-definition-dir", tempDir.path,
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .failure)
    XCTAssertTrue(result.stderr.isEmpty)
    let failure = try decodeJSON(WorkflowValidationFailureResult.self, from: result.stdout)
    XCTAssertFalse(failure.valid)
    XCTAssertEqual(failure.workflowId, "broken")
    XCTAssertTrue(failure.error.contains("invalidWorkflow"))
    XCTAssertTrue(failure.diagnostics.contains {
      $0.path == "workflow.entryStepId" && $0.message.contains("missing-entry")
    })
  }

  func testValidateJSONFailureReturnsParseableEnvelopeForMalformedNodePatch() async throws {
    let root = repositoryRoot()
    let result = await RielflowCLIApplication().run([
      "workflow", "validate", "worker-only-single-step",
      "--workflow-definition-dir", "\(root)/examples",
      "--node-patch", #"{"unterminated": true"#,
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .failure)
    XCTAssertTrue(result.stderr.isEmpty)
    let failure = try decodeJSON(WorkflowValidationFailureResult.self, from: result.stdout)
    XCTAssertFalse(failure.valid)
    XCTAssertEqual(failure.workflowId, "worker-only-single-step")
    XCTAssertFalse(failure.error.isEmpty)
  }

  func testInspectJSONFailureReturnsParseableEnvelopeForMissingWorkflow() async throws {
    let result = await RielflowCLIApplication().run([
      "workflow", "inspect", "definitely-missing-workflow",
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .failure)
    XCTAssertTrue(result.stderr.isEmpty)
    let failure = try decodeJSON(WorkflowInspectionFailureResult.self, from: result.stdout)
    XCTAssertEqual(failure.workflowId, "definitely-missing-workflow")
    XCTAssertEqual(failure.exitCode, CLIExitCode.failure.rawValue)
    XCTAssertTrue(failure.error.contains("notFound"))
  }

  func testInspectJSONFailureReturnsDiagnosticsForInvalidWorkflow() async throws {
    let tempDir = FileManager.default.temporaryDirectory
      .appendingPathComponent("rielflow-cli-invalid-inspect-\(UUID().uuidString)", isDirectory: true)
    let workflowDir = tempDir.appendingPathComponent("broken", isDirectory: true)
    try FileManager.default.createDirectory(at: workflowDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }
    try """
    {
      "workflowId": "broken",
      "defaults": { "maxLoopIterations": 3, "nodeTimeoutMs": 120000 },
      "entryStepId": "missing-entry",
      "nodes": [{ "id": "node", "nodeFile": "nodes/node.json" }],
      "steps": [{ "id": "step", "nodeId": "node", "role": "worker" }]
    }
    """.write(to: workflowDir.appendingPathComponent("workflow.json"), atomically: true, encoding: .utf8)

    let result = await RielflowCLIApplication().run([
      "workflow", "inspect", "broken",
      "--workflow-definition-dir", tempDir.path,
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .failure)
    XCTAssertTrue(result.stderr.isEmpty)
    let failure = try decodeJSON(WorkflowInspectionFailureResult.self, from: result.stdout)
    XCTAssertEqual(failure.workflowId, "broken")
    XCTAssertTrue(failure.error.contains("invalidWorkflow"))
    XCTAssertTrue(failure.diagnostics.contains {
      $0.path == "workflow.entryStepId" && $0.message.contains("missing-entry")
    })
  }

  func testScenarioSequenceRetriesInvalidOutputContractBeforePublishingTransition() async throws {
    let store = InMemoryWorkflowRuntimeStore()
    let scenario = WorkflowMockScenario(responses: [
      "step": [
        MockNodeResponse(payload: ["other": .string("invalid")]),
        MockNodeResponse(payload: ["status": .string("valid")]),
      ],
    ])
    let runner = DeterministicWorkflowRunner(
      store: store,
      adapter: ScenarioNodeAdapter(scenario: scenario)
    )
    let workflow = WorkflowDefinition(
      workflowId: "retry-scenario",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 3),
      entryStepId: "step",
      nodeRegistry: [
        WorkflowNodeRegistryRef(id: "node", nodeFile: "nodes/node.json"),
        WorkflowNodeRegistryRef(id: "next-node", nodeFile: "nodes/next-node.json"),
      ],
      steps: [
        WorkflowStepRef(id: "step", nodeId: "node", transitions: [WorkflowStepTransition(toStepId: "next")]),
        WorkflowStepRef(id: "next", nodeId: "next-node"),
      ],
      nodes: [
        WorkflowNodeRef(id: "step", nodeFile: "nodes/node.json"),
        WorkflowNodeRef(id: "next", nodeFile: "nodes/next-node.json"),
      ]
    )
    let result = try await runner.run(DeterministicWorkflowRunRequest(
      workflow: workflow,
      nodePayloads: [
        "node": AgentNodePayload(
          id: "node",
          executionBackend: .codexAgent,
          model: "gpt-5-nano",
          output: NodeOutputContract(
            jsonSchema: [
              "type": .string("object"),
              "required": .array([.string("status")]),
            ],
            maxValidationAttempts: 2
          )
        ),
        "next-node": AgentNodePayload(id: "next-node", executionBackend: .codexAgent, model: "gpt-5-nano"),
      ]
    ))

    XCTAssertEqual(result.status, .completed)
    let retriedExecutions = result.session.executions.filter { $0.stepId == "step" }
    XCTAssertEqual(retriedExecutions.map(\.attempt), [1, 2])
    XCTAssertEqual(retriedExecutions.map(\.status), [.failed, .completed])
    XCTAssertEqual(retriedExecutions.first?.acceptedOutput, nil)
    XCTAssertEqual(retriedExecutions.last?.acceptedOutput?.payload["status"], .string("valid"))
    let messages = try await store.listMessages(for: result.session.sessionId, toStepId: nil)
    XCTAssertEqual(messages.count, 1)
    XCTAssertEqual(messages.first?.sourceStepExecutionId, retriedExecutions.last?.executionId)
  }

  func testScenarioSequenceSkipsUnusedRetrySlotsForRepeatedStepExecutions() async throws {
    let store = InMemoryWorkflowRuntimeStore()
    let scenario = WorkflowMockScenario(responses: [
      "step": [
        MockNodeResponse(when: ["loop": true], payload: ["status": .string("first")]),
        MockNodeResponse(fail: true),
        MockNodeResponse(when: ["loop": false, "done": true], payload: ["status": .string("second")]),
      ],
    ])
    let runner = DeterministicWorkflowRunner(
      store: store,
      adapter: ScenarioNodeAdapter(scenario: scenario)
    )
    let workflow = WorkflowDefinition(
      workflowId: "repeat-scenario",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 3),
      entryStepId: "step",
      nodeRegistry: [
        WorkflowNodeRegistryRef(id: "node", nodeFile: "nodes/node.json"),
        WorkflowNodeRegistryRef(id: "final-node", nodeFile: "nodes/final-node.json"),
      ],
      steps: [
        WorkflowStepRef(id: "step", nodeId: "node", transitions: [
          WorkflowStepTransition(toStepId: "step", label: "loop"),
          WorkflowStepTransition(toStepId: "final", label: "done"),
        ]),
        WorkflowStepRef(id: "final", nodeId: "final-node"),
      ],
      nodes: [
        WorkflowNodeRef(id: "step", nodeFile: "nodes/node.json"),
        WorkflowNodeRef(id: "final", nodeFile: "nodes/final-node.json"),
      ]
    )
    let result = try await runner.run(DeterministicWorkflowRunRequest(
      workflow: workflow,
      nodePayloads: [
        "node": AgentNodePayload(
          id: "node",
          executionBackend: .codexAgent,
          model: "gpt-5-nano",
          output: NodeOutputContract(
            jsonSchema: [
              "type": .string("object"),
              "required": .array([.string("status")]),
            ],
            maxValidationAttempts: 2
          )
        ),
        "final-node": AgentNodePayload(id: "final-node", executionBackend: .codexAgent, model: "gpt-5-nano"),
      ],
      maxSteps: 3
    ))

    XCTAssertEqual(result.status, .completed)
    XCTAssertEqual(result.nodeExecutions, 3)
    XCTAssertEqual(result.transitions, 2)
    let executions = result.session.executions.filter { $0.stepId == "step" }
    XCTAssertEqual(executions.map(\.attempt), [1, 1])
    XCTAssertEqual(executions.map(\.acceptedOutput?.payload["status"]), [.string("first"), .string("second")])
    let messages = try await store.listMessages(for: result.session.sessionId, toStepId: nil)
    XCTAssertEqual(messages.map(\.toStepId), ["step", "final"])
  }

  func testScenarioLookupUsesExecutingStepIdWhenNodeIsReusable() async throws {
    let tempDir = FileManager.default.temporaryDirectory
      .appendingPathComponent("rielflow-cli-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }
    let scenarioURL = tempDir.appendingPathComponent("scenario.json")
    try """
    {
      "step-a": {
        "provider": "scenario-mock",
        "model": "gpt-5-nano",
        "payload": {
          "status": "step-key-used"
        }
      }
    }
    """.write(to: scenarioURL, atomically: true, encoding: .utf8)
    let workflowJSON = """
    {
      "workflow": {
        "workflowId": "reusable-node-scenario",
        "defaults": {
          "maxLoopIterations": 3,
          "nodeTimeoutMs": 120000
        },
        "entryStepId": "step-a",
        "nodes": [
          {
            "id": "shared-worker",
            "nodeFile": "nodes/shared-worker.json"
          }
        ],
        "steps": [
          {
            "id": "step-a",
            "nodeId": "shared-worker",
            "role": "worker"
          }
        ]
      },
      "nodePayloads": {
        "nodes/shared-worker.json": {
          "id": "shared-worker",
          "executionBackend": "codex-agent",
          "model": "gpt-5-nano",
          "variables": {}
        }
      }
    }
    """

    let result = await RielflowCLIApplication().run([
      "workflow", "run", workflowJSON,
      "--mock-scenario", scenarioURL.path,
      "--output", "json",
    ])

    XCTAssertEqual(result.exitCode, .success)
    let run = try decodeJSON(WorkflowRunResult.self, from: result.stdout)
    XCTAssertEqual(run.rootOutput?["status"], .string("step-key-used"))
    XCTAssertEqual(run.session.executions.first?.stepId, "step-a")
    XCTAssertEqual(run.session.executions.first?.nodeId, "shared-worker")
  }

  private func assertScopedProjectWorkflowEscapeRejected(workingDirectory: URL, workflowName: String = "escape") async throws {
    let validate = await RielflowCLIApplication().run([
      "workflow", "validate", workflowName,
      "--scope", "project",
      "--working-dir", workingDirectory.path,
      "--output", "json",
    ])
    XCTAssertEqual(validate.exitCode, .failure)
    XCTAssertTrue(validate.stderr.isEmpty)
    let validateFailure = try decodeJSON(WorkflowValidationFailureResult.self, from: validate.stdout)
    XCTAssertFalse(validateFailure.valid)
    XCTAssertEqual(validateFailure.workflowId, workflowName)
    XCTAssertTrue(validateFailure.error.contains("escapes"))

    let inspect = await RielflowCLIApplication().run([
      "workflow", "inspect", workflowName,
      "--scope", "project",
      "--working-dir", workingDirectory.path,
      "--output", "json",
    ])
    XCTAssertEqual(inspect.exitCode, .failure)
    XCTAssertTrue(inspect.stderr.isEmpty)
    let inspectFailure = try decodeJSON(WorkflowInspectionFailureResult.self, from: inspect.stdout)
    XCTAssertEqual(inspectFailure.workflowId, workflowName)
    XCTAssertTrue(inspectFailure.error.contains("escapes"))

    let run = await RielflowCLIApplication().run([
      "workflow", "run", workflowName,
      "--scope", "project",
      "--working-dir", workingDirectory.path,
      "--output", "json",
    ])
    XCTAssertEqual(run.exitCode, .failure)
    XCTAssertTrue(run.stderr.isEmpty)
    let runFailure = try decodeJSON(WorkflowRunFailureResult.self, from: run.stdout)
    XCTAssertEqual(runFailure.target, workflowName)
    XCTAssertTrue(runFailure.error.contains("escapes"))
  }

  private func decodeJSON<T: Decodable>(_ type: T.Type, from stdout: String) throws -> T {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try decoder.decode(T.self, from: Data(stdout.utf8))
  }

  private func repositoryRoot() -> String {
    var url = URL(fileURLWithPath: #filePath)
    while url.pathComponents.count > 1 {
      if FileManager.default.fileExists(atPath: url.appendingPathComponent("Package.swift").path) {
        return url.path
      }
      url.deleteLastPathComponent()
    }
    return FileManager.default.currentDirectoryPath
  }
}
