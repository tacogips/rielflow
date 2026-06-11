import Foundation

public struct WorkflowOutputContract: Codable, Equatable, Sendable {
  public var schema: JSONObject?
  public var requiredObject: Bool

  public init(schema: JSONObject? = nil, requiredObject: Bool = false) {
    self.schema = schema
    self.requiredObject = requiredObject
  }
}

public enum WorkflowOutputValidationStatus: String, Codable, Sendable {
  case accepted
  case rejected
}

public struct WorkflowOutputValidationResult: Codable, Equatable, Sendable {
  public var status: WorkflowOutputValidationStatus
  public var payload: JSONObject?
  public var reason: String?

  public init(status: WorkflowOutputValidationStatus, payload: JSONObject? = nil, reason: String? = nil) {
    self.status = status
    self.payload = payload
    self.reason = reason
  }
}

public protocol WorkflowOutputValidating: Sendable {
  func validate(_ candidate: RuntimeOutputCandidate, contract: WorkflowOutputContract?) throws -> WorkflowOutputValidationResult
}

public struct DefaultWorkflowOutputValidator: WorkflowOutputValidating {
  public init() {}

  public func validate(_ candidate: RuntimeOutputCandidate, contract: WorkflowOutputContract?) throws -> WorkflowOutputValidationResult {
    guard candidate.completionPassed else {
      return WorkflowOutputValidationResult(status: .rejected, reason: "completionPassed is false")
    }
    guard let contract else {
      return WorkflowOutputValidationResult(status: .accepted, payload: candidate.payload)
    }
    if let schema = contract.schema, let reason = validate(candidate.payload, against: schema) {
      return WorkflowOutputValidationResult(status: .rejected, reason: reason)
    }
    return WorkflowOutputValidationResult(status: .accepted, payload: candidate.payload)
  }

  private func validate(_ payload: JSONObject, against schema: JSONObject) -> String? {
    let schemaValue = JSONValue.object(schema)
    let payloadValue = JSONValue.object(payload)
    if let reason = validateSchemaDefinition(schema) {
      return reason
    }
    if !canPossiblyAcceptObject(schema) {
      return "output contract $schema must allow object because node output payloads are always top-level JSON objects"
    }
    return validateValue(payloadValue, against: schemaValue, path: "$")
  }

  private func validateSchemaDefinition(_ schema: JSONObject) -> String? {
    var errors: [(path: String, message: String)] = []
    validateSchemaNode(.object(schema), path: "$schema", errors: &errors)
    if let first = errors.first {
      return "output contract \(first.path) \(first.message)"
    }
    return nil
  }

  private func validateSchemaNode(_ schemaValue: JSONValue, path: String, errors: inout [(path: String, message: String)]) {
    guard case let .object(schema) = schemaValue else {
      errors.append((path, "must be an object"))
      return
    }

    let supportedSchemaKeys: Set<String> = [
      "$schema",
      "title",
      "description",
      "type",
      "properties",
      "required",
      "additionalProperties",
      "items",
      "enum",
      "const",
      "minLength",
      "maxLength",
      "pattern",
      "minimum",
      "maximum",
      "minItems",
      "maxItems",
      "anyOf",
      "oneOf",
      "allOf"
    ]

    for key in schema.keys.sorted() where !supportedSchemaKeys.contains(key) {
      errors.append(("\(path).\(key)", "uses an unsupported JSON Schema keyword"))
    }

    validateStringMetadata("$schema", schema: schema, path: path, errors: &errors)
    validateStringMetadata("title", schema: schema, path: path, errors: &errors)
    validateStringMetadata("description", schema: schema, path: path, errors: &errors)
    validateSchemaType(schema["type"], path: path, errors: &errors)
    validateSchemaProperties(schema["properties"], path: path, errors: &errors)
    validateSchemaRequired(schema["required"], path: path, errors: &errors)
    validateSchemaAdditionalProperties(schema["additionalProperties"], path: path, errors: &errors)
    if let items = schema["items"] {
      validateSchemaNode(items, path: "\(path).items", errors: &errors)
    }
    validateSchemaEnum(schema["enum"], path: path, errors: &errors)
    validateSchemaIntegerBound("minLength", schema: schema, path: path, errors: &errors)
    validateSchemaIntegerBound("maxLength", schema: schema, path: path, errors: &errors)
    validateSchemaOrderedBounds(minKey: "minLength", maxKey: "maxLength", schema: schema, path: path, errors: &errors)
    validateSchemaPattern(schema["pattern"], path: path, errors: &errors)
    validateSchemaNumberBound("minimum", schema: schema, path: path, errors: &errors)
    validateSchemaNumberBound("maximum", schema: schema, path: path, errors: &errors)
    validateSchemaOrderedBounds(minKey: "minimum", maxKey: "maximum", schema: schema, path: path, errors: &errors)
    validateSchemaIntegerBound("minItems", schema: schema, path: path, errors: &errors)
    validateSchemaIntegerBound("maxItems", schema: schema, path: path, errors: &errors)
    validateSchemaOrderedBounds(minKey: "minItems", maxKey: "maxItems", schema: schema, path: path, errors: &errors)
    validateSchemaCombinator("anyOf", schema: schema, path: path, errors: &errors)
    validateSchemaCombinator("oneOf", schema: schema, path: path, errors: &errors)
    validateSchemaCombinator("allOf", schema: schema, path: path, errors: &errors)
  }

  private func validateStringMetadata(
    _ key: String,
    schema: JSONObject,
    path: String,
    errors: inout [(path: String, message: String)]
  ) {
    guard let value = schema[key] else {
      return
    }
    if value.stringValue == nil {
      errors.append(("\(path).\(key)", "must be a string when provided"))
    }
  }

  private func validateSchemaType(
    _ value: JSONValue?,
    path: String,
    errors: inout [(path: String, message: String)]
  ) {
    guard let value else {
      return
    }
    let primitiveTypes: Set<String> = ["null", "boolean", "object", "array", "number", "integer", "string"]
    switch value {
    case let .string(typeName):
      if !primitiveTypes.contains(typeName) {
        errors.append(("\(path).type", "must be a supported JSON Schema type"))
      }
    case let .array(entries):
      if entries.isEmpty {
        errors.append(("\(path).type", "must not be an empty array"))
      }
      for (index, entry) in entries.enumerated() {
        guard let typeName = entry.stringValue, primitiveTypes.contains(typeName) else {
          errors.append(("\(path).type[\(index)]", "must be a supported JSON Schema type"))
          continue
        }
      }
    default:
      errors.append(("\(path).type", "must be a string or array of strings"))
    }
  }

  private func validateSchemaProperties(
    _ value: JSONValue?,
    path: String,
    errors: inout [(path: String, message: String)]
  ) {
    guard let value else {
      return
    }
    guard case let .object(properties) = value else {
      errors.append(("\(path).properties", "must be an object when provided"))
      return
    }
    for key in properties.keys.sorted() {
      validateSchemaNode(properties[key] ?? .null, path: "\(path).properties.\(key)", errors: &errors)
    }
  }

  private func validateSchemaRequired(
    _ value: JSONValue?,
    path: String,
    errors: inout [(path: String, message: String)]
  ) {
    guard let value else {
      return
    }
    guard case let .array(entries) = value else {
      errors.append(("\(path).required", "must be an array when provided"))
      return
    }
    for (index, entry) in entries.enumerated() {
      guard let key = entry.stringValue, !key.isEmpty else {
        errors.append(("\(path).required[\(index)]", "must be a non-empty string"))
        continue
      }
    }
  }

  private func validateSchemaAdditionalProperties(
    _ value: JSONValue?,
    path: String,
    errors: inout [(path: String, message: String)]
  ) {
    guard let value else {
      return
    }
    if case .bool = value {
      return
    }
    validateSchemaNode(value, path: "\(path).additionalProperties", errors: &errors)
  }

  private func validateSchemaEnum(
    _ value: JSONValue?,
    path: String,
    errors: inout [(path: String, message: String)]
  ) {
    guard let value else {
      return
    }
    guard case let .array(entries) = value, !entries.isEmpty else {
      errors.append(("\(path).enum", "must be a non-empty array when provided"))
      return
    }
  }

  private func validateSchemaIntegerBound(
    _ key: String,
    schema: JSONObject,
    path: String,
    errors: inout [(path: String, message: String)]
  ) {
    guard let value = schema[key] else {
      return
    }
    guard let number = value.numberValue, number.isFinite, number.rounded() == number, number >= 0 else {
      errors.append(("\(path).\(key)", "must be an integer >= 0 when provided"))
      return
    }
  }

  private func validateSchemaNumberBound(
    _ key: String,
    schema: JSONObject,
    path: String,
    errors: inout [(path: String, message: String)]
  ) {
    guard let value = schema[key] else {
      return
    }
    guard let number = value.numberValue, number.isFinite else {
      errors.append(("\(path).\(key)", "must be a finite number when provided"))
      return
    }
  }

  private func validateSchemaOrderedBounds(
    minKey: String,
    maxKey: String,
    schema: JSONObject,
    path: String,
    errors: inout [(path: String, message: String)]
  ) {
    guard let minimum = schema[minKey]?.numberValue, let maximum = schema[maxKey]?.numberValue, minimum > maximum else {
      return
    }
    errors.append(("\(path).\(maxKey)", "must be >= \(minKey)"))
  }

  private func validateSchemaPattern(
    _ value: JSONValue?,
    path: String,
    errors: inout [(path: String, message: String)]
  ) {
    guard let value else {
      return
    }
    guard let pattern = value.stringValue else {
      errors.append(("\(path).pattern", "must be a string when provided"))
      return
    }
    do {
      _ = try NSRegularExpression(pattern: pattern)
    } catch {
      errors.append(("\(path).pattern", "must be a valid regular expression"))
    }
  }

  private func validateSchemaCombinator(
    _ key: String,
    schema: JSONObject,
    path: String,
    errors: inout [(path: String, message: String)]
  ) {
    guard let value = schema[key] else {
      return
    }
    guard case let .array(entries) = value, !entries.isEmpty else {
      errors.append(("\(path).\(key)", "must be a non-empty array when provided"))
      return
    }
    for (index, entry) in entries.enumerated() {
      validateSchemaNode(entry, path: "\(path).\(key)[\(index)]", errors: &errors)
    }
  }

  private func validateValue(_ value: JSONValue, against schemaValue: JSONValue, path: String) -> String? {
    guard case let .object(schema) = schemaValue else {
      return "output contract \(path) schema must be an object"
    }

    let allowedTypes = schemaTypes(schema["type"])
    if !allowedTypes.isEmpty, !allowedTypes.contains(where: { value.matchesSchemaType($0) }) {
      return "output contract \(path) must be of type \(allowedTypes.joined(separator: " | "))"
    }

    if let constValue = schema["const"], value != constValue {
      return "output contract \(path) must equal the declared const value"
    }

    if let enumValue = schema["enum"], case let .array(entries) = enumValue, !entries.contains(value) {
      return "output contract \(path) must equal one of the declared enum values"
    }

    if let reason = validateCombinators(value, schema: schema, path: path) {
      return reason
    }

    if case let .string(stringValue) = value, let reason = validateString(stringValue, schema: schema, path: path) {
      return reason
    }
    if case let .number(numberValue) = value, let reason = validateNumber(numberValue, schema: schema, path: path) {
      return reason
    }
    if case let .array(arrayValue) = value, let reason = validateArray(arrayValue, schema: schema, path: path) {
      return reason
    }
    if case let .object(objectValue) = value, let reason = validateObject(objectValue, schema: schema, path: path) {
      return reason
    }
    return nil
  }

  private func validateCombinators(_ value: JSONValue, schema: JSONObject, path: String) -> String? {
    if let allOf = schema["allOf"], case let .array(entries) = allOf {
      for entry in entries {
        if let reason = validateValue(value, against: entry, path: path) {
          return reason
        }
      }
    }
    if let anyOf = schema["anyOf"], case let .array(entries) = anyOf {
      let matches = entries.contains { validateValue(value, against: $0, path: path) == nil }
      if !matches {
        return "output contract \(path) must satisfy at least one anyOf branch"
      }
    }
    if let oneOf = schema["oneOf"], case let .array(entries) = oneOf {
      let matches = entries.filter { validateValue(value, against: $0, path: path) == nil }
      if matches.count != 1 {
        return "output contract \(path) must satisfy exactly one oneOf branch"
      }
    }
    return nil
  }

  private func validateString(_ value: String, schema: JSONObject, path: String) -> String? {
    if let minLength = schema["minLength"]?.numberValue, value.count < Int(minLength) {
      return "output contract \(path) must have length >= \(formatNumber(minLength))"
    }
    if let maxLength = schema["maxLength"]?.numberValue, value.count > Int(maxLength) {
      return "output contract \(path) must have length <= \(formatNumber(maxLength))"
    }
    if let pattern = schema["pattern"]?.stringValue,
       let regexResult = validate(value, matchesPattern: pattern, path: path) {
      return regexResult
    }
    return nil
  }

  private func validate(_ value: String, matchesPattern pattern: String, path: String) -> String? {
    do {
      let regex = try NSRegularExpression(pattern: pattern)
      let range = NSRange(value.startIndex..<value.endIndex, in: value)
      return regex.firstMatch(in: value, range: range) == nil ? "output contract \(path) must match the declared pattern" : nil
    } catch {
      return "output contract \(path) pattern must be a valid regular expression"
    }
  }

  private func validateNumber(_ value: Double, schema: JSONObject, path: String) -> String? {
    guard value.isFinite else {
      return "output contract \(path) must be a finite number"
    }
    if let minimum = schema["minimum"]?.numberValue, value < minimum {
      return "output contract \(path) must be >= \(formatNumber(minimum))"
    }
    if let maximum = schema["maximum"]?.numberValue, value > maximum {
      return "output contract \(path) must be <= \(formatNumber(maximum))"
    }
    return nil
  }

  private func validateArray(_ value: [JSONValue], schema: JSONObject, path: String) -> String? {
    if let minItems = schema["minItems"]?.numberValue, value.count < Int(minItems) {
      return "output contract \(path) must contain at least \(formatNumber(minItems)) items"
    }
    if let maxItems = schema["maxItems"]?.numberValue, value.count > Int(maxItems) {
      return "output contract \(path) must contain at most \(formatNumber(maxItems)) items"
    }
    if let items = schema["items"] {
      for (index, entry) in value.enumerated() {
        if let reason = validateValue(entry, against: items, path: "\(path)[\(index)]") {
          return reason
        }
      }
    }
    return nil
  }

  private func validateObject(_ value: JSONObject, schema: JSONObject, path: String) -> String? {
    let properties = schema["properties"]?.objectValue ?? [:]
    if let required = schema["required"], case let .array(requiredValues) = required {
      for entry in requiredValues {
        guard case let .string(key) = entry else {
          return "output contract \(path) required entries must be strings"
        }
        if value[key] == nil {
          return "output contract \(joinPath(path, key)) required property is missing"
        }
      }
    }

    for (key, entry) in value {
      if let propertySchema = properties[key] {
        if let reason = validateValue(entry, against: propertySchema, path: joinPath(path, key)) {
          return reason
        }
      } else if schema["additionalProperties"] == .bool(false) {
        return "output contract \(joinPath(path, key)) additional property is not allowed"
      } else if let additionalProperties = schema["additionalProperties"], case .object = additionalProperties {
        if let reason = validateValue(entry, against: additionalProperties, path: joinPath(path, key)) {
          return reason
        }
      }
    }
    return nil
  }

  private func canPossiblyAcceptObject(_ schema: JSONObject) -> Bool {
    let allowedTypes = schemaTypes(schema["type"])
    if !allowedTypes.isEmpty, !allowedTypes.contains("object") {
      return false
    }
    if let constValue = schema["const"] {
      return constValue.objectValue != nil
    }
    if let enumValue = schema["enum"], case let .array(entries) = enumValue {
      return entries.contains { $0.objectValue != nil }
    }
    if let allOf = schema["allOf"], case let .array(entries) = allOf {
      return entries.allSatisfy { $0.objectValue.map(canPossiblyAcceptObject) ?? false }
    }
    if let anyOf = schema["anyOf"], case let .array(entries) = anyOf {
      return entries.contains { $0.objectValue.map(canPossiblyAcceptObject) ?? false }
    }
    if let oneOf = schema["oneOf"], case let .array(entries) = oneOf {
      return entries.contains { $0.objectValue.map(canPossiblyAcceptObject) ?? false }
    }
    return true
  }

  private func schemaTypes(_ value: JSONValue?) -> [String] {
    switch value {
    case let .string(typeName):
      return [typeName]
    case let .array(values):
      return values.compactMap(\.stringValue)
    default:
      return []
    }
  }

  private func joinPath(_ basePath: String, _ next: String) -> String {
    basePath == "$" ? "$.\(next)" : "\(basePath).\(next)"
  }

  private func formatNumber(_ value: Double) -> String {
    value.rounded() == value ? String(Int(value)) : String(value)
  }
}

private extension JSONValue {
  var stringValue: String? {
    guard case let .string(value) = self else {
      return nil
    }
    return value
  }

  var numberValue: Double? {
    guard case let .number(value) = self else {
      return nil
    }
    return value
  }

  var objectValue: JSONObject? {
    guard case let .object(value) = self else {
      return nil
    }
    return value
  }

  func matchesSchemaType(_ type: String) -> Bool {
    switch (type, self) {
    case ("null", .null), ("boolean", .bool), ("number", .number), ("string", .string), ("array", .array), ("object", .object):
      return true
    case ("integer", .number(let value)):
      return value.rounded() == value
    default:
      return false
    }
  }
}
