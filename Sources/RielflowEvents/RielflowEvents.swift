import Foundation
import RielflowCore

public struct RielflowEventEnvelope: Codable, Equatable, Sendable {
  public var sourceId: String
  public var eventId: String
  public var receivedAt: Date
  public var payload: JSONObject

  public init(sourceId: String, eventId: String, receivedAt: Date = Date(), payload: JSONObject) {
    self.sourceId = sourceId
    self.eventId = eventId
    self.receivedAt = receivedAt
    self.payload = payload
  }
}
