import RielflowCore

enum CursorCLIAgentEffortResolution {
  static let composerModelPrefix = "composer-"

  private static let cursorEffortTokens: Set<String> = [
    "none", "low", "medium", "high", "xhigh", "max",
  ]
  private static let extraHighEffortModelPrefixes = ["gpt-5.5"]

  static func modelSupportsCursorEffortSuffix(model: String) -> Bool {
    !model.hasPrefix(composerModelPrefix)
  }

  static func resolveCursorAgentEffort(model: String, effort: NodeReasoningEffort?) -> NodeReasoningEffort? {
    guard let effort, modelSupportsCursorEffortSuffix(model: model) else {
      return nil
    }
    return effort
  }

  static func resolveModelForEffort(model: String, effort: NodeReasoningEffort?) -> String {
    guard let resolvedEffort = resolveCursorAgentEffort(model: model, effort: effort) else {
      return model
    }
    guard model.contains("-") else {
      return model
    }

    let fastSuffix = model.hasSuffix("-fast") ? "-fast" : ""
    let base = fastSuffix.isEmpty ? model : String(model.dropLast(5))
    let requested = formatCursorEffortToken(modelBase: base, effort: resolvedEffort)

    if base.hasSuffix("-extra-high") {
      let prefix = String(base.dropLast("-extra-high".count))
      return "\(prefix)-\(requested)\(fastSuffix)"
    }

    var tokens = base.split(separator: "-", omittingEmptySubsequences: false).map(String.init)
    if let last = tokens.last, cursorEffortTokens.contains(last) {
      tokens[tokens.count - 1] = requested
      return tokens.joined(separator: "-") + fastSuffix
    }

    if requested == NodeReasoningEffort.medium.rawValue, !usesExtraHighEffortToken(modelBase: base) {
      return model
    }

    return "\(base)-\(requested)\(fastSuffix)"
  }

  private static func formatCursorEffortToken(modelBase: String, effort: NodeReasoningEffort) -> String {
    if effort == .xhigh, usesExtraHighEffortToken(modelBase: modelBase) {
      return "extra-high"
    }
    return effort.rawValue
  }

  private static func usesExtraHighEffortToken(modelBase: String) -> Bool {
    extraHighEffortModelPrefixes.contains { prefix in
      modelBase == prefix || modelBase.hasPrefix("\(prefix)-")
    }
  }
}
