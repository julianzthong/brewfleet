import { DeviceEvents } from './types'

// The topic convention shared by devices and both transports.
export const topics = {
  desired: (id: string) => `devices/${id}/shadow/desired`,
  ota: (id: string) => `devices/${id}/ota`,
}

// Topic suffixes (after devices/{id}/) that devices publish and the backend consumes.
export const INBOUND_SUFFIXES = ['telemetry', 'status', 'shadow/reported', 'ota/status']

// Turns one inbound device message into a DeviceEvents call. Shared by every transport
// that carries our topics; unknown topics are ignored. `receivedAt` is when the message
// hit the broker/rule (not when we processed it), used to order status changes.
export async function routeInbound(topic: string, body: any, receivedAt: Date, events: DeviceEvents) {
  const match = topic.match(/^devices\/([^/]+)\/(.+)$/)
  if (!match) return
  const [, id, suffix] = match
  switch (suffix) {
    case 'telemetry': return events.telemetry(id, body)
    case 'status': return events.status(id, Boolean(body.online), receivedAt)
    case 'shadow/reported': return events.reported(id, body)
    case 'ota/status': return events.otaStatus(id, body)
  }
}
