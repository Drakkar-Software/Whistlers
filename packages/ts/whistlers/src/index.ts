// Queue
export type { QueueAdapter, QueueMessage, MessageHandler, TopicSubscription } from "./queue/base.js"
export { MemoryQueueAdapter, CustomQueueAdapter, matchNatsTopic } from "./queue/memory.js"
export { NatsQueueAdapter } from "./queue/nats.js"
export type { NatsQueueAdapterOptions } from "./queue/nats.js"
export { MqttQueueAdapter } from "./queue/mqtt.js"
export type { MqttQueueAdapterOptions } from "./queue/mqtt.js"

// Destination
export type { DestinationAdapter, OutgoingNotification, NotificationPayload } from "./destination/base.js"
export { MemoryDestination } from "./destination/memory.js"
export { FirebaseDestination } from "./destination/firebase.js"
export type { FirebaseDestinationOptions } from "./destination/firebase.js"
export { ClickHouseDestination } from "./destination/clickhouse.js"
export type { ClickHouseDestinationOptions } from "./destination/clickhouse.js"
export { PostgresDestination } from "./destination/postgres.js"
export type { PostgresDestinationOptions } from "./destination/postgres.js"
export { S3Destination } from "./destination/s3.js"
export type { S3DestinationOptions } from "./destination/s3.js"
export { SSEDestination } from "./destination/sse.js"
export type { SSEDestinationOptions, SSEEventInit } from "./destination/sse.js"

// Config
export type { WhistlersConfig, NamespaceConfig, SubscriptionConfig, NotificationTemplate } from "./config/schema.js"
export { validateConfig, assertValidConfig } from "./config/validate.js"
export { createConfig, parseConfigJson } from "./config/loader.js"
export type { CreateConfigOptions } from "./config/loader.js"

// Bridge
export { Whistler, sanitizeTopic } from "./bridge.js"
export type { WhistlerOptions, Logger } from "./bridge.js"
