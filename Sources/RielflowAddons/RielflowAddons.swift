import RielflowCore

public struct RielflowAddonDescriptor: Codable, Equatable, Sendable {
  public var name: String
  public var version: String?

  public init(name: String, version: String? = nil) {
    self.name = name
    self.version = version
  }
}
