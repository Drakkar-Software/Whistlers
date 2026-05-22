import { describe, it, expect } from "vitest"
import { createConfig, parseConfigJson } from "../../src/config/loader.js"

describe("createConfig", () => {
  it("builds config from code", () => {
    const config = createConfig({
      subscriptions: [{ name: "orders", topics: ["orders.*"] }],
    })
    expect(config.version).toBe(1)
    expect(config.subscriptions[0]?.name).toBe("orders")
  })

  it("throws when validation fails", () => {
    expect(() =>
      createConfig({ subscriptions: [{ name: "", topics: ["a"] }] })
    ).toThrow("Invalid WhistlersConfig")
  })

  it("accepts multiple subscriptions", () => {
    const config = createConfig({
      subscriptions: [
        { name: "orders", topics: ["orders.*"] },
        { name: "users", topics: ["users.>"] },
      ],
    })
    expect(config.subscriptions).toHaveLength(2)
  })

  it("includes namespaces in the built config", () => {
    const config = createConfig({
      subscriptions: [],
      namespaces: {
        tenantA: { subscriptions: [{ name: "orders", topics: ["orders.*"] }] },
      },
    })
    expect(config.namespaces?.["tenantA"]?.subscriptions[0]?.name).toBe("orders")
  })

  it("omits the namespaces key when not provided", () => {
    const config = createConfig({ subscriptions: [{ name: "x", topics: ["a"] }] })
    expect("namespaces" in config).toBe(false)
  })

  it("throws when a namespace name is invalid", () => {
    expect(() =>
      createConfig({
        subscriptions: [],
        namespaces: { "bad name!": { subscriptions: [{ name: "x", topics: ["a"] }] } },
      })
    ).toThrow("Invalid WhistlersConfig")
  })
})

describe("parseConfigJson", () => {
  it("parses and validates a valid JSON config", () => {
    const json = JSON.stringify({
      version: 1,
      subscriptions: [{ name: "orders", topics: ["orders.*"] }],
    })
    const config = parseConfigJson(json)
    expect(config.version).toBe(1)
    expect(config.subscriptions[0]?.name).toBe("orders")
  })

  it("parses a config with namespaces", () => {
    const json = JSON.stringify({
      version: 1,
      subscriptions: [],
      namespaces: {
        tenantA: { subscriptions: [{ name: "orders", topics: ["orders.*"] }] },
      },
    })
    const config = parseConfigJson(json)
    expect(config.namespaces?.["tenantA"]?.subscriptions[0]?.name).toBe("orders")
  })

  it("throws on invalid JSON", () => {
    expect(() => parseConfigJson("not json {")).toThrow("Failed to parse config JSON")
  })

  it("throws on structurally invalid config", () => {
    expect(() => parseConfigJson(JSON.stringify({ version: 2, subscriptions: [] }))).toThrow(
      "Invalid WhistlersConfig"
    )
  })
})
