import XCTest
@testable import RielflowCore

final class WorkflowSessionEntryValidationTests: XCTestCase {
  func testMutuallyExclusiveSessionEntryModesRejectMultipleRequests() {
    XCTAssertThrowsError(
      try WorkflowSessionEntryValidation.validateMutuallyExclusiveSessionEntryModes(
        resumeSessionId: "sess-1",
        rerunFromSessionId: "sess-2",
        continueFromWorkflowExecutionId: nil
      )
    ) { error in
      guard case let WorkflowSessionEntryValidationError.usage(message) = error else {
        return XCTFail("expected usage error")
      }
      XCTAssertTrue(message.contains("mutually exclusive"))
    }
  }

  func testRerunRequiresStepId() {
    let workflow = sampleWorkflow()
    let session = WorkflowSession(
      workflowId: workflow.workflowId,
      sessionId: "sess-1",
      entryStepId: "step-a",
      createdAt: Date(),
      updatedAt: Date()
    )
    XCTAssertThrowsError(
      try WorkflowSessionEntryValidation.validateRerunTarget(
        workflow: workflow,
        sourceSession: session,
        rerunStepId: nil
      )
    ) { error in
      guard case let WorkflowSessionEntryValidationError.validation(message) = error else {
        return XCTFail("expected validation error")
      }
      XCTAssertEqual(message, "rerun step id is required when rerunFromSessionId is set")
    }
  }

  func testRerunRejectsUnknownStepIdWithStepOrientedMessage() {
    let workflow = sampleWorkflow()
    let session = WorkflowSession(
      workflowId: workflow.workflowId,
      sessionId: "sess-1",
      entryStepId: "step-a",
      createdAt: Date(),
      updatedAt: Date()
    )
    XCTAssertThrowsError(
      try WorkflowSessionEntryValidation.validateRerunTarget(
        workflow: workflow,
        sourceSession: session,
        rerunStepId: "missing-step"
      )
    ) { error in
      guard case let WorkflowSessionEntryValidationError.validation(message) = error else {
        return XCTFail("expected validation error")
      }
      XCTAssertEqual(message, "unknown rerun step 'missing-step'")
    }
  }

  func testAmbiguousFanoutBranchRerunTargetIsRejected() {
    let workflow = sampleWorkflow()
    let session = WorkflowSession(
      workflowId: workflow.workflowId,
      sessionId: "sess-1",
      entryStepId: "step-a",
      createdAt: Date(),
      updatedAt: Date(),
      fanoutGroups: [
        WorkflowFanoutGroupRecord(groupId: "group-1", targetStepId: "step-b", branches: ["b1", "b2"])
      ]
    )
    XCTAssertThrowsError(
      try WorkflowSessionEntryValidation.validateRerunTarget(
        workflow: workflow,
        sourceSession: session,
        rerunStepId: "step-b"
      )
    ) { error in
      guard case let WorkflowSessionEntryValidationError.usage(message) = error else {
        return XCTFail("expected usage error")
      }
      XCTAssertTrue(message.contains("cannot rerun fanout branch target step 'step-b'"))
      XCTAssertTrue(message.contains("group-1"))
    }
  }

  private func sampleWorkflow() -> WorkflowDefinition {
    WorkflowDefinition(
      workflowId: "rerun-flow",
      defaults: WorkflowDefaults(nodeTimeoutMs: 120_000, maxLoopIterations: 3),
      entryStepId: "step-a",
      nodeRegistry: [
        WorkflowNodeRegistryRef(id: "node-a", nodeFile: "nodes/a.json"),
        WorkflowNodeRegistryRef(id: "node-b", nodeFile: "nodes/b.json"),
      ],
      steps: [
        WorkflowStepRef(id: "step-a", nodeId: "node-a", transitions: [WorkflowStepTransition(toStepId: "step-b")]),
        WorkflowStepRef(id: "step-b", nodeId: "node-b"),
      ],
      nodes: [
        WorkflowNodeRef(id: "step-a", nodeFile: "nodes/a.json"),
        WorkflowNodeRef(id: "step-b", nodeFile: "nodes/b.json"),
      ]
    )
  }
}
