import type { DestinationAdapter, OutgoingNotification } from "./base.js"

export interface NamespaceRoutingDestinationOptions {
  /**
   * Map of namespace name → destination adapter. A notification whose
   * `namespace` matches a key is forwarded to that adapter. Useful for routing
   * each namespace to its own backend — e.g. a `FirebaseDestination` holding a
   * separate firebase-admin app (and thus a separate Firebase project / key)
   * per namespace.
   */
  routes: Record<string, DestinationAdapter>
  /**
   * Fallback adapter used when a notification has no matching route — both
   * root (non-namespaced) notifications (`namespace === undefined`) and
   * notifications whose namespace is absent from `routes`. If omitted, such a
   * notification causes `send()` to throw (surfaced through the bridge's
   * `onError`) rather than being silently dropped.
   */
  default?: DestinationAdapter
}

/**
 * Destination adapter that dispatches each notification to a per-namespace
 * destination based on `OutgoingNotification.namespace`. The routing primitive
 * itself is destination-agnostic — wrap any `DestinationAdapter`.
 */
export class NamespaceRoutingDestination implements DestinationAdapter {
  constructor(private readonly opts: NamespaceRoutingDestinationOptions) {}

  async send(notification: OutgoingNotification): Promise<void> {
    const route =
      notification.namespace !== undefined ? this.opts.routes[notification.namespace] : undefined
    const dest = route ?? this.opts.default
    if (!dest) {
      throw new Error(
        notification.namespace !== undefined
          ? `No destination configured for namespace "${notification.namespace}" and no default destination`
          : "No default destination configured for a non-namespaced notification"
      )
    }
    await dest.send(notification)
  }

  /**
   * Close every wrapped adapter (routes + default). Adapters are deduplicated
   * by identity so an adapter shared across namespaces — or reused as the
   * default — is only closed once. All `close()` calls are awaited even if some
   * reject; the first rejection is rethrown afterwards.
   */
  async close(): Promise<void> {
    const adapters = new Set<DestinationAdapter>(Object.values(this.opts.routes))
    if (this.opts.default) adapters.add(this.opts.default)
    const results = await Promise.allSettled([...adapters].map((a) => a.close?.()))
    const failure = results.find((r) => r.status === "rejected")
    if (failure && failure.status === "rejected") throw failure.reason
  }
}
