import Foundation

public func renderPromptTemplate(_ template: String, variables: JSONObject) -> String {
  let pattern = #"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}"#
  guard let regex = try? NSRegularExpression(pattern: pattern) else {
    return template
  }

  let range = NSRange(template.startIndex..<template.endIndex, in: template)
  var rendered = template
  for match in regex.matches(in: template, range: range).reversed() {
    guard
      let matchRange = Range(match.range, in: template),
      let pathRange = Range(match.range(at: 1), in: template)
    else {
      continue
    }

    let path = String(template[pathRange])
    let replacement = lookupPath(path, in: variables).map(formatTemplateValue) ?? ""
    rendered.replaceSubrange(matchRange, with: replacement)
  }
  return rendered
}

private func lookupPath(_ path: String, in variables: JSONObject) -> JSONValue? {
  let keys = path.split(separator: ".").map(String.init).filter { !$0.isEmpty }
  guard !keys.isEmpty else {
    return nil
  }

  var current: JSONValue? = .object(variables)
  for key in keys {
    guard case let .object(object) = current else {
      return nil
    }
    current = object[key]
  }
  return current
}

private func formatTemplateValue(_ value: JSONValue) -> String {
  switch value {
  case .null:
    return ""
  case let .string(value):
    return value
  case let .bool(value):
    return value ? "true" : "false"
  case let .number(value):
    if value.rounded(.towardZero) == value {
      return String(Int64(value))
    }
    return String(value)
  case .array, .object:
    return (try? value.compactJSONString()) ?? ""
  }
}

extension JSONValue {
  public func compactJSONString() throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(self)
    return String(decoding: data, as: UTF8.self)
  }
}
