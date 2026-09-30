import mqtt from 'mqtt'

// Settings shared by all devices; index.ts mutates failureRate when sim/config arrives.
export interface SimConfig {
  otaFailureRate: number
  otaDelayMs: number
}

type BrewState = 'idle' | 'heating' | 'brewing'
interface OtaResult { jobId: string; status: 'SUCCEEDED' | 'FAILED'; version: string }

const AMBIENT_C = 20
const BREW_TICKS = 2 // a brew lasts 2 telemetry intervals

export function startDevice(id: string, mqttUrl: string, cfg: SimConfig, telemetryMs: number) {
  // --- device state (all in memory; a restart resets it, like a power cycle) ---
  let firmwareVersion = '1.0.0'
  let waterTempC = AMBIENT_C
  let targetTempC = AMBIENT_C
  let brewRecipe: string | null = null
  let brewTicksLeft = 0
  let appliedVersion = 0                       // highest shadow version applied so far
  const otaResults = new Map<string, OtaResult>() // jobId -> finished result, for duplicate jobs
  const otaInFlight = new Set<string>()

  const t = (suffix: string) => `devices/${id}/${suffix}`

  // Last Will: the broker publishes this if we vanish without a clean disconnect.
  const client = mqtt.connect(mqttUrl, {
    clientId: `sim-${id}`,
    keepalive: 10, // broker declares us dead after ~1.5x this
    will: { topic: t('status'), payload: JSON.stringify({ online: false }), qos: 1, retain: true },
  })

  const publish = (suffix: string, body: object, retain = false) =>
    client.publish(t(suffix), JSON.stringify(body), { qos: 1, retain })

  // 'connect' fires on every (re)connect; the session is clean so we resubscribe each time.
  client.on('connect', () => {
    client.subscribe([t('shadow/desired'), t('ota')], { qos: 1 })
    publish('status', { online: true }, true)
    publishReported()
  })
  client.on('error', (err) => console.error(`[${id}]`, err.message))

  // --- shadow: apply desired, report back ---
  function publishReported() {
    publish('shadow/reported', { version: appliedVersion, state: { targetTempC, brewRecipe } })
  }

  function onDesired(msg: { version: number; state: { targetTempC?: number; brewRecipe?: string | null } }) {
    if (msg.version < appliedVersion) return // stale/out-of-order: ignore
    // version == appliedVersion is a duplicate: re-applying is harmless, and we re-ack below.
    const { targetTempC: target, brewRecipe: recipe } = msg.state
    if (target !== undefined) targetTempC = target
    if (recipe !== undefined) {
      if (recipe !== null && recipe !== brewRecipe) brewTicksLeft = BREW_TICKS // new recipe -> brew
      brewRecipe = recipe
    }
    appliedVersion = msg.version
    publishReported()
  }

  // --- OTA: "download", then succeed or fail per the configured failure rate ---
  function onOta(job: { jobId: string; version: string }) {
    const done = otaResults.get(job.jobId)
    if (done) return publish('ota/status', done) // duplicate of a finished job: re-send result
    if (otaInFlight.has(job.jobId)) return       // duplicate of a running job: ignore
    otaInFlight.add(job.jobId)
    publish('ota/status', { jobId: job.jobId, status: 'IN_PROGRESS', version: job.version })
    setTimeout(() => {
      const ok = Math.random() >= cfg.otaFailureRate
      if (ok) firmwareVersion = job.version
      const result: OtaResult = { jobId: job.jobId, status: ok ? 'SUCCEEDED' : 'FAILED', version: job.version }
      otaResults.set(job.jobId, result)
      otaInFlight.delete(job.jobId)
      publish('ota/status', result)
    }, cfg.otaDelayMs)
  }

  client.on('message', (topic, payload) => {
    try {
      const msg = JSON.parse(payload.toString())
      if (topic === t('shadow/desired')) onDesired(msg)
      else if (topic === t('ota')) onOta(msg)
    } catch (err) {
      console.error(`[${id}] bad message on ${topic}`)
    }
  })

  // --- telemetry loop: tiny thermal model, then publish ---
  const timer = setInterval(() => {
    let state: BrewState
    if (brewTicksLeft > 0) {
      state = 'brewing'
      brewTicksLeft--
    } else if (waterTempC < targetTempC) {
      state = 'heating'
      waterTempC = Math.min(targetTempC, waterTempC + 15)
    } else {
      state = 'idle'
      waterTempC = Math.max(targetTempC, waterTempC - 5) // cool toward target
    }
    publish('telemetry', { ts: new Date().toISOString(), waterTempC, state, firmwareVersion })
  }, telemetryMs)

  // A clean disconnect does NOT fire the will, so say goodbye ourselves on SIGTERM.
  return async function stop() {
    clearInterval(timer)
    await client.publishAsync(t('status'), JSON.stringify({ online: false }), { qos: 1, retain: true })
    await client.endAsync()
  }
}
