import type { WhistlersConfig } from "./schema.js"

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

  const names = new Set<string>()

  for (let i = 0; i < c["subscriptions"].length; i++) {
    const sub = c["subscriptions"][i] as Record<string, unknown>
    const prefix = `subscriptions[${i}]`

    if (typeof sub["name"] !== "string" || sub["name"].trim() === "") {
      errors.push(`${prefix}.name must be a non-empty string`)
    } else {
      if (names.has(sub["name"])) {
        errors.push(`${prefix}.name "${sub["name"]}" is duplicated`)
      }
      names.add(sub["name"])
    }

    if (!Array.isArray(sub["topics"]) || (sub["topics"] as unknown[]).length === 0) {
      errors.push(`${prefix}.topics must be a non-empty array`)
    } else {
      for (let j = 0; j < (sub["topics"] as unknown[]).length; j++) {
        if (typeof (sub["topics"] as unknown[])[j] !== "string") {
          errors.push(`${prefix}.topics[${j}] must be a string`)
        }
      }
    }

    if (sub["group"] !== undefined && typeof sub["group"] !== "string") {
      errors.push(`${prefix}.group must be a string`)
    }

    if (sub["destinationTopic"] !== undefined) {
      if (typeof sub["destinationTopic"] !== "string") {
        errors.push(`${prefix}.destinationTopic must be a string`)
      } else if (!/^[a-zA-Z0-9\-_.~%]+$/.test(sub["destinationTopic"])) {
        errors.push(
          `${prefix}.destinationTopic "${sub["destinationTopic"]}" contains characters not allowed by FCM`
        )
      }
    }

    if (sub["notification"] !== undefined) {
      if (typeof sub["notification"] !== "object" || sub["notification"] === null) {
        errors.push(`${prefix}.notification must be an object`)
      }
    }

    if (sub["dataFields"] !== undefined) {
      if (!Array.isArray(sub["dataFields"])) {
        errors.push(`${prefix}.dataFields must be an array`)
      } else {
        for (let j = 0; j < (sub["dataFields"] as unknown[]).length; j++) {
          if (typeof (sub["dataFields"] as unknown[])[j] !== "string") {
            errors.push(`${prefix}.dataFields[${j}] must be a string`)
          }
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
