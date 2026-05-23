import { describe, it, expect } from "vitest"
import { NamespaceRoutingDestination } from "../../src/destination/namespace-routing.js"
import { MemoryDestination } from "../../src/destination/memory.js"
import type { DestinationAdapter, OutgoingNotification } from "../../src/destination/base.js"

function makeNotification(
  overrides: Partial<OutgoingNotification> = {}
): OutgoingNotification {
  return {
    topic: "orders",
    sourceTopic: "orders.created",
    rawPayload: { id: "1" },
    ...overrides,
  }
}

describe("NamespaceRoutingDestination", () => {
  it("routes a notification to the adapter for its namespace", async () => {
    const acme = new MemoryDestination()
    const globex = new MemoryDestination()
    const dest = new NamespaceRoutingDestination({ routes: { acme, globex } })

    await dest.send(makeNotification({ namespace: "acme" }))
    await dest.send(makeNotification({ namespace: "globex" }))

    expect(acme.sent).toHaveLength(1)
    expect(globex.sent).toHaveLength(1)
    expect(acme.sent[0]?.namespace).toBe("acme")
  })

  it("routes root (non-namespaced) notifications to default", async () => {
    const acme = new MemoryDestination()
    const fallback = new MemoryDestination()
    const dest = new NamespaceRoutingDestination({ routes: { acme }, default: fallback })

    await dest.send(makeNotification())

    expect(fallback.sent).toHaveLength(1)
    expect(acme.sent).toHaveLength(0)
  })

  it("routes unknown namespaces to default", async () => {
    const acme = new MemoryDestination()
    const fallback = new MemoryDestination()
    const dest = new NamespaceRoutingDestination({ routes: { acme }, default: fallback })

    await dest.send(makeNotification({ namespace: "unknown" }))

    expect(fallback.sent).toHaveLength(1)
    expect(acme.sent).toHaveLength(0)
  })

  it("throws for an unknown namespace when no default is configured", async () => {
    const acme = new MemoryDestination()
    const dest = new NamespaceRoutingDestination({ routes: { acme } })

    await expect(dest.send(makeNotification({ namespace: "unknown" }))).rejects.toThrow(
      'No destination configured for namespace "unknown"'
    )
  })

  it("throws for a root notification when no default is configured", async () => {
    const acme = new MemoryDestination()
    const dest = new NamespaceRoutingDestination({ routes: { acme } })

    await expect(dest.send(makeNotification())).rejects.toThrow(
      "No default destination configured for a non-namespaced notification"
    )
  })

  it("propagates errors thrown by the routed adapter", async () => {
    const failing: DestinationAdapter = {
      send: () => Promise.reject(new Error("backend down")),
    }
    const dest = new NamespaceRoutingDestination({ routes: { acme: failing } })

    await expect(dest.send(makeNotification({ namespace: "acme" }))).rejects.toThrow("backend down")
  })

  it("close() closes every routed adapter and the default", async () => {
    const acme = new MemoryDestination()
    const globex = new MemoryDestination()
    const fallback = new MemoryDestination()
    acme.sent.push(makeNotification())
    globex.sent.push(makeNotification())
    fallback.sent.push(makeNotification())

    const dest = new NamespaceRoutingDestination({
      routes: { acme, globex },
      default: fallback,
    })
    await dest.close()

    expect(acme.sent).toHaveLength(0)
    expect(globex.sent).toHaveLength(0)
    expect(fallback.sent).toHaveLength(0)
  })

  it("close() closes an adapter shared across routes/default only once", async () => {
    let closes = 0
    const shared: DestinationAdapter = {
      send: () => Promise.resolve(),
      close: () => {
        closes++
        return Promise.resolve()
      },
    }
    const dest = new NamespaceRoutingDestination({
      routes: { acme: shared, globex: shared },
      default: shared,
    })
    await dest.close()

    expect(closes).toBe(1)
  })

  it("close() awaits all adapters even if one rejects, then rethrows", async () => {
    let closedB = false
    const a: DestinationAdapter = {
      send: () => Promise.resolve(),
      close: () => Promise.reject(new Error("a failed to close")),
    }
    const b: DestinationAdapter = {
      send: () => Promise.resolve(),
      close: () => {
        closedB = true
        return Promise.resolve()
      },
    }
    const dest = new NamespaceRoutingDestination({ routes: { a, b } })

    await expect(dest.close()).rejects.toThrow("a failed to close")
    expect(closedB).toBe(true)
  })
})
