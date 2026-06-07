import type { OutgoingNotification } from "../destination/base.js"
import type {
  Coalesce,
  ConditionTemplate,
  FcmTemplateValue,
  FieldRef,
} from "./schema.js"

/**
 * Compiles declarative `SubscriptionConfig.fcm` templates into FCM message bodies.
 *
 * This is what lets product-specific FCM shaping live entirely in config: nested
 * payload fields, android/apns options, self-exclusion `condition`s, and
 * placeholder+upgrade message arrays. The output is shaped exactly for
 * `FirebaseDestination`'s `format` (which applies topic/condition addressing and
 * sends arrays via `sendEach`).
 */

/** Sentinel meaning "drop this key / array element / empty object". */
const OMIT = Symbol("omit")

function getPath(payload: unknown, path: string): unknown {
  let cur: unknown = payload
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/** Resolve a raw payload path to a primitive string (objects/arrays/null → ""). */
function readString(payload: unknown, path: string): string {
  const raw = getPath(payload, path)
  if (raw === undefined || raw === null || typeof raw === "object") return ""
  return String(raw)
}

function resolveFieldRef(ref: FieldRef, payload: unknown): string | typeof OMIT {
  let val = readString(payload, ref.field)
  if (ref.unless !== undefined && val === ref.unless) val = ""
  if (val === "") val = ref.default ?? ""
  if (val === "" && ref.omitIfEmpty) return OMIT
  return val
}

function resolveCoalesce(c: Coalesce, payload: unknown): string | typeof OMIT {
  for (const item of c.coalesce) {
    const ref: FieldRef = typeof item === "string" ? { field: item } : item
    let val = readString(payload, ref.field)
    if (ref.unless !== undefined && val === ref.unless) val = ""
    if (val !== "") return val
  }
  const def = c.default ?? ""
  if (def === "" && c.omitIfEmpty) return OMIT
  return def
}

/**
 * Build an FCM `condition` string. Returns OMIT (→ key dropped → plain topic
 * addressing) unless every `var` resolves non-empty AND passes its `match` guard.
 */
function resolveCondition(
  ct: ConditionTemplate,
  payload: unknown,
  topic: string,
): string | typeof OMIT {
  const vars: Record<string, string> = { topic }
  for (const [name, ref] of Object.entries(ct.condition.vars ?? {})) {
    const val = readString(payload, ref.field)
    if (val === "") return OMIT
    if (ref.match !== undefined && !new RegExp(ref.match).test(val)) return OMIT
    vars[name] = val
  }
  return ct.condition.template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "")
}

function isFieldRef(v: object): v is FieldRef {
  return typeof (v as FieldRef).field === "string"
}
function isCoalesce(v: object): v is Coalesce {
  return Array.isArray((v as Coalesce).coalesce)
}
function isCondition(v: object): v is ConditionTemplate {
  const c = (v as ConditionTemplate).condition
  return typeof c === "object" && c !== null && typeof c.template === "string"
}

function resolveValue(
  tpl: FcmTemplateValue,
  payload: unknown,
  topic: string,
): unknown | typeof OMIT {
  if (Array.isArray(tpl)) {
    const out: unknown[] = []
    for (const el of tpl) {
      const r = resolveValue(el, payload, topic)
      if (r !== OMIT) out.push(r)
    }
    return out
  }
  if (tpl !== null && typeof tpl === "object") {
    if (isCondition(tpl)) return resolveCondition(tpl, payload, topic)
    if (isCoalesce(tpl)) return resolveCoalesce(tpl, payload)
    if (isFieldRef(tpl)) return resolveFieldRef(tpl, payload)
    const obj: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(tpl)) {
      const r = resolveValue(v, payload, topic)
      if (r !== OMIT) obj[k] = r
    }
    // An object emptied entirely by omission is itself dropped (e.g. android's
    // `notification: { tag }` when there is no room key).
    return Object.keys(obj).length === 0 ? OMIT : obj
  }
  // Literal scalar.
  return tpl
}

/**
 * Render a subscription's `fcm` templates against an outgoing notification.
 * Returns the FCM message bodies (one per `messages` entry that didn't fully
 * resolve away). Returns `[]` when the subscription has no `fcm` config.
 */
export function renderFcmMessages(
  notification: OutgoingNotification,
): Record<string, unknown>[] {
  const fcm = notification.subscription?.fcm
  if (!fcm) return []
  const out: Record<string, unknown>[] = []
  for (const msg of fcm.messages) {
    const r = resolveValue(msg, notification.rawPayload, notification.topic)
    if (r !== OMIT && r !== null && typeof r === "object") {
      out.push(r as Record<string, unknown>)
    }
  }
  return out
}
