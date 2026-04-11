import { describe, it, expect, vi, beforeEach } from "vitest"
import { ClickHouseDestination } from "../../src/destination/clickhouse.js"
import type { OutgoingNotification } from "../../src/destination/base.js"

const mockInsert = vi.fn().mockResolvedValue(undefined)
const mockClose = vi.fn().mockResolvedValue(undefined)
const mockCreateClient = vi.fn(() => ({ insert: mockInsert, close: mockClose }))

vi.mock("@clickhouse/client", () => ({
  createClient: mockCreateClient,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockInsert.mockResolvedValue(undefined)
  mockClose.mockResolvedValue(undefined)
  mockCreateClient.mockReturnValue({ insert: mockInsert, close: mockClose })
})

function makeNotification(overrides: Partial<OutgoingNotification> = {}): OutgoingNotification {
  return {
    topic: "orders",
    sourceTopic: "orders.created",
    rawPayload: { id: "1" },
    ...overrides,
  }
}

describe("ClickHouseDestination", () => {
  it("inserts a row into the configured table", async () => {
    const dest = new ClickHouseDestination({
      url: "http://localhost:8123",
      database: "default",
      table: "events",
    })
    await dest.send(makeNotification())
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ table: "events", format: "JSONEachRow" })
    )
  })

  it("creates client with configured options", async () => {
    const dest = new ClickHouseDestination({
      url: "http://ch:8123",
      database: "mydb",
      table: "events",
      username: "user",
      password: "pass",
    })
    await dest.send(makeNotification())
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://ch:8123",
        database: "mydb",
        username: "user",
        password: "pass",
      })
    )
  })

  it("reuses the same client across multiple sends", async () => {
    const dest = new ClickHouseDestination({
      url: "http://localhost:8123",
      database: "default",
      table: "events",
    })
    await dest.send(makeNotification())
    await dest.send(makeNotification())
    expect(mockCreateClient).toHaveBeenCalledTimes(1)
  })

  it("stores notification as JSON when present", async () => {
    const dest = new ClickHouseDestination({
      url: "http://localhost:8123",
      database: "default",
      table: "events",
    })
    await dest.send(makeNotification({ notification: { title: "Hello", body: "World" } }))
    const call = mockInsert.mock.calls[0]?.[0] as { values: Record<string, unknown>[] }
    expect(call.values[0]?.["notification"]).toBe(
      JSON.stringify({ title: "Hello", body: "World" })
    )
  })

  it("stores null for notification when not provided", async () => {
    const dest = new ClickHouseDestination({
      url: "http://localhost:8123",
      database: "default",
      table: "events",
    })
    await dest.send(makeNotification())
    const call = mockInsert.mock.calls[0]?.[0] as { values: Record<string, unknown>[] }
    expect(call.values[0]?.["notification"]).toBeNull()
  })

  it("stores data as JSON when present", async () => {
    const dest = new ClickHouseDestination({
      url: "http://localhost:8123",
      database: "default",
      table: "events",
    })
    await dest.send(makeNotification({ data: { id: "42", status: "ok" } }))
    const call = mockInsert.mock.calls[0]?.[0] as { values: Record<string, unknown>[] }
    expect(call.values[0]?.["data"]).toBe(JSON.stringify({ id: "42", status: "ok" }))
  })

  it("stores null for data when not provided", async () => {
    const dest = new ClickHouseDestination({
      url: "http://localhost:8123",
      database: "default",
      table: "events",
    })
    await dest.send(makeNotification())
    const call = mockInsert.mock.calls[0]?.[0] as { values: Record<string, unknown>[] }
    expect(call.values[0]?.["data"]).toBeNull()
  })

  it("propagates errors from insert", async () => {
    mockInsert.mockRejectedValueOnce(new Error("CH connection refused"))
    const dest = new ClickHouseDestination({
      url: "http://localhost:8123",
      database: "default",
      table: "events",
    })
    await expect(dest.send(makeNotification())).rejects.toThrow("CH connection refused")
  })

  it("close() closes the underlying client", async () => {
    const dest = new ClickHouseDestination({
      url: "http://localhost:8123",
      database: "default",
      table: "events",
    })
    await dest.send(makeNotification())
    await dest.close()
    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it("close() does nothing when never connected", async () => {
    const dest = new ClickHouseDestination({
      url: "http://localhost:8123",
      database: "default",
      table: "events",
    })
    await expect(dest.close()).resolves.toBeUndefined()
    expect(mockClose).not.toHaveBeenCalled()
  })
})
