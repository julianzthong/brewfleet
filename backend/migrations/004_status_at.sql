-- When the online/offline status was observed (by the broker/rule, not our clock at processing
-- time). Lets us drop a status message that arrives after a newer one (SQS does not order).
ALTER TABLE devices ADD COLUMN status_at TIMESTAMPTZ;
