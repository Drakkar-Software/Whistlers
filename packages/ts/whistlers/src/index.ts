// Queue
export type { QueueAdapter, QueueMessage, MessageHandler } from "./queue/base.js"
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

// Config
export type { WhistlersConfig, SubscriptionConfig, NotificationTemplate } from "./config/schema.js"
export { validateConfig, assertValidConfig } from "./config/validate.js"
export { parseConfigJson, createConfig } from "./config/loader.js"
export type { CreateConfigOptions } from "./config/loader.js"

// Bridge
export { Whistler, sanitizeTopic } from "./bridge.js"
export type { WhistlerOptions, Logger } from "./bridge.js"
