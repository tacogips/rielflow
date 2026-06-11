import XCTest
@testable import RielflowCore

final class RuntimeStoreTests: XCTestCase {
  func testInMemoryStoreUsesDeterministicIdsTimestampsAndCreatedOrder() async throws {
    let date = Date(timeIntervalSince1970: 100)
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(date))

    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let execution = try await store.recordStepExecution(
      WorkflowStepExecutionRecordInput(sessionId: session.sessionId, stepId: "start", nodeId: "node-start", attempt: 1, backend: .codexAgent)
    )
    let first = try await store.appendWorkflowMessage(
      WorkflowMessageAppendInput(
        workflowExecutionId: session.sessionId,
        fromStepId: "start",
        toStepId: "next",
        sourceStepExecutionId: execution.executionId,
        payload: ["n": .number(1)]
      )
    )
    let second = try await store.appendWorkflowMessage(
      WorkflowMessageAppendInput(
        workflowExecutionId: session.sessionId,
        fromStepId: "start",
        toStepId: "next",
        sourceStepExecutionId: execution.executionId,
        payload: ["n": .number(2)]
      )
    )

    XCTAssertEqual(session.sessionId, "wf-session-1")
    XCTAssertEqual(execution.executionId, "start-attempt-1-exec-1")
    XCTAssertEqual(first.communicationId, "comm-000001")
    XCTAssertEqual(second.communicationId, "comm-000002")
    XCTAssertEqual(first.createdOrder, 1)
    XCTAssertEqual(second.createdOrder, 2)
    XCTAssertEqual(first.lifecycleStatus, .delivered)
    XCTAssertEqual(second.lifecycleStatus, .delivered)
    XCTAssertEqual(second.createdAt, date)
    let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: "next")
    XCTAssertEqual(listedMessages, [first, second])
  }

  func testAppendFailureIsObservableAndDoesNotCreateMessages() async throws {
    let store = InMemoryWorkflowRuntimeStore(
      clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 100)),
      appendFailurePredicate: { _ in "sqlite write failed" }
    )
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let execution = try await store.recordStepExecution(
      WorkflowStepExecutionRecordInput(sessionId: session.sessionId, stepId: "start", nodeId: "node-start", attempt: 1)
    )

    do {
      _ = try await store.appendWorkflowMessage(
        WorkflowMessageAppendInput(
          workflowExecutionId: session.sessionId,
          fromStepId: "start",
          toStepId: "next",
          sourceStepExecutionId: execution.executionId,
          payload: ["ok": .bool(true)]
        )
      )
      XCTFail("expected append failure")
    } catch WorkflowRuntimeStoreError.messageAppendRejected(let reason) {
      XCTAssertEqual(reason, "sqlite write failed")
    }

    let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(listedMessages, [])
  }

  func testMessageInputResolverFiltersOrdersAndMergesPayloads() async throws {
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 100)))
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let startExecution = try await store.recordStepExecution(
      WorkflowStepExecutionRecordInput(sessionId: session.sessionId, stepId: "start", nodeId: "node-start", attempt: 1)
    )
    let branchExecution = try await store.recordStepExecution(
      WorkflowStepExecutionRecordInput(sessionId: session.sessionId, stepId: "branch", nodeId: "node-branch", attempt: 1)
    )

    _ = try await store.appendWorkflowMessage(
      WorkflowMessageAppendInput(
        workflowExecutionId: session.sessionId,
        fromStepId: "start",
        toStepId: "target",
        sourceStepExecutionId: startExecution.executionId,
        payload: ["shared": .string("first"), "startOnly": .bool(true)]
      )
    )
    _ = try await store.appendWorkflowMessage(
      WorkflowMessageAppendInput(
        workflowExecutionId: session.sessionId,
        fromStepId: "start",
        toStepId: "other",
        sourceStepExecutionId: startExecution.executionId,
        payload: ["other": .bool(true)]
      )
    )
    _ = try await store.appendWorkflowMessage(
      WorkflowMessageAppendInput(
        workflowExecutionId: session.sessionId,
        fromStepId: "branch",
        toStepId: "target",
        sourceStepExecutionId: branchExecution.executionId,
        payload: ["shared": .string("second"), "branchOnly": .number(2)]
      )
    )

    let resolved = try await DefaultWorkflowMessageInputResolver().resolveInput(
      for: session.sessionId,
      stepId: "target",
      store: store
    )

    XCTAssertEqual(resolved.workflowExecutionId, session.sessionId)
    XCTAssertEqual(resolved.stepId, "target")
    XCTAssertEqual(resolved.communicationIds, ["comm-000001", "comm-000003"])
    XCTAssertEqual(resolved.messages.map(\.toStepId), ["target", "target"])
    XCTAssertEqual(resolved.sourceStepIds, ["start", "branch"])
    XCTAssertEqual(
      resolved.payload,
      ["shared": .string("second"), "startOnly": .bool(true), "branchOnly": .number(2)]
    )

    let adapterInput = resolved.applying(
      to: AdapterExecutionInput(
        node: AgentNodePayload(id: "target", model: "gpt-5"),
        promptText: "prompt",
        mergedVariables: ["existing": .string("kept"), "shared": .string("base")]
      )
    )
    XCTAssertEqual(
      adapterInput.mergedVariables,
      [
        "existing": .string("kept"),
        "shared": .string("second"),
        "startOnly": .bool(true),
        "branchOnly": .number(2)
      ]
    )
  }

  func testMessageInputResolverUsesOnlyDeliveredAndConsumedMessages() async throws {
    let date = Date(timeIntervalSince1970: 100)
    let messages = [
      message("created", lifecycleStatus: .created, createdOrder: 1, date: date, payload: ["drop": .string("created")]),
      message("delivered", lifecycleStatus: .delivered, createdOrder: 2, date: date, payload: ["keep": .string("delivered")]),
      message("failed", lifecycleStatus: .failed, createdOrder: 3, date: date, payload: ["drop": .string("failed")]),
      message("consumed", lifecycleStatus: .consumed, createdOrder: 4, date: date, payload: ["keep": .string("consumed")]),
      message("superseded", lifecycleStatus: .superseded, createdOrder: 5, date: date, payload: ["drop": .string("superseded")])
    ]
    let store = StaticWorkflowRuntimeStore(sessionId: "session", messages: messages)

    let resolved = try await DefaultWorkflowMessageInputResolver().resolveInput(
      for: "session",
      stepId: "target",
      store: store
    )

    XCTAssertEqual(resolved.communicationIds, ["delivered", "consumed"])
    XCTAssertEqual(resolved.payload, ["keep": .string("consumed")])
  }

  private func message(
    _ communicationId: String,
    lifecycleStatus: WorkflowMessageLifecycleStatus,
    createdOrder: Int,
    date: Date,
    payload: JSONObject
  ) -> WorkflowMessageRecord {
    WorkflowMessageRecord(
      communicationId: communicationId,
      workflowExecutionId: "session",
      fromStepId: "source",
      toStepId: "target",
      sourceStepExecutionId: "source-exec",
      payload: payload,
      lifecycleStatus: lifecycleStatus,
      createdOrder: createdOrder,
      createdAt: date
    )
  }
}

private struct StaticWorkflowRuntimeStore: WorkflowRuntimeStore {
  var sessionId: String
  var messages: [WorkflowMessageRecord]

  func createSession(_ input: WorkflowSessionCreateInput) async throws -> WorkflowSession {
    throw WorkflowRuntimeStoreError.messageAppendRejected("static store does not create sessions")
  }

  func recordStepExecution(_ input: WorkflowStepExecutionRecordInput) async throws -> WorkflowStepExecution {
    throw WorkflowRuntimeStoreError.messageAppendRejected("static store does not record executions")
  }

  func updateStepExecution(_ input: WorkflowStepExecutionUpdateInput) async throws -> WorkflowStepExecution {
    throw WorkflowRuntimeStoreError.messageAppendRejected("static store does not update executions")
  }

  func appendWorkflowMessage(_ input: WorkflowMessageAppendInput) async throws -> WorkflowMessageRecord {
    throw WorkflowRuntimeStoreError.messageAppendRejected("static store does not append messages")
  }

  func appendWorkflowMessages(_ inputs: [WorkflowMessageAppendInput]) async throws -> [WorkflowMessageRecord] {
    throw WorkflowRuntimeStoreError.messageAppendRejected("static store does not append messages")
  }

  func listMessages(for sessionId: String, toStepId: String?) async throws -> [WorkflowMessageRecord] {
    guard sessionId == self.sessionId else {
      throw WorkflowRuntimeStoreError.sessionNotFound(sessionId)
    }
    guard let toStepId else {
      return messages
    }
    return messages.filter { $0.toStepId == toStepId }
  }

  func loadSession(id: String) async throws -> WorkflowSession? {
    nil
  }
}
