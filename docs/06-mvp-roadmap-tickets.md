# 06 — MVP, Roadmap, and the First 30 Tickets

## 1. MVP definition

**The MVP's job is to prove one sentence: "I played a match in FC, and someone in my club noticed."**

### Must have

1. Guided first-run: detect FC 26, detect Live Editor, compatibility check, install bridge, connection test.
2. Import one career: clubs, players, contracts, squads, current date, the user's club.
3. Squad screen + player profile with companion-generated personalities.
4. Companion SQLite career with migrations, checkpoints and restore.
5. Fixture + result synchronisation, with **manual entry fallback** and mandatory user confirmation.
6. Per-match player lines derived by snapshot diffing.
7. Inbox + calendar + advance-time.
8. **One deep system: Board & Mandate** (below).
9. Sync Doctor.
10. Career history for the single season played.

### The one deep system: **Board & Mandate**

Chosen over transfers, scouting and relationships, and the reasoning matters more than the choice:

- It is **100% companion-authoritative** — zero writes to FC, so the MVP cannot corrupt a save.
- It consumes **exactly the data the confirmed read path provides**: results, table position, squad, finances. No unproven capability is on the critical path.
- It is the **product thesis in miniature**. A mandate negotiated in July, a promise made in September, a director who remembers both in March — that is the whole pitch, delivered in one season.
- It fails loudly rather than silently. If results import wrongly, the board reacts wrongly and the user tells you immediately. It is a *test harness disguised as a feature*.

Counter-argument, stated honestly: most players expect transfers first, and an MVP without a market will feel incomplete. Accepted — because **the MVP is a private alpha for ~10 testers, not a product launch.** Transfers arrive in Phase 3, before anything is public.

### Useful after MVP
Transfers with real negotiation · scouting fog · academy intake · dressing room · media/journalists · multi-club world simulation · season rollover · controller support · AI narrative provider.

### Not before public alpha
Ownership changes · tactical familiarity · staff hiring beyond scouts · national teams · create-a-club · asset/image importing · localisation · anything writing to FC beyond the single verified transfer path · Steam/store distribution.

### Explicit exclusions from the MVP, and why
Transfers (risk deferral), writing anything to FC (same), lineup/formation writes (unproven), multi-club simulation (not needed to prove the loop), AI narrative (templates prove it), youth (Phase 4), press conferences (Phase 4), any second FC version (Phase 7).

### MVP success criteria (measurable)
- A full season of one club is playable end-to-end without data loss, on **three different machines**.
- **≥ 95%** of played matches import correctly on the first attempt; the remaining 5% are *detected and reported*, never silently wrong.
- Career import of a full FC 26 database completes in **< 90 s**.
- Advance-one-day is **< 150 ms** at the 95th percentile.
- **Zero** unrecoverable saves across ≥ 200 tester sessions. A corrupted save that restores from a checkpoint is a pass; one that does not is a project-level failure.
- ≥ 6 of 10 private testers voluntarily play a second season.
- Every failure a tester hits produces a Sync Doctor entry that names the actual cause.

---

## 2. Roadmap (milestone gates, not dates)

Effort ranges assume 10–15 h/week and are honest, not motivational.

### Phase 0 — Technical spike · **20–40 h**
*Objective:* find out whether the premise is real before designing anything further.
*Deliverables:* a throwaway Lua script + a 200-line Node server proving all seven checks in doc 00 §3.9. A written spike report with measured numbers.
*Exit criteria:* career detected · save UID stable across restarts · ≥ 5,000 players exported with timing recorded · fixtures read (or a documented failure) · one played result read back · **one write proven durable across a restart** · zero save corruption after 20 cycles.
*Risks:* offsets broken on current build; snapshot too slow; HTTP blocked by AV.
*Claude Code:* excellent at the Node server and JSON plumbing; **the Lua/memory work needs the developer's own eyes** — it is undocumented, and a confidently wrong offset is worse than none.
*Postponed:* everything.

### Phase 1 — Vertical slice · **60–100 h**
*Objective:* one club, one fixture, twenty-five players, end to end.
*Deliverables:* Electron shell, SQLite + migrations, import pipeline, snapshot diffing, a Squad screen, a Result confirmation screen, checkpoint/restore.
*Exit:* play a real match in FC and see correct per-player lines in the companion, twice in a row, from a cold start.
*Postponed:* board, world, any second club.

### Phase 2 — Career foundation · **80–120 h**
*Objective:* make saves trustworthy.
*Deliverables:* full import (all clubs/players), migration framework with an old-save test, backup/restore UX, Sync Doctor v1, write queue with idempotency (still no writes enabled), compatibility manifest, diagnostic bundle.
*Exit:* a save created in Phase 1 opens after three schema migrations; a killed process mid-write loses at most one day; Sync Doctor correctly identifies all eleven failure classes (doc 07).

### Phase 3 — Board & Mandate + first writes · **100–150 h**
*Objective:* the deep system, and the first verified write path.
*Deliverables:* board members, mandate negotiation, promises, objective tracking, board inbox with reasons, causal-chain UI. Then: `SetTransferBudget` as the first-ever write, fully verified — chosen because it is single-valued, reversible and non-structural.
*Exit:* a full season of board reactions traceable to recorded events; the budget write proven durable 20/20.

### Phase 4 — World simulation · **120–200 h**
*Objective:* the league lives without you. Three fidelity tiers, background transfers, AI squad planning, media/news, and the transfer system with the `TransferPlayer` write behind a feature flag and a mandatory backup.
*Exit:* a 640-club season advances in < 3 s; the transfer market's volume/price distribution stays inside a defined corridor over five simulated seasons.

### Phase 5 — Season rollover · **80–120 h**
*Objective:* survive the boundary. Rollover sequence, reconciliation against FC's own rollover, history records, ten-season soak.
*Exit:* ten consecutive seasons with a stable population pyramid, no orphaned rows, no financial drift outside the corridor, and rollover reconciliation reports that a human can act on.

### Phase 6 — Private alpha · **60–100 h**
10–20 testers, install-support tooling, feedback intake, crash/diagnostic loop, onboarding rewrite based on where people actually get stuck.
*Exit:* the MVP success criteria above are met by real testers on real machines.

### Phase 7 — Public alpha · **80–140 h**
Update channels, compatibility matrix published, Bridge Doctor hardened, docs and a setup video, support policy, the business model in doc 08.
*Exit:* a stranger with no help installs and completes a match cycle.

**Total to public alpha: ≈ 600–970 hours → 12–18 months at 12.5 h/week.** Anyone promising less is not counting the sync work.

### What Claude Code does well here vs. what needs supervision

| Do well (direct it, review the diff) | Supervise closely (design it yourself first) |
|---|---|
| Electron/React scaffolding, screens, forms, tables | Memory-offset Lua and anything in `bridge/readers/fixtures_offsets.lua` |
| SQL schema, migrations, repository layer, Kysely queries | The sync state machine and idempotency semantics |
| Deterministic system implementations from a written spec | Determinism/RNG-stream design — a subtle bug here poisons every save |
| Test suites, fixtures, soak harnesses, CI | Balance constants and the economy corridor |
| Protocol envelopes, zod validation, JSON plumbing | Anything that writes to a real career for the first time |
| Refactors, doc generation, boilerplate | The decision of *what not to build* |

---

## 3. The first 30 tickets, in execution order

Difficulty: **S** (< 2 h) · **M** (2–6 h) · **L** (6–15 h) · **XL** (15 h+). "Auto" = Claude Code can likely do it mostly unsupervised given the spec.

| # | Title | Purpose | Files/modules | Acceptance | Tests | Deps | Diff | Auto |
|---|---|---|---|---|---|---|---|---|
| 1 | Repo skeleton + workspaces | One command builds and tests nothing successfully | root, `pnpm-workspace.yaml`, `tsconfig.*`, eslint boundaries | `pnpm i && pnpm build && pnpm test` green | boundary lint test asserting `sim` cannot import React | — | S | Yes |
| 2 | Compatibility manifest format | Encode FC build ↔ LE version support as data, updatable without a release | `packages/sync/compat/manifest.ts`, `docs/compatibility.md` | Manifest parses, validates, answers `support(build, le) → supported\|untested\|unsupported` | unit: all three verdicts | 1 | S | Yes |
| 3 | Bridge handshake file | Establish the local contract before any code talks | `packages/sync/protocol/handshake.ts` | Writes `{port, token, protocol}` atomically to `%LOCALAPPDATA%\Tenure\bridge` | unit: atomic rename, permissions | 1 | S | Yes |
| 4 | Loopback HTTP server | The bridge's only endpoint | `packages/sync/server/*` | Binds 127.0.0.1 ephemeral, rejects missing/incorrect token with 401, logs every request | integration: token accept/reject, port collision | 3 | M | Yes |
| 5 | **Lua bridge: hello + IsInCM** | First contact | `bridge/tenure_bridge.lua`, `bridge/lib/transport.lua` | Script run in-game POSTs `/v1/hello` with `LE_VERSION`, game build, `IsInCM()`, `GetSaveUID()`; server logs it | manual, recorded; then replayed as a fixture | 4 | M | **No** |
| 6 | **Spike: schema dump** | Discover the *real* schema instead of guessing | `tools/schema-dump/dump.lua` | Dumps every `GetDBTablesNames()` table with fields + row counts to JSON; records wall-clock time | committed as `tests/fixtures/schema-<build>.json` | 5 | M | **No** |
| 7 | **Spike: player/team export + timing** | Measure the snapshot cost | `bridge/readers/db_tables.lua` | Exports players, teams, teamplayerlinks, career_playercontract; reports rows/sec and total time | assert < 90 s for a full DB | 6 | M | **No** |
| 8 | **Spike: fixtures via offsets** | Find out if the fragile path works today | `bridge/readers/fixtures_offsets.lua`, `bridge/compat/` | Returns fixtures + standings on the current build, or fails cleanly with a named error | unit against a recorded dump; guard rejects unknown builds | 6 | L | **No** |
| 9 | **Spike: persistence proof harness** | Answer the single biggest unknown | `tools/schema-dump/persist_test.lua` | For each candidate table: write → save → quit → relaunch → read; produces a persistence report | report committed to `docs/persistence-<build>.md` | 6 | L | **No** |
| 10 | Snapshot protocol + chunking | Move large payloads reliably | `packages/sync/protocol/*` | Chunked envelopes with seq/of, sha256, idempotency key; partial transfers never commit | unit: missing chunk, bad checksum, duplicate chunk | 4 | M | Yes |
| 11 | Snapshot persistence + raw archive | Keep the evidence | `packages/persistence/snapshots.ts` | Raw snapshot stored on disk, row in `sync_snapshots` with counts and checksum | integration round-trip | 10 | M | Yes |
| 12 | SQLite + migration framework | Saves that survive schema change | `packages/persistence/*`, `migrations/0001_init.sql` | Migrations apply in order, are recorded with checksums, refuse to run out of order | test: v1 save opens at v4; checksum mismatch aborts | 1 | M | Yes |
| 13 | Checkpoint manager | Make everything reversible | `packages/persistence/checkpoints.ts` | `VACUUM INTO` + manifest; list/restore; retention policy per doc 03 §4 | integration: restore after a corrupt write | 12 | M | Yes |
| 14 | External id mapping | Never key on FC ids | `packages/sync/snapshot/mapping.ts` | Maps FC ids → internal, records method + confidence, handles unknown/new entities | unit: new player, renamed player, ambiguous match | 12 | M | Yes |
| 15 | Import pipeline v1 | Turn a snapshot into a career | `packages/sync/snapshot/import.ts` | Clubs, players, contracts, squads imported; progress reported with counts; idempotent re-import | integration on the recorded fixture; re-import changes nothing | 11,12,14 | L | Yes |
| 16 | Deterministic RNG streams | The foundation of every later guarantee | `packages/sim/rng/*` | splitmix64 + `stream(seed, tick, streamId, entityId)`; no global state anywhere | unit: same inputs → same sequence, 10⁶ draws; distribution sanity | 1 | M | Yes |
| 17 | Personality generation | Companion facts that feel earned | `packages/sim/systems/personality.ts` | Derived from age/potential-gap/reputation/contract + seeded noise; stable across regeneration | unit: same seed → same traits; distribution not degenerate | 16,15 | M | Yes |
| 18 | Event log + effect application | The causal spine | `packages/sim/engine/*` | Effects are the only mutation path; every effect writes a `sim_event` with a deterministic key; duplicate keys are no-ops | unit: replay a day twice → identical state | 12,16 | L | Yes |
| 19 | Advance-time loop | Time moves, reproducibly | `packages/sim/engine/advance.ts` | Implements doc 02 §3 pseudocode incl. PAUSED; one transaction per day | unit: 365 days twice from the same seed → byte-identical DB digest | 18 | L | Yes |
| 20 | Electron shell + typed IPC | A window, and a wall between UI and rules | `apps/desktop/*` | App boots, renderer reaches main only through typed channels; boundary lint passes | E2E smoke: launch, no console errors | 1 | M | Yes |
| 21 | Squad + player profile screens | The first thing a human sees | `apps/desktop/src/renderer/screens/*` | Renders imported squad, sortable, density setting, ranges for unknown values | component tests + a11y checks | 15,20 | L | Yes |
| 22 | Sync status strip + Sync Doctor v1 | Make state legible from minute one | `screens/SyncDoctor` | Live checklist of all preconditions; every failure names its cause and offers an action | unit per failure class | 4,20 | L | Yes |
| 23 | FC + Live Editor detection | Onboarding's hard part | `apps/desktop/src/main/launcher/*` | Finds installs via registry/known paths, reads the FC build version, manual browse fallback | unit against recorded registry fixtures | 20 | M | Yes |
| 24 | Bridge script installer | Ship the Lua safely | `main/launcher/bridgeInstall.ts` | Shows a diff before writing, verifies checksum after, never overwrites a user-modified file without consent | integration: fresh install, upgrade, tampered file | 23 | M | Yes |
| 25 | Pre-match snapshot + launch gate | Protect the diff | `screens/MatchPrep`, `sync/snapshot` | Launch is blocked until a pre-match snapshot exists or manual mode is chosen explicitly | integration: gate enforced | 15,23 | M | Yes |
| 26 | Match extraction by diffing | The core derivation | `packages/sync/diff/match.ts` | Diffs two snapshots → appearances, goals, assists, cards, clean sheets, rating; flags low-confidence rows | unit on recorded before/after pairs incl. a multi-match gap | 11,25 | L | Yes |
| 27 | Result confirmation screen | The trust surface | `screens/PostMatch` | Shows imported result + lines, allows correction, commits only on confirm, records provenance | integration: correction path writes `user_entered` | 26 | M | Yes |
| 28 | Manual result entry fallback | Survive a broken offset | `screens/PostMatch` | Full manual entry produces a valid `match_result` + stats with correct provenance | unit: identical downstream effects | 27 | M | Yes |
| 29 | Board v1: members, mandate, memory | The deep system's spine | `packages/sim/systems/board/*` | Three directors with priorities/patience/authority; mandate negotiated at career start; confidence computed purely from `sim_events` | unit: same event history → same board state; authority scope respected | 18,19 | XL | Partly |
| 30 | Board reactions + causal-chain UI | Pillar 3, visible | `screens/Boardroom`, `components/WhyPanel` | After each result, directors produce a stated position with a "why" that lists the actual source events | integration: every reaction links to ≥ 1 real event id | 29,27 | L | Yes |

**Note the shape of this list:** tickets 5–9 are the ones that decide whether the project is real, they are the least automatable, and they come before a single screen is built. That ordering is the whole point.
