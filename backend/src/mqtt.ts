import mqtt from 'mqtt'

// A handler gets the device id (from the topic) and the parsed JSON payload.
export type Handler = (deviceId: string, payload: any) => Promise<void>

const client = mqtt.connect(process.env.MQTT_URL ?? 'mqtt://localhost:1883', { clientId: 'brewfleet-backend' })

export function publish(topic: string, body: object, retain = false) {
  return client.publishAsync(topic, JSON.stringify(body), { qos: 1, retain })
}

// handlers is keyed by the topic suffix after devices/{id}/, e.g. 'telemetry' or 'ota/status'.
export function subscribeDevices(handlers: Record<string, Handler>) {
  const subscribe = () => {
    console.log('mqtt subscribing')
    client.subscribe(Object.keys(handlers).map((suffix) => `devices/+/${suffix}`), { qos: 1 })
  }
  client.on('connect', subscribe) // every (re)connect: our session is clean
  if (client.connected) subscribe() // we may already be connected (migrations ran first)
  client.on('error', (err) => console.error('mqtt error', err.message))

  client.on('message', async (topic, raw) => {
    const match = topic.match(/^devices\/([^/]+)\/(.+)$/)
    const handler = match && handlers[match[2]]
    if (!handler) return
    try {
      await handler(match[1], JSON.parse(raw.toString()))
    } catch (err) {
      // A bad message must never take the backend down.
      console.error(`failed handling ${topic}:`, err)
    }
  })
}
