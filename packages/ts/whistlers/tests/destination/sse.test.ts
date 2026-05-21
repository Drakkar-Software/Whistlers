import { describe, it, expect, afterEach } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { SSEDestination, type SSEDestinationOptions } from "../../src/destination/sse.js"
import type { OutgoingNotification } from "../../src/destination/base.js"

function makeNotification(overrides: Partial<OutgoingNotification> = {}): OutgoingNotification {
  return {
    topic: "orders",
    sourceTopic: "orders.created",
    rawPayload: { id: "1" },
    ...overrides,
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await delay(10)
  }
}

interface ParsedFrame {
  id?: string
  event?: string
  data?: string
  retry?: number
  comment?: string
}

function parseFrames(raw: string): ParsedFrame[] {
  return raw
    .split("\n\n")
    .filter((block) => block.length > 0)
    .map((block) => {
      const frame: ParsedFrame = {}
      const dataLines: string[] = []
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) {
          frame.comment = (frame.comment ?? "") + line.slice(1).trimStart()
          continue
        }
        const idx = line.indexOf(":")
        const field = idx === -1 ? line : line.slice(0, idx)
        let value = idx === -1 ? "" : line.slice(idx + 1)
        if (value.startsWith(" ")) value = value.slice(1)
        if (field === "data") dataLines.push(value)
        else if (field === "event") frame.event = value
        else if (field === "id") frame.id = value
        else if (field === "retry") frame.retry = Number(value)
      }
      if (dataLines.length > 0) frame.data = dataLines.join("\n")
      return frame
    })
}

class TestClient {
  raw = ""
  constructor(
    readonly req: http.ClientRequest,
    readonly res: http.IncomingMessage
  ) {
    res.setEncoding("utf8")
    res.on("data", (chunk: string) => {
      this.raw += chunk
    })
  }
  frames(): ParsedFrame[] {
    return parseFrames(this.raw)
  }
  dataFrames(): ParsedFrame[] {
    return this.frames().filter((f) => f.data !== undefined)
  }
  async waitForDataFrames(n: number, timeoutMs = 1000): Promise<ParsedFrame[]> {
    await waitFor(() => this.dataFrames().length >= n, timeoutMs)
    return this.dataFrames()
  }
  close(): void {
    this.req.destroy()
  }
}

// --- cleanup registries -----------------------------------------------------

let openClients: TestClient[] = []
let openDests: SSEDestination[] = []
let openServers: http.Server[] = []

afterEach(async () => {
  for (const c of openClients) c.close()
  openClients = []
  for (const d of openDests) await d.close()
  openDests = []
  for (const s of openServers) await new Promise<void>((r) => s.close(() => r()))
  openServers = []
})

async function startDest(opts?: SSEDestinationOptions): Promise<{ dest: SSEDestination; port: number }> {
  const dest = new SSEDestination(opts)
  openDests.push(dest)
  const addr = await dest.listen(0)
  return { dest, port: addr.port }
}

function connect(port: number, path = "/events"): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const client = new TestClient(req, res)
      // Resolve once the initial ": connected" comment arrives — by then the server has
      // registered the client, so a subsequent send() is guaranteed to reach it.
      res.once("data", () => resolve(client))
    })
    req.on("error", reject)
    req.end()
  })
}

async function open(port: number, path?: string): Promise<TestClient> {
  const client = await connect(port, path)
  openClients.push(client)
  return client
}

function httpGet(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path }, (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => (body += chunk))
        res.on("end", () => resolve(body))
      })
      .on("error", reject)
  })
}

// --- tests ------------------------------------------------------------------

describe("SSEDestination", () => {
  it("listen(0) binds an ephemeral port and returns its AddressInfo", async () => {
    const dest = new SSEDestination()
    openDests.push(dest)
    const addr = await dest.listen(0)
    expect(addr.port).toBeGreaterThan(0)
  })

  it("broadcasts a notification to a connected client", async () => {
    const { dest, port } = await startDest()
    const client = await open(port)
    await dest.send(makeNotification({ topic: "orders" }))
    const frames = await client.waitForDataFrames(1)
    expect(frames[0]?.event).toBe("orders")
    const data = JSON.parse(frames[0]?.data ?? "{}") as Record<string, unknown>
    expect(data["topic"]).toBe("orders")
    expect(data["sourceTopic"]).toBe("orders.created")
    expect(data["rawPayload"]).toEqual({ id: "1" })
  })

  it("defaults the event to the topic and emits a uuid id", async () => {
    const { dest, port } = await startDest()
    const client = await open(port)
    await dest.send(makeNotification({ topic: "alerts" }))
    const frames = await client.waitForDataFrames(1)
    expect(frames[0]?.event).toBe("alerts")
    expect(frames[0]?.id).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it("broadcasts to multiple connected clients", async () => {
    const { dest, port } = await startDest()
    const a = await open(port)
    const b = await open(port)
    await dest.send(makeNotification())
    expect((await a.waitForDataFrames(1)).length).toBe(1)
    expect((await b.waitForDataFrames(1)).length).toBe(1)
  })

  it("filters per-client by the ?topic query parameter", async () => {
    const { dest, port } = await startDest()
    const a = await open(port, "/events?topic=orders")
    const b = await open(port, "/events?topic=alerts")
    const c = await open(port) // no filter — receives everything
    await dest.send(makeNotification({ topic: "orders" }))
    await a.waitForDataFrames(1)
    await c.waitForDataFrames(1)
    await delay(50) // give b a chance to (incorrectly) receive
    expect(a.dataFrames().length).toBe(1)
    expect(c.dataFrames().length).toBe(1)
    expect(b.dataFrames().length).toBe(0)
  })

  it("format callback returning a string is used as the data payload as-is", async () => {
    const { dest, port } = await startDest({ format: () => "custom content" })
    const client = await open(port)
    await dest.send(makeNotification())
    const frames = await client.waitForDataFrames(1)
    expect(frames[0]?.data).toBe("custom content")
    expect(frames[0]?.event).toBe("orders") // default event preserved
  })

  it("format callback returning a plain object is JSON-serialised into data", async () => {
    const { dest, port } = await startDest({ format: () => ({ custom: "x" }) })
    const client = await open(port)
    await dest.send(makeNotification())
    const frames = await client.waitForDataFrames(1)
    expect(JSON.parse(frames[0]?.data ?? "{}")).toEqual({ custom: "x" })
  })

  it("format callback returning an SSEEventInit controls data/event/id/retry", async () => {
    const { dest, port } = await startDest({
      format: () => ({ data: { a: 1 }, event: "custom", id: "fixed-id", retry: 5000 }),
    })
    const client = await open(port)
    await dest.send(makeNotification())
    const frames = await client.waitForDataFrames(1)
    expect(frames[0]?.event).toBe("custom")
    expect(frames[0]?.id).toBe("fixed-id")
    expect(frames[0]?.retry).toBe(5000)
    expect(JSON.parse(frames[0]?.data ?? "{}")).toEqual({ a: 1 })
  })

  it("propagates errors thrown by the format callback", async () => {
    const { dest, port } = await startDest({
      format: () => {
        throw new Error("formatter crashed")
      },
    })
    await open(port)
    await expect(dest.send(makeNotification())).rejects.toThrow("formatter crashed")
  })

  it("removes a client from the broadcast set when it disconnects", async () => {
    const { dest, port } = await startDest()
    const client = await open(port)
    expect(dest.connectionCount).toBe(1)
    client.close()
    await waitFor(() => dest.connectionCount === 0)
    expect(dest.connectionCount).toBe(0)
  })

  it("emits heartbeat comments at the configured interval", async () => {
    const { port } = await startDest({ heartbeatMs: 20 })
    const client = await open(port)
    await delay(80)
    const pings = client.frames().filter((f) => f.comment?.includes("ping"))
    expect(pings.length).toBeGreaterThanOrEqual(1)
  })

  it("heartbeatMs: 0 disables heartbeats", async () => {
    const { port } = await startDest({ heartbeatMs: 0 })
    const client = await open(port)
    await delay(80)
    const pings = client.frames().filter((f) => f.comment?.includes("ping"))
    expect(pings.length).toBe(0)
  })

  it("send() before listen() with no injected server throws", async () => {
    const dest = new SSEDestination()
    await expect(dest.send(makeNotification())).rejects.toThrow(/listen\(\) or provide a server/)
  })

  it("listen() throws when a server was injected", async () => {
    const server = http.createServer()
    openServers.push(server)
    const dest = new SSEDestination({ server })
    openDests.push(dest)
    await expect(dest.listen(0)).rejects.toThrow(/injected server/)
  })

  it("mounts onto an injected server without owning its lifecycle", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.statusCode = 200
        res.end("ok")
      }
      // other paths fall through to the SSE request listener
    })
    openServers.push(server)
    const dest = new SSEDestination({ server })
    openDests.push(dest)
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as AddressInfo).port

    expect(await httpGet(port, "/health")).toBe("ok")

    const client = await connect(port)
    openClients.push(client)
    await dest.send(makeNotification({ topic: "orders" }))
    expect((await client.waitForDataFrames(1)).length).toBe(1)

    client.close()
    await dest.close()

    // close() must NOT have closed the injected server.
    expect(await httpGet(port, "/health")).toBe("ok")
  })

  it("close() ends open client streams and stops the server", async () => {
    const { dest, port } = await startDest()
    const client = await open(port)
    let closed = false
    client.res.on("end", () => (closed = true))
    client.res.on("close", () => (closed = true))

    await dest.close()
    await waitFor(() => closed)
    expect(closed).toBe(true)

    // The internal server stopped listening — new connections are refused.
    await expect(connect(port)).rejects.toThrow()
  })
})
