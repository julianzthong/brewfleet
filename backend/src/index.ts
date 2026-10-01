import { migrate } from './db'
import { onStatus, onTelemetry } from './devices'
import { advanceRollouts, onOtaStatus } from './ota'
import { onReported } from './shadow'
import { app } from './routes'
import { transport } from './transport'

async function main() {
  await migrate()
  await transport.start({
    telemetry: onTelemetry,
    status: onStatus,
    reported: onReported,
    otaStatus: onOtaStatus,
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
