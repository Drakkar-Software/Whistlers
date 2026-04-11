import { describe, it, expect } from "vitest"
import { createConfig } from "../../src/config/loader.js"

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
})
