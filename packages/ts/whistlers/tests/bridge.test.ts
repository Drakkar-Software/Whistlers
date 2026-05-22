import { describe, it, expect, vi } from "vitest"
import { Whistler, sanitizeTopic } from "../src/bridge.js"
import { MemoryQueueAdapter, CustomQueueAdapter } from "../src/queue/memory.js"
import { MemoryDestination } from "../src/destination/memory.js"
import { createConfig } from "../src/config/loader.js"
import type { QueueMessage, TopicSubscription } from "../src/queue/base.js"

function makeMessage(topic: string, payload: unknown = {}): QueueMessage {
  return { topic, payload: JSON.stringify(payload), timestamp: 1000 }
}

function setup(overrides?: Partial<Parameters<typeof createConfig>[0]>) {
  const queue = new MemoryQueueAdapter()
  const dest = new MemoryDestination()
  const config = createConfig({
    subscriptions: [
      {
        name: "orders",
        topics: ["orders.*"],
        notification: { title: "Order update", body: "Something changed" },
        dataFields: ["id", "status"],
      },
    ],
    ...overrides,
  })
  const whistler = new Whistler({ queue, destination: dest, config })
  return { queue, dest, whistler }
}

describe("sanitizeTopic", () => {
  it("leaves safe characters intact", () => {
    expect(sanitizeTopic("orders-v1_test~100%")).toBe("orders-v1_test~100%")
  })

  it("replaces dots", () => {
    expect(sanitizeTopic("orders.created")).toBe("orders-created")
  })

  it("replaces slashes", () => {
    expect(sanitizeTopic("orders/created")).toBe("orders-created")
  })

  it("replaces spaces and special chars", () => {
    expect(sanitizeTopic("a b!c")).toBe("a-b-c")
  })
})

describe("Whistler lifecycle", () => {
  it("starts and stops cleanly", async () => {
    const { whistler, queue } = setup()
    await whistler.start()
    expect(queue.isConnected()).toBe(true)
    expect(queue.subscribed).toContain("orders.*")
    await whistler.stop()
    expect(queue.isConnected()).toBe(false)
  })

  it("throws if started twice", async () => {
    const { whistler } = setup()
    await whistler.start()
    await expect(whistler.start()).rejects.toThrow("already started")
    await whistler.stop()
  })

  it("stop is safe to call before start", async () => {
    const { whistler } = setup()
    await expect(whistler.stop()).resolves.toBeUndefined()
  })
})

describe("Whistler message routing", () => {
  it("forwards a matching message to the destination", async () => {
    const { queue, dest, whistler } = setup()
    await whistler.start()

    await queue.simulate(makeMessage("orders.created", { id: "1", status: "pending" }))

    expect(dest.sent).toHaveLength(1)
    const n = dest.sent[0]!
    expect(n.sourceTopic).toBe("orders.created")
    expect(n.topic).toBe("orders-created")
    expect(n.notification?.title).toBe("Order update")
    expect(n.notification?.body).toBe("Something changed")
    await whistler.stop()
  })

  it("does not forward messages that match no subscription", async () => {
    const { queue, dest, whistler } = setup()
    await whistler.start()
    await queue.simulate(makeMessage("unrelated.topic"))
    expect(dest.sent).toHaveLength(0)
    await whistler.stop()
  })

  it("extracts dataFields from payload", async () => {
    const { queue, dest, whistler } = setup()
    await whistler.start()
    await queue.simulate(makeMessage("orders.updated", { id: "42", status: "shipped", internal: "skip" }))

    const n = dest.sent[0]!
    expect(n.data?.["id"]).toBe("42")
    expect(n.data?.["status"]).toBe("shipped")
    expect(n.data?.["internal"]).toBeUndefined()
    await whistler.stop()
  })

  it("omits data when no dataFields configured", async () => {
    const queue = new MemoryQueueAdapter()
    const dest = new MemoryDestination()
    const config = createConfig({
      subscriptions: [{ name: "events", topics: ["events.*"] }],
    })
    const whistler = new Whistler({ queue, destination: dest, config })
    await whistler.start()
    await queue.simulate(makeMessage("events.fired", { id: "1" }))
    expect(dest.sent[0]?.data).toBeUndefined()
    await whistler.stop()
  })

  it("uses destinationTopic override when set", async () => {
    const queue = new MemoryQueueAdapter()
    const dest = new MemoryDestination()
    const config = createConfig({
      subscriptions: [{ name: "orders", topics: ["orders.*"], destinationTopic: "order-events" }],
    })
    const whistler = new Whistler({ queue, destination: dest, config })
    await whistler.start()
    await queue.simulate(makeMessage("orders.created"))
    expect(dest.sent[0]?.topic).toBe("order-events")
    await whistler.stop()
  })

  it("raw payload is set to the original JSON-parsed value", async () => {
    const { queue, dest, whistler } = setup()
    await whistler.start()
    await queue.simulate(makeMessage("orders.created", { id: "99", amount: 100 }))
    expect((dest.sent[0]?.rawPayload as Record<string, unknown>)?.["id"]).toBe("99")
    await whistler.stop()
  })

  it("sets rawPayload to the string when payload is not valid JSON", async () => {
    const { queue, dest, whistler } = setup()
    await whistler.start()
    await queue.simulate({ topic: "orders.created", payload: "plain-text", timestamp: 1000 })
    expect(dest.sent[0]?.rawPayload).toBe("plain-text")
    await whistler.stop()
  })

  it("a message can match multiple subscriptions", async () => {
    const queue = new MemoryQueueAdapter()
    const dest = new MemoryDestination()
    const config = createConfig({
      subscriptions: [
        { name: "sub-a", topics: ["events.*"], destinationTopic: "a" },
        { name: "sub-b", topics: ["events.>"], destinationTopic: "b" },
      ],
    })
    const whistler = new Whistler({ queue, destination: dest, config })
    await whistler.start()
    await queue.simulate(makeMessage("events.fired"))
    expect(dest.sent).toHaveLength(2)
    const topics = dest.sent.map((n) => n.topic)
    expect(topics).toContain("a")
    expect(topics).toContain("b")
    await whistler.stop()
  })

  it("deduplicates subscribed topics across subscriptions", async () => {
    const queue = new MemoryQueueAdapter()
    const dest = new MemoryDestination()
    const config = createConfig({
      subscriptions: [
        { name: "a", topics: ["orders.*"] },
        { name: "b", topics: ["orders.*", "events.*"] },
      ],
    })
    const whistler = new Whistler({ queue, destination: dest, config })
    await whistler.start()
    expect(queue.subscribed).toHaveLength(2)
    expect(queue.subscribed).toContain("orders.*")
    expect(queue.subscribed).toContain("events.*")
    await whistler.stop()
  })

  it("passes group to the queue adapter when subscribing", async () => {
    const received: TopicSubscription[] = []
    const queue = new CustomQueueAdapter({
      onSubscribe: async (subs) => { received.push(...subs) },
    })
    const dest = new MemoryDestination()
    const config = createConfig({
      subscriptions: [
        { name: "orders", topics: ["orders.*"], group: "workers" },
        { name: "events", topics: ["events.*"] },
      ],
    })
    const whistler = new Whistler({ queue, destination: dest, config })
    await whistler.start()
    expect(received).toContainEqual({ topic: "orders.*", group: "workers" })
    expect(received).toContainEqual({ topic: "events.*" })
    await whistler.stop()
  })
})

describe("Whistler namespace routing", () => {
  it("prefixes destination topic with namespace name", async () => {
    const queue = new MemoryQueueAdapter()
    const dest = new MemoryDestination()
    const config = createConfig({
      subscriptions: [],
      namespaces: {
        tenantA: {
          subscriptions: [{ name: "orders", topics: ["orders.*"] }],
        },
      },
    })
    const whistler = new Whistler({ queue, destination: dest, config })
    await whistler.start()
    await queue.simulate(makeMessage("orders.created"))
    expect(dest.sent[0]?.topic).toBe("tenantA-orders-created")
    await whistler.stop()
  })

  it("attaches namespace field to OutgoingNotification", async () => {
    const queue = new MemoryQueueAdapter()
    const dest = new MemoryDestination()
    const config = createConfig({
      subscriptions: [],
      namespaces: {
        tenantA: {
          subscriptions: [{ name: "orders", topics: ["orders.*"] }],
        },
      },
    })
    const whistler = new Whistler({ queue, destination: dest, config })
    await whistler.start()
    await queue.simulate(makeMessage("orders.created"))
    expect(dest.sent[0]?.namespace).toBe("tenantA")
    await whistler.stop()
  })

  it("prefixes even an explicit destinationTopic with the namespace", async () => {
    const queue = new MemoryQueueAdapter()
    const dest = new MemoryDestination()
    const config = createConfig({
      subscriptions: [],
      namespaces: {
        tenantA: {
          subscriptions: [
            { name: "orders", topics: ["orders.*"], destinationTopic: "order-events" },
          ],
        },
      },
    })
    const whistler = new Whistler({ queue, destination: dest, config })
    await whistler.start()
    await queue.simulate(makeMessage("orders.created"))
    expect(dest.sent[0]?.topic).toBe("tenantA-order-events")
    await whistler.stop()
  })

  it("root subscriptions are unaffected by namespaces (no prefix, no namespace field)", async () => {
    const queue = new MemoryQueueAdapter()
    const dest = new MemoryDestination()
    const config = createConfig({
      subscriptions: [{ name: "root-orders", topics: ["orders.*"], destinationTopic: "orders" }],
      namespaces: {
        tenantA: {
          subscriptions: [
            { name: "tenant-orders", topics: ["orders.*"], destinationTopic: "orders" },
          ],
        },
      },
    })
    const whistler = new Whistler({ queue, destination: dest, config })
    await whistler.start()
    await queue.simulate(makeMessage("orders.created"))

    expect(dest.sent).toHaveLength(2)
    const root = dest.sent.find((n) => n.namespace === undefined)!
    const ns = dest.sent.find((n) => n.namespace === "tenantA")!
    expect(root.topic).toBe("orders")
    expect(root.namespace).toBeUndefined()
    expect(ns.topic).toBe("tenantA-orders")
    expect(ns.namespace).toBe("tenantA")
    await whistler.stop()
  })

  it("deduplicates queue subscriptions even when same topic appears in multiple namespaces", async () => {
    const received: TopicSubscription[] = []
    const queue = new CustomQueueAdapter({
      onSubscribe: async (subs) => { received.push(...subs) },
    })
    const dest = new MemoryDestination()
    const config = createConfig({
      subscriptions: [],
      namespaces: {
        tenantA: { subscriptions: [{ name: "orders", topics: ["orders.*"] }] },
        tenantB: { subscriptions: [{ name: "orders", topics: ["orders.*"] }] },
      },
    })
    const whistler = new Whistler({ queue, destination: dest, config })
    await whistler.start()
    // Both namespaces share the same source topic pattern — should subscribe once
    expect(received.filter((s) => s.topic === "orders.*")).toHaveLength(1)
    await whistler.stop()
  })

  it("fans out a message to all matching namespaced subscriptions", async () => {
    const queue = new MemoryQueueAdapter()
    const dest = new MemoryDestination()
    const config = createConfig({
      subscriptions: [],
      namespaces: {
        tenantA: { subscriptions: [{ name: "orders", topics: ["orders.*"] }] },
        tenantB: { subscriptions: [{ name: "orders", topics: ["orders.*"] }] },
      },
    })
    const whistler = new Whistler({ queue, destination: dest, config })
    await whistler.start()
    await queue.simulate(makeMessage("orders.created"))
    expect(dest.sent).toHaveLength(2)
    const namespaces = dest.sent.map((n) => n.namespace).sort()
    expect(namespaces).toEqual(["tenantA", "tenantB"])
    await whistler.stop()
  })
})

describe("Whistler error handling", () => {
  it("calls onError and continues when destination.send throws", async () => {
    const queue = new MemoryQueueAdapter()
    const dest = new MemoryDestination()
    const errors: unknown[] = []
    let callCount = 0

    vi.spyOn(dest, "send").mockImplementation(async () => {
      callCount++
      if (callCount === 1) throw new Error("FCM error")
    })

    const config = createConfig({
      subscriptions: [{ name: "orders", topics: ["orders.*"] }],
    })
    const whistler = new Whistler({
      queue,
      destination: dest,
      config,
      onError: (err) => errors.push(err),
    })

    await whistler.start()
    await queue.simulate(makeMessage("orders.created"))
    await queue.simulate(makeMessage("orders.updated"))

    expect(errors).toHaveLength(1)
    expect(callCount).toBe(2) // second call succeeded
    await whistler.stop()
  })

  it("logs errors when logger is provided", async () => {
    const queue = new MemoryQueueAdapter()
    const dest = new MemoryDestination()
    vi.spyOn(dest, "send").mockRejectedValueOnce(new Error("timeout"))
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const config = createConfig({
      subscriptions: [{ name: "orders", topics: ["orders.*"] }],
    })
    const whistler = new Whistler({ queue, destination: dest, config, logger })
    await whistler.start()
    await queue.simulate(makeMessage("orders.created"))
    expect(logger.error).toHaveBeenCalled()
    await whistler.stop()
  })
})
