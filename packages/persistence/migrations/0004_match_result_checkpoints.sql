-- 0004_match_result_checkpoints — make post-result recovery explicit.
--
-- match_results remains append-only. Filesystem checkpoint state advances in a
-- separate one-row-per-result ledger so a committed score can never be mistaken
-- for a failed result merely because its post-match checkpoint needs retrying.

CREATE TABLE match_result_checkpoints (
  match_result_id INTEGER PRIMARY KEY REFERENCES match_results(id),
  in_game_date    INTEGER NOT NULL,
  state           TEXT    NOT NULL
                  CHECK (state IN ('pending', 'created', 'failed', 'legacy')),
  checkpoint_id   TEXT,
  last_error      TEXT,
  updated_at      INTEGER NOT NULL,
  CHECK (
    (state = 'created' AND checkpoint_id IS NOT NULL AND last_error IS NULL) OR
    (state = 'failed' AND checkpoint_id IS NULL AND last_error IS NOT NULL) OR
    (state = 'pending' AND checkpoint_id IS NULL AND last_error IS NULL) OR
    (state = 'legacy' AND checkpoint_id IS NULL AND last_error IS NOT NULL)
  )
);
CREATE INDEX idx_match_result_checkpoints_state
  ON match_result_checkpoints (state, updated_at);

INSERT INTO match_result_checkpoints (
  match_result_id, in_game_date, state, checkpoint_id, last_error, updated_at
)
SELECT
  match_results.id,
  fixtures.scheduled_date,
  'legacy',
  NULL,
  'Result predates the checkpoint ledger; no historical checkpoint can be reconstructed.',
  match_results.created_at
FROM match_results
JOIN fixtures ON fixtures.id = match_results.fixture_id;
