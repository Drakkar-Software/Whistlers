import type { SubscriptionConfig, WhistlersConfig } from "./schema.js"
import { assertValidConfig } from "./validate.js"

export interface CreateConfigOptions {
  subscriptions: SubscriptionConfig[]
}

/**
 * Build a WhistlersConfig from code. Validates before returning.
 */
export function createConfig(options: CreateConfigOptions): WhistlersConfig {
  const config: WhistlersConfig = { version: 1, subscriptions: options.subscriptions }
  assertValidConfig(config)
  return config
}
