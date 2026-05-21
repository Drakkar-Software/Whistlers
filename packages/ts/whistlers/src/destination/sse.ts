import type { AddressInfo } from "node:net"
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http"
import type { DestinationAdapter, OutgoingNotification } from "./base.js"

/** Full control over a single Server-Sent Event, returned from a `format` callback. */
export interface SSEEventInit {
  /** The `data:` payload. A string is used as-is; an object is JSON-serialised. */
  data: string | Record<string, unknown>
  /** Overrides the default `event:` field (which defaults to the notification topic). */
  event?: string
  /** Overrides the default `id:` field (which defaults to a random UUID). */
  id?: string
  /** SSE reconnection hint in milliseconds, emitted as the `retry:` field. */
  retry?: number
}

export interface SSEDestinationOptions {
  /** URL path SSE clients connect to (default: `"/events"`). */
  path?: string
  /**
   * A pre-existing `http.Server` to mount the SSE handler onto. When provided, the adapter
   * attaches a `request` listener and does **not** `listen()`/`close()` the server — its
   * lifecycle remains the caller's responsibility (mirrors `S3Destination`'s injectable
   * `client`). Use `listen()` instead when omitted. Note: the adapter responds to requests
   * matching `path`; ensure your own handler does not also respond to that path.
   */
  server?: HttpServer
  /**
   * Heartbeat comment interval in milliseconds to keep idle connections alive through
   * proxies and load balancers (default: `15000`). Set to `0` to disable.
   */
  heartbeatMs?: number
  /** Extra response headers set on each SSE stream (e.g. CORS). Default: none. */
  headers?: Record<string, string>
  /**
   * Customize the emitted event. Returns:
   *  - a `string` — used as the `data:` payload as-is;
   *  - a `Record<string, unknown>` — JSON-serialised into `data:`;
   *  - an `SSEEventInit` (an object with a `data` property) — full control of
   *    `data`/`event`/`id`/`retry`.
   *
   * When omitted, the event uses `event` = topic, `id` = a random UUID, and `data` = a JSON
   * object containing `topic`, `sourceTopic`, `notification`, `data`, and `rawPayload`.
   */
  format?: (notification: OutgoingNotification) => string | Record<string, unknown> | SSEEventInit
}

interface SSEClient {
  res: ServerResponse
  /** Topics this client subscribed to via `?topic=`, or `null` to receive every topic. */
  topics: Set<string> | null
}

interface SSEFrame {
  id: string
  event: string | undefined
  data: string
  retry: number | undefined
}

export class SSEDestination implements DestinationAdapter {
  private readonly path: string
  private readonly heartbeatMs: number
  private readonly headers: Record<string, string>
  private readonly formatFn: SSEDestinationOptions["format"]
  private readonly externalServer: HttpServer | undefined
  private readonly clients = new Set<SSEClient>()

  /** Internally-created server (only when `listen()` is used). */
  private server: HttpServer | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private requestListener: ((req: IncomingMessage, res: ServerResponse) => void) | undefined

  constructor(opts: SSEDestinationOptions = {}) {
    this.path = opts.path ?? "/events"
    this.heartbeatMs = opts.heartbeatMs ?? 15000
    this.headers = opts.headers ?? {}
    this.formatFn = opts.format
    this.externalServer = opts.server

    if (this.externalServer) {
      this.requestListener = this.makeRequestListener()
      this.externalServer.on("request", this.requestListener)
      this.startHeartbeat()
    }
  }

  /** Number of currently connected clients. */
  get connectionCount(): number {
    return this.clients.size
  }

  /**
   * Start an internal HTTP server listening on `port` (use `0` for an ephemeral port).
   * Call this once, before `whistler.start()`. Resolves with the bound address.
   * Throws when a `server` was injected via options — that server's lifecycle is the
   * caller's responsibility.
   */
  async listen(port: number, host?: string): Promise<AddressInfo> {
    if (this.externalServer) {
      throw new Error(
        "SSEDestination: listen() cannot be used when a `server` was provided; the injected server's lifecycle is the caller's responsibility"
      )
    }
    if (this.server) return this.address()

    const { createServer } = await import("node:http")
    const server = createServer(this.makeRequestListener())
    this.server = server
    this.startHeartbeat()

    await new Promise<void>((resolve, reject) => {
      const onError = (err: unknown) => reject(err)
      server.once("error", onError)
      server.listen(port, host, () => {
        server.off("error", onError)
        resolve()
      })
    })
    return this.address()
  }

  async send(notification: OutgoingNotification): Promise<void> {
    if (!this.server && !this.externalServer) {
      throw new Error("SSEDestination: call listen() or provide a server before sending")
    }
    const payload = this.serializeFrame(this.resolveFrame(notification))
    for (const client of this.clients) {
      if (client.topics !== null && !client.topics.has(notification.topic)) continue
      try {
        client.res.write(payload)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  async close(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = undefined
    }
    for (const client of this.clients) {
      try {
        client.res.end()
      } catch {
        // already closed — ignore
      }
    }
    this.clients.clear()

    // Injected server: detach our listener only, never close it.
    if (this.externalServer) {
      if (this.requestListener) {
        this.externalServer.off("request", this.requestListener)
        this.requestListener = undefined
      }
      return
    }

    if (this.server) {
      const server = this.server
      // Force idle keep-alive sockets shut so server.close()'s callback resolves promptly.
      ;(server as { closeAllConnections?: () => void }).closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      this.server = undefined
    }
  }

  private address(): AddressInfo {
    const addr = this.server?.address()
    if (!addr || typeof addr !== "object") {
      throw new Error("SSEDestination: server has no bound address")
    }
    return addr
  }

  private makeRequestListener(): (req: IncomingMessage, res: ServerResponse) => void {
    return (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost")
      if (req.method !== "GET" || url.pathname !== this.path) {
        // On an injected server, other request listeners may handle this route — stay silent.
        if (!this.externalServer) {
          res.statusCode = 404
          res.end()
        }
        return
      }

      res.statusCode = 200
      res.setHeader("Content-Type", "text/event-stream")
      res.setHeader("Cache-Control", "no-cache, no-transform")
      res.setHeader("Connection", "keep-alive")
      res.setHeader("X-Accel-Buffering", "no")
      for (const [name, value] of Object.entries(this.headers)) {
        res.setHeader(name, value)
      }
      res.flushHeaders()
      req.socket.setTimeout(0)

      const topicParams = url.searchParams.getAll("topic")
      const client: SSEClient = {
        res,
        topics: topicParams.length > 0 ? new Set(topicParams) : null,
      }
      this.clients.add(client)
      res.write(": connected\n\n")
      req.on("close", () => {
        this.clients.delete(client)
      })
    }
  }

  private resolveFrame(notification: OutgoingNotification): SSEFrame {
    const defaultId = crypto.randomUUID()
    const defaultEvent = notification.topic

    if (!this.formatFn) {
      return {
        id: defaultId,
        event: defaultEvent,
        data: JSON.stringify({
          topic: notification.topic,
          sourceTopic: notification.sourceTopic,
          notification: notification.notification,
          data: notification.data,
          rawPayload: notification.rawPayload,
        }),
        retry: undefined,
      }
    }

    const result = this.formatFn(notification)
    if (typeof result === "string") {
      return { id: defaultId, event: defaultEvent, data: result, retry: undefined }
    }

    const obj = result as Record<string, unknown>
    // An object carrying a `data` property is treated as an SSEEventInit; any other object
    // is the JSON-`data` shorthand.
    if ("data" in obj) {
      const dataVal = obj["data"]
      return {
        id: typeof obj["id"] === "string" ? obj["id"] : defaultId,
        event: typeof obj["event"] === "string" ? obj["event"] : defaultEvent,
        data: typeof dataVal === "string" ? dataVal : JSON.stringify(dataVal),
        retry: typeof obj["retry"] === "number" ? obj["retry"] : undefined,
      }
    }
    return { id: defaultId, event: defaultEvent, data: JSON.stringify(obj), retry: undefined }
  }

  private serializeFrame(frame: SSEFrame): string {
    let out = `id: ${frame.id}\n`
    if (frame.event !== undefined) out += `event: ${frame.event}\n`
    if (frame.retry !== undefined) out += `retry: ${frame.retry}\n`
    // The spec requires one `data:` line per newline in the payload.
    for (const line of frame.data.split("\n")) {
      out += `data: ${line}\n`
    }
    return out + "\n"
  }

  private startHeartbeat(): void {
    if (this.heartbeatMs <= 0 || this.heartbeat) return
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        try {
          client.res.write(": ping\n\n")
        } catch {
          this.clients.delete(client)
        }
      }
    }, this.heartbeatMs)
    this.heartbeat.unref()
  }
}
