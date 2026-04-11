import type { SubscriptionConfig, WhistlersConfig } from "./schema.js"
import { assertValidConfig } from "./validate.js"

/**
 * Parse and validate a JSON string into a WhistlersConfig.
 * Throws if the JSON is malformed or the config is invalid.
 */
export function parseConfigJson(json: string): WhistlersConfig {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error("Failed to parse config: invalid JSON")
  }
  assertValidConfig(raw)
  return raw
}

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
