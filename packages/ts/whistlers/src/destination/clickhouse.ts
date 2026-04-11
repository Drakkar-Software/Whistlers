import type { DestinationAdapter, OutgoingNotification } from "./base.js"

export interface ClickHouseDestinationOptions {
  /** ClickHouse server URL, e.g. `"http://localhost:8123"`. */
  url: string
  /** Database name. */
  database: string
  /** Table to insert notification rows into. */
  table: string
  /** ClickHouse username (default: `"default"`). */
  username?: string
  /** ClickHouse password (default: `""`). */
  password?: string
}

interface ClickHouseClient {
  insert(params: { table: string; values: unknown[]; format: string }): Promise<unknown>
  close(): Promise<void>
}

export class ClickHouseDestination implements DestinationAdapter {
  private client: ClickHouseClient | undefined

  constructor(private readonly opts: ClickHouseDestinationOptions) {}

  private async getClient(): Promise<ClickHouseClient> {
    if (!this.client) {
      const { createClient } = await import("@clickhouse/client")
      this.client = createClient({
        url: this.opts.url,
        username: this.opts.username,
        password: this.opts.password,
        database: this.opts.database,
      }) as ClickHouseClient
    }
    return this.client
  }

  async send(notification: OutgoingNotification): Promise<void> {
    const client = await this.getClient()
    await client.insert({
      table: this.opts.table,
      values: [
        {
          topic: notification.topic,
          source_topic: notification.sourceTopic,
          notification:
            notification.notification !== undefined
              ? JSON.stringify(notification.notification)
              : null,
          data: notification.data !== undefined ? JSON.stringify(notification.data) : null,
          raw_payload: JSON.stringify(notification.rawPayload),
          received_at: new Date().toISOString(),
        },
      ],
      format: "JSONEachRow",
    })
  }

  async close(): Promise<void> {
    await this.client?.close()
    this.client = undefined
  }
}
