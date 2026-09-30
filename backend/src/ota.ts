import { pool, withTx } from './db'
import { publish } from './mqtt'

const STAGE_TIMEOUT_MS = Number(process.env.OTA_STAGE_TIMEOUT_MS ?? 30000)
const TERMINAL = ['SUCCEEDED', 'FAILED', 'TIMED_OUT']
const FAILURES = ['FAILED', 'TIMED_OUT']

interface Rollout {
  id: string
  target_version: string
  stages: number[]
  failure_threshold_pct: number
  cohort: string[]
  current_stage: number
  stage_started_at: Date
}
type Job = { id: string; device_id: string }

export function validateRollout(body: any): string | null {
  if (typeof body?.targetVersion !== 'string' || !body.targetVersion) return 'targetVersion must be a non-empty string'
  const stages = body.stages
  if (!Array.isArray(stages) || stages.length === 0) return 'stages must be a non-empty array'
  if (!stages.every((p, i) => Number.isInteger(p) && p > 0 && p <= 100 && (i === 0 || p > stages[i - 1])))
    return 'stages must be strictly increasing integers in 1..100'
  const t = body.failureThresholdPct
  if (typeof t !== 'number' || t < 0 || t > 100) return 'failureThresholdPct must be a number 0-100'
  return null
}

// Devices belonging to `stage` = the slice of the cohort between the previous stage's
// cumulative percentage and this stage's (percentages are cumulative, rounded up).
function devicesForStage(r: Rollout, stage: number) {
  const upTo = (pct: number) => Math.ceil((r.cohort.length * pct) / 100)
  return r.cohort.slice(stage === 0 ? 0 : upTo(r.stages[stage - 1]), upTo(r.stages[stage]))
}

// Writes the job rows (inside the caller's transaction); publishing happens after commit.
async function insertJobs(tx: { query: typeof pool.query }, r: Rollout, stage: number): Promise<Job[]> {
  const devices = devicesForStage(r, stage)
  if (devices.length === 0) return []
  const { rows } = await tx.query(
    `INSERT INTO ota_jobs (rollout_id, device_id, stage)
     SELECT $1, unnest($2::text[]), $3
     ON CONFLICT (rollout_id, device_id) DO NOTHING
     RETURNING id, device_id`,
    [r.id, devices, stage],
  )
  return rows
}

function sendJobs(r: Rollout, jobs: Job[]) {
  return Promise.all(
    jobs.map((j) => publish(`devices/${j.device_id}/ota`, { jobId: j.id, version: r.target_version })),
  )
}

export async function createRollout(targetVersion: string, stages: number[], failureThresholdPct: number) {
  const online = await pool.query('SELECT id FROM devices WHERE online ORDER BY id')
  if (online.rowCount === 0) return null
  const { rollout, jobs } = await withTx(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO ota_rollouts (target_version, stages, failure_threshold_pct, cohort)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [targetVersion, stages, failureThresholdPct, online.rows.map((d) => d.id)],
    )
    return { rollout: rows[0] as Rollout, jobs: await insertJobs(tx, rows[0], 0) }
  })
  await sendJobs(rollout, jobs)
  return rollout.id
}

// MQTT handler for devices/{id}/ota/status. A job only moves forward: once it is terminal,
// duplicates and late/out-of-order messages (e.g. IN_PROGRESS after SUCCEEDED) change nothing.
export async function onOtaStatus(deviceId: string, msg: { jobId: string; status: string }) {
  if (!['IN_PROGRESS', 'SUCCEEDED', 'FAILED'].includes(msg.status)) return
  await pool.query(
    `UPDATE ota_jobs SET status = $3, updated_at = now()
      WHERE id = $1 AND device_id = $2 AND status <> ALL($4)`,
    [msg.jobId, deviceId, msg.status, TERMINAL],
  )
}

// Called on a timer. All progress is derived from the database, so there is no in-memory
// state to lose: a backend restart simply picks the running rollouts up again.
export async function advanceRollouts() {
  const { rows } = await pool.query("SELECT * FROM ota_rollouts WHERE status = 'RUNNING'")
  for (const r of rows as Rollout[]) await advance(r)
}

async function advance(r: Rollout) {
  const pending = await pool.query(
    'SELECT 1 FROM ota_jobs WHERE rollout_id = $1 AND stage = $2 AND status <> ALL($3)',
    [r.id, r.current_stage, TERMINAL],
  )
  if (pending.rowCount) {
    if (Date.now() - r.stage_started_at.getTime() < STAGE_TIMEOUT_MS) return // still waiting
    await pool.query(
      `UPDATE ota_jobs SET status = 'TIMED_OUT', updated_at = now()
        WHERE rollout_id = $1 AND stage = $2 AND status <> ALL($3)`,
      [r.id, r.current_stage, TERMINAL],
    )
  }

  // Stage finished. Failure rate is cumulative over every job dispatched so far.
  const { failed, total } = await counts(r.id)
  const failurePct = total === 0 ? 0 : (failed / total) * 100
  const isLast = r.current_stage === r.stages.length - 1
  const finish = (status: string) =>
    pool.query("UPDATE ota_rollouts SET status = $2 WHERE id = $1 AND status = 'RUNNING'", [r.id, status])

  if (failurePct > r.failure_threshold_pct) {
    console.log(`rollout ${r.id} ABORTED: ${failurePct}% failed > ${r.failure_threshold_pct}%`)
    return void (await finish('ABORTED'))
  }
  if (isLast) {
    console.log(`rollout ${r.id} COMPLETED`)
    return void (await finish('COMPLETED'))
  }

  // Move to the next stage. The stage bump and its job rows commit together; the
  // `current_stage = $2` guard makes a repeated call for the same stage a no-op.
  const next = r.current_stage + 1
  const jobs = await withTx(async (tx) => {
    const moved = await tx.query(
      `UPDATE ota_rollouts SET current_stage = $3, stage_started_at = now()
        WHERE id = $1 AND current_stage = $2 AND status = 'RUNNING'`,
      [r.id, r.current_stage, next],
    )
    return moved.rowCount ? insertJobs(tx, r, next) : []
  })
  console.log(`rollout ${r.id} -> stage ${next} (${r.stages[next]}%), ${jobs.length} devices`)
  await sendJobs(r, jobs)
}

async function counts(rolloutId: string) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = ANY($2))::int AS failed,
            count(*) FILTER (WHERE status = 'SUCCEEDED')::int AS succeeded
       FROM ota_jobs WHERE rollout_id = $1`,
    [rolloutId, FAILURES],
  )
  return rows[0] as { total: number; failed: number; succeeded: number }
}

export async function getRollout(id: string) {
  const { rows } = await pool.query(
    `SELECT id, target_version AS "targetVersion", stages, failure_threshold_pct AS "failureThresholdPct",
            status, current_stage AS "currentStage", created_at AS "createdAt"
       FROM ota_rollouts WHERE id = $1`,
    [id],
  )
  if (!rows[0]) return null
  const { total, failed, succeeded } = await counts(id)
  const jobs = await pool.query(
    'SELECT device_id AS "deviceId", stage, status FROM ota_jobs WHERE rollout_id = $1 ORDER BY stage, device_id',
    [id],
  )
  return {
    ...rows[0],
    progress: { total, succeeded, failed, failurePct: total ? (failed / total) * 100 : 0 },
    jobs: jobs.rows,
  }
}
