import { describe, it, expect, vi, beforeEach } from "vitest"
import { NatsQueueAdapter } from "../../src/queue/nats.js"

// Mock the entire `nats` module
const mockSubscription = {
  unsubscribe: vi.fn(),
  [Symbol.asyncIterator]: vi.fn(),
}

const mockConnection = {
  subscribe: vi.fn(() => mockSubscription),
  drain: vi.fn().mockResolvedValue(undefined),
}

vi.mock("nats", () => ({
  connect: vi.fn().mockResolvedValue(mockConnection),
  StringCodec: vi.fn(() => ({
    decode: (data: Uint8Array) => Buffer.from(data).toString("utf8"),
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockSubscription.unsubscribe.mockReset()
  mockConnection.subscribe.mockReturnValue(mockSubscription)
  mockConnection.drain.mockResolvedValue(undefined)
  // Default async iterator: yields nothing
  mockSubscription[Symbol.asyncIterator].mockReturnValue({
    next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
  })
})

describe("NatsQueueAdapter.matchesTopic", () => {
  const adapter = new NatsQueueAdapter({ servers: "nats://localhost:4222" })

  it("exact match", () => {
    expect(adapter.matchesTopic("a.b.c", "a.b.c")).toBe(true)
    expect(adapter.matchesTopic("a.b.c", "a.b.d")).toBe(false)
  })

  it("* wildcard", () => {
    expect(adapter.matchesTopic("a.*.c", "a.b.c")).toBe(true)
    expect(adapter.matchesTopic("a.*.c", "a.b.d")).toBe(false)
    expect(adapter.matchesTopic("a.*", "a.b.c")).toBe(false)
  })

  it("> wildcard", () => {
    expect(adapter.matchesTopic("a.>", "a.b")).toBe(true)
    expect(adapter.matchesTopic("a.>", "a.b.c.d")).toBe(true)
    expect(adapter.matchesTopic("a.>", "a")).toBe(false)
    expect(adapter.matchesTopic(">", "x.y.z")).toBe(true)
  })
})

describe("NatsQueueAdapter lifecycle", () => {
  it("connect calls nats.connect with servers option", async () => {
    const { connect } = await import("nats")
    const adapter = new NatsQueueAdapter({ servers: "nats://localhost:4222" })
    await adapter.connect()
    expect(connect).toHaveBeenCalledWith({ servers: "nats://localhost:4222" })
  })

  it("subscribe calls nc.subscribe for each topic", async () => {
    const adapter = new NatsQueueAdapter({ servers: "nats://localhost:4222" })
    await adapter.connect()
    await adapter.subscribe(["orders.created", "orders.updated"])
    expect(mockConnection.subscribe).toHaveBeenCalledWith("orders.created")
    expect(mockConnection.subscribe).toHaveBeenCalledWith("orders.updated")
    expect(mockConnection.subscribe).toHaveBeenCalledTimes(2)
  })

  it("subscribe is idempotent — does not re-subscribe to the same topic", async () => {
    const adapter = new NatsQueueAdapter({ servers: "nats://localhost:4222" })
    await adapter.connect()
    await adapter.subscribe(["a"])
    await adapter.subscribe(["a"])
    expect(mockConnection.subscribe).toHaveBeenCalledTimes(1)
  })

  it("unsubscribe calls sub.unsubscribe and removes the subscription", async () => {
    const adapter = new NatsQueueAdapter({ servers: "nats://localhost:4222" })
    await adapter.connect()
    await adapter.subscribe(["a"])
    await adapter.unsubscribe(["a"])
    expect(mockSubscription.unsubscribe).toHaveBeenCalled()
  })

  it("close drains the connection", async () => {
    const adapter = new NatsQueueAdapter({ servers: "nats://localhost:4222" })
    await adapter.connect()
    await adapter.subscribe(["a"])
    await adapter.close()
    expect(mockSubscription.unsubscribe).toHaveBeenCalled()
    expect(mockConnection.drain).toHaveBeenCalled()
  })

  it("throws if subscribe is called before connect", async () => {
    const adapter = new NatsQueueAdapter({ servers: "nats://localhost:4222" })
    await expect(adapter.subscribe(["a"])).rejects.toThrow("Not connected")
  })

  it("dispatches decoded messages to registered handlers", async () => {
    // Override the async iterator to yield one message
    const fakeMsg = {
      subject: "orders.created",
      data: new TextEncoder().encode('{"id":"1"}'),
      headers: null,
    }
    mockSubscription[Symbol.asyncIterator].mockReturnValueOnce({
      next: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: fakeMsg })
        .mockResolvedValue({ done: true, value: undefined }),
    })

    const adapter = new NatsQueueAdapter({ servers: "nats://localhost:4222" })
    await adapter.connect()

    const received: { topic: string; payload: string }[] = []
    adapter.onMessage((m) => { received.push({ topic: m.topic, payload: m.payload }) })

    await adapter.subscribe(["orders.created"])
    // Give the async iterator loop a tick to run
    await new Promise((r) => setTimeout(r, 10))

    expect(received).toHaveLength(1)
    expect(received[0]?.topic).toBe("orders.created")
    expect(received[0]?.payload).toBe('{"id":"1"}')
  })
})
