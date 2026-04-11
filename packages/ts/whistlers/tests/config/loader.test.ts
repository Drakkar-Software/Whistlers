import { describe, it, expect } from "vitest"
import { parseConfigJson, createConfig } from "../../src/config/loader.js"

const validJson = JSON.stringify({
  version: 1,
  subscriptions: [{ name: "orders", topics: ["orders.*"] }],
})

describe("parseConfigJson", () => {
  it("parses a valid config string", () => {
    const config = parseConfigJson(validJson)
    expect(config.version).toBe(1)
    expect(config.subscriptions).toHaveLength(1)
    expect(config.subscriptions[0]?.name).toBe("orders")
  })

  it("throws on malformed JSON", () => {
    expect(() => parseConfigJson("{invalid}")).toThrow("invalid JSON")
  })

  it("throws when config validation fails", () => {
    expect(() =>
      parseConfigJson(JSON.stringify({ version: 1, subscriptions: [] }))
    ).not.toThrow() // empty subscriptions array is valid structurally

    expect(() =>
      parseConfigJson(JSON.stringify({ version: 2, subscriptions: [] }))
    ).toThrow("Invalid WhistlersConfig")
  })

  it("parses optional fields", () => {
    const config = parseConfigJson(
      JSON.stringify({
        version: 1,
        subscriptions: [
          {
            name: "events",
            topics: ["events.>"],
            group: "workers",
            destinationTopic: "events",
            notification: { title: "Event", body: "Something happened" },
            dataFields: ["id", "type"],
          },
        ],
      })
    )
    const sub = config.subscriptions[0]!
    expect(sub.group).toBe("workers")
    expect(sub.destinationTopic).toBe("events")
    expect(sub.notification?.title).toBe("Event")
    expect(sub.dataFields).toEqual(["id", "type"])
  })
})

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
