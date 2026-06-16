import Foundation

public struct WorkflowBranchEvaluator: Sendable {
  public init() {}

  public func evaluate(label: String?, when: [String: Bool], payload: JSONObject = [:]) -> Bool {
    guard let label, !label.isEmpty else {
      return label == nil
    }
    let tokens = WorkflowBranchTokenizer(expression: label).tokens()
    guard let tokens, !tokens.isEmpty else {
      return false
    }
    var parser = WorkflowBranchParser(tokens: tokens, when: when, payload: payload)
    return parser.evaluate()
  }
}

private enum WorkflowBranchToken: Equatable {
  case and
  case or
  case not
  case leftParen
  case rightParen
  case identifier(String)
}

private struct WorkflowBranchTokenizer {
  var expression: String

  func tokens() -> [WorkflowBranchToken]? {
    let characters = Array(expression)
    var index = 0
    var tokens: [WorkflowBranchToken] = []
    while index < characters.count {
      let character = characters[index]
      if character.isWhitespace {
        index += 1
        continue
      }
      if character == "&", peek(at: index + 1, in: characters) == "&" {
        tokens.append(.and)
        index += 2
        continue
      }
      if character == "|", peek(at: index + 1, in: characters) == "|" {
        tokens.append(.or)
        index += 2
        continue
      }
      if character == "!" {
        tokens.append(.not)
        index += 1
        continue
      }
      if character == "(" {
        tokens.append(.leftParen)
        index += 1
        continue
      }
      if character == ")" {
        tokens.append(.rightParen)
        index += 1
        continue
      }
      guard isIdentifierStart(character) else {
        return nil
      }
      var end = index + 1
      while end < characters.count, isIdentifierContinuation(characters[end]) {
        end += 1
      }
      tokens.append(.identifier(String(characters[index..<end])))
      index = end
    }
    return tokens
  }

  private func peek(at index: Int, in characters: [Character]) -> Character? {
    guard index < characters.count else {
      return nil
    }
    return characters[index]
  }

  private func isIdentifierStart(_ character: Character) -> Bool {
    character == "_" || character.isASCIIAlpha
  }

  private func isIdentifierContinuation(_ character: Character) -> Bool {
    character == "_" || character == "-" || character.isASCIIAlpha || character.isASCIIDigit
  }
}

private struct WorkflowBranchParser {
  var tokens: [WorkflowBranchToken]
  var when: [String: Bool]
  var payload: JSONObject
  var index = 0

  mutating func evaluate() -> Bool {
    let value = parseExpression()
    return index == tokens.count ? value : false
  }

  private mutating func parseExpression() -> Bool {
    parseOr()
  }

  private mutating func parseOr() -> Bool {
    var value = parseAnd()
    while current == .or {
      index += 1
      let rhs = parseAnd()
      value = value || rhs
    }
    return value
  }

  private mutating func parseAnd() -> Bool {
    var value = parseUnary()
    while current == .and {
      index += 1
      let rhs = parseUnary()
      value = value && rhs
    }
    return value
  }

  private mutating func parseUnary() -> Bool {
    if current == .not {
      index += 1
      return !parseUnary()
    }
    return parsePrimary()
  }

  private mutating func parsePrimary() -> Bool {
    guard let token = current else {
      return false
    }
    switch token {
    case .leftParen:
      index += 1
      let value = parseExpression()
      guard current == .rightParen else {
        return false
      }
      index += 1
      return value
    case let .identifier(identifier):
      index += 1
      switch identifier {
      case "true", "always":
        return true
      case "false", "never":
        return false
      default:
        return lookup(identifier)
      }
    default:
      return false
    }
  }

  private var current: WorkflowBranchToken? {
    guard index < tokens.count else {
      return nil
    }
    return tokens[index]
  }

  private func lookup(_ key: String) -> Bool {
    if let value = when[key] {
      return value
    }
    if case let .bool(value)? = payload[key] {
      return value
    }
    return false
  }
}

private extension Character {
  var isASCIIAlpha: Bool {
    guard let scalar = unicodeScalars.first, unicodeScalars.count == 1 else {
      return false
    }
    return (65...90).contains(Int(scalar.value)) || (97...122).contains(Int(scalar.value))
  }

  var isASCIIDigit: Bool {
    guard let scalar = unicodeScalars.first, unicodeScalars.count == 1 else {
      return false
    }
    return (48...57).contains(Int(scalar.value))
  }
}
