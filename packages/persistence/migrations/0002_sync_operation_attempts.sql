-- 0002_sync_operation_attempts — durable evidence for every bridge command try.
--
-- The operation row is the current state. Attempts are append-only history, so
-- Sync Doctor can explain whether a command was never collected, acknowledged
-- as applied, failed, or is waiting for post-restart durability verification.

ALTER TABLE sync_operations ADD COLUMN last_attempt_at INTEGER;
ALTER TABLE sync_operations ADD COLUMN observed_json TEXT;
ALTER TABLE sync_operations ADD COLUMN durable_at INTEGER;

CREATE TABLE sync_operation_attempts (
  id              INTEGER PRIMARY KEY,
  operation_id    INTEGER NOT NULL REFERENCES sync_operations(id),
  attempt_number  INTEGER NOT NULL,
  sent_at         INTEGER NOT NULL,
  acknowledged_at INTEGER,
  result          TEXT CHECK (result IN ('applied', 'failed')),
  observed_json   TEXT,
  error           TEXT,
  UNIQUE (operation_id, attempt_number)
);
CREATE INDEX idx_operation_attempts_operation
  ON sync_operation_attempts (operation_id, attempt_number);
