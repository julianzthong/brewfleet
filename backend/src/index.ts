import { migrate } from './db'
import { onStatus, onTelemetry } from './devices'
import { subscribeDevices } from './mqtt'
import { advanceRollouts, onOtaStatus } from './ota'
import { onReported } from './shadow'
import { app } from './routes'

async function main() {
  await migrate()
  subscribeDevices({
    telemetry: onTelemetry,
    status: onStatus,
    'shadow/reported': onReported,
    'ota/status': onOtaStatus,
  })
  // Drives staged rollouts forward; skips a beat if the previous pass is still running.
  let busy = false
  setInterval(async () => {
    if (busy) return
    busy = true
    try {
      await advanceRollouts()
    } catch (err) {
      console.error('rollout tick failed', err)
    } finally {
      busy = false
    }
  }, 1000)
  app.listen(3000, () => console.log('backend listening on :3000'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
