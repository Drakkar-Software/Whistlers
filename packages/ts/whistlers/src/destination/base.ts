export interface NotificationPayload {
  title?: string
  body?: string
}

export interface OutgoingNotification {
  /** Sanitized FCM-safe topic name. */
  topic: string
  /** Original topic from the queue message. */
  sourceTopic: string
  notification?: NotificationPayload
  /** String-string map forwarded as FCM data fields. */
  data?: Record<string, string>
  /** The parsed payload from the queue message. */
  rawPayload: unknown
}

export interface DestinationAdapter {
  send(notification: OutgoingNotification): Promise<void>
  close?(): Promise<void>
}
