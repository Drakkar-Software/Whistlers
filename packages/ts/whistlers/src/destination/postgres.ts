import type { DestinationAdapter, OutgoingNotification } from "./base.js"

export interface PostgresDestinationOptions {
  /** PostgreSQL connection string, e.g. `"postgresql://user:pass@host:5432/db"`. */
  connectionString: string
  /** Table to insert notification rows into. */
  table: string
  /**
   * Format the row inserted into PostgreSQL. Receives the outgoing notification and returns
   * a record whose keys become column names in a dynamic `INSERT` statement.
   *
   * **Column names are SQL identifiers** — keys must be static, trusted values. They are
   * double-quoted before interpolation, but should not be derived from untrusted input.
   * Values are always passed as parameterized placeholders and are safe.
   *
   * When omitted, the default row contains: `topic`, `source_topic`, `notification` (JSON),
   * `data` (JSON), `raw_payload` (JSON), and `received_at` (SQL `NOW()`).
   * Note: a custom formatter must supply its own timestamp value — the SQL `NOW()` function
   * is only used by the default query.
   */
  format?: (notification: OutgoingNotification) => Record<string, unknown>
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
    if (this.opts.format) {
      const row = this.opts.format(notification)
      const keys = Object.keys(row)
      if (keys.length === 0) {
        throw new Error(
          `PostgresDestination: format callback returned an empty row for topic "${notification.topic}"`
        )
      }
      const values = Object.values(row)
      const columns = keys.map((k) => `"${k.replace(/"/g, '""')}"`).join(", ")
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ")
      await pool.query(
        `INSERT INTO ${this.opts.table} (${columns}) VALUES (${placeholders})`,
        values
      )
    } else {
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
  }

  async close(): Promise<void> {
    await this.pool?.end()
    this.pool = undefined
  }
}
