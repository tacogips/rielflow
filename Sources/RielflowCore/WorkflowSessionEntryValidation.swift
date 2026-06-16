import Foundation

public struct WorkflowFanoutGroupRecord: Codable, Equatable, Sendable {
  public var groupId: String
  public var targetStepId: String
  public var branches: [String]

  public init(groupId: String, targetStepId: String, branches: [String]) {
    self.groupId = groupId
    self.targetStepId = targetStepId
    self.branches = branches
  }
}

public enum WorkflowSessionEntryValidationError: Error, Equatable, Sendable {
  case usage(String)
  case validation(String)
}

public enum WorkflowSessionEntryValidation {
  public static func validateMutuallyExclusiveSessionEntryModes(
    resumeSessionId: String?,
    rerunFromSessionId: String?,
    continueFromWorkflowExecutionId: String?
  ) throws {
    let requested = [
      resumeSessionId != nil,
      rerunFromSessionId != nil,
      continueFromWorkflowExecutionId != nil,
    ].filter { $0 }.count
    guard requested <= 1 else {
      throw WorkflowSessionEntryValidationError.usage(
        "resumeSessionId, rerunFromSessionId, and continueFromWorkflowExecutionId are mutually exclusive"
      )
    }
  }

  public static func validateRerunTarget(
    workflow: WorkflowDefinition,
    sourceSession: WorkflowSession,
    rerunStepId: String?
  ) throws -> String {
    let rerunTargetLabel = "step"
    guard let rerunStepId, !rerunStepId.isEmpty else {
      throw WorkflowSessionEntryValidationError.validation(
        "rerun \(rerunTargetLabel) id is required when rerunFromSessionId is set"
      )
    }
    let stepIds = Set(workflow.steps.map(\.id))
    guard stepIds.contains(rerunStepId) else {
      throw WorkflowSessionEntryValidationError.validation(
        "unknown rerun \(rerunTargetLabel) '\(rerunStepId)'"
      )
    }
    if let message = describeAmbiguousFanoutBranchRerunTarget(session: sourceSession, stepId: rerunStepId) {
      throw WorkflowSessionEntryValidationError.usage(message)
    }
    return rerunStepId
  }

  public static func describeAmbiguousFanoutBranchRerunTarget(
    session: WorkflowSession,
    stepId: String
  ) -> String? {
    let groups = (session.fanoutGroups ?? []).filter { $0.targetStepId == stepId && $0.branches.count > 1 }
    guard !groups.isEmpty else {
      return nil
    }
    let groupIds = groups.map(\.groupId).joined(separator: ", ")
    return "cannot rerun fanout branch target step '\(stepId)' without fanout branch context; matching fanout group(s): \(groupIds)"
  }
}
