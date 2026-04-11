import { describe, it, expect, vi, beforeEach } from "vitest"
import { MqttQueueAdapter } from "../../src/queue/mqtt.js"
import type { QueueMessage } from "../../src/queue/base.js"

// Mock the `mqtt` module
const mockClient = {
  once: vi.fn(),
  on: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  end: vi.fn(),
}

vi.mock("mqtt", () => ({
  connect: vi.fn(() => mockClient),
}))

beforeEach(() => {
  vi.clearAllMocks()

  // Default: emit "connect" immediately when once("connect", cb) is called
  mockClient.once.mockImplementation((event: string, cb: () => void) => {
    if (event === "connect") setImmediate(cb)
  })
  mockClient.subscribe.mockImplementation((_topic: string, cb: (err: null) => void) => cb(null))
  mockClient.unsubscribe.mockImplementation((_topic: string, cb: (err: null) => void) => cb(null))
  mockClient.end.mockImplementation((_force: boolean, _opts: object, cb: () => void) => cb())
})

describe("MqttQueueAdapter.matchesTopic", () => {
  const adapter = new MqttQueueAdapter({ url: "mqtt://localhost:1883" })

  it("exact match", () => {
    expect(adapter.matchesTopic("a/b/c", "a/b/c")).toBe(true)
    expect(adapter.matchesTopic("a/b/c", "a/b/d")).toBe(false)
  })

  it("+ matches single level", () => {
    expect(adapter.matchesTopic("a/+/c", "a/b/c")).toBe(true)
    expect(adapter.matchesTopic("a/+", "a/b")).toBe(true)
    expect(adapter.matchesTopic("a/+", "a/b/c")).toBe(false)
  })

  it("# matches all remaining levels", () => {
    expect(adapter.matchesTopic("a/#", "a/b")).toBe(true)
    expect(adapter.matchesTopic("a/#", "a/b/c/d")).toBe(true)
    expect(adapter.matchesTopic("#", "x/y/z")).toBe(true)
    expect(adapter.matchesTopic("a/#", "a")).toBe(false)
  })

  it("strips $share prefix before matching", () => {
    expect(adapter.matchesTopic("$share/mygroup/orders/+", "orders/created")).toBe(true)
    expect(adapter.matchesTopic("$share/mygroup/orders/+", "orders/created/extra")).toBe(false)
  })
})

describe("MqttQueueAdapter.buildSubscriptionTopic", () => {
  it("returns topic as-is when no group", () => {
    expect(MqttQueueAdapter.buildSubscriptionTopic("orders/#")).toBe("orders/#")
  })

  it("prepends $share prefix when group is provided", () => {
    expect(MqttQueueAdapter.buildSubscriptionTopic("orders/#", "whistlers")).toBe(
      "$share/whistlers/orders/#"
    )
  })
})

describe("MqttQueueAdapter lifecycle", () => {
  it("connect resolves when broker emits connect", async () => {
    const adapter = new MqttQueueAdapter({ url: "mqtt://localhost:1883" })
    await expect(adapter.connect()).resolves.toBeUndefined()
  })

  it("connect rejects on error event", async () => {
    mockClient.once.mockImplementation((event: string, cb: (err?: Error) => void) => {
      if (event === "error") setImmediate(() => cb(new Error("connection refused")))
    })
    const adapter = new MqttQueueAdapter({ url: "mqtt://bad-host" })
    await expect(adapter.connect()).rejects.toThrow("connection refused")
  })

  it("subscribe calls client.subscribe for each topic", async () => {
    const adapter = new MqttQueueAdapter({ url: "mqtt://localhost:1883" })
    await adapter.connect()
    await adapter.subscribe([{ topic: "orders/created" }, { topic: "orders/updated" }])
    expect(mockClient.subscribe).toHaveBeenCalledWith("orders/created", expect.any(Function))
    expect(mockClient.subscribe).toHaveBeenCalledWith("orders/updated", expect.any(Function))
  })

  it("subscribe with group applies $share prefix", async () => {
    const adapter = new MqttQueueAdapter({ url: "mqtt://localhost:1883" })
    await adapter.connect()
    await adapter.subscribe([{ topic: "orders/+", group: "workers" }])
    expect(mockClient.subscribe).toHaveBeenCalledWith("$share/workers/orders/+", expect.any(Function))
  })

  it("subscribe is idempotent", async () => {
    const adapter = new MqttQueueAdapter({ url: "mqtt://localhost:1883" })
    await adapter.connect()
    await adapter.subscribe([{ topic: "a/b" }])
    await adapter.subscribe([{ topic: "a/b" }])
    expect(mockClient.subscribe).toHaveBeenCalledTimes(1)
  })

  it("unsubscribe calls client.unsubscribe with the effective topic", async () => {
    const adapter = new MqttQueueAdapter({ url: "mqtt://localhost:1883" })
    await adapter.connect()
    await adapter.subscribe([{ topic: "a/b" }])
    await adapter.unsubscribe([{ topic: "a/b" }])
    expect(mockClient.unsubscribe).toHaveBeenCalledWith("a/b", expect.any(Function))
  })

  it("unsubscribe with group uses the $share-prefixed topic", async () => {
    const adapter = new MqttQueueAdapter({ url: "mqtt://localhost:1883" })
    await adapter.connect()
    await adapter.subscribe([{ topic: "orders/+", group: "workers" }])
    await adapter.unsubscribe([{ topic: "orders/+", group: "workers" }])
    expect(mockClient.unsubscribe).toHaveBeenCalledWith("$share/workers/orders/+", expect.any(Function))
  })

  it("close calls client.end", async () => {
    const adapter = new MqttQueueAdapter({ url: "mqtt://localhost:1883" })
    await adapter.connect()
    await adapter.close()
    expect(mockClient.end).toHaveBeenCalled()
  })

  it("throws if subscribe is called before connect", async () => {
    const adapter = new MqttQueueAdapter({ url: "mqtt://localhost:1883" })
    await expect(adapter.subscribe([{ topic: "a" }])).rejects.toThrow("Not connected")
  })

  it("dispatches incoming messages to handlers", async () => {
    let messageCallback: ((topic: string, payload: Buffer) => void) | null = null
    mockClient.on.mockImplementation((event: string, cb: (t: string, p: Buffer) => void) => {
      if (event === "message") messageCallback = cb
    })

    const adapter = new MqttQueueAdapter({ url: "mqtt://localhost:1883" })
    await adapter.connect()

    const received: QueueMessage[] = []
    adapter.onMessage((m) => { received.push(m) })

    messageCallback?.("orders/created", Buffer.from('{"id":"42"}'))

    // Give promise microtasks a tick
    await Promise.resolve()

    expect(received).toHaveLength(1)
    expect(received[0]?.topic).toBe("orders/created")
    expect(received[0]?.payload).toBe('{"id":"42"}')
  })
})
