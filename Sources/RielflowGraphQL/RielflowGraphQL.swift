import RielflowCore

public struct GraphQLRequest: Codable, Equatable, Sendable {
  public var query: String
  public var variables: JSONObject?

  public init(query: String, variables: JSONObject? = nil) {
    self.query = query
    self.variables = variables
  }
}
