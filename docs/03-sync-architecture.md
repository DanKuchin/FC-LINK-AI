# 03 — Synchronisation Architecture

This is the system that decides whether the product is trustworthy. Everything else is a game; this is a distributed-systems problem with an unreliable, undocumented, patch-volatile peer that can be closed at any moment.

**Governing principle: the companion is the system of record for the management fiction; FC is the system of record for the football facts it actually owns. Writes to FC are rare, explicit, verified, and reversible.**

---

## 1. Protocol shape

```
Companion (HTTP server on 127.0.0.1, ephemeral port)
   ▲  POST /v1/hello        ── bridge announces LE_VERSION, game build, save_uid
   ▲  POST /v1/snapshot     ── chunked career export  (bridge → companion)
   ▲  POST /v1/event        ── career-mode events     (bridge → companion)
   │  GET  /v1/commands     ── long-poll for write instructions
   ▲  POST /v1/ack          ── per-instruction result + idempotency key
   ▲  POST /v1/log          ── bridge diagnostics
Bridge script (Lua, inside FC's process, HTTP client only)
```

Auth: a random 32-byte token in `%LOCALAPPDATA%\Tenure\bridge\handshake.json`, sent as a bearer header. The server binds loopback only and rejects any request without the token. This is not about attackers; it is about not accidentally accepting traffic from another local process.

Fallback transport: atomic file drop in `bridge\outbox\` / `bridge\inbox\` with identical envelopes. Selected automatically when three consecutive HTTP attempts fail. Both transports carry the same messages, so the protocol is tested once.

### Envelope

```json
{
  "protocol": 1,
  "sent_at": "2026-07-28T14:03:11Z",
  "save_uid": "9d82d73c76b9413aadbfaae1b969dc4",
  "game_build": "1.0.138.57785",
  "le_version": "v26.3.5",
  "kind": "snapshot.chunk",
  "seq": 7,
  "of": 24,
  "idempotency_key": "snap_01J…:7",
  "checksum": "sha256:…",
  "payload": { }
}
```

Rules: every message carries `save_uid` (wrong save → hard reject, this is how you stop a career being polluted by a different one); every mutating message carries an `idempotency_key`; every chunked transfer carries `seq/of` and a whole-transfer checksum verified before anything is committed.

---

## 2. Identity and mapping

- **Career identity:** `GetSaveUID()` — a 31-char id persisted inside the save. **[C]** This is the anchor for everything.
- **Entity identity:** FC ids (`playerid`, `teamid`, `compobjid`) are stable within a save but *not* globally meaningful across saves or mods.
- Therefore: `external_id_mappings(career_id, entity_type, external_id, internal_id, first_seen, last_seen, confidence)`. The companion never uses an FC id as a primary key.
- **Newly generated players** (FC regens/youth) appear with unknown ids: matched on `(name, birthdate, nationality, club)` and, failing that, created as new internal entities and flagged for review.

---

## 3. Source-of-truth matrix

Directions are from the companion's point of view. `R` = we read from FC, `W` = we write to FC.

| Field | Source of truth | Read | Write | Timing | Conflict policy |
|---|---|---|---|---|---|
| Player club / squad membership | **FC** | R | W (Phase 3, gated) | Every snapshot | FC wins. A companion-side transfer that FC contradicts becomes an open reconciliation item, never a silent overwrite |
| Contract length / expiry | **FC** | R | W (Phase 4, only if proven persistent) | Snapshot | FC wins on read; our pending writes replay once |
| Wage | **Shared, reconciled** | R (if locatable) | no | Snapshot | If unreadable → companion-authoritative, flagged as estimated |
| Fitness | **FC** | R | W (rare, opt-in) | Pre-match, post-match | FC wins |
| Injury | **FC** | R (+ event hook) | never | Event + snapshot | FC wins absolutely |
| Suspension | **Companion (derived)** | derived from cards | never | Post-match | Companion wins; shown as derived |
| Transfer (the act) | **FC for the fact, companion for the story** | R | W (Phase 3) | Window ticks | Ownership must match or a repair item opens |
| Transfer budget | **Shared, reconciled** | R | W (opt-in) | Window boundaries | User chooses at connect time which side leads; default FC |
| Fixture list | **FC** | R (fragile) | never | Career load + rollover | FC wins. If unreadable → companion generates and marks the career *unsynced-fixtures* |
| Result | **FC** | R (fragile) + manual fallback | never | Post-match | FC wins; user confirms before commit |
| Player season statistics | **FC** | R | never | Pre/post match | FC wins |
| Per-match statistics | **Derived** | diff of snapshots | never | Post-match | Companion-owned, provenance recorded |
| League table | **Derived** | prefer computing from results | never | Post-match | Companion computes; FC's standings used only as a cross-check that raises a warning on mismatch |
| Formation / starting XI | **FC** | R (Phase 4+) | never | Pre-match | FC wins |
| Youth players | **Companion** | R if reachable | never | Season | Companion wins |
| Morale | **Companion** | — | W (optional flavour write) | Post-decision | Companion wins |
| Personality / hidden traits | **Companion** | — | never | — | Companion only; does not exist in FC |
| Board confidence, promises, mandates | **Companion** | — | never | — | Companion only |
| Relationships, agents, journalists | **Companion** | — | never | — | Companion only |

Read that table's right-hand column as the product thesis: **the interesting half of the game is in the rows FC cannot contradict.** That is deliberate.

---

## 4. Checkpoints

A checkpoint is an atomic, restorable copy of the companion database plus the last raw snapshot, with a label and a reason.

| Checkpoint | When | Retained |
|---|---|---|
| `career_created` | after first import | forever |
| `pre_launch` | immediately before FC is launched | last 3 |
| `career_loaded` | after `POST_LOAD_PREPARE` + successful snapshot | last 3 |
| `pre_match` | before the user plays — **required for match diffing** | last 5 |
| `post_match` | after the result is confirmed | last 5 |
| `window_close` | end of each transfer window | last 4 |
| `pre_rollover` / `post_rollover` | season boundary | forever |
| `pre_write_batch` | before any batch containing an FC write | last 10 |
| `pre_migration` | before a schema migration | last 3 |

Implementation: SQLite `VACUUM INTO` to a timestamped file + a JSON manifest. Cheap, atomic, and restorable by copying one file back. Restoring is a first-class user action, not a support procedure.

---

## 5. Write pipeline

```
intent (user action)
  → instruction row  {kind, target, params, idempotency_key, state: pending}
  → pre_write_batch checkpoint
  → GET /v1/commands delivers batch to bridge
  → bridge executes ONE instruction at a time, in order
  → bridge reads the value back immediately
  → POST /v1/ack {key, result, observed_value}
  → companion marks applied | failed(reason)
  → on next POST_LOAD_PREPARE snapshot: verify still true → durable
  → only durable clears the queue
```

Rules that are not negotiable:
- Writes execute **only** when the game is at a safe point (post-load or between match days), never during a match or while a game edit screen is open. The Live Editor wiki documents that edits made while the in-game *Edit Player* screen is open get overwritten. **[C]**
- Batches are capped (start at 10 instructions) and abort on the first hard failure, leaving the remainder pending.
- Any instruction touching a table not yet proven persistent (doc 00 §3.3) is rejected at creation time by the schema, not at runtime.
- Every write batch is preceded by a checkpoint, and the UI names it.

---

## 6. The failure this architecture exists to prevent

> *The companion believes a player was transferred; the player is still at the old club inside FC.*

**Prevention**
1. The companion never treats "instruction sent" as "transfer happened". The transfer's state machine has a terminal state `completed` that is only reachable from `durable`.
2. Read-back verification: `GetTeamIdFromPlayerId(playerid)` must equal the destination team id in the same session. **[C]** — this exact function exists.
3. Durability verification on the next career load.
4. Preconditions checked before writing: not on loan (`IsPlayerLoanedOut`), not presigned (`IsPlayerPresigned`) — both documented calls with documented remedies. **[C]**

**Detection (the reconciliation pass, runs on every snapshot)**
```
for each expectation E the companion holds about FC state:
    observed = snapshot.lookup(E.target)
    if observed != E.expected:
        open a DIVERGENCE record {field, expected, observed, first_seen, related_events}
```

**Resolution — presented, never silent.** The Sync Doctor lists each divergence with three offers: *Accept FC's version* (companion rolls back its narrative, keeping an audit note), *Retry the write*, or *Keep both and mark unsynced* (the career continues with an explicit, visible asterisk on that entity).

The third option matters more than it looks. A career that can survive being partly wrong, visibly, is worth far more than one that halts. **[P]**

---

## 7. Ownership of the snapshot cost

A full snapshot of ~17k players is the single biggest performance question in the product and it is **unmeasured** — this is assumption [A] until Ticket 6.

Mitigations designed in from the start: full snapshot only at career load and season rollover; everything else is a **delta snapshot** scoped to the user's club, its competitions, and any entity the companion has an open expectation about. Name resolution (documented as slow **[C]**) happens once per entity, ever, and is cached in `external_id_mappings`.
