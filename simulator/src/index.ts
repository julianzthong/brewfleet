import mqtt from 'mqtt'
import { SimConfig, startDevice } from './device'

const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883'
const COUNT = Number(process.env.DEVICE_COUNT ?? 10)
const TELEMETRY_MS = Number(process.env.TELEMETRY_INTERVAL_MS ?? 5000)

const cfg: SimConfig = {
  otaFailureRate: Number(process.env.OTA_FAILURE_RATE ?? 0),
  otaDelayMs: Number(process.env.OTA_DELAY_MS ?? 3000),
}

const stops = Array.from({ length: COUNT }, (_, i) =>
  startDevice(`brewer-${String(i + 1).padStart(3, '0')}`, MQTT_URL, cfg, TELEMETRY_MS),
)
console.log(`simulating ${COUNT} brewers -> ${MQTT_URL}`, cfg)

// Control channel so the demo can change behaviour live:
//   mosquitto_pub -t sim/config -m '{"otaFailureRate":0.9}'
const control = mqtt.connect(MQTT_URL, { clientId: 'sim-control' })
control.on('connect', () => control.subscribe('sim/config'))
control.on('message', (_topic, payload) => {
  try {
    const patch = JSON.parse(payload.toString())
    if (typeof patch.otaFailureRate === 'number') cfg.otaFailureRate = patch.otaFailureRate
    if (typeof patch.otaDelayMs === 'number') cfg.otaDelayMs = patch.otaDelayMs
    console.log('config updated', cfg)
  } catch {
    console.error('bad sim/config message')
  }
})

process.on('SIGTERM', async () => {
  await Promise.all(stops.map((stop) => stop()))
  process.exit(0)
})
