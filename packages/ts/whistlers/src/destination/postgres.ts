import type { DestinationAdapter, OutgoingNotification } from "./base.js"

export interface PostgresDestinationOptions {
  /** PostgreSQL connection string, e.g. `"postgresql://user:pass@host:5432/db"`. */
  connectionString: string
  /** Table to insert notification rows into. */
  table: string
}

interface PgPool {
  query(text: string, values: unknown[]): Promise<unknown>
  end(): Promise<void>
}

export class PostgresDestination implements DestinationAdapter {
  private pool: PgPool | undefined

  constructor(private readonly opts: PostgresDestinationOptions) {}

  private async getPool(): Promise<PgPool> {
    if (!this.pool) {
      const { Pool } = await import("pg")
      this.pool = new Pool({ connectionString: this.opts.connectionString })
    }
    return this.pool
  }

  async send(notification: OutgoingNotification): Promise<void> {
    const pool = await this.getPool()
    await pool.query(
      `INSERT INTO ${this.opts.table} (topic, source_topic, notification, data, raw_payload, received_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        notification.topic,
        notification.sourceTopic,
        notification.notification !== undefined
          ? JSON.stringify(notification.notification)
          : null,
        notification.data !== undefined ? JSON.stringify(notification.data) : null,
        JSON.stringify(notification.rawPayload),
      ]
    )
  }

  async close(): Promise<void> {
    await this.pool?.end()
    this.pool = undefined
  }
}
