import Foundation

public enum CLIRuntimeEnvironment {
  @TaskLocal public static var overrides: [String: String]?

  public static func mergedProcessEnvironment() -> [String: String] {
    var environment = ProcessInfo.processInfo.environment
    if let overrides {
      for (key, value) in overrides {
        environment[key] = value
      }
    }
    return environment
  }

  public static func homeDirectory(
    environment: [String: String] = mergedProcessEnvironment()
  ) -> String {
    environment["HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? NSHomeDirectory()
  }
}
