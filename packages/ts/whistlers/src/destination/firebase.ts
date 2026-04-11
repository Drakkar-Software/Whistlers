import type { DestinationAdapter, OutgoingNotification } from "./base.js"

export interface FirebaseDestinationOptions {
  /**
   * A pre-initialized firebase-admin App instance.
   * If omitted, the default app is used (i.e. `admin.messaging()`).
   */
  app?: import("firebase-admin/app").App
  /**
   * Format the FCM message body. Receives the outgoing notification and returns an object
   * that is spread into the FCM message alongside `topic` (which is always set from
   * `notification.topic` and cannot be overridden — a `topic` key in the return value is
   * silently ignored).
   *
   * Standard keys: `notification` (`{title?, body?}`), `data` (`Record<string, string>` —
   * FCM requires string values). Additional FCM-specific keys (android, apns, webpush,
   * fcmOptions, etc.) are also accepted.
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

    await messaging.send({ ...body, topic: notification.topic })
  }
}
