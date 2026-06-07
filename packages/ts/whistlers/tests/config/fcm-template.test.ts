import { describe, it, expect } from "vitest"
import { renderFcmMessages } from "../../src/config/fcm-template.js"
import { validateConfig } from "../../src/config/validate.js"
import type { FcmConfig, OutgoingNotification } from "../../src/index.js"

/**
 * Conformance tests for declarative FCM templating. These reproduce the exact
 * output of the (now-retired) drakkar-bridge `format()` functions
 * (octobot/index.ts, octochat/format.ts) so the official whistlers server image,
 * driven only by config, is byte-identical to the old custom image.
 */

// ── octobot: silent data-only push ──────────────────────────────────────────
const OCTOBOT_FCM: FcmConfig = {
  messages: [
    {
      data: { type: "signals.changed", productId: { field: "params.productId", default: "" } },
      android: { priority: "high" },
      apns: {
        headers: { "apns-push-type": "background", "apns-priority": "5" },
        payload: { aps: { "content-available": 1 } },
      },
    },
  ],
}

// ── octochat: visible placeholder + data-only upgrade ────────────────────────
const ROOM_KEY = {
  coalesce: ["params.roomId", { field: "params.docId", unless: "_rooms" }],
  omitIfEmpty: true,
}
const CHAT_DATA = {
  type: "chat.changed",
  spaceId: { field: "params.spaceId", default: "" },
  roomId: { field: "params.roomId", default: "" },
  docId: { field: "params.docId", default: "", unless: "_rooms" },
}
const CHAT_CONDITION = {
  condition: {
    template: "'{topic}' in topics && !('octochat-user-{authorId}' in topics)",
    vars: { authorId: { field: "identity", match: "^[0-9a-f]{32}$" } },
  },
}
const OCTOCHAT_FCM: FcmConfig = {
  messages: [
    {
      notification: { title: "OctoChat", body: "New message in another room" },
      data: CHAT_DATA,
      condition: CHAT_CONDITION,
      android: { priority: "high", notification: { tag: ROOM_KEY } },
      apns: {
        headers: { "apns-push-type": "alert", "apns-priority": "10" },
        payload: { aps: { sound: "default", threadId: ROOM_KEY } },
      },
    },
    {
      data: CHAT_DATA,
      condition: CHAT_CONDITION,
      android: { priority: "high" },
    },
  ],
}

const TOPIC = "octochat-octochat-chat-changed-sp-abc"

function render(
  fcm: FcmConfig,
  rawPayload: unknown,
  topic = TOPIC,
): Record<string, unknown>[] {
  const notification: OutgoingNotification = {
    topic,
    sourceTopic: "octochat.chat.changed.sp-abc",
    rawPayload,
    subscription: { name: "chat", topics: ["x"], fcm },
  }
  return renderFcmMessages(notification)
}

const AUTHOR = "a".repeat(32) // a valid 32-char hex userId

describe("renderFcmMessages — octobot signals", () => {
  const octobot = (params?: Record<string, unknown>) =>
    render(OCTOBOT_FCM, params === undefined ? {} : { params })[0]!

  it("forwards productId from the nested params block", () => {
    expect(octobot({ productId: "p1" })).toEqual({
      data: { type: "signals.changed", productId: "p1" },
      android: { priority: "high" },
      apns: {
        headers: { "apns-push-type": "background", "apns-priority": "5" },
        payload: { aps: { "content-available": 1 } },
      },
    })
  })

  it("missing productId degrades to empty string (key still present)", () => {
    expect((octobot().data as Record<string, string>).productId).toBe("")
  })

  it("is a single message", () => {
    expect(render(OCTOBOT_FCM, { params: { productId: "p1" } })).toHaveLength(1)
  })
})

describe("renderFcmMessages — octochat chat", () => {
  const msgs = (params?: Record<string, unknown>, identity?: string) =>
    render(OCTOCHAT_FCM, { ...(params ? { params } : {}), ...(identity ? { identity } : {}) })
  const placeholder = (p?: Record<string, unknown>, id?: string) => msgs(p, id)[0]!
  const upgrade = (p?: Record<string, unknown>, id?: string) => msgs(p, id)[1]!
  const data = (p?: Record<string, unknown>) => placeholder(p).data as Record<string, string>

  it("returns two messages: visible placeholder + data-only upgrade", () => {
    const m = msgs({ spaceId: "sp-abc", roomId: "sp-abc-general" })
    expect(m).toHaveLength(2)
    expect(m[0]!.notification).toEqual({ title: "OctoChat", body: "New message in another room" })
    expect(m[1]!.notification).toBeUndefined()
    expect(m[1]!.apns).toBeUndefined()
    expect(m[1]!.android).toEqual({ priority: "high" })
    expect(m[1]!.data).toBeTruthy()
  })

  it("both messages carry identical routing data", () => {
    const p = { spaceId: "sp-abc", roomId: "sp-abc-general" }
    expect(placeholder(p).data).toEqual(upgrade(p).data)
  })

  it("private chat: forwards roomId, docId empty", () => {
    expect(data({ spaceId: "sp-abc", roomId: "sp-abc-general" })).toEqual({
      type: "chat.changed",
      spaceId: "sp-abc",
      roomId: "sp-abc-general",
      docId: "",
    })
  })

  it("public-space room: forwards docId as room id, roomId empty", () => {
    expect(data({ ownerId: "u1", spaceId: "psp-xyz", docId: "psp-xyz-welcome" })).toEqual({
      type: "chat.changed",
      spaceId: "psp-xyz",
      roomId: "",
      docId: "psp-xyz-welcome",
    })
  })

  it("_rooms registry write is not a room: docId dropped, space kept", () => {
    const d = data({ ownerId: "u1", spaceId: "psp-xyz", docId: "_rooms" })
    expect(d.docId).toBe("")
    expect(d.spaceId).toBe("psp-xyz")
  })

  it("missing params: all ids empty, no grouping keys", () => {
    expect(data()).toEqual({ type: "chat.changed", spaceId: "", roomId: "", docId: "" })
    const p = placeholder()
    expect(p.android).toEqual({ priority: "high" })
    expect(p.apns).toEqual({
      headers: { "apns-push-type": "alert", "apns-priority": "10" },
      payload: { aps: { sound: "default" } },
    })
  })

  it("rawPayload entirely absent degrades, does not throw", () => {
    expect(() => render(OCTOCHAT_FCM, undefined)).not.toThrow()
  })

  it("per-room grouping: android tag + apns thread-id keyed on roomId", () => {
    const p = placeholder({ spaceId: "sp-abc", roomId: "sp-abc-general" })
    expect(p.android).toEqual({ priority: "high", notification: { tag: "sp-abc-general" } })
    expect(p.apns).toEqual({
      headers: { "apns-push-type": "alert", "apns-priority": "10" },
      payload: { aps: { sound: "default", threadId: "sp-abc-general" } },
    })
  })

  it("public-space room groups on docId", () => {
    const p = placeholder({ ownerId: "u1", spaceId: "psp-xyz", docId: "psp-xyz-welcome" })
    expect((p.android as { notification?: { tag?: string } }).notification?.tag).toBe(
      "psp-xyz-welcome",
    )
    expect(
      (p.apns as { payload?: { aps?: { threadId?: string } } }).payload?.aps?.threadId,
    ).toBe("psp-xyz-welcome")
  })

  it("identity present: BOTH messages address an FCM condition excluding the author", () => {
    const [ph, up] = msgs({ spaceId: "sp-abc", roomId: "sp-abc-general" }, AUTHOR)
    const expected = `'${TOPIC}' in topics && !('octochat-user-${AUTHOR}' in topics)`
    expect(ph!.condition).toBe(expected)
    expect(up!.condition).toBe(expected)
    expect((ph!.data as Record<string, string>).roomId).toBe("sp-abc-general")
  })

  it("no identity: no condition on either message (plain topic send)", () => {
    const p = { spaceId: "sp-abc", roomId: "sp-abc-general" }
    expect(placeholder(p).condition).toBeUndefined()
    expect(upgrade(p).condition).toBeUndefined()
  })

  it("malformed identity is ignored (no condition; guards injection)", () => {
    for (const bad of ["", "not-hex", "a".repeat(31), "a".repeat(33), "A".repeat(32), "' in topics || '"]) {
      const [ph, up] = msgs({ spaceId: "sp-abc", roomId: "r" }, bad)
      expect(ph!.condition, `identity=${JSON.stringify(bad)}`).toBeUndefined()
      expect(up!.condition).toBeUndefined()
    }
  })
})

describe("renderFcmMessages — edge cases", () => {
  it("returns [] when the subscription has no fcm config", () => {
    expect(
      renderFcmMessages({ topic: "t", sourceTopic: "s", rawPayload: {} }),
    ).toEqual([])
  })
})

describe("validateConfig — fcm templates", () => {
  const wrap = (fcm: unknown) => ({
    version: 1,
    subscriptions: [{ name: "s", topics: ["a"], fcm }],
  })

  it("accepts the octobot and octochat templates", () => {
    expect(validateConfig(wrap(OCTOBOT_FCM))).toEqual([])
    expect(validateConfig(wrap(OCTOCHAT_FCM))).toEqual([])
  })

  it("rejects fcm without a non-empty messages array", () => {
    expect(validateConfig(wrap({})).some((e) => e.includes("messages"))).toBe(true)
    expect(validateConfig(wrap({ messages: [] })).some((e) => e.includes("messages"))).toBe(true)
  })

  it("rejects a field reference with a non-string field path", () => {
    const bad = { messages: [{ data: { x: { field: 123 } } }] }
    expect(validateConfig(wrap(bad)).some((e) => e.includes("field"))).toBe(true)
  })

  it("rejects an invalid match regex", () => {
    const bad = {
      messages: [{ condition: { condition: { template: "x", vars: { a: { field: "f", match: "(" } } } } }],
    }
    expect(validateConfig(wrap(bad)).some((e) => e.includes("regular expression"))).toBe(true)
  })
})
