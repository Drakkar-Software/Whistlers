import type { S3Client } from "@aws-sdk/client-s3"
import type { DestinationAdapter, OutgoingNotification } from "./base.js"

export interface S3DestinationOptions {
  /** S3 bucket name. */
  bucket: string
  /**
   * AWS region, e.g. `"us-east-1"`. Defaults to the `AWS_REGION` environment variable
   * when omitted. Ignored when `client` is provided.
   */
  region?: string
  /** Key prefix for stored objects (default: `"whistlers/"`). */
  prefix?: string
  /**
   * A pre-configured `S3Client` instance. When provided, `region` is ignored.
   * The client is **not** destroyed when `close()` is called — that remains the caller's
   * responsibility. Useful for custom endpoints (LocalStack, MinIO, etc.).
   */
  client?: S3Client
}

export class S3Destination implements DestinationAdapter {
  private readonly bucket: string
  private readonly prefix: string
  private readonly region: string | undefined
  private readonly externalClient: S3Client | undefined
  private s3: S3Client | undefined

  constructor(opts: S3DestinationOptions) {
    this.bucket = opts.bucket
    this.prefix = opts.prefix ?? "whistlers/"
    this.region = opts.region
    this.externalClient = opts.client
  }

  private async getClient(): Promise<S3Client> {
    if (this.externalClient) return this.externalClient
    if (!this.s3) {
      const { S3Client } = await import("@aws-sdk/client-s3")
      this.s3 = new S3Client({ region: this.region })
    }
    return this.s3
  }

  async send(notification: OutgoingNotification): Promise<void> {
    const client = await this.getClient()
    const { PutObjectCommand } = await import("@aws-sdk/client-s3")

    const key = `${this.prefix}${notification.topic}/${crypto.randomUUID()}.json`
    const body = JSON.stringify({
      topic: notification.topic,
      sourceTopic: notification.sourceTopic,
      notification: notification.notification,
      data: notification.data,
      rawPayload: notification.rawPayload,
    })

    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
      })
    )
  }

  async close(): Promise<void> {
    this.s3?.destroy()
    this.s3 = undefined
  }
}
