import { describe, it, expect } from "vitest"
import { validateConfig, assertValidConfig } from "../../src/config/validate.js"

describe("validateConfig", () => {
  it("accepts a valid minimal config", () => {
    expect(
      validateConfig({ version: 1, subscriptions: [{ name: "orders", topics: ["orders.*"] }] })
    ).toEqual([])
  })

  it("rejects non-object", () => {
    expect(validateConfig(null)).toContain("config must be an object")
    expect(validateConfig("string")).toContain("config must be an object")
  })

  it("rejects wrong version", () => {
    const errors = validateConfig({ version: 2, subscriptions: [] })
    expect(errors.some((e) => e.includes("version"))).toBe(true)
  })

  it("rejects missing subscriptions", () => {
    const errors = validateConfig({ version: 1 })
    expect(errors.some((e) => e.includes("subscriptions"))).toBe(true)
  })

  it("rejects subscription with missing name", () => {
    const errors = validateConfig({ version: 1, subscriptions: [{ topics: ["a"] }] })
    expect(errors.some((e) => e.includes("name"))).toBe(true)
  })

  it("rejects subscription with empty name", () => {
    const errors = validateConfig({ version: 1, subscriptions: [{ name: "  ", topics: ["a"] }] })
    expect(errors.some((e) => e.includes("name"))).toBe(true)
  })

  it("rejects duplicate subscription names", () => {
    const errors = validateConfig({
      version: 1,
      subscriptions: [
        { name: "orders", topics: ["a"] },
        { name: "orders", topics: ["b"] },
      ],
    })
    expect(errors.some((e) => e.includes("duplicated"))).toBe(true)
  })

  it("rejects subscription with empty topics array", () => {
    const errors = validateConfig({ version: 1, subscriptions: [{ name: "x", topics: [] }] })
    expect(errors.some((e) => e.includes("topics"))).toBe(true)
  })

  it("rejects non-string topic entries", () => {
    const errors = validateConfig({ version: 1, subscriptions: [{ name: "x", topics: [1, 2] }] })
    expect(errors.some((e) => e.includes("topics[0]"))).toBe(true)
  })

  it("rejects invalid destinationTopic characters", () => {
    const errors = validateConfig({
      version: 1,
      subscriptions: [{ name: "x", topics: ["a"], destinationTopic: "bad topic!" }],
    })
    expect(errors.some((e) => e.includes("destinationTopic"))).toBe(true)
  })

  it("accepts valid destinationTopic", () => {
    expect(
      validateConfig({
        version: 1,
        subscriptions: [{ name: "x", topics: ["a"], destinationTopic: "orders-created_v1" }],
      })
    ).toEqual([])
  })

  it("rejects non-string group", () => {
    const errors = validateConfig({
      version: 1,
      subscriptions: [{ name: "x", topics: ["a"], group: 123 }],
    })
    expect(errors.some((e) => e.includes("group"))).toBe(true)
  })

  it("rejects non-array dataFields", () => {
    const errors = validateConfig({
      version: 1,
      subscriptions: [{ name: "x", topics: ["a"], dataFields: "id" }],
    })
    expect(errors.some((e) => e.includes("dataFields"))).toBe(true)
  })
})

describe("assertValidConfig", () => {
  it("does not throw for valid config", () => {
    expect(() =>
      assertValidConfig({ version: 1, subscriptions: [{ name: "x", topics: ["a"] }] })
    ).not.toThrow()
  })

  it("throws with all errors listed", () => {
    expect(() =>
      assertValidConfig({ version: 2, subscriptions: "bad" })
    ).toThrow("Invalid WhistlersConfig")
  })
})
