import type { DestinationAdapter, OutgoingNotification } from "./base.js"

export interface FirebaseDestinationOptions {
  /**
   * A pre-initialized firebase-admin App instance.
   * If omitted, the default app is used (i.e. `admin.messaging()`).
   */
  app?: import("firebase-admin/app").App
  /**
   * Format the FCM message body. Receives the outgoing notification and returns an object
   * that is spread into the FCM message alongside `topic` (which is set from
   * `notification.topic` — a `topic` key in the return value is silently ignored).
   *
   * Standard keys: `notification` (`{title?, body?}`), `data` (`Record<string, string>` —
   * FCM requires string values). Additional FCM-specific keys (android, apns, webpush,
   * fcmOptions, etc.) are also accepted.
   *
   * Returning a non-empty string `condition` switches addressing from topic to an FCM
   * condition expression (e.g. `"'A' in topics && !('B' in topics)"`, up to 5 topics):
   * the message is then sent with `condition` and WITHOUT `topic` (FCM rejects both at
   * once). An absent/empty `condition` falls back to the default topic send, so a
   * formatter can opt into exclusion per-message and otherwise behave as before.
   *
   * **Returning an ARRAY** sends one FCM message per element for a single event (via
   * `messaging.sendEach`). Each element is addressed INDEPENDENTLY — the same
   * `condition`/`topic` rule above is applied per element — so a formatter can, e.g.,
   * fan out a `notification` placeholder plus a `data`-only message, both carrying the
   * same exclusion `condition`. A single object (the common case) is unchanged: exactly
   * one `messaging.send`. An empty array sends nothing. NOTE: FCM does not guarantee
   * delivery ordering between the messages in a batch.
   *
   * When omitted, `notification` and `data` are forwarded from the incoming notification.
   */
  format?: (notification: OutgoingNotification) => Record<string, unknown> | Record<string, unknown>[]
  /**
   * How to handle a MULTI-message batch (an array-returning `format`) where SOME — but
   * not all — messages fail to send:
   * - `"resolve"` (default): swallow partial failures, so a message that DID deliver
   *   isn't undone by a sibling's failure (e.g. a delivered placeholder survives a
   *   failed upgrade).
   * - `"throw"`: reject if ANY message in the batch fails.
   *
   * A batch where EVERY message fails always rejects, regardless of this setting.
   * Single-message sends are unaffected — they reject on failure exactly as before.
   */
  multiSendFailure?: "resolve" | "throw"
}

/**
 * Destination adapter that sends FCM push notifications via firebase-admin.
 *
 * Requires `firebase-admin` to be installed and the app to be initialized before use.
 */
export class FirebaseDestination implements DestinationAdapter {
  constructor(private readonly opts: FirebaseDestinationOptions = {}) {}

  async send(notification: OutgoingNotification): Promise<void> {
    const { getMessaging } = await import("firebase-admin/messaging")
    const messaging = this.opts.app ? getMessaging(this.opts.app) : getMessaging()

    const formatted: Record<string, unknown> | Record<string, unknown>[] = this.opts.format
      ? this.opts.format(notification)
      : {
          ...(notification.notification
            ? {
                notification: {
                  title: notification.notification.title,
                  body: notification.notification.body,
                },
              }
            : {}),
          ...(notification.data && Object.keys(notification.data).length > 0
            ? { data: notification.data }
            : {}),
        }

    // A formatter may return a single body (the common case) or an array of bodies to
    // send several messages for one event (e.g. a placeholder + a data-only upgrade).
    const bodies = Array.isArray(formatted) ? formatted : [formatted]
    if (bodies.length === 0) return
    const messages = bodies.map((body) => this.resolveAddressing(body, notification.topic))

    // One message → a single `send` (unchanged behavior, rejects on failure). Several →
    // `sendEach` (one batch round trip).
    if (messages.length === 1) {
      await messaging.send(messages[0]!)
      return
    }
    const res = await messaging.sendEach(messages)
    if (res.failureCount === 0) return
    // Surface failures when EVERY message failed, or when the consumer opted into
    // strict ("throw") handling; otherwise a delivered message isn't undone by a
    // sibling's failure (default "resolve").
    const allFailed = res.failureCount === messages.length
    if (allFailed || this.opts.multiSendFailure === "throw") {
      const detail = res.responses
        .map((r, i) => (r.error ? `#${i}: ${r.error.message}` : null))
        .filter(Boolean)
        .join("; ")
      throw new Error(
        `FirebaseDestination: ${res.failureCount}/${messages.length} FCM messages failed: ${detail}`,
      )
    }
  }

  /**
   * Re-apply FCM addressing to a formatted body: FCM accepts EITHER `topic` OR
   * `condition`, never both, so a non-empty `condition` replaces the topic; otherwise
   * the subscription's `topic` is used. The formatter can never set `topic` directly
   * (stripped here, as documented). Applied per element so each message in a
   * multi-message batch is addressed independently.
   */
  private resolveAddressing(
    body: Record<string, unknown>,
    topic: string,
  ): import("firebase-admin/messaging").Message {
    const { condition, topic: _ignoredTopic, ...rest } = body
    const message =
      typeof condition === "string" && condition.length > 0
        ? { ...rest, condition }
        : { ...rest, topic }
    return message as import("firebase-admin/messaging").Message
  }
}
