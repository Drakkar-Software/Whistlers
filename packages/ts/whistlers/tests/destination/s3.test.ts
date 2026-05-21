import { describe, it, expect, vi, beforeEach } from "vitest"
import { S3Destination } from "../../src/destination/s3.js"
import type { OutgoingNotification } from "../../src/destination/base.js"

const mockSend = vi.fn().mockResolvedValue({})
const mockDestroy = vi.fn()
// vitest 4 requires constructor mocks to be constructable (regular function / class),
// so these use `function` expressions rather than arrows — both are invoked with `new`.
const MockS3Client = vi.fn(function () {
  return { send: mockSend, destroy: mockDestroy }
})
const MockPutObjectCommand = vi.fn(function (input: unknown) {
  return input
})

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: MockS3Client,
  PutObjectCommand: MockPutObjectCommand,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockSend.mockResolvedValue({})
  MockS3Client.mockImplementation(function () {
    return { send: mockSend, destroy: mockDestroy }
  })
  MockPutObjectCommand.mockImplementation(function (input: unknown) {
    return input
  })
})

function makeNotification(overrides: Partial<OutgoingNotification> = {}): OutgoingNotification {
  return {
    topic: "orders",
    sourceTopic: "orders.created",
    rawPayload: { id: "1" },
    ...overrides,
  }
}

describe("S3Destination", () => {
  it("puts an object in the configured bucket", async () => {
    const dest = new S3Destination({ bucket: "my-bucket" })
    await dest.send(makeNotification())
    expect(MockPutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: "my-bucket" })
    )
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("key starts with the default prefix, includes the topic, and ends with .json", async () => {
    const dest = new S3Destination({ bucket: "my-bucket" })
    await dest.send(makeNotification({ topic: "orders" }))
    const call = MockPutObjectCommand.mock.calls[0]?.[0] as { Key: string }
    expect(call.Key).toMatch(/^whistlers\/orders\/.+\.json$/)
  })

  it("respects a custom prefix", async () => {
    const dest = new S3Destination({ bucket: "my-bucket", prefix: "custom/" })
    await dest.send(makeNotification({ topic: "orders" }))
    const call = MockPutObjectCommand.mock.calls[0]?.[0] as { Key: string }
    expect(call.Key).toMatch(/^custom\/orders\//)
  })

  it("body is valid JSON containing all notification fields", async () => {
    const dest = new S3Destination({ bucket: "my-bucket" })
    await dest.send(
      makeNotification({ notification: { title: "Hi" }, data: { id: "1" }, rawPayload: { x: 2 } })
    )
    const call = MockPutObjectCommand.mock.calls[0]?.[0] as { Body: string }
    const body = JSON.parse(call.Body) as Record<string, unknown>
    expect(body["topic"]).toBe("orders")
    expect(body["sourceTopic"]).toBe("orders.created")
    expect(body["notification"]).toEqual({ title: "Hi" })
    expect(body["data"]).toEqual({ id: "1" })
    expect(body["rawPayload"]).toEqual({ x: 2 })
  })

  it("sets ContentType to application/json by default", async () => {
    const dest = new S3Destination({ bucket: "my-bucket" })
    await dest.send(makeNotification())
    const call = MockPutObjectCommand.mock.calls[0]?.[0] as { ContentType: string }
    expect(call.ContentType).toBe("application/json")
  })

  it("uses a provided S3Client and does not create a new one", async () => {
    const fakeClient = { send: mockSend, destroy: mockDestroy }
    const dest = new S3Destination({
      bucket: "my-bucket",
      client: fakeClient as never,
    })
    await dest.send(makeNotification())
    expect(MockS3Client).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("creates an internal client with the configured region", async () => {
    const dest = new S3Destination({ bucket: "my-bucket", region: "eu-west-1" })
    await dest.send(makeNotification())
    expect(MockS3Client).toHaveBeenCalledWith(expect.objectContaining({ region: "eu-west-1" }))
  })

  it("reuses the same internal client across multiple sends", async () => {
    const dest = new S3Destination({ bucket: "my-bucket" })
    await dest.send(makeNotification())
    await dest.send(makeNotification())
    expect(MockS3Client).toHaveBeenCalledTimes(1)
  })

  it("propagates errors from s3.send", async () => {
    mockSend.mockRejectedValueOnce(new Error("S3 NoSuchBucket"))
    const dest = new S3Destination({ bucket: "my-bucket" })
    await expect(dest.send(makeNotification())).rejects.toThrow("S3 NoSuchBucket")
  })

  it("close() destroys the internally-created client", async () => {
    const dest = new S3Destination({ bucket: "my-bucket" })
    await dest.send(makeNotification())
    await dest.close()
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })

  it("close() does not destroy an externally-provided client", async () => {
    const fakeClient = { send: mockSend, destroy: mockDestroy }
    const dest = new S3Destination({ bucket: "my-bucket", client: fakeClient as never })
    await dest.send(makeNotification())
    await dest.close()
    expect(mockDestroy).not.toHaveBeenCalled()
  })

  it("close() does nothing when never connected", async () => {
    const dest = new S3Destination({ bucket: "my-bucket" })
    await expect(dest.close()).resolves.toBeUndefined()
    expect(mockDestroy).not.toHaveBeenCalled()
  })

  it("format callback string result: body used as-is, ContentType is text/plain, no .json extension", async () => {
    const format = vi.fn().mockReturnValue("custom content")
    const dest = new S3Destination({ bucket: "my-bucket", format })
    await dest.send(makeNotification())
    expect(format).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "orders",
        sourceTopic: "orders.created",
        rawPayload: { id: "1" },
      })
    )
    const call = MockPutObjectCommand.mock.calls[0]?.[0] as {
      Body: string
      ContentType: string
      Key: string
    }
    expect(call.Body).toBe("custom content")
    expect(call.ContentType).toBe("text/plain")
    expect(call.Key).not.toMatch(/\.json$/)
  })

  it("format callback object result: body is JSON-serialised, ContentType is application/json, key ends with .json", async () => {
    const format = vi.fn().mockReturnValue({ custom: "data" })
    const dest = new S3Destination({ bucket: "my-bucket", format })
    await dest.send(makeNotification())
    const call = MockPutObjectCommand.mock.calls[0]?.[0] as {
      Body: string
      ContentType: string
      Key: string
    }
    expect(call.Body).toBe(JSON.stringify({ custom: "data" }))
    expect(call.ContentType).toBe("application/json")
    expect(call.Key).toMatch(/\.json$/)
  })

  it("propagates errors thrown by format callback", async () => {
    const format = vi.fn().mockImplementation(() => {
      throw new Error("formatter crashed")
    })
    const dest = new S3Destination({ bucket: "my-bucket", format })
    await expect(dest.send(makeNotification())).rejects.toThrow("formatter crashed")
  })
})
