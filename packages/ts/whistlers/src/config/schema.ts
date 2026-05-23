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

export interface NamespaceConfig {
  /**
   * Subscriptions scoped to this namespace.
   * Each subscription's destination topic is automatically prefixed with `{namespaceName}-`.
   */
  subscriptions: SubscriptionConfig[]
  /**
   * Path to a Firebase service-account JSON key file used for this namespace's
   * notifications. Lets each namespace target its own Firebase project.
   *
   * Consumed only by the bundled server (`bin/server.ts`) when
   * `DESTINATION_TYPE=firebase`: the server initializes a dedicated
   * firebase-admin app per namespace and routes via `NamespaceRoutingDestination`.
   * Namespaces without this field fall back to the default app (Application
   * Default Credentials). Ignored by the `Whistler` bridge itself and by
   * other destination types — only a path is accepted here, never inline
   * credentials.
   */
  firebaseCredentials?: string
}

export interface WhistlersConfig {
  version: 1
  subscriptions: SubscriptionConfig[]
  /**
   * Named groups of subscriptions. Each key prefixes its subscriptions' destination topics
   * with `{name}-` and is attached as `namespace` on the `OutgoingNotification` so
   * destinations can segment traffic by namespace.
   *
   * Key rules: must match `[a-zA-Z0-9_-]+`. Subscription `name`s must be unique within
   * each namespace; the root subscriptions list is its own scope (names may repeat across
   * scopes).
   */
  namespaces?: Record<string, NamespaceConfig>
}
