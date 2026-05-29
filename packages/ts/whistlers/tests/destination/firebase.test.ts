import { describe, it, expect, vi, beforeEach } from "vitest"
import { FirebaseDestination } from "../../src/destination/firebase.js"
import type { OutgoingNotification } from "../../src/destination/base.js"

const mockSend = vi.fn().mockResolvedValue("message-id")
const batchOk = (n: number) => ({
  successCount: n,
  failureCount: 0,
  responses: Array.from({ length: n }, () => ({ success: true })),
})
const mockSendEach = vi.fn().mockResolvedValue(batchOk(2))
const mockGetMessaging = vi.fn(() => ({ send: mockSend, sendEach: mockSendEach }))

vi.mock("firebase-admin/messaging", () => ({
  getMessaging: mockGetMessaging,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockSend.mockResolvedValue("message-id")
  mockSendEach.mockResolvedValue(batchOk(2))
  mockGetMessaging.mockReturnValue({ send: mockSend, sendEach: mockSendEach })
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

  it("sends with condition (and no topic) when format returns a condition", async () => {
    const condition = "'orders' in topics && !('user-7' in topics)"
    const format = vi.fn().mockReturnValue({ data: { id: "1" }, condition })
    const dest = new FirebaseDestination({ format })
    await dest.send(makeNotification({ topic: "orders" }))
    const call = mockSend.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call?.["condition"]).toBe(condition)
    expect(call?.["topic"]).toBeUndefined()
    expect(call?.["data"]).toEqual({ id: "1" })
  })

  it("falls back to topic send when condition is empty", async () => {
    const format = vi.fn().mockReturnValue({ data: {}, condition: "" })
    const dest = new FirebaseDestination({ format })
    await dest.send(makeNotification({ topic: "orders" }))
    const call = mockSend.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call?.["topic"]).toBe("orders")
    expect(call?.["condition"]).toBeUndefined()
  })

  it("propagates errors thrown by format callback", async () => {
    const format = vi.fn().mockImplementation(() => {
      throw new Error("formatter crashed")
    })
    const dest = new FirebaseDestination({ format })
    await expect(dest.send(makeNotification())).rejects.toThrow("formatter crashed")
  })

  it("sends each message via sendEach when format returns an array", async () => {
    const format = vi.fn().mockReturnValue([
      { notification: { title: "Placeholder" } },
      { data: { id: "1" } },
    ])
    const dest = new FirebaseDestination({ format })
    await dest.send(makeNotification({ topic: "orders" }))
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockSendEach).toHaveBeenCalledTimes(1)
    const arg = mockSendEach.mock.calls[0]?.[0] as Record<string, unknown>[]
    expect(arg).toHaveLength(2)
    expect(arg[0]).toEqual({ notification: { title: "Placeholder" }, topic: "orders" })
    expect(arg[1]).toEqual({ data: { id: "1" }, topic: "orders" })
  })

  it("addresses each array element independently (condition vs topic)", async () => {
    const condition = "'orders' in topics && !('user-7' in topics)"
    const format = vi.fn().mockReturnValue([
      { notification: { title: "Placeholder" }, condition },
      { data: { id: "1" }, condition },
    ])
    const dest = new FirebaseDestination({ format })
    await dest.send(makeNotification({ topic: "orders" }))
    const arg = mockSendEach.mock.calls[0]?.[0] as Record<string, unknown>[]
    expect(arg[0]).toEqual({ notification: { title: "Placeholder" }, condition })
    expect(arg[0]).not.toHaveProperty("topic")
    expect(arg[1]).toEqual({ data: { id: "1" }, condition })
    expect(arg[1]).not.toHaveProperty("topic")
  })

  it("routes a single-element array through send, not sendEach", async () => {
    const format = vi.fn().mockReturnValue([{ data: { id: "1" } }])
    const dest = new FirebaseDestination({ format })
    await dest.send(makeNotification({ topic: "orders" }))
    expect(mockSendEach).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith({ data: { id: "1" }, topic: "orders" })
  })

  it("sends nothing when format returns an empty array", async () => {
    const format = vi.fn().mockReturnValue([])
    const dest = new FirebaseDestination({ format })
    await dest.send(makeNotification())
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockSendEach).not.toHaveBeenCalled()
  })

  it("resolves on partial batch failure by default (a delivered message survives)", async () => {
    mockSendEach.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 1,
      responses: [{ success: true }, { success: false, error: new Error("bad token") }],
    })
    const format = vi.fn().mockReturnValue([{ data: { a: "1" } }, { data: { b: "2" } }])
    const dest = new FirebaseDestination({ format })
    await expect(dest.send(makeNotification())).resolves.toBeUndefined()
  })

  it("throws on partial batch failure when multiSendFailure is 'throw'", async () => {
    mockSendEach.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 1,
      responses: [{ success: true }, { success: false, error: new Error("bad token") }],
    })
    const format = vi.fn().mockReturnValue([{ data: { a: "1" } }, { data: { b: "2" } }])
    const dest = new FirebaseDestination({ format, multiSendFailure: "throw" })
    await expect(dest.send(makeNotification())).rejects.toThrow(/1\/2 FCM messages failed/)
  })

  it("throws when every message in the batch fails (regardless of policy)", async () => {
    mockSendEach.mockResolvedValueOnce({
      successCount: 0,
      failureCount: 2,
      responses: [
        { success: false, error: new Error("e0") },
        { success: false, error: new Error("e1") },
      ],
    })
    const format = vi.fn().mockReturnValue([{ data: { a: "1" } }, { data: { b: "2" } }])
    const dest = new FirebaseDestination({ format })
    await expect(dest.send(makeNotification())).rejects.toThrow(/2\/2 FCM messages failed/)
  })
})
