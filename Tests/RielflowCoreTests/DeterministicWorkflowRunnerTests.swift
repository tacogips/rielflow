import XCTest
@testable import RielflowCore

final class DeterministicWorkflowRunnerTests: XCTestCase {
  func testAdapterFailureRecordsFailedExecutionWithoutMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore()
    let runner = DeterministicWorkflowRunner(store: store, adapter: FailingAdapter())

    await XCTAssertThrowsErrorAsync(try await runner.run(request()))

    let maybeSession = await store.loadSessionForTest(id: "runner-session-1")
    let session = try XCTUnwrap(maybeSession)
    XCTAssertEqual(session.status, .failed)
    XCTAssertEqual(session.executions.count, 1)
    XCTAssertEqual(session.executions.first?.status, .failed)
    let messages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(messages, [])
  }

  func testCompletionFailureRecordsFailedExecutionWithoutMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore()
    let runner = DeterministicWorkflowRunner(
      store: store,
      adapter: StaticAdapter(output: output(completionPassed: false, payload: ["status": .string("blocked")]))
    )

    await XCTAssertThrowsErrorAsync(try await runner.run(request()))

    let maybeSession = await store.loadSessionForTest(id: "runner-session-1")
    let session = try XCTUnwrap(maybeSession)
    XCTAssertEqual(session.status, .failed)
    XCTAssertEqual(session.executions.first?.status, .failed)
    let messages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(messages, [])
  }

  func testInvalidOutputContractRecordsFailedExecutionWithoutMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore()
    let node = payload(
      output: NodeOutputContract(
        jsonSchema: [
          "type": .string("object"),
          "required": .array([.string("status")]),
        ]
      )
    )
    let runner = DeterministicWorkflowRunner(store: store, adapter: StaticAdapter(output: output(payload: ["other": .string("value")])))

    await XCTAssertThrowsErrorAsync(try await runner.run(request(nodePayload: node)))

    let maybeSession = await store.loadSessionForTest(id: "runner-session-1")
    let session = try XCTUnwrap(maybeSession)
    XCTAssertEqual(session.status, .failed)
    XCTAssertEqual(session.executions.first?.status, .failed)
    let messages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(messages, [])
  }

  func testUnsupportedTransitionRecordsFailureBeforeMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore()
    let workflow = workflow(transitions: [WorkflowStepTransition(toStepId: "child", toWorkflowId: "child-workflow")])
    let runner = DeterministicWorkflowRunner(store: store, adapter: StaticAdapter(output: output()))

    await XCTAssertThrowsErrorAsync(try await runner.run(request(workflow: workflow)))

    let maybeSession = await store.loadSessionForTest(id: "runner-session-1")
    let session = try XCTUnwrap(maybeSession)
    XCTAssertEqual(session.status, .failed)
    XCTAssertEqual(session.executions.first?.status, .failed)
    let messages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(messages, [])
  }

  func testMultiplePublishableTransitionsFailClosedWithoutMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore()
    let workflow = WorkflowDefinition(
      workflowId: "runner",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 3),
      entryStepId: "step",
      nodeRegistry: [
        WorkflowNodeRegistryRef(id: "node", nodeFile: "nodes/node.json"),
        WorkflowNodeRegistryRef(id: "left-node", nodeFile: "nodes/left-node.json"),
        WorkflowNodeRegistryRef(id: "right-node", nodeFile: "nodes/right-node.json"),
      ],
      steps: [
        WorkflowStepRef(
          id: "step",
          nodeId: "node",
          transitions: [
            WorkflowStepTransition(toStepId: "left"),
            WorkflowStepTransition(toStepId: "right"),
          ]
        ),
        WorkflowStepRef(id: "left", nodeId: "left-node"),
        WorkflowStepRef(id: "right", nodeId: "right-node"),
      ],
      nodes: [
        WorkflowNodeRef(id: "step", nodeFile: "nodes/node.json"),
        WorkflowNodeRef(id: "left", nodeFile: "nodes/left-node.json"),
        WorkflowNodeRef(id: "right", nodeFile: "nodes/right-node.json"),
      ]
    )
    let runner = DeterministicWorkflowRunner(store: store, adapter: StaticAdapter(output: output()))

    await XCTAssertThrowsErrorAsync(try await runner.run(DeterministicWorkflowRunRequest(
      workflow: workflow,
      nodePayloads: [
        "node": payload(),
        "left-node": payload(),
        "right-node": payload(),
      ]
    )))

    let maybeSession = await store.loadSessionForTest(id: "runner-session-1")
    let session = try XCTUnwrap(maybeSession)
    XCTAssertEqual(session.status, .failed)
    XCTAssertEqual(session.executions.count, 1)
    XCTAssertEqual(session.executions.first?.status, .failed)
    XCTAssertEqual(session.executions.first?.failureReason, "invalid_output: multiple direct transitions are not supported by the Swift TASK-007 sequential runner")
    let messages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(messages, [])
  }

  func testMultipleEnvelopeTransitionsFailClosedAfterOutputNormalization() async throws {
    let store = InMemoryWorkflowRuntimeStore()
    let workflow = WorkflowDefinition(
      workflowId: "runner",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 3),
      entryStepId: "step",
      nodeRegistry: [
        WorkflowNodeRegistryRef(id: "node", nodeFile: "nodes/node.json"),
        WorkflowNodeRegistryRef(id: "left-node", nodeFile: "nodes/left-node.json"),
        WorkflowNodeRegistryRef(id: "right-node", nodeFile: "nodes/right-node.json"),
      ],
      steps: [
        WorkflowStepRef(
          id: "step",
          nodeId: "node",
          transitions: [
            WorkflowStepTransition(toStepId: "left", label: "left"),
            WorkflowStepTransition(toStepId: "right", label: "right"),
          ]
        ),
        WorkflowStepRef(id: "left", nodeId: "left-node"),
        WorkflowStepRef(id: "right", nodeId: "right-node"),
      ],
      nodes: [
        WorkflowNodeRef(id: "step", nodeFile: "nodes/node.json"),
        WorkflowNodeRef(id: "left", nodeFile: "nodes/left-node.json"),
        WorkflowNodeRef(id: "right", nodeFile: "nodes/right-node.json"),
      ]
    )
    let runner = DeterministicWorkflowRunner(
      store: store,
      adapter: StaticAdapter(output: AdapterExecutionOutput(
        provider: "test",
        model: "gpt-5-nano",
        promptText: "prompt",
        completionPassed: true,
        when: ["left": false, "right": false],
        payload: [
          "when": .object(["left": .bool(true), "right": .bool(true)]),
          "payload": .object(["status": .string("ok")]),
        ]
      ))
    )

    await XCTAssertThrowsErrorAsync(try await runner.run(DeterministicWorkflowRunRequest(
      workflow: workflow,
      nodePayloads: [
        "node": payload(),
        "left-node": payload(),
        "right-node": payload(),
      ]
    )))

    let maybeSession = await store.loadSessionForTest(id: "runner-session-1")
    let session = try XCTUnwrap(maybeSession)
    XCTAssertEqual(session.status, .failed)
    XCTAssertEqual(session.executions.count, 1)
    XCTAssertEqual(session.executions.first?.status, .failed)
    XCTAssertEqual(session.executions.first?.failureReason, "invalid_output: multiple direct transitions are not supported by the Swift TASK-007 sequential runner")
    XCTAssertNil(session.executions.first?.acceptedOutput)
    let messages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(messages, [])
  }

  func testNegatedTransitionLabelPublishesWhenFlagIsFalse() async throws {
    let store = InMemoryWorkflowRuntimeStore()
    let workflow = WorkflowDefinition(
      workflowId: "runner",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 3),
      entryStepId: "step",
      nodeRegistry: [
        WorkflowNodeRegistryRef(id: "node", nodeFile: "nodes/node.json"),
        WorkflowNodeRegistryRef(id: "next-node", nodeFile: "nodes/next-node.json"),
      ],
      steps: [
        WorkflowStepRef(
          id: "step",
          nodeId: "node",
          transitions: [WorkflowStepTransition(toStepId: "next", label: "!(needs_revision)")]
        ),
        WorkflowStepRef(id: "next", nodeId: "next-node"),
      ],
      nodes: [
        WorkflowNodeRef(id: "step", nodeFile: "nodes/node.json"),
        WorkflowNodeRef(id: "next", nodeFile: "nodes/next-node.json"),
      ]
    )
    let runner = DeterministicWorkflowRunner(
      store: store,
      adapter: StaticAdapter(output: output(when: ["needs_revision": false]))
    )

    let result = try await runner.run(DeterministicWorkflowRunRequest(
      workflow: workflow,
      nodePayloads: [
        "node": payload(),
        "next-node": payload(),
      ]
    ))

    XCTAssertEqual(result.status, .completed)
    XCTAssertEqual(result.exitCode, 0)
    XCTAssertEqual(result.nodeExecutions, 2)
    XCTAssertEqual(result.transitions, 1)
    let messages = try await store.listMessages(for: result.session.sessionId, toStepId: nil)
    XCTAssertEqual(messages.map(\.toStepId), ["next"])
  }

  func testMultipleExpressionTransitionsFailClosedUsingBranchEvaluator() async throws {
    let store = InMemoryWorkflowRuntimeStore()
    let workflow = WorkflowDefinition(
      workflowId: "runner",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 3),
      entryStepId: "step",
      nodeRegistry: [
        WorkflowNodeRegistryRef(id: "node", nodeFile: "nodes/node.json"),
        WorkflowNodeRegistryRef(id: "left-node", nodeFile: "nodes/left-node.json"),
        WorkflowNodeRegistryRef(id: "right-node", nodeFile: "nodes/right-node.json"),
      ],
      steps: [
        WorkflowStepRef(
          id: "step",
          nodeId: "node",
          transitions: [
            WorkflowStepTransition(toStepId: "left", label: "!(left)"),
            WorkflowStepTransition(toStepId: "right", label: "!(right)"),
          ]
        ),
        WorkflowStepRef(id: "left", nodeId: "left-node"),
        WorkflowStepRef(id: "right", nodeId: "right-node"),
      ],
      nodes: [
        WorkflowNodeRef(id: "step", nodeFile: "nodes/node.json"),
        WorkflowNodeRef(id: "left", nodeFile: "nodes/left-node.json"),
        WorkflowNodeRef(id: "right", nodeFile: "nodes/right-node.json"),
      ]
    )
    let runner = DeterministicWorkflowRunner(
      store: store,
      adapter: StaticAdapter(output: output(when: ["left": false, "right": false]))
    )

    await XCTAssertThrowsErrorAsync(try await runner.run(DeterministicWorkflowRunRequest(
      workflow: workflow,
      nodePayloads: [
        "node": payload(),
        "left-node": payload(),
        "right-node": payload(),
      ]
    )))

    let maybeSession = await store.loadSessionForTest(id: "runner-session-1")
    let session = try XCTUnwrap(maybeSession)
    XCTAssertEqual(session.status, .failed)
    XCTAssertEqual(session.executions.count, 1)
    XCTAssertEqual(session.executions.first?.failureReason, "invalid_output: multiple direct transitions are not supported by the Swift TASK-007 sequential runner")
    let messages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(messages, [])
  }

  func testMessageAppendFailureDoesNotFabricateDownstreamMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore(appendFailurePredicate: { _ in "append blocked" })
    let workflow = workflow(transitions: [WorkflowStepTransition(toStepId: "step")])
    let runner = DeterministicWorkflowRunner(store: store, adapter: StaticAdapter(output: output()))

    await XCTAssertThrowsErrorAsync(try await runner.run(request(workflow: workflow)))

    let maybeSession = await store.loadSessionForTest(id: "runner-session-1")
    let session = try XCTUnwrap(maybeSession)
    XCTAssertEqual(session.status, .failed)
    XCTAssertEqual(session.executions.first?.status, .failed)
    XCTAssertNil(session.executions.first?.acceptedOutput)
    let messages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(messages, [])
  }

  func testTimeoutOptionsPropagateAdapterDeadline() async throws {
    let adapter = DeadlineCapturingAdapter()
    let runner = DeterministicWorkflowRunner(adapter: adapter)

    _ = try await runner.run(request(timeoutMs: 500))

    let maybeDeadline = await adapter.capturedDeadline()
    let deadline = try XCTUnwrap(maybeDeadline)
    XCTAssertLessThanOrEqual(deadline.timeIntervalSinceNow, 0.5)
    XCTAssertGreaterThan(deadline.timeIntervalSinceNow, 0)
  }

  func testRunRendersHydratedPromptTemplateAndPromptVariantBeforeAdapterExecution() async throws {
    let adapter = InputCapturingAdapter()
    let workflow = WorkflowDefinition(
      workflowId: "runner",
      description: "fallback {{topic}}",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 3),
      prompts: WorkflowPrompts(workerSystemPromptTemplate: "workflow system {{topic}}"),
      entryStepId: "step",
      nodeRegistry: [WorkflowNodeRegistryRef(id: "node", nodeFile: "nodes/node.json")],
      steps: [
        WorkflowStepRef(
          id: "step",
          nodeId: "node",
          description: "step fallback {{topic}}",
          role: .worker,
          promptVariant: "review"
        )
      ],
      nodes: [WorkflowNodeRef(id: "step", nodeFile: "nodes/node.json")]
    )
    let node = AgentNodePayload(
      id: "node",
      executionBackend: .codexAgent,
      model: "gpt-5-nano",
      systemPromptTemplate: "base system {{topic}}",
      promptTemplate: "base prompt {{topic}}",
      sessionStartPromptTemplate: "base start {{topic}}",
      promptVariants: [
        "review": NodePromptVariant(
          systemPromptTemplate: "variant system {{topic}}",
          promptTemplate: "variant prompt {{topic}} {{nodeId}} {{nodeKind}}",
          sessionStartPromptTemplate: "variant start {{topic}}"
        )
      ],
      variables: ["topic": .string("base")]
    )
    let runner = DeterministicWorkflowRunner(adapter: adapter)

    _ = try await runner.run(DeterministicWorkflowRunRequest(
      workflow: workflow,
      nodePayloads: ["node": node],
      variables: ["topic": .string("release")]
    ))

    let capturedInput = await adapter.capturedInput()
    let input = try XCTUnwrap(capturedInput)
    XCTAssertEqual(
      input.promptText,
      "variant start release\n\nvariant prompt release step worker"
    )
    XCTAssertEqual(
      input.systemPromptText,
      "workflow system release\n\nvariant system release"
    )
    XCTAssertFalse(input.promptText.contains("fallback"))
    XCTAssertFalse(input.promptText.contains("base prompt"))
    XCTAssertEqual(input.node.promptTemplateFile, nil)
    XCTAssertEqual(input.node.id, "step")
  }

  func testRunPreservesConfiguredPromptTemplateThatRendersEmpty() async throws {
    let adapter = InputCapturingAdapter()
    let workflow = WorkflowDefinition(
      workflowId: "runner",
      description: "workflow fallback",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 3),
      entryStepId: "step",
      nodeRegistry: [WorkflowNodeRegistryRef(id: "node", nodeFile: "nodes/node.json")],
      steps: [
        WorkflowStepRef(
          id: "step",
          nodeId: "node",
          description: "step fallback must not run",
          role: .worker
        )
      ],
      nodes: [WorkflowNodeRef(id: "step", nodeFile: "nodes/node.json")]
    )
    let node = AgentNodePayload(
      id: "node",
      executionBackend: .codexAgent,
      model: "gpt-5-nano",
      promptTemplate: "{{ missing.path }}"
    )
    let runner = DeterministicWorkflowRunner(adapter: adapter)

    _ = try await runner.run(DeterministicWorkflowRunRequest(
      workflow: workflow,
      nodePayloads: ["node": node]
    ))

    let capturedInput = await adapter.capturedInput()
    let input = try XCTUnwrap(capturedInput)
    XCTAssertEqual(input.promptText, "")
    XCTAssertFalse(input.promptText.contains("fallback"))
  }

  func testMaxLoopIterationsBoundsDeterministicRun() async throws {
    let loopingWorkflow = workflow(
      defaults: WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 10),
      transitions: [WorkflowStepTransition(toStepId: "step")]
    )
    let runner = DeterministicWorkflowRunner(adapter: StaticAdapter(output: output()))

    do {
      _ = try await runner.run(request(workflow: loopingWorkflow, maxLoopIterations: 1))
      XCTFail("expected maxStepsExceeded")
    } catch DeterministicWorkflowRunnerError.maxStepsExceeded(let maxSteps) {
      XCTAssertEqual(maxSteps, 2)
    } catch {
      XCTFail("unexpected error: \(error)")
    }
  }

  private func request(
    workflow: WorkflowDefinition? = nil,
    nodePayload: AgentNodePayload? = nil,
    maxLoopIterations: Int? = nil,
    timeoutMs: Int? = nil
  ) -> DeterministicWorkflowRunRequest {
    let resolvedWorkflow = workflow ?? self.workflow()
    return DeterministicWorkflowRunRequest(
      workflow: resolvedWorkflow,
      nodePayloads: ["node": nodePayload ?? payload()],
      maxLoopIterations: maxLoopIterations,
      timeoutMs: timeoutMs
    )
  }

  private func workflow(
    defaults: WorkflowDefaults = WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 3),
    transitions: [WorkflowStepTransition]? = nil
  ) -> WorkflowDefinition {
    WorkflowDefinition(
      workflowId: "runner",
      defaults: defaults,
      entryStepId: "step",
      nodeRegistry: [WorkflowNodeRegistryRef(id: "node", nodeFile: "nodes/node.json")],
      steps: [WorkflowStepRef(id: "step", nodeId: "node", transitions: transitions)],
      nodes: [WorkflowNodeRef(id: "step", nodeFile: "nodes/node.json")]
    )
  }

  private func payload(output: NodeOutputContract? = nil) -> AgentNodePayload {
    AgentNodePayload(id: "node", executionBackend: .codexAgent, model: "gpt-5-nano", output: output)
  }

  private func output(
    completionPassed: Bool = true,
    payload: JSONObject = ["status": .string("ok")],
    when: [String: Bool] = ["always": true]
  ) -> AdapterExecutionOutput {
    AdapterExecutionOutput(
      provider: "test",
      model: "gpt-5-nano",
      promptText: "prompt",
      completionPassed: completionPassed,
      when: when,
      payload: payload
    )
  }
}

private struct FailingAdapter: NodeAdapter {
  func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    throw AdapterExecutionError(.providerError, "forced failure")
  }
}

private struct StaticAdapter: NodeAdapter {
  var output: AdapterExecutionOutput

  func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    output
  }
}

private actor DeadlineCapturingAdapter: NodeAdapter {
  private(set) var deadline: Date?

  func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    deadline = context.deadline
    return AdapterExecutionOutput(
      provider: "test",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      payload: ["status": .string("ok")]
    )
  }

  func capturedDeadline() -> Date? {
    deadline
  }
}

private actor InputCapturingAdapter: NodeAdapter {
  private var input: AdapterExecutionInput?

  func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    self.input = input
    return AdapterExecutionOutput(
      provider: "test",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      payload: ["status": .string("ok")]
    )
  }

  func capturedInput() -> AdapterExecutionInput? {
    input
  }
}

private func XCTAssertThrowsErrorAsync(
  _ expression: @autoclosure () async throws -> some Sendable,
  file: StaticString = #filePath,
  line: UInt = #line
) async {
  do {
    _ = try await expression()
    XCTFail("expected error", file: file, line: line)
  } catch {}
}

private extension InMemoryWorkflowRuntimeStore {
  func loadSessionForTest(id: String) async -> WorkflowSession? {
    try? await loadSession(id: id)
  }
}
