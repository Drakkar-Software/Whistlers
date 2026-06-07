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

    if (sub["fcm"] !== undefined) {
      errors.push(...validateFcm(sub["fcm"], `${subPrefix}.fcm`))
    }
  }

  return errors
}

/**
 * Validate a subscription's `fcm` template config. Checks the `messages` array and
 * walks every template node so malformed `FieldRef`/`Coalesce`/`ConditionTemplate`
 * leaves (and bad `match`/`condition` regexes) are caught at load time.
 */
function validateFcm(fcm: unknown, prefix: string): string[] {
  const errors: string[] = []
  if (typeof fcm !== "object" || fcm === null) {
    return [`${prefix} must be an object`]
  }
  const messages = (fcm as Record<string, unknown>)["messages"]
  if (!Array.isArray(messages) || messages.length === 0) {
    return [`${prefix}.messages must be a non-empty array`]
  }
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
      errors.push(`${prefix}.messages[${i}] must be an object`)
    } else {
      errors.push(...validateTemplateNode(msg, `${prefix}.messages[${i}]`))
    }
  }
  return errors
}

function validateTemplateNode(node: unknown, prefix: string): string[] {
  const errors: string[] = []
  if (node === null || typeof node !== "object") return errors // literal scalar
  if (Array.isArray(node)) {
    node.forEach((el, i) => errors.push(...validateTemplateNode(el, `${prefix}[${i}]`)))
    return errors
  }
  const obj = node as Record<string, unknown>

  // A ConditionTemplate node is `{ condition: { template, vars? } }` — detected by the
  // nested `template`, so a plain FCM message carrying a `condition` STRING key (the
  // common case) falls through to generic recursion instead. Mirrors `isCondition`.
  const condNode = obj["condition"]
  if (
    typeof condNode === "object" &&
    condNode !== null &&
    "template" in (condNode as Record<string, unknown>)
  ) {
    const cond = condNode as Record<string, unknown>
    if (typeof cond["template"] !== "string") {
      errors.push(`${prefix}.condition.template must be a string`)
    }
    if (cond["vars"] !== undefined) {
      if (typeof cond["vars"] !== "object" || cond["vars"] === null) {
        errors.push(`${prefix}.condition.vars must be an object`)
      } else {
        for (const [name, ref] of Object.entries(cond["vars"] as Record<string, unknown>)) {
          errors.push(...validateFieldRef(ref, `${prefix}.condition.vars.${name}`))
        }
      }
    }
    return errors
  }

  if ("coalesce" in obj) {
    if (!Array.isArray(obj["coalesce"]) || obj["coalesce"].length === 0) {
      errors.push(`${prefix}.coalesce must be a non-empty array`)
    } else {
      ;(obj["coalesce"] as unknown[]).forEach((item, i) => {
        if (typeof item === "string") return
        errors.push(...validateFieldRef(item, `${prefix}.coalesce[${i}]`))
      })
    }
    return errors
  }

  if ("field" in obj) {
    return validateFieldRef(obj, prefix)
  }

  for (const [k, v] of Object.entries(obj)) {
    errors.push(...validateTemplateNode(v, `${prefix}.${k}`))
  }
  return errors
}

function validateFieldRef(ref: unknown, prefix: string): string[] {
  const errors: string[] = []
  if (typeof ref !== "object" || ref === null) {
    return [`${prefix} must be a field-reference object`]
  }
  const r = ref as Record<string, unknown>
  if (typeof r["field"] !== "string" || r["field"] === "") {
    errors.push(`${prefix}.field must be a non-empty string`)
  }
  if (r["match"] !== undefined) {
    if (typeof r["match"] !== "string") {
      errors.push(`${prefix}.match must be a string`)
    } else {
      try {
        new RegExp(r["match"])
      } catch {
        errors.push(`${prefix}.match must be a valid regular expression`)
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
