import { pool } from './db'
import { touchDevice } from './devices'
import { publish } from './mqtt'

type Fields = Record<string, unknown>

// delta = the desired fields whose value the device has not reported yet.
export function computeDelta(desired: Fields, reported: Fields): Fields {
  const delta: Fields = {}
  for (const [key, value] of Object.entries(desired)) {
    if (JSON.stringify(value) !== JSON.stringify(reported[key])) delta[key] = value
  }
  return delta
}

// Returns an error message, or null if the patch is acceptable.
export function validateDesired(body: any): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'body must be a JSON object'
  const keys = Object.keys(body)
  if (keys.length === 0) return 'body is empty'
  for (const key of keys) {
    if (key === 'targetTempC') {
      if (typeof body[key] !== 'number' || body[key] < 0 || body[key] > 100) return 'targetTempC must be a number 0-100'
    } else if (key === 'brewRecipe') {
      if (body[key] !== null && typeof body[key] !== 'string') return 'brewRecipe must be a string or null'
    } else {
      return `unknown field: ${key}`
    }
  }
  return null
}

export async function getShadow(id: string) {
  const { rows } = await pool.query(
    `SELECT desired, desired_version AS "desiredVersion", reported, reported_version AS "reportedVersion"
       FROM device_shadow WHERE device_id = $1`,
    [id],
  )
  const s = rows[0] ?? { desired: {}, desiredVersion: 0, reported: {}, reportedVersion: 0 }
  return { ...s, delta: computeDelta(s.desired, s.reported) }
}

// Merge the patch into desired, bump the version, and push the full desired state to the device.
// Retained, so a device that is offline (or restarts) still gets the latest desired on connect.
export async function setDesired(id: string, patch: Fields) {
  const { rows } = await pool.query(
    `INSERT INTO device_shadow (device_id, desired, desired_version) VALUES ($1, $2, 1)
     ON CONFLICT (device_id) DO UPDATE
       SET desired = device_shadow.desired || EXCLUDED.desired,
           desired_version = device_shadow.desired_version + 1,
           updated_at = now()
     RETURNING desired, desired_version AS version`,
    [id, patch],
  )
  await publish(`devices/${id}/shadow/desired`, { version: rows[0].version, state: rows[0].desired }, true)
}

// The device echoes the desired version it applied. Older versions are dropped, so a
// delayed or duplicated report can never roll reported state backwards.
export async function onReported(id: string, msg: { version: number; state: Fields }) {
  await touchDevice(id)
  await pool.query(
    `INSERT INTO device_shadow (device_id, reported, reported_version) VALUES ($1, $2, $3)
     ON CONFLICT (device_id) DO UPDATE
       SET reported = EXCLUDED.reported, reported_version = EXCLUDED.reported_version, updated_at = now()
       WHERE device_shadow.reported_version <= EXCLUDED.reported_version`,
    [id, msg.state, msg.version],
  )
}
