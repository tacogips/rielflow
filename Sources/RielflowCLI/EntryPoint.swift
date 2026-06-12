import Foundation

@main
struct RielflowSwiftCLI {
  static func main() async {
    let result = await RielflowCLIApplication().run(Array(CommandLine.arguments.dropFirst()))
    if !result.stdout.isEmpty {
      FileHandle.standardOutput.write(Data(result.stdout.utf8))
    }
    if !result.stderr.isEmpty {
      FileHandle.standardError.write(Data((result.stderr + "\n").utf8))
    }
    Foundation.exit(result.exitCode.rawValue)
  }
}
