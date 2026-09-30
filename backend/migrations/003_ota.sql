CREATE TABLE ota_rollouts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_version        TEXT NOT NULL,
  stages                INTEGER[] NOT NULL,   -- e.g. {10,50,100}: cumulative % of the cohort
  failure_threshold_pct REAL NOT NULL,
  cohort                TEXT[] NOT NULL,      -- device ids fixed at creation, in rollout order
  status                TEXT NOT NULL DEFAULT 'RUNNING',   -- RUNNING | COMPLETED | ABORTED
  current_stage         INTEGER NOT NULL DEFAULT 0,        -- index into stages
  stage_started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One job per device per rollout (the UNIQUE constraint makes dispatch idempotent).
CREATE TABLE ota_jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- this is the jobId sent to the device
  rollout_id UUID NOT NULL REFERENCES ota_rollouts(id),
  device_id  TEXT NOT NULL REFERENCES devices(id),
  stage      INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'QUEUED',   -- QUEUED | IN_PROGRESS | SUCCEEDED | FAILED | TIMED_OUT
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rollout_id, device_id)
);
