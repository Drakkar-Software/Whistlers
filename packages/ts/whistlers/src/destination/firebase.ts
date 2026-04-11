import type { DestinationAdapter, OutgoingNotification } from "./base.js"

export interface FirebaseDestinationOptions {
  /**
   * A pre-initialized firebase-admin App instance.
   * If omitted, the default app is used (i.e. `admin.messaging()`).
   */
  app?: import("firebase-admin/app").App
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

    await messaging.send({
      topic: notification.topic,
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
    })
  }
}
