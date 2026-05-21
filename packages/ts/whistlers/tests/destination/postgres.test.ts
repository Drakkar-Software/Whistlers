import { describe, it, expect, vi, beforeEach } from "vitest"
import { PostgresDestination } from "../../src/destination/postgres.js"
import type { OutgoingNotification } from "../../src/destination/base.js"

const mockQuery = vi.fn().mockResolvedValue({ rows: [] })
const mockEnd = vi.fn().mockResolvedValue(undefined)
// vitest 4 requires constructor mocks to be constructable (regular function / class),
// so this uses a `function` expression rather than an arrow — it is invoked with `new`.
const MockPool = vi.fn(function () {
  return { query: mockQuery, end: mockEnd }
})

vi.mock("pg", () => ({ Pool: MockPool }))

beforeEach(() => {
  vi.clearAllMocks()
  mockQuery.mockResolvedValue({ rows: [] })
  mockEnd.mockResolvedValue(undefined)
  MockPool.mockImplementation(function () {
    return { query: mockQuery, end: mockEnd }
  })
})

function makeNotification(overrides: Partial<OutgoingNotification> = {}): OutgoingNotification {
  return {
    topic: "orders",
    sourceTopic: "orders.created",
    rawPayload: { id: "1" },
    ...overrides,
  }
}

describe("PostgresDestination", () => {
  it("inserts a row with a parameterized query", async () => {
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
    })
    await dest.send(makeNotification())
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO events"),
      expect.arrayContaining(["orders", "orders.created"])
    )
  })

  it("creates pool with configured connection string", async () => {
    const dest = new PostgresDestination({
      connectionString: "postgresql://user:pass@host:5432/db",
      table: "events",
    })
    await dest.send(makeNotification())
    expect(MockPool).toHaveBeenCalledWith({
      connectionString: "postgresql://user:pass@host:5432/db",
    })
  })

  it("reuses the same pool across multiple sends", async () => {
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
    })
    await dest.send(makeNotification())
    await dest.send(makeNotification())
    expect(MockPool).toHaveBeenCalledTimes(1)
  })

  it("serializes notification as JSON when present", async () => {
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
    })
    await dest.send(makeNotification({ notification: { title: "Hi", body: "There" } }))
    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(values).toContain(JSON.stringify({ title: "Hi", body: "There" }))
  })

  it("passes null for notification when not provided", async () => {
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
    })
    await dest.send(makeNotification())
    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(values).toContain(null)
  })

  it("serializes data as JSON when present", async () => {
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
    })
    await dest.send(makeNotification({ data: { id: "42" } }))
    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(values).toContain(JSON.stringify({ id: "42" }))
  })

  it("passes null for data when not provided", async () => {
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
    })
    await dest.send(makeNotification())
    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]]
    // notification is null, data is null — both appear as null in the values array
    const nullCount = (values as unknown[]).filter((v) => v === null).length
    expect(nullCount).toBeGreaterThanOrEqual(2)
  })

  it("propagates errors from query", async () => {
    mockQuery.mockRejectedValueOnce(new Error("PG connection refused"))
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
    })
    await expect(dest.send(makeNotification())).rejects.toThrow("PG connection refused")
  })

  it("close() ends the pool", async () => {
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
    })
    await dest.send(makeNotification())
    await dest.close()
    expect(mockEnd).toHaveBeenCalledTimes(1)
  })

  it("close() does nothing when never connected", async () => {
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
    })
    await expect(dest.close()).resolves.toBeUndefined()
    expect(mockEnd).not.toHaveBeenCalled()
  })

  it("calls format callback with the full OutgoingNotification and builds a dynamic INSERT", async () => {
    const format = vi.fn().mockReturnValue({ col_a: "x", col_b: 42 })
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
      format,
    })
    await dest.send(makeNotification())
    expect(format).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "orders",
        sourceTopic: "orders.created",
        rawPayload: { id: "1" },
      })
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO events ("col_a", "col_b")'),
      ["x", 42]
    )
  })

  it("format callback column names are double-quoted in the INSERT statement", async () => {
    const format = vi.fn().mockReturnValue({ my_col: "v" })
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
      format,
    })
    await dest.send(makeNotification())
    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('"my_col"')
  })

  it("format callback returning an empty object throws a descriptive error", async () => {
    const format = vi.fn().mockReturnValue({})
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
      format,
    })
    await expect(dest.send(makeNotification())).rejects.toThrow(
      "PostgresDestination: format callback returned an empty row"
    )
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it("propagates errors thrown by format callback", async () => {
    const format = vi.fn().mockImplementation(() => {
      throw new Error("formatter crashed")
    })
    const dest = new PostgresDestination({
      connectionString: "postgresql://localhost/test",
      table: "events",
      format,
    })
    await expect(dest.send(makeNotification())).rejects.toThrow("formatter crashed")
  })
})
