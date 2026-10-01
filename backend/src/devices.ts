import { pool } from './db'

// Devices are created on first contact, whichever message arrives first.
export async function touchDevice(id: string) {
  await pool.query('INSERT INTO devices (id) VALUES ($1) ON CONFLICT DO NOTHING', [id])
}

// Online/offline, from the device's retained status message or its Last Will. Only applied if
// it was observed at or after the status we already have.
export async function onStatus(id: string, online: boolean, at: Date) {
  await pool.query(
    `INSERT INTO devices (id, online, status_at) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET online = EXCLUDED.online, status_at = EXCLUDED.status_at
       WHERE devices.status_at IS NULL OR devices.status_at <= EXCLUDED.status_at`,
    [id, online, at],
  )
}

export async function onTelemetry(
  id: string,
  msg: { ts: string; waterTempC: number; state: string; firmwareVersion: string },
) {
  await touchDevice(id)
  // Idempotent: (device_id, ts) is the primary key, so a duplicate delivery inserts nothing.
  await pool.query(
    `INSERT INTO telemetry (device_id, ts, water_temp_c, state, firmware_version)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [id, msg.ts, msg.waterTempC, msg.state, msg.firmwareVersion],
  )
  // Out-of-order: only let this message become the "latest" if it is newer than what we have.
  await pool.query(
    `UPDATE devices
        SET last_telemetry_at = $2, water_temp_c = $3, state = $4, firmware_version = $5
      WHERE id = $1 AND (last_telemetry_at IS NULL OR last_telemetry_at < $2)`,
    [id, msg.ts, msg.waterTempC, msg.state, msg.firmwareVersion],
  )
}

const DEVICE_COLUMNS = `id, firmware_version AS "firmwareVersion", online,
  last_telemetry_at AS "lastTelemetryAt", water_temp_c AS "waterTempC", state`

export async function listDevices() {
  const { rows } = await pool.query(`SELECT ${DEVICE_COLUMNS} FROM devices ORDER BY id`)
  return rows
}

export async function getDevice(id: string) {
  const { rows } = await pool.query(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = $1`, [id])
  return rows[0] ?? null
}
