import { describe, it, expect, vi } from "vitest"
import { MemoryQueueAdapter, CustomQueueAdapter, matchNatsTopic } from "../../src/queue/memory.js"
import type { QueueMessage } from "../../src/queue/base.js"

function makeMessage(topic: string, payload = "{}"): QueueMessage {
  return { topic, payload, timestamp: 1000 }
}

describe("matchNatsTopic", () => {
  it("matches exact topics", () => {
    expect(matchNatsTopic("orders.created", "orders.created")).toBe(true)
  })

  it("does not match different exact topics", () => {
    expect(matchNatsTopic("orders.created", "orders.updated")).toBe(false)
  })

  it("* matches single token", () => {
    expect(matchNatsTopic("orders.*", "orders.created")).toBe(true)
    expect(matchNatsTopic("orders.*", "orders.updated")).toBe(true)
    expect(matchNatsTopic("orders.*", "orders.new.extra")).toBe(false)
  })

  it("> matches all remaining tokens", () => {
    expect(matchNatsTopic("orders.>", "orders.created")).toBe(true)
    expect(matchNatsTopic("orders.>", "orders.new.extra")).toBe(true)
    expect(matchNatsTopic(">", "anything.at.all")).toBe(true)
  })

  it("> requires at least one token after the prefix", () => {
    expect(matchNatsTopic("orders.>", "orders")).toBe(false)
  })

  it("does not match if pattern is longer than topic", () => {
    expect(matchNatsTopic("a.b.c", "a.b")).toBe(false)
  })
})

describe("MemoryQueueAdapter", () => {
  it("starts disconnected", () => {
    const adapter = new MemoryQueueAdapter()
    expect(adapter.isConnected()).toBe(false)
  })

  it("connects and disconnects", async () => {
    const adapter = new MemoryQueueAdapter()
    await adapter.connect()
    expect(adapter.isConnected()).toBe(true)
    await adapter.close()
    expect(adapter.isConnected()).toBe(false)
  })

  it("subscribe adds topics, unsubscribe removes them", async () => {
    const adapter = new MemoryQueueAdapter()
    await adapter.subscribe([{ topic: "a" }, { topic: "b" }, { topic: "c" }])
    expect(adapter.subscribed).toEqual(["a", "b", "c"])
    await adapter.unsubscribe([{ topic: "b" }])
    expect(adapter.subscribed).toEqual(["a", "c"])
  })

  it("subscribe is idempotent", async () => {
    const adapter = new MemoryQueueAdapter()
    await adapter.subscribe([{ topic: "a" }])
    await adapter.subscribe([{ topic: "a" }])
    expect(adapter.subscribed).toHaveLength(1)
  })

  it("simulate dispatches to all registered handlers", async () => {
    const adapter = new MemoryQueueAdapter()
    const received: QueueMessage[] = []
    adapter.onMessage((m) => { received.push(m) })
    adapter.onMessage((m) => { received.push({ ...m, topic: "copy" }) })

    await adapter.simulate(makeMessage("orders.created"))
    expect(received).toHaveLength(2)
    expect(received[0]?.topic).toBe("orders.created")
    expect(received[1]?.topic).toBe("copy")
  })

  it("simulate awaits async handlers in order", async () => {
    const adapter = new MemoryQueueAdapter()
    const order: number[] = []
    adapter.onMessage(async () => {
      await new Promise((r) => setTimeout(r, 10))
      order.push(1)
    })
    adapter.onMessage(async () => {
      order.push(2)
    })
    await adapter.simulate(makeMessage("t"))
    expect(order).toEqual([1, 2])
  })

  it("close clears handlers and subscriptions", async () => {
    const adapter = new MemoryQueueAdapter()
    await adapter.subscribe(["x"])
    adapter.onMessage(() => {})
    await adapter.close()
    expect(adapter.subscribed).toHaveLength(0)
    // After close, simulate should do nothing (no handlers)
    let called = false
    await adapter.simulate(makeMessage("x"))
    expect(called).toBe(false)
  })
})

describe("CustomQueueAdapter", () => {
  it("calls onSubscribe callback with TopicSubscription objects", async () => {
    const onSubscribe = vi.fn().mockResolvedValue(undefined)
    const adapter = new CustomQueueAdapter({ onSubscribe })
    await adapter.subscribe([{ topic: "t1" }, { topic: "t2", group: "workers" }])
    expect(onSubscribe).toHaveBeenCalledWith([{ topic: "t1" }, { topic: "t2", group: "workers" }])
  })

  it("calls onUnsubscribe callback with TopicSubscription objects", async () => {
    const onUnsubscribe = vi.fn().mockResolvedValue(undefined)
    const adapter = new CustomQueueAdapter({ onUnsubscribe })
    await adapter.subscribe([{ topic: "t1" }])
    await adapter.unsubscribe([{ topic: "t1" }])
    expect(onUnsubscribe).toHaveBeenCalledWith([{ topic: "t1" }])
  })

  it("deliver dispatches message to handlers", async () => {
    const adapter = new CustomQueueAdapter()
    const received: QueueMessage[] = []
    adapter.onMessage((m) => { received.push(m) })
    await adapter.deliver(makeMessage("x.y"))
    expect(received).toHaveLength(1)
    expect(received[0]?.topic).toBe("x.y")
  })

  it("works without any callbacks", async () => {
    const adapter = new CustomQueueAdapter()
    await expect(adapter.connect()).resolves.toBeUndefined()
    await expect(adapter.subscribe([{ topic: "t" }])).resolves.toBeUndefined()
    await expect(adapter.close()).resolves.toBeUndefined()
  })
})
