export interface NotificationTemplate {
  title?: string
  body?: string
}

export interface SubscriptionConfig {
  /** Unique identifier for this subscription. */
  name: string
  /**
   * Queue-native topic patterns to subscribe to.
   * NATS: use `*` (single token) and `>` (all remaining).
   * MQTT: use `+` (single level) and `#` (multilevel).
   */
  topics: string[]
  /**
   * Consumer group name.
   * NATS: used as a queue group name for load-balanced delivery.
   * MQTT: used as the shared subscription group (`$share/{group}/topic`).
   */
  group?: string
  /**
   * Destination topic name. Defaults to a sanitized version of the source topic
   * (queue separators replaced with `-`).
   */
  destinationTopic?: string
  /** Static notification content passed through to the destination adapter. */
  notification?: NotificationTemplate
  /**
   * Payload fields to forward as string key/value pairs.
   * Only top-level string/number/boolean fields are supported.
   */
  dataFields?: string[]
}

export interface WhistlersConfig {
  version: 1
  subscriptions: SubscriptionConfig[]
}
