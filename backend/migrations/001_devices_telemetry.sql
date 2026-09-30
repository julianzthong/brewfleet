CREATE TABLE devices (
  id                TEXT PRIMARY KEY,
  firmware_version  TEXT,
  online            BOOLEAN NOT NULL DEFAULT FALSE,
  -- Latest telemetry snapshot. last_telemetry_at is the device-side timestamp of that
  -- snapshot; we only overwrite when a newer one arrives (out-of-order protection).
  last_telemetry_at TIMESTAMPTZ,
  water_temp_c      REAL,
  state             TEXT
);

CREATE TABLE telemetry (
  device_id        TEXT NOT NULL REFERENCES devices(id),
  ts               TIMESTAMPTZ NOT NULL,   -- device-side timestamp
  water_temp_c     REAL NOT NULL,
  state            TEXT NOT NULL,
  firmware_version TEXT NOT NULL,
  PRIMARY KEY (device_id, ts)              -- a redelivered message hits this and is skipped
);
