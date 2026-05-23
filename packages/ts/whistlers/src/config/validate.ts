import type { WhistlersConfig } from "./schema.js"

const NAMESPACE_NAME_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Validate an array of subscription objects and return error strings.
 * Assumes `subs` has already been confirmed to be an array; does NOT
 * require it to be non-empty (callers add that check when needed).
 */
function validateSubscriptions(subs: unknown[], prefix: string): string[] {
  const errors: string[] = []
  const names = new Set<string>()

  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i] as Record<string, unknown>
    const subPrefix = `${prefix}[${i}]`

    if (typeof sub["name"] !== "string" || sub["name"].trim() === "") {
      errors.push(`${subPrefix}.name must be a non-empty string`)
    } else {
      if (names.has(sub["name"])) {
        errors.push(`${subPrefix}.name "${sub["name"]}" is duplicated`)
      }
      names.add(sub["name"])
    }

    if (!Array.isArray(sub["topics"]) || (sub["topics"] as unknown[]).length === 0) {
      errors.push(`${subPrefix}.topics must be a non-empty array`)
    } else {
      for (let j = 0; j < (sub["topics"] as unknown[]).length; j++) {
        if (typeof (sub["topics"] as unknown[])[j] !== "string") {
          errors.push(`${subPrefix}.topics[${j}] must be a string`)
        }
      }
    }

    if (sub["group"] !== undefined && typeof sub["group"] !== "string") {
      errors.push(`${subPrefix}.group must be a string`)
    }

    if (sub["destinationTopic"] !== undefined) {
      if (typeof sub["destinationTopic"] !== "string") {
        errors.push(`${subPrefix}.destinationTopic must be a string`)
      } else if (!/^[a-zA-Z0-9\-_.~%]+$/.test(sub["destinationTopic"])) {
        errors.push(
          `${subPrefix}.destinationTopic "${sub["destinationTopic"]}" contains characters not allowed by FCM`
        )
      }
    }

    if (sub["notification"] !== undefined) {
      if (typeof sub["notification"] !== "object" || sub["notification"] === null) {
        errors.push(`${subPrefix}.notification must be an object`)
      }
    }

    if (sub["dataFields"] !== undefined) {
      if (!Array.isArray(sub["dataFields"])) {
        errors.push(`${subPrefix}.dataFields must be an array`)
      } else {
        for (let j = 0; j < (sub["dataFields"] as unknown[]).length; j++) {
          if (typeof (sub["dataFields"] as unknown[])[j] !== "string") {
            errors.push(`${subPrefix}.dataFields[${j}] must be a string`)
          }
        }
      }
    }
  }

  return errors
}

export function validateConfig(config: unknown): string[] {
  const errors: string[] = []

  if (typeof config !== "object" || config === null) {
    return ["config must be an object"]
  }

  const c = config as Record<string, unknown>

  if (c["version"] !== 1) {
    errors.push(`version must be 1, got ${String(c["version"])}`)
  }

  if (!Array.isArray(c["subscriptions"])) {
    errors.push("subscriptions must be an array")
    return errors
  }

  errors.push(...validateSubscriptions(c["subscriptions"] as unknown[], "subscriptions"))

  if (c["namespaces"] !== undefined) {
    if (
      typeof c["namespaces"] !== "object" ||
      c["namespaces"] === null ||
      Array.isArray(c["namespaces"])
    ) {
      errors.push("namespaces must be an object")
    } else {
      for (const [nsName, nsConfig] of Object.entries(
        c["namespaces"] as Record<string, unknown>
      )) {
        if (!NAMESPACE_NAME_RE.test(nsName)) {
          errors.push(
            `namespaces["${nsName}"]: name must only contain letters, digits, hyphens, and underscores`
          )
        }

        if (typeof nsConfig !== "object" || nsConfig === null) {
          errors.push(`namespaces["${nsName}"] must be an object`)
          continue
        }

        const nsSubs = (nsConfig as Record<string, unknown>)["subscriptions"]
        if (!Array.isArray(nsSubs) || (nsSubs as unknown[]).length === 0) {
          errors.push(`namespaces["${nsName}"].subscriptions must be a non-empty array`)
        } else {
          errors.push(
            ...validateSubscriptions(nsSubs as unknown[], `namespaces["${nsName}"].subscriptions`)
          )
        }

        const nsCreds = (nsConfig as Record<string, unknown>)["firebaseCredentials"]
        if (nsCreds !== undefined && (typeof nsCreds !== "string" || nsCreds.trim() === "")) {
          errors.push(`namespaces["${nsName}"].firebaseCredentials must be a non-empty string`)
        }
      }
    }
  }

  return errors
}

export function assertValidConfig(config: unknown): asserts config is WhistlersConfig {
  const errors = validateConfig(config)
  if (errors.length > 0) {
    throw new Error(`Invalid WhistlersConfig:\n${errors.map((e) => `  - ${e}`).join("\n")}`)
  }
}
