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
   * When omitted, `notification` and `data` are forwarded from the incoming notification.
   */
  format?: (notification: OutgoingNotification) => Record<string, unknown>
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

    const body: Record<string, unknown> = this.opts.format
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

    // A formatter may return a `condition` (FCM topic-combination expression) to
    // exclude/combine topics. FCM accepts EITHER `topic` OR `condition`, never both,
    // so a non-empty condition replaces the topic; otherwise we send by topic. The
    // formatter can never set `topic` directly (stripped here, as documented).
    const { condition, topic: _ignoredTopic, ...rest } = body
    await messaging.send(
      typeof condition === "string" && condition.length > 0
        ? { ...rest, condition }
        : { ...rest, topic: notification.topic },
    )
  }
}
