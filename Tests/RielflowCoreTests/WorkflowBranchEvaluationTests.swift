import XCTest
@testable import RielflowCore

final class WorkflowBranchEvaluationTests: XCTestCase {
  func testEvaluatesBareAndNegatedLabelsFromWhenAndPayload() {
    let evaluator = WorkflowBranchEvaluator()

    XCTAssertTrue(evaluator.evaluate(label: "needs_revision", when: ["needs_revision": true]))
    XCTAssertFalse(evaluator.evaluate(label: "needs_revision", when: ["needs_revision": false]))
    XCTAssertTrue(evaluator.evaluate(label: "!(needs_revision)", when: ["needs_revision": false]))
    XCTAssertFalse(evaluator.evaluate(label: "continue_debate", when: [:], payload: ["continue_debate": .bool(false)]))
    XCTAssertTrue(evaluator.evaluate(label: "continue_debate", when: [:], payload: ["continue_debate": .bool(true)]))
  }

  func testEvaluatesBooleanOperatorsAndPrecedence() {
    let evaluator = WorkflowBranchEvaluator()
    let when = ["a": true, "b": false, "c": true]

    XCTAssertTrue(evaluator.evaluate(label: "a && b || c", when: when))
    XCTAssertTrue(evaluator.evaluate(label: "a && (b || c)", when: when))
    XCTAssertFalse(evaluator.evaluate(label: "a && !c", when: when))
    XCTAssertTrue(evaluator.evaluate(label: "!(planning_only || needs_design_revision || needs_revision)", when: [
      "planning_only": false,
      "needs_design_revision": false,
      "needs_revision": false,
    ]))
  }
}
