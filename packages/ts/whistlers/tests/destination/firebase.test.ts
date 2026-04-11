import { describe, it, expect, vi, beforeEach } from "vitest"
import { FirebaseDestination } from "../../src/destination/firebase.js"
import type { OutgoingNotification } from "../../src/destination/base.js"

const mockSend = vi.fn().mockResolvedValue("message-id")
const mockGetMessaging = vi.fn(() => ({ send: mockSend }))

vi.mock("firebase-admin/messaging", () => ({
  getMessaging: mockGetMessaging,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockSend.mockResolvedValue("message-id")
  mockGetMessaging.mockReturnValue({ send: mockSend })
})

function makeNotification(overrides: Partial<OutgoingNotification> = {}): OutgoingNotification {
  return {
    topic: "orders",
    sourceTopic: "orders.created",
    rawPayload: { id: "1" },
    ...overrides,
  }
}

describe("FirebaseDestination", () => {
  it("calls messaging.send with the topic", async () => {
    const dest = new FirebaseDestination()
    await dest.send(makeNotification({ topic: "orders" }))
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ topic: "orders" }))
  })

  it("includes notification when present", async () => {
    const dest = new FirebaseDestination()
    await dest.send(
      makeNotification({
        notification: { title: "New order", body: "Check it out" },
      })
    )
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: { title: "New order", body: "Check it out" },
      })
    )
  })

  it("omits notification key when not provided", async () => {
    const dest = new FirebaseDestination()
    await dest.send(makeNotification())
    const call = mockSend.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call?.["notification"]).toBeUndefined()
  })

  it("includes data when present", async () => {
    const dest = new FirebaseDestination()
    await dest.send(makeNotification({ data: { id: "42", status: "pending" } }))
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ data: { id: "42", status: "pending" } })
    )
  })

  it("omits data key when data is empty", async () => {
    const dest = new FirebaseDestination()
    await dest.send(makeNotification({ data: {} }))
    const call = mockSend.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call?.["data"]).toBeUndefined()
  })

  it("uses default app when no app option provided", async () => {
    const dest = new FirebaseDestination()
    await dest.send(makeNotification())
    expect(mockGetMessaging).toHaveBeenCalledWith()
  })

  it("uses provided app when app option is given", async () => {
    const fakeApp = {} as import("firebase-admin/app").App
    const dest = new FirebaseDestination({ app: fakeApp })
    await dest.send(makeNotification())
    expect(mockGetMessaging).toHaveBeenCalledWith(fakeApp)
  })

  it("propagates errors from messaging.send", async () => {
    mockSend.mockRejectedValueOnce(new Error("FCM quota exceeded"))
    const dest = new FirebaseDestination()
    await expect(dest.send(makeNotification())).rejects.toThrow("FCM quota exceeded")
  })

  it("calls format callback with the full OutgoingNotification and uses its return value", async () => {
    const format = vi.fn().mockReturnValue({ data: { custom: "yes" } })
    const dest = new FirebaseDestination({ format })
    await dest.send(makeNotification({ notification: { title: "Hi" }, data: { foo: "bar" } }))
    expect(format).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "orders",
        sourceTopic: "orders.created",
        rawPayload: { id: "1" },
      })
    )
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "orders", data: { custom: "yes" } })
    )
    const call = mockSend.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call?.["notification"]).toBeUndefined()
  })

  it("format callback cannot override topic", async () => {
    const format = vi.fn().mockReturnValue({ topic: "hacked", data: {} })
    const dest = new FirebaseDestination({ format })
    await dest.send(makeNotification({ topic: "orders" }))
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ topic: "orders" }))
  })

  it("propagates errors thrown by format callback", async () => {
    const format = vi.fn().mockImplementation(() => {
      throw new Error("formatter crashed")
    })
    const dest = new FirebaseDestination({ format })
    await expect(dest.send(makeNotification())).rejects.toThrow("formatter crashed")
  })
})
