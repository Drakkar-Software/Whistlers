import type { NamespaceConfig, SubscriptionConfig, WhistlersConfig } from "./schema.js"
import { assertValidConfig } from "./validate.js"

export interface CreateConfigOptions {
  subscriptions: SubscriptionConfig[]
  namespaces?: Record<string, NamespaceConfig>
}

/**
 * Build a WhistlersConfig from code. Validates before returning.
 */
export function createConfig(options: CreateConfigOptions): WhistlersConfig {
  const config: WhistlersConfig = {
    version: 1,
    subscriptions: options.subscriptions,
    ...(options.namespaces !== undefined ? { namespaces: options.namespaces } : {}),
  }
  assertValidConfig(config)
  return config
}

/**
 * Parse and validate a WhistlersConfig from a JSON string.
 * Throws if the string is not valid JSON or the config is structurally invalid.
 */
export function parseConfigJson(raw: string): WhistlersConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Failed to parse config JSON: ${(err as Error).message}`)
  }
  assertValidConfig(parsed)
  return parsed
}
