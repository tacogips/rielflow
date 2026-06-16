import Foundation
import RielflowCore
import RielflowGraphQL

public struct ServerRequestEnvelope: Equatable, Sendable {
  public var method: String
  public var path: String
  public var headers: [String: String]
  public var body: Data?

  public init(method: String, path: String, headers: [String: String] = [:], body: Data? = nil) {
    self.method = method
    self.path = path
    self.headers = headers
    self.body = body
  }
}

public struct ServerResponseDescriptor: Equatable, Sendable {
  public var status: Int
  public var contentType: String
  public var body: JSONObject

  public init(status: Int, contentType: String = "application/json", body: JSONObject) {
    self.status = status
    self.contentType = contentType
    self.body = body
  }
}

public struct ServerRequestContext: Equatable, Sendable {
  public var serviceName: String
  public var bearerToken: String?
  public var managerSessionId: String?
  public var inheritedEnvironment: [String: String]

  public init(
    serviceName: String = "rielflow",
    bearerToken: String? = nil,
    managerSessionId: String? = nil,
    inheritedEnvironment: [String: String] = [:]
  ) {
    self.serviceName = serviceName
    self.bearerToken = bearerToken
    self.managerSessionId = managerSessionId
    self.inheritedEnvironment = inheritedEnvironment
  }

  public var sanitizedEnvironment: [String: String] {
    let strippedKeys: Set<String> = [
      "RIELFLOW_MANAGER_SESSION_ID",
      "RIEL_WORKFLOW_ID",
      "RIEL_WORKFLOW_EXECUTION_ID"
    ]
    return inheritedEnvironment.filter { key, _ in
      !key.hasPrefix("RIEL_MANAGER_") && !strippedKeys.contains(key)
    }
  }
}

public struct GraphQLServerEnvelope: Equatable, Sendable {
  public var query: String
  public var variables: JSONObject
  public var operationName: String?

  public init(query: String, variables: JSONObject = [:], operationName: String? = nil) {
    self.query = query
    self.variables = variables
    self.operationName = operationName
  }
}

public protocol ServerRouteHandling: Sendable {
  func route(_ request: ServerRequestEnvelope, context: ServerRequestContext) async -> ServerResponseDescriptor
}

public struct DeterministicServerRouteHandler: ServerRouteHandling {
  public init() {}

  public func route(_ request: ServerRequestEnvelope, context: ServerRequestContext) async -> ServerResponseDescriptor {
    let normalizedMethod = request.method.uppercased()
    let contextWithHeaders = context.withHeaders(from: request.headers)
    switch (normalizedMethod, request.path) {
    case ("GET", "/"), ("GET", "/overview"):
      return .init(status: 200, body: [
        "service": .string(context.serviceName),
        "route": .string(request.path),
        "readOnly": .bool(true)
      ])
    case ("GET", "/healthz"):
      return .init(status: 200, body: [
        "service": .string(context.serviceName),
        "status": .string("ok")
      ])
    case ("POST", "/graphql"):
      return routeGraphQL(request, context: contextWithHeaders)
    case (_, "/"), (_, "/overview"), (_, "/healthz"), (_, "/graphql"):
      return .init(status: 405, body: [
        "error": .string("unsupported method"),
        "method": .string(normalizedMethod),
        "path": .string(request.path)
      ])
    default:
      return .init(status: 404, body: [
        "error": .string("unknown path"),
        "path": .string(request.path)
      ])
    }
  }

  public func parseGraphQLEnvelope(_ request: ServerRequestEnvelope) -> GraphQLEnvelopeParseResult {
    guard let body = request.body, !body.isEmpty else {
      return .failure("graphql request body is required")
    }
    guard let value = try? JSONDecoder().decode(JSONValue.self, from: body), case let .object(object) = value else {
      return .failure("graphql request body must be a JSON object")
    }
    guard case let .string(rawQuery)? = object["query"] else {
      return .failure("graphql request body must include a non-empty query string")
    }
    let query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else {
      return .failure("graphql request body must include a non-empty query string")
    }
    let variables: JSONObject
    if let rawVariables = object["variables"] {
      if case .null = rawVariables {
        variables = [:]
      } else if case let .object(variableObject) = rawVariables {
        variables = variableObject
      } else {
        return .failure("graphql variables must be an object when present")
      }
    } else {
      variables = [:]
    }
    let operationName: String?
    if let rawOperationName = object["operationName"] {
      switch rawOperationName {
      case .null:
        operationName = nil
      case let .string(value):
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        operationName = trimmed.isEmpty ? nil : trimmed
      default:
        operationName = nil
      }
    } else {
      operationName = nil
    }
    return .success(.init(query: query, variables: variables, operationName: operationName))
  }

  private func routeGraphQL(_ request: ServerRequestEnvelope, context: ServerRequestContext) -> ServerResponseDescriptor {
    switch parseGraphQLEnvelope(request) {
    case let .failure(message):
      return .init(status: 400, body: ["error": .string(message)])
    case let .success(envelope):
      return .init(status: 200, body: [
        "graphql": .object([
          "delegated": .bool(true),
          "query": .string(envelope.query),
          "variables": .object(envelope.variables),
          "operationName": envelope.operationName.map(JSONValue.string) ?? .null,
          "schema": .string(GraphQLContractProjector.schemaContract)
        ]),
        "context": .object([
          "bearerTokenPresent": .bool(context.bearerToken != nil),
          "managerSessionId": context.managerSessionId.map(JSONValue.string) ?? .null,
          "sanitizedEnvironmentKeys": .array(context.sanitizedEnvironment.keys.sorted().map(JSONValue.string))
        ])
      ])
    }
  }
}

public enum GraphQLEnvelopeParseResult: Equatable, Sendable {
  case success(GraphQLServerEnvelope)
  case failure(String)
}

private extension ServerRequestContext {
  func withHeaders(from headers: [String: String]) -> ServerRequestContext {
    var copy = self
    var lowercased: [String: String] = [:]
    for key in headers.keys.sorted() {
      lowercased[key.lowercased()] = headers[key]
    }
    if let authorization = lowercased["authorization"], authorization.lowercased().hasPrefix("bearer ") {
      copy.bearerToken = String(authorization.dropFirst("Bearer ".count))
    }
    if let managerSessionId = lowercased["x-rielflow-manager-session-id"] {
      copy.managerSessionId = managerSessionId
    }
    return copy
  }
}
