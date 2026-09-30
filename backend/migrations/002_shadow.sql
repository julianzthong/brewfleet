-- One row per device, modelled on AWS IoT Device Shadow:
--   desired  = what the cloud wants, bumped (version+1) on every PUT
--   reported = what the device last said it is, tagged with the desired version it had applied
CREATE TABLE device_shadow (
  device_id        TEXT PRIMARY KEY REFERENCES devices(id),
  desired          JSONB   NOT NULL DEFAULT '{}',
  desired_version  INTEGER NOT NULL DEFAULT 0,
  reported         JSONB   NOT NULL DEFAULT '{}',
  reported_version INTEGER NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
