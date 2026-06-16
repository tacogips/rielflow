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
    return formatTemplateNumber(value)
  case .array, .object:
    return renderCompactJSON(value)
  }
}

private func formatTemplateNumber(_ value: Double) -> String {
  guard value.isFinite else {
    return String(value)
  }
  if value == 0 {
    return "0"
  }

  let rendered = normalizeExponent(String(value))
  let magnitude = abs(value)
  if magnitude >= 1.0e-6, magnitude < 1.0e21 {
    if let expanded = expandPositiveExponent(rendered) ?? expandNegativeExponent(rendered) {
      return expanded
    }
  }

  if rendered.hasSuffix(".0") {
    return String(rendered.dropLast(2))
  }
  return rendered
}

private func normalizeExponent(_ value: String) -> String {
  value
    .replacingOccurrences(of: "e-0", with: "e-")
    .replacingOccurrences(of: "e+0", with: "e+")
}

private func expandPositiveExponent(_ value: String) -> String? {
  let parts = value.split(separator: "e+", maxSplits: 1).map(String.init)
  guard parts.count == 2, let exponent = Int(parts[1]) else {
    return nil
  }

  let isNegative = parts[0].hasPrefix("-")
  let mantissa = isNegative ? String(parts[0].dropFirst()) : parts[0]
  let mantissaParts = mantissa.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
  let whole = mantissaParts.first ?? ""
  let fraction = mantissaParts.count > 1 ? mantissaParts[1] : ""
  let digits = whole + fraction
  let zerosToAppend = exponent - fraction.count
  let sign = isNegative ? "-" : ""

  if zerosToAppend >= 0 {
    return sign + digits + String(repeating: "0", count: zerosToAppend)
  }

  let decimalIndex = digits.index(digits.startIndex, offsetBy: exponent + 1)
  return sign + digits[..<decimalIndex] + "." + digits[decimalIndex...]
}

private func expandNegativeExponent(_ value: String) -> String? {
  let parts = value.split(separator: "e-", maxSplits: 1).map(String.init)
  guard parts.count == 2, let exponent = Int(parts[1]) else {
    return nil
  }

  let isNegative = parts[0].hasPrefix("-")
  let mantissa = isNegative ? String(parts[0].dropFirst()) : parts[0]
  let mantissaParts = mantissa.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
  let whole = mantissaParts.first ?? ""
  let fraction = mantissaParts.count > 1 ? mantissaParts[1] : ""
  let digits = whole + fraction
  let sign = isNegative ? "-" : ""

  return "\(sign)0.\(String(repeating: "0", count: exponent - 1))\(digits)"
}

private func renderCompactJSON(_ value: JSONValue) -> String {
  switch value {
  case .null:
    return "null"
  case let .string(value):
    return renderJSONString(value)
  case let .bool(value):
    return value ? "true" : "false"
  case let .number(value):
    return formatTemplateNumber(value)
  case let .array(values):
    return "[\(values.map(renderCompactJSON).joined(separator: ","))]"
  case let .object(object):
    let pairs = object.keys.sorted().map { key in
      "\(renderJSONString(key)):\(renderCompactJSON(object[key] ?? .null))"
    }
    return "{\(pairs.joined(separator: ","))}"
  }
}

private func renderJSONString(_ value: String) -> String {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.withoutEscapingSlashes]
  guard let data = try? encoder.encode(value) else {
    return "\"\""
  }
  return String(decoding: data, as: UTF8.self)
}

extension JSONValue {
  public func compactJSONString() throws -> String {
    renderCompactJSON(self)
  }
}
