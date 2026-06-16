import RielflowGraphQL

public struct RielflowServerConfiguration: Equatable, Sendable {
  public var host: String
  public var port: Int

  public init(host: String = "127.0.0.1", port: Int = 8787) {
    self.host = host
    self.port = port
  }
}
