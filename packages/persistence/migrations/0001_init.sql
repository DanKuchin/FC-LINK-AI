-- 0001_init — the initial career schema.
--
-- Conventions:
--   · dates are integers (days since 1970-01-01) so ordering and arithmetic are trivial
--   · timestamps are integer epoch milliseconds
--   · money is signed integer minor units; balances are never stored, only summed
--   · tables marked APPEND ONLY are never UPDATEd or DELETEd by application code
--
-- Two invariants are enforced by the schema itself rather than by application
-- code, because an invariant the database keeps cannot be forgotten:
--   · a player may hold at most one active permanent contract
--   · a simulation event key is unique per career (this is what makes replay safe)

-- ═══════════════════════════════════════════ identity ═══
CREATE TABLE careers (
  id                INTEGER PRIMARY KEY,
  name              TEXT    NOT NULL,
  save_uid          TEXT    NOT NULL UNIQUE,   -- FC GetSaveUID(); the anchor for all mapping
  master_seed       TEXT    NOT NULL,          -- root of determinism
  current_date      INTEGER NOT NULL,
  tick_index        INTEGER NOT NULL DEFAULT 0,
  managed_club_id   INTEGER REFERENCES clubs(id),
  schema_version    INTEGER NOT NULL,
  game_build        TEXT,
  le_version        TEXT,
  sync_mode         TEXT    NOT NULL DEFAULT 'connected'
                    CHECK (sync_mode IN ('connected', 'offline', 'unsynced')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- ═══════════════════════════════════════════ world ═══
CREATE TABLE seasons (
  id          INTEGER PRIMARY KEY,
  career_id   INTEGER NOT NULL REFERENCES careers(id),
  start_year  INTEGER NOT NULL,
  end_year    INTEGER NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('upcoming', 'active', 'complete')),
  UNIQUE (career_id, start_year)
);

CREATE TABLE competitions (
  id           INTEGER PRIMARY KEY,
  career_id    INTEGER NOT NULL REFERENCES careers(id),
  name         TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('league', 'cup', 'continental', 'other')),
  country      TEXT,
  tier         INTEGER,
  reputation   INTEGER NOT NULL DEFAULT 50,
  fidelity     TEXT    NOT NULL DEFAULT 'shallow'
               CHECK (fidelity IN ('deep', 'medium', 'shallow')),
  UNIQUE (career_id, name)
);

CREATE TABLE clubs (
  id                     INTEGER PRIMARY KEY,
  career_id              INTEGER NOT NULL REFERENCES careers(id),
  name                   TEXT    NOT NULL,
  short_name             TEXT,
  competition_id         INTEGER REFERENCES competitions(id),
  reputation             INTEGER NOT NULL DEFAULT 50,
  strength               REAL    NOT NULL DEFAULT 0,
  fidelity               TEXT    NOT NULL DEFAULT 'shallow'
                         CHECK (fidelity IN ('deep', 'medium', 'shallow')),
  recruitment_philosophy TEXT,
  wage_structure_tier    INTEGER,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);
CREATE INDEX idx_clubs_career_comp ON clubs (career_id, competition_id);

CREATE TABLE players (
  id                  INTEGER PRIMARY KEY,
  career_id           INTEGER NOT NULL REFERENCES careers(id),
  club_id             INTEGER REFERENCES clubs(id),
  first_name          TEXT,
  last_name           TEXT,
  known_as            TEXT,
  birth_date          INTEGER NOT NULL,
  nationality         TEXT,
  primary_position    TEXT    NOT NULL,
  secondary_positions TEXT,                     -- comma-separated; read rarely, never joined
  current_ability     INTEGER,
  potential_low       INTEGER,
  potential_high      INTEGER,
  status              TEXT    NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'retired', 'released')),
  origin              TEXT    NOT NULL DEFAULT 'imported'
                      CHECK (origin IN ('imported', 'generated', 'youth')),
  deleted_at          INTEGER,                  -- soft delete: history must stay queryable
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_players_club ON players (career_id, club_id) WHERE deleted_at IS NULL;

-- Narrow and hot: rewritten far more often than the wide players row.
CREATE TABLE player_attributes (
  player_id   INTEGER PRIMARY KEY REFERENCES players(id),
  fitness     INTEGER NOT NULL DEFAULT 100,
  sharpness   INTEGER NOT NULL DEFAULT 50,
  form        INTEGER NOT NULL DEFAULT 50,
  morale      INTEGER NOT NULL DEFAULT 65,
  match_load  INTEGER NOT NULL DEFAULT 0,
  injury_risk REAL    NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

-- Five traits, each of which must be visible in some explanation string.
CREATE TABLE player_personalities (
  player_id       INTEGER PRIMARY KEY REFERENCES players(id),
  professionalism INTEGER NOT NULL,
  ambition        INTEGER NOT NULL,
  loyalty         INTEGER NOT NULL,
  consistency     INTEGER NOT NULL,
  pressure        INTEGER NOT NULL,
  seed            TEXT    NOT NULL   -- derivation seed: regeneratable and auditable
);

CREATE TABLE staff (
  id         INTEGER PRIMARY KEY,
  career_id  INTEGER NOT NULL REFERENCES careers(id),
  club_id    INTEGER REFERENCES clubs(id),
  name       TEXT    NOT NULL,
  role       TEXT    NOT NULL CHECK (role IN ('coach', 'scout', 'physio', 'analyst')),
  judgement  INTEGER,
  specialism TEXT,
  region     TEXT,
  bias       TEXT
);
CREATE INDEX idx_staff_club ON staff (career_id, club_id, role);

-- ═══════════════════════════════════════════ contracts & promises ═══
CREATE TABLE contracts (
  id                INTEGER PRIMARY KEY,
  career_id         INTEGER NOT NULL REFERENCES careers(id),
  player_id         INTEGER NOT NULL REFERENCES players(id),
  club_id           INTEGER NOT NULL REFERENCES clubs(id),
  kind              TEXT    NOT NULL CHECK (kind IN ('permanent', 'loan', 'youth')),
  wage              INTEGER NOT NULL DEFAULT 0,
  wage_is_estimated INTEGER NOT NULL DEFAULT 0,
  start_date        INTEGER NOT NULL,
  end_date          INTEGER NOT NULL,
  squad_role        TEXT,
  release_clause    INTEGER,
  status            TEXT    NOT NULL CHECK (status IN ('active', 'expired', 'terminated')),
  external_source   TEXT    NOT NULL DEFAULT 'companion'
                    CHECK (external_source IN ('fc', 'companion'))
);
CREATE UNIQUE INDEX uq_contract_active_permanent
  ON contracts (player_id) WHERE status = 'active' AND kind = 'permanent';
CREATE INDEX idx_contracts_expiry ON contracts (career_id, status, end_date);

-- APPEND ONLY. A promise never changes; a new row supersedes the old one.
CREATE TABLE promises (
  id              INTEGER PRIMARY KEY,
  career_id       INTEGER NOT NULL REFERENCES careers(id),
  made_to_type    TEXT    NOT NULL,
  made_to_id      INTEGER NOT NULL,
  kind            TEXT    NOT NULL,
  terms_json      TEXT    NOT NULL,
  made_on         INTEGER NOT NULL,
  due_on          INTEGER,
  state           TEXT    NOT NULL
                  CHECK (state IN ('open', 'kept', 'broken', 'expired', 'renegotiated')),
  resolved_on     INTEGER,
  supersedes_id   INTEGER REFERENCES promises(id),
  source_event_id INTEGER REFERENCES sim_events(id)
);
CREATE INDEX idx_promises_open ON promises (career_id, state, due_on);

-- ═══════════════════════════════════════════ board ═══
CREATE TABLE board_members (
  id             INTEGER PRIMARY KEY,
  career_id      INTEGER NOT NULL REFERENCES careers(id),
  club_id        INTEGER NOT NULL REFERENCES clubs(id),
  name           TEXT    NOT NULL,
  role           TEXT    NOT NULL
                 CHECK (role IN ('chair', 'sporting_director', 'finance_director',
                                 'owner', 'academy_director')),
  patience       INTEGER NOT NULL,
  trust          INTEGER NOT NULL,
  priorities_json TEXT   NOT NULL,
  authority_json  TEXT   NOT NULL,
  voice          TEXT    NOT NULL
);
CREATE INDEX idx_board_club ON board_members (career_id, club_id);

CREATE TABLE board_objectives (
  id          INTEGER PRIMARY KEY,
  career_id   INTEGER NOT NULL REFERENCES careers(id),
  season_id   INTEGER NOT NULL REFERENCES seasons(id),
  set_by      INTEGER REFERENCES board_members(id),
  kind        TEXT    NOT NULL,
  target_json TEXT    NOT NULL,
  weight      REAL    NOT NULL DEFAULT 1,
  negotiated  INTEGER NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL CHECK (status IN ('open', 'met', 'failed', 'revised'))
);

-- ═══════════════════════════════════════════ calendar & matches ═══
CREATE TABLE fixtures (
  id                  INTEGER PRIMARY KEY,
  career_id           INTEGER NOT NULL REFERENCES careers(id),
  season_id           INTEGER NOT NULL REFERENCES seasons(id),
  competition_id      INTEGER NOT NULL REFERENCES competitions(id),
  home_club_id        INTEGER NOT NULL REFERENCES clubs(id),
  away_club_id        INTEGER NOT NULL REFERENCES clubs(id),
  scheduled_date      INTEGER NOT NULL,
  stage               TEXT,
  status              TEXT    NOT NULL
                      CHECK (status IN ('scheduled', 'user_pending', 'played', 'simulated')),
  external_fixture_id INTEGER,
  UNIQUE (career_id, season_id, competition_id, home_club_id, away_club_id, scheduled_date)
);
CREATE INDEX idx_fixtures_date ON fixtures (career_id, scheduled_date);

-- APPEND ONLY.
CREATE TABLE match_results (
  id                 INTEGER PRIMARY KEY,
  fixture_id         INTEGER NOT NULL UNIQUE REFERENCES fixtures(id),
  home_goals         INTEGER NOT NULL,
  away_goals         INTEGER NOT NULL,
  home_pens          INTEGER,
  away_pens          INTEGER,
  provenance         TEXT    NOT NULL
                     CHECK (provenance IN ('fc_sync', 'user_entered', 'simulated')),
  confirmed_by_user  INTEGER NOT NULL DEFAULT 0,
  snapshot_before_id INTEGER REFERENCES sync_snapshots(id),
  snapshot_after_id  INTEGER REFERENCES sync_snapshots(id),
  created_at         INTEGER NOT NULL
);

-- APPEND ONLY. Derived by diffing snapshots; there is no per-match source in FC.
CREATE TABLE player_match_stats (
  id              INTEGER PRIMARY KEY,
  match_result_id INTEGER NOT NULL REFERENCES match_results(id),
  player_id       INTEGER NOT NULL REFERENCES players(id),
  appearances     INTEGER NOT NULL DEFAULT 0,
  goals           INTEGER NOT NULL DEFAULT 0,
  assists         INTEGER NOT NULL DEFAULT 0,
  yellow          INTEGER NOT NULL DEFAULT 0,
  red             INTEGER NOT NULL DEFAULT 0,
  clean_sheet     INTEGER NOT NULL DEFAULT 0,
  rating          REAL,
  derivation      TEXT    NOT NULL CHECK (derivation IN ('snapshot_diff', 'user_entered')),
  confidence      REAL    NOT NULL DEFAULT 1.0,
  UNIQUE (match_result_id, player_id)
);

-- ═══════════════════════════════════════════ market ═══
CREATE TABLE transfer_negotiations (
  id            INTEGER PRIMARY KEY,
  career_id     INTEGER NOT NULL REFERENCES careers(id),
  player_id     INTEGER NOT NULL REFERENCES players(id),
  from_club_id  INTEGER REFERENCES clubs(id),
  to_club_id    INTEGER REFERENCES clubs(id),
  state         TEXT    NOT NULL,
  opened_on     INTEGER NOT NULL,
  deadline      INTEGER,
  history_json  TEXT    NOT NULL DEFAULT '[]',
  closed_on     INTEGER,
  outcome       TEXT
);
CREATE INDEX idx_neg_open ON transfer_negotiations (career_id, state);

-- APPEND ONLY.
CREATE TABLE transfer_transactions (
  id                INTEGER PRIMARY KEY,
  career_id         INTEGER NOT NULL REFERENCES careers(id),
  negotiation_id    INTEGER REFERENCES transfer_negotiations(id),
  player_id         INTEGER NOT NULL REFERENCES players(id),
  from_club_id      INTEGER REFERENCES clubs(id),
  to_club_id        INTEGER REFERENCES clubs(id),
  fee               INTEGER NOT NULL DEFAULT 0,
  structure_json    TEXT,
  kind              TEXT    NOT NULL CHECK (kind IN ('permanent', 'loan', 'free', 'release')),
  completed_on      INTEGER NOT NULL,
  fc_state          TEXT    NOT NULL DEFAULT 'unknown'
                    CHECK (fc_state IN ('unknown', 'pending', 'applied', 'durable', 'divergent')),
  sync_operation_id INTEGER REFERENCES sync_operations(id)
);

-- ═══════════════════════════════════════════ scouting, relationships, media ═══
CREATE TABLE scouting_assignments (
  id          INTEGER PRIMARY KEY,
  career_id   INTEGER NOT NULL REFERENCES careers(id),
  staff_id    INTEGER NOT NULL REFERENCES staff(id),
  scope       TEXT    NOT NULL,
  target_json TEXT    NOT NULL,
  started_on  INTEGER NOT NULL,
  ends_on     INTEGER,
  status      TEXT    NOT NULL CHECK (status IN ('active', 'complete', 'recalled'))
);

-- APPEND ONLY. Reports carry ranges, never point values.
CREATE TABLE scouting_reports (
  id            INTEGER PRIMARY KEY,
  career_id     INTEGER NOT NULL REFERENCES careers(id),
  assignment_id INTEGER REFERENCES scouting_assignments(id),
  player_id     INTEGER NOT NULL REFERENCES players(id),
  ability_low   INTEGER NOT NULL,
  ability_high  INTEGER NOT NULL,
  potential_low INTEGER NOT NULL,
  potential_high INTEGER NOT NULL,
  confidence    REAL    NOT NULL,
  written_on    INTEGER NOT NULL,
  notes_json    TEXT,
  CHECK (ability_low <= ability_high AND potential_low <= potential_high)
);
CREATE INDEX idx_reports_player ON scouting_reports (career_id, player_id, written_on);

CREATE TABLE relationships (
  id              INTEGER PRIMARY KEY,
  career_id       INTEGER NOT NULL REFERENCES careers(id),
  a_type          TEXT    NOT NULL,
  a_id            INTEGER NOT NULL,
  b_type          TEXT    NOT NULL,
  b_id            INTEGER NOT NULL,
  kind            TEXT    NOT NULL,
  value           INTEGER NOT NULL,
  last_changed_on INTEGER NOT NULL,
  decay_rate      REAL    NOT NULL DEFAULT 0,
  UNIQUE (career_id, a_type, a_id, b_type, b_id, kind)
);

-- APPEND ONLY. sim_event_id is NOT NULL: there is no story without a fact.
CREATE TABLE narrative_events (
  id           INTEGER PRIMARY KEY,
  career_id    INTEGER NOT NULL REFERENCES careers(id),
  sim_event_id INTEGER NOT NULL REFERENCES sim_events(id),
  channel      TEXT    NOT NULL,
  author_id    INTEGER,
  headline     TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  generator    TEXT    NOT NULL CHECK (generator IN ('template', 'llm')),
  template_id  TEXT,
  occurred_on  INTEGER NOT NULL
);

CREATE TABLE messages (
  id                INTEGER PRIMARY KEY,
  career_id         INTEGER NOT NULL REFERENCES careers(id),
  kind              TEXT    NOT NULL,
  subject           TEXT    NOT NULL,
  body              TEXT    NOT NULL,
  requires_decision INTEGER NOT NULL DEFAULT 0,
  decision_json     TEXT,
  sim_event_id      INTEGER REFERENCES sim_events(id),
  received_on       INTEGER NOT NULL,
  read_at           INTEGER,
  resolved_at       INTEGER
);
CREATE INDEX idx_messages_unread ON messages (career_id, resolved_at, received_on);

-- ═══════════════════════════════════════════ money ═══
-- APPEND ONLY. A club's balance is SUM(amount). Money cannot appear.
CREATE TABLE financial_transactions (
  id                   INTEGER PRIMARY KEY,
  career_id            INTEGER NOT NULL REFERENCES careers(id),
  club_id              INTEGER NOT NULL REFERENCES clubs(id),
  amount               INTEGER NOT NULL,
  category             TEXT    NOT NULL,
  occurred_on          INTEGER NOT NULL,
  due_on               INTEGER,
  counterparty_club_id INTEGER REFERENCES clubs(id),
  source_event_id      INTEGER REFERENCES sim_events(id),
  description          TEXT    NOT NULL
);
CREATE INDEX idx_fin_club_date ON financial_transactions (club_id, occurred_on);

-- ═══════════════════════════════════════════ the spine ═══
-- APPEND ONLY. Determinism and the "why did this happen?" UI both live here.
CREATE TABLE sim_events (
  id             INTEGER PRIMARY KEY,
  career_id      INTEGER NOT NULL REFERENCES careers(id),
  event_key      TEXT    NOT NULL,       -- deterministic; the replay dedupe guard
  tick           INTEGER NOT NULL,
  occurred_on    INTEGER NOT NULL,
  kind           TEXT    NOT NULL,
  subject_type   TEXT,
  subject_id     INTEGER,
  cause_event_id INTEGER REFERENCES sim_events(id),
  payload_json   TEXT    NOT NULL DEFAULT '{}',
  rng_stream     TEXT,
  rng_draws_json TEXT,
  UNIQUE (career_id, event_key)
);
CREATE INDEX idx_events_subject ON sim_events (career_id, subject_type, subject_id, occurred_on);
CREATE INDEX idx_events_tick ON sim_events (career_id, tick);

-- APPEND ONLY. Survives season rollover; this is what a career is made of.
CREATE TABLE historical_records (
  id           INTEGER PRIMARY KEY,
  career_id    INTEGER NOT NULL REFERENCES careers(id),
  season_id    INTEGER NOT NULL REFERENCES seasons(id),
  scope        TEXT    NOT NULL,
  subject_type TEXT    NOT NULL,
  subject_id   INTEGER NOT NULL,
  record_json  TEXT    NOT NULL
);

-- Scheduled work for the tick loop. Not append-only: events are consumed.
CREATE TABLE scheduled_events (
  id          INTEGER PRIMARY KEY,
  career_id   INTEGER NOT NULL REFERENCES careers(id),
  event_key   TEXT    NOT NULL,
  due_on      INTEGER NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 100,
  kind        TEXT    NOT NULL,
  subject_type TEXT,
  subject_id  INTEGER,
  payload_json TEXT   NOT NULL DEFAULT '{}',
  cause_event_id INTEGER REFERENCES sim_events(id),
  UNIQUE (career_id, event_key)
);
CREATE INDEX idx_scheduled_due ON scheduled_events (career_id, due_on, priority, kind, subject_id);

-- ═══════════════════════════════════════════ sync ═══
CREATE TABLE sync_snapshots (
  id                 INTEGER PRIMARY KEY,
  career_id          INTEGER NOT NULL REFERENCES careers(id),
  taken_at           INTEGER NOT NULL,
  reason             TEXT    NOT NULL,
  game_build         TEXT,
  le_version         TEXT,
  protocol           INTEGER NOT NULL,
  in_game_date       INTEGER,
  checksum           TEXT    NOT NULL,
  raw_path           TEXT    NOT NULL,
  entity_counts_json TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_snapshots_career ON sync_snapshots (career_id, taken_at);

-- APPEND ONLY in spirit: state advances, but rows are never removed.
CREATE TABLE sync_operations (
  id              INTEGER PRIMARY KEY,
  career_id       INTEGER NOT NULL REFERENCES careers(id),
  idempotency_key TEXT    NOT NULL UNIQUE,
  kind            TEXT    NOT NULL,
  target_json     TEXT    NOT NULL,
  params_json     TEXT    NOT NULL,
  state           TEXT    NOT NULL
                  CHECK (state IN ('pending', 'sent', 'applied', 'durable', 'failed', 'abandoned')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  checkpoint_id   INTEGER,
  created_at      INTEGER NOT NULL,
  resolved_at     INTEGER
);
CREATE INDEX idx_ops_state ON sync_operations (career_id, state);

CREATE TABLE external_id_mappings (
  id           INTEGER PRIMARY KEY,
  career_id    INTEGER NOT NULL REFERENCES careers(id),
  entity_type  TEXT    NOT NULL,
  external_id  INTEGER NOT NULL,
  internal_id  INTEGER NOT NULL,
  confidence   REAL    NOT NULL DEFAULT 1.0,
  match_method TEXT    NOT NULL,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  UNIQUE (career_id, entity_type, external_id)
);
CREATE INDEX idx_mappings_internal ON external_id_mappings (career_id, entity_type, internal_id);

CREATE TABLE sync_divergences (
  id            INTEGER PRIMARY KEY,
  career_id     INTEGER NOT NULL REFERENCES careers(id),
  entity_type   TEXT    NOT NULL,
  entity_id     INTEGER NOT NULL,
  field         TEXT    NOT NULL,
  expected_json TEXT    NOT NULL,
  observed_json TEXT    NOT NULL,
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  resolution    TEXT,
  resolved_at   INTEGER
);
CREATE INDEX idx_divergences_open ON sync_divergences (career_id, resolved_at);
