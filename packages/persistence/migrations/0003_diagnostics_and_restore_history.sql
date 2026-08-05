-- 0003_diagnostics_and_restore_history — make recovery and support auditable.

CREATE TABLE diagnostic_runs (
  id           INTEGER PRIMARY KEY,
  career_id    INTEGER REFERENCES careers(id),
  created_at   INTEGER NOT NULL,
  summary_json TEXT    NOT NULL,
  bundle_path  TEXT
);
CREATE INDEX idx_diagnostic_runs_career
  ON diagnostic_runs (career_id, created_at);

CREATE TABLE restore_history (
  id                  INTEGER PRIMARY KEY,
  career_id           INTEGER REFERENCES careers(id),
  checkpoint_manifest TEXT    NOT NULL,
  restored_at         INTEGER NOT NULL,
  safety_copy_path    TEXT    NOT NULL,
  result              TEXT    NOT NULL CHECK (result IN ('restored', 'failed')),
  error               TEXT
);
CREATE INDEX idx_restore_history_career
  ON restore_history (career_id, restored_at);
