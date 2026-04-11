import { describe, it, expect } from "vitest"
import { MemoryDestination } from "../../src/destination/memory.js"
import type { OutgoingNotification } from "../../src/destination/base.js"

function makeNotification(topic: string, overrides: Partial<OutgoingNotification> = {}): OutgoingNotification {
  return {
    topic,
    sourceTopic: topic,
    rawPayload: {},
    ...overrides,
  }
}

describe("MemoryDestination", () => {
  it("records sent notifications", async () => {
    const dest = new MemoryDestination()
    await dest.send(makeNotification("orders"))
    await dest.send(makeNotification("events"))
    expect(dest.sent).toHaveLength(2)
    expect(dest.sent[0]?.topic).toBe("orders")
    expect(dest.sent[1]?.topic).toBe("events")
  })

  it("clear() empties sent without closing", () => {
    const dest = new MemoryDestination()
    dest.sent.push(makeNotification("x"))
    dest.clear()
    expect(dest.sent).toHaveLength(0)
  })

  it("close() empties sent", async () => {
    const dest = new MemoryDestination()
    await dest.send(makeNotification("x"))
    await dest.close()
    expect(dest.sent).toHaveLength(0)
  })

  it("preserves notification details", async () => {
    const dest = new MemoryDestination()
    await dest.send(
      makeNotification("orders", {
        notification: { title: "Hello", body: "World" },
        data: { id: "1" },
        rawPayload: { id: "1", status: "pending" },
      })
    )
    const n = dest.sent[0]!
    expect(n.notification?.title).toBe("Hello")
    expect(n.notification?.body).toBe("World")
    expect(n.data?.["id"]).toBe("1")
  })
})
