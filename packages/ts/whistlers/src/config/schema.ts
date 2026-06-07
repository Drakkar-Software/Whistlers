export interface NotificationTemplate {
  title?: string
  body?: string
}

/**
 * A reference to a (possibly nested) field of the parsed queue payload, resolved
 * to a string. `default` (or `""`) is used when the path is missing/non-primitive.
 * `unless` maps a specific resolved value to the default (e.g. drop a sentinel like
 * `"_rooms"`). `omitIfEmpty` drops the surrounding key when the result is empty.
 * `match` (used only inside a `ConditionTemplate`'s `vars`) requires the resolved
 * value to match the regex, otherwise the variable is treated as unresolved.
 */
export interface FieldRef {
  field: string
  default?: string
  unless?: string
  omitIfEmpty?: boolean
  match?: string
}

/** First non-empty of the listed field references (or literal field paths). */
export interface Coalesce {
  coalesce: (string | FieldRef)[]
  default?: string
  omitIfEmpty?: boolean
}

/**
 * An FCM `condition` expression built by interpolating `{topic}` (the destination
 * topic) and the resolved `vars` into `template`. The whole `condition` key is
 * omitted (falling back to plain topic addressing) unless EVERY var resolves to a
 * non-empty value passing its optional `match` guard.
 */
export interface ConditionTemplate {
  condition: { template: string; vars?: Record<string, FieldRef> }
}

/** A leaf or nested node of an FCM message template. */
export type FcmTemplateValue =
  | string
  | number
  | boolean
  | FieldRef
  | Coalesce
  | ConditionTemplate
  | FcmTemplateValue[]
  | { [key: string]: FcmTemplateValue }

/**
 * A single FCM message body shaped exactly like firebase-admin's `Message` (minus
 * `topic`/`condition` addressing, which Whistlers applies), but where leaves may be
 * `FieldRef`/`Coalesce`/`ConditionTemplate` template nodes instead of literals.
 */
export type FcmMessageTemplate = { [key: string]: FcmTemplateValue }

/**
 * Declarative FCM message formatting for a subscription. Consumed only by the
 * bundled server (`bin/server.ts`) when `DESTINATION_TYPE=firebase`: it compiles
 * these templates into the `FirebaseDestination` `format` function. `messages` with
 * more than one entry are sent via `sendEach` (e.g. a visible placeholder + a
 * data-only upgrade). Ignored by SSE and other destination types.
 */
export interface FcmConfig {
  messages: FcmMessageTemplate[]
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
  /**
   * Declarative FCM message template(s). When present, the bundled server builds
   * the `FirebaseDestination` `format` from this instead of forwarding
   * `notification`/`dataFields`. Lets product-specific FCM shaping (nested fields,
   * android/apns options, self-exclusion conditions, placeholder+upgrade arrays)
   * live entirely in config. See `FcmConfig`.
   */
  fcm?: FcmConfig
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
