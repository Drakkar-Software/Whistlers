export interface NotificationPayload {
  title?: string
  body?: string
}

export interface OutgoingNotification {
  /** Sanitized destination topic name. */
  topic: string
  /** Original topic from the queue message. */
  sourceTopic: string
  notification?: NotificationPayload
  /** String-string map forwarded to the destination adapter as key/value pairs. */
  data?: Record<string, string>
  /** The parsed payload from the queue message. */
  rawPayload: unknown
}

export interface DestinationAdapter {
  send(notification: OutgoingNotification): Promise<void>
  close?(): Promise<void>
}
