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

describe("validateConfig — namespaces", () => {
  const rootSub = { name: "root", topics: ["root.*"] }
  const nsSub = { name: "orders", topics: ["orders.*"] }

  it("accepts a valid config with namespaces", () => {
    expect(
      validateConfig({
        version: 1,
        subscriptions: [rootSub],
        namespaces: {
          tenantA: { subscriptions: [nsSub] },
        },
      })
    ).toEqual([])
  })

  it("accepts an empty root subscriptions array when namespaces are present", () => {
    expect(
      validateConfig({
        version: 1,
        subscriptions: [],
        namespaces: { tenantA: { subscriptions: [nsSub] } },
      })
    ).toEqual([])
  })

  it("rejects namespaces that is an array", () => {
    const errors = validateConfig({ version: 1, subscriptions: [], namespaces: [] })
    expect(errors.some((e) => e.includes("namespaces must be an object"))).toBe(true)
  })

  it("rejects a namespace name with invalid characters", () => {
    const errors = validateConfig({
      version: 1,
      subscriptions: [],
      namespaces: { "bad name!": { subscriptions: [nsSub] } },
    })
    expect(errors.some((e) => e.includes("bad name!") && e.includes("name must only contain"))).toBe(true)
  })

  it("rejects a namespace with an empty subscriptions array", () => {
    const errors = validateConfig({
      version: 1,
      subscriptions: [],
      namespaces: { tenantA: { subscriptions: [] } },
    })
    expect(errors.some((e) => e.includes('namespaces["tenantA"].subscriptions must be a non-empty array'))).toBe(true)
  })

  it("rejects a namespace with non-array subscriptions", () => {
    const errors = validateConfig({
      version: 1,
      subscriptions: [],
      namespaces: { tenantA: { subscriptions: "bad" } },
    })
    expect(errors.some((e) => e.includes('namespaces["tenantA"].subscriptions must be a non-empty array'))).toBe(true)
  })

  it("rejects duplicate subscription names within a namespace", () => {
    const errors = validateConfig({
      version: 1,
      subscriptions: [],
      namespaces: {
        tenantA: {
          subscriptions: [
            { name: "orders", topics: ["a"] },
            { name: "orders", topics: ["b"] },
          ],
        },
      },
    })
    expect(errors.some((e) => e.includes("duplicated"))).toBe(true)
  })

  it("allows the same subscription name in root and a namespace (different scopes)", () => {
    expect(
      validateConfig({
        version: 1,
        subscriptions: [{ name: "orders", topics: ["a"] }],
        namespaces: { tenantA: { subscriptions: [{ name: "orders", topics: ["b"] }] } },
      })
    ).toEqual([])
  })

  it("allows the same subscription name in two different namespaces", () => {
    expect(
      validateConfig({
        version: 1,
        subscriptions: [],
        namespaces: {
          tenantA: { subscriptions: [{ name: "orders", topics: ["a"] }] },
          tenantB: { subscriptions: [{ name: "orders", topics: ["b"] }] },
        },
      })
    ).toEqual([])
  })

  it("runs per-subscription validation inside namespaces", () => {
    const errors = validateConfig({
      version: 1,
      subscriptions: [],
      namespaces: {
        tenantA: { subscriptions: [{ name: "", topics: ["a"] }] },
      },
    })
    expect(errors.some((e) => e.includes('namespaces["tenantA"].subscriptions[0].name'))).toBe(true)
  })

  it("accepts a string firebaseCredentials path", () => {
    expect(
      validateConfig({
        version: 1,
        subscriptions: [],
        namespaces: {
          tenantA: { subscriptions: [nsSub], firebaseCredentials: "/secrets/tenant-a.json" },
        },
      })
    ).toEqual([])
  })

  it("rejects a non-string firebaseCredentials", () => {
    const errors = validateConfig({
      version: 1,
      subscriptions: [],
      namespaces: {
        tenantA: { subscriptions: [nsSub], firebaseCredentials: 42 },
      },
    })
    expect(
      errors.some((e) =>
        e.includes('namespaces["tenantA"].firebaseCredentials must be a non-empty string')
      )
    ).toBe(true)
  })

  it("rejects an empty-string firebaseCredentials", () => {
    const errors = validateConfig({
      version: 1,
      subscriptions: [],
      namespaces: {
        tenantA: { subscriptions: [nsSub], firebaseCredentials: "   " },
      },
    })
    expect(
      errors.some((e) =>
        e.includes('namespaces["tenantA"].firebaseCredentials must be a non-empty string')
      )
    ).toBe(true)
  })
})
