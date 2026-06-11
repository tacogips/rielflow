import Foundation
import RielflowCore

let version = "0.1.15-swift-migration"
let arguments = CommandLine.arguments.dropFirst()

if arguments.contains("--version") {
  print(version)
} else {
  print("rielflow Swift migration CLI scaffold")
  print("available backends: \(nodeExecutionBackendListText())")
}
