import mqtt from 'mqtt'
import { INBOUND_SUFFIXES, routeInbound, topics } from './topics'
import { DeviceEvents, Fields, Transport } from './types'

export class MosquittoTransport implements Transport {
  private client!: mqtt.MqttClient

  constructor(private url: string) {}

  async start(events: DeviceEvents) {
    this.client = mqtt.connect(this.url, { clientId: 'brewfleet-backend' })
    // Clean session, so subscribe on every (re)connect.
    this.client.on('connect', () =>
      this.client.subscribe(INBOUND_SUFFIXES.map((s) => `devices/+/${s}`), { qos: 1 }),
    )
    this.client.on('error', (err) => console.error('mqtt error', err.message))
    this.client.on('message', async (topic, raw) => {
      try {
        await routeInbound(topic, JSON.parse(raw.toString()), new Date(), events)
      } catch (err) {
        // A bad message must never take the backend down.
        console.error(`failed handling ${topic}:`, err)
      }
    })
    await new Promise<void>((resolve) => this.client.once('connect', () => resolve()))
    console.log('mosquitto transport connected')
  }

  // Retained: the broker keeps the latest, so an offline or restarted device gets it on connect.
  setDesired(id: string, version: number, state: Fields) {
    return this.publish(topics.desired(id), { version, state }, true)
  }

  dispatchOta(id: string, job: { jobId: string; version: string }) {
    return this.publish(topics.ota(id), job)
  }

  private publish(topic: string, body: object, retain = false) {
    return this.client.publishAsync(topic, JSON.stringify(body), { qos: 1, retain }).then(() => {})
  }
}
