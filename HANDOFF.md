# HANDOFF — TENURE / FC-LINK-AI

**For:** whoever picks this up next (Codex, another agent, or Dan in three months).
**Written:** 2026-07-28, end of the design session that produced everything in this repo.
**Repo:** `github.com/DanKuchin/FC-LINK-AI` (private) · local: `D:\FC LINK`

Read this file first. It is the map, the reasoning that didn't fit in the docs, and the list of things not to do.

> **Continuation note (2026-07-28):** Sections 1–2 below describe the original
> baseline on `main`, not the current `codex/phase-0-2` branch. That branch now
> contains the Electron application and the schema-independent Phase 0–2
> foundation. Read [`docs/09-phase-0-2-implementation-audit.md`](docs/09-phase-0-2-implementation-audit.md)
> immediately after this file for the current evidence and remaining gates. The
> Phase 0 Windows/FC evidence blocker and every “do not build” boundary in this
> handoff remain authoritative.
> Current local evidence: 27 test files / 177 tests, with desktop startup
> checkpointing and migrating a schema-v1 career through schema v4.

---

## 1. What this is in one paragraph

An original desktop companion management game for **EA Sports FC 26** (PC, offline career only). The companion owns the management fiction — board politics, promises, transfers, scouting, finances, relationships — and EA Sports FC plays the matches. The two are connected through **FC 26 Live Editor's Lua API**, which exposes the game's in-memory career database and can make HTTP calls out to a local server. Working title **TENURE**; the pitch is *"a football management career where nothing is forgotten."*

**It is currently a planning + foundations repo. There is no application yet.** No Electron shell, no UI, no import pipeline. What exists is 20 design documents, a Phase 0 spike kit, and four tested foundation modules.

---

## 2. Current state — what is real

### Committed and green
```
71 tests passing · clean typecheck · 3 commits + this handoff
```

| Area | State |
|---|---|
| `packages/sim/rng` | **Done.** xoshiro128** + splitmix32, integer-only state, derived per-(seed, tick, stream, entity) streams. 23 tests incl. an inline snapshot guarding the exact algorithm. |
| `packages/persistence` | **Done.** `Db` adapter over `node:sqlite`, numbered migrations with checksum + out-of-order guards, `VACUUM INTO` checkpoints with verify/restore/retention. 26 tests. |
| `packages/persistence/migrations/0001_init.sql` | **Done.** The full career schema — 30 tables. Two invariants live in the schema itself. |
| `packages/sync/compat` | **Done.** Compatibility manifest as data: supported / untested / unsupported. 15 tests. |
| `tests/architecture.test.ts` | **Done.** Boundaries enforced as a test, not lint config. |
| `spike/` + `bridge/spike/` | **Written, never run.** See §3. |
| `docs/00–08` | Product + technical plan. |
| `docs/10–19` | AI layer design. |

### Not started
Electron shell · any UI · import pipeline · snapshot diffing · event log · advance-time loop · board system · anything AI.

### The one thing to internalise about the schema
`0001_init.sql` already encodes two invariants **in the database**, because an invariant the DB enforces cannot be forgotten by application code:
- `uq_contract_active_permanent` — a player can hold at most one active permanent contract.
- `sim_events (career_id, event_key)` unique — this is what makes replay and partial-failure recovery safe.

And a third by convention, tested: **balance is `SUM(financial_transactions)`.** There is no balance column to drift.

---

## 3. THE BLOCKER — read before doing anything

**FC 26 build `1.0.138.57785` requires FC Live Editor `v26.3.5`. The installed Live Editor is at most `v26.3.4`.** Live Editor will not inject into this game build, so no Lua runs, so **none of the Phase 0 spike can execute.**

Dan said he'd download the newer version "later today" (2026-07-28). Verify before assuming:

```bash
node spike/detect.mjs
```

That prints the verdict in two seconds. Full detail and the three resolution options are in [`docs/compatibility.md`](docs/compatibility.md).

**Until this clears, every technical claim about the bridge is unverified.** Seven questions are open (`docs/spike-report.md` grades all seven as UNKNOWN). Two of them can kill or reshape the product:

1. **Do fixtures/results read on this build?** They're reached by walking raw pointers at hard-coded offsets (`FCEDataManager + 0x60` / `+0x88`), not through any API. If `bridge/spike/04_fixtures_probe.lua` prints FAIL, results must be typed in by hand until the offsets are re-derived — a materially different product.
2. **Do writes persist?** Live Editor's own wiki says only *some* tables are stored in the career file; others silently revert on restart. Which is which is undocumented. `05_persist_write.lua` → save → quit → relaunch → `06_persist_verify.lua` answers it.

The spike is ~3 hours, mostly waiting for a football game to load. Run order and what each result means: [`spike/README.md`](spike/README.md).

---

## 4. The decisions, and why

This is the part that isn't fully written down elsewhere. If you disagree with a decision, this is the reasoning to argue with.

### 4.1 Read-heavy, write-thin

The single most important architectural commitment. FC is treated as **a match engine and a result oracle**, not a database to drive. The MVP writes *nothing* to FC. The first write (`SetTransferBudget`) lands in Phase 3, after a durability harness proves it survives a restart.

Why: the tool author attaches explicit save-corruption warnings to `TransferPlayer`; an unknown subset of tables doesn't persist; and the product's whole value proposition is that consequences are real, which dies the moment a career gets corrupted. Writing less is both safer *and* the better game design — the interesting half of the design deliberately lives in rows FC cannot contradict (board, promises, relationships, reputation).

### 4.2 Board & Mandate as the MVP deep system, not transfers

Most people would build transfers first. Deliberately didn't:
- Board is **100% companion-authoritative** — zero FC writes, so the MVP *cannot* corrupt a save.
- It consumes exactly the data the confirmed read path provides (results, table, squad, finances). No unproven capability on the critical path.
- It's the product thesis in miniature: a mandate negotiated in July, a promise in September, a director who remembers both in March.
- It fails loudly. Wrong result import → wrong board reaction → the tester tells you immediately. It's a test harness disguised as a feature.

Counter-argument, acknowledged: an MVP without a market feels incomplete. Accepted because the MVP is a ~10-person private alpha, not a launch.

### 4.3 `node:sqlite` over `better-sqlite3` (deviation from doc 04)

Recorded in [`docs/adr/0001-sqlite-driver.md`](docs/adr/0001-sqlite-driver.md). No native compilation, no `electron-rebuild`, tests run with zero install. It's behind an adapter.

**The unpaid cost:** `node:sqlite` is experimental, and *I have not verified Electron's bundled Node exposes it.* That's a Phase 1 check (ticket 20). If it's missing, reimplement `sqlite-runtime.ts` + `db.ts` against the same interface — the persistence test suite touches no driver-specific API, so it doubles as the acceptance test for a replacement. Few hours, not a rewrite.

### 4.4 Determinism is structural, not a feature

One master seed per career; every draw comes from a stream derived from `(masterSeed, tick, streamId, entityId)`; no global RNG anywhere; integer-only state so results are identical across platforms and Node versions.

This underwrites three separate promises: a save reloads to the same world, a bug is reproducible from a seed, and the game can *explain* why something happened. `rng.test.ts` has an inline snapshot of the first four draws — **if it fails, the generator changed and every existing save now simulates differently.** That is a save-breaking change, not a refactor. The test says so.

### 4.5 The AI doctrine — the simulation decides, AI expresses

Docs 10–19. The short version: AI has exactly two jobs — turn a simulation-decided fact into words, and turn the user's words into one of a closed intent set. Enforced four ways rather than asserted:

1. **No write path** from any model output to a mutating statement.
2. **Facts are assembled and handed over, never fetched.** I explicitly rejected giving the model read tools — a journalist with `read_contract` can fetch a wage they shouldn't know; a journalist handed a fact sheet cannot, because the number isn't in the context window. Prompt instructions are not controls.
3. **Numbers are never generated.** Prose carries `{{fee}}` slots; the sim substitutes. `AgentNegotiationMove` has no numeric fields at all.
4. **`narrative_events.sim_event_id` is `NOT NULL` with an FK** — already in `0001_init.sql`, already tested. An ungrounded line physically cannot be stored.

**The risk I rank first is not hallucination or cost. It's volume.** Generated dialogue is cheap and infinite; a manager's attention isn't. The importance scorer's success metric is its *refusal* rate — target 0–2 rendered reactions per week out of 40+ candidates.

### 4.6 What I pushed back on

Recorded so nobody re-litigates it without new information:

| Rejected | Why |
|---|---|
| Persistent autonomous agents per character | Unbounded cost, latency, and inconsistency; destroys determinism and with it the soak tests and replay. Lazy activation gives the same felt result. |
| Vector DB for memory | A 10-season career is ~20k rows. That's an indexed `WHERE`, not similarity search. `sqlite-vec` + FTS5 is documented as the additive path if a real retrieval problem ever appears. |
| Match commentary / tactical analysis | **Structurally impossible.** FC yields cumulative season aggregates only; per-match lines exist solely by diffing snapshots. No possession, no xG, no in-match events. An adviser discussing pressing structure is inventing telemetry the user will catch. Doc 13 §6 ships an honest labelled version instead. |
| Unlimited free-text conversation | Hybrid instead: free text resolves to a closed 12-intent enum and is **confirmed before it commits**. |
| Personalised difficulty adjustment | The moment a player suspects outcomes are tuned to their behaviour, every result is suspect. Presentation-only personalisation is permitted; nothing else. |
| 38 player sub-skills (the GAFFER-style number) | Five hidden traits. A property that doesn't change a decision doesn't exist. |
| Eleven emotion values | Seven. Four were renames or had no distinct consequence. |
| Racing GAFFER on features | They shipped v0.1→v0.5.2 in 25 days. That race isn't winnable. Compete on not losing people's careers. |

### 4.7 Two grounded findings that changed designs

- **Haiku 4.5's minimum cacheable prompt prefix is 4,096 tokens** (vs 1,024 on Sonnet 5). The natural shared prompt is ~1,900, so caching would have *silently* done nothing — no error, just `cache_creation_input_tokens: 0`. Doc 15 §3.2 handles it; ticket 28 asserts a cache read actually occurs.
- **Live Editor's own `version.json` maps 27 FC 26 builds across ~10 tool versions** — a patch roughly every 2–3 weeks, each potentially invalidating memory offsets. That's why the compatibility manifest is *data* (updatable without a release) and why offsets are isolated in exactly one guarded file.

---

## 5. Where to pick up

### If the blocker is cleared
Run the spike. Nothing else matters until the seven checks are answered.

```bash
node spike/detect.mjs        # must say the version pair is OK
pnpm spike:install           # copies Lua into <Live Editor>\lua\tenure\
node spike/server.mjs        # leave running
# in game (F9 → Features → Lua Engine → execute): 01 → 02 → 03 → 04
# back up a throwaway save, arm 05, run it, save → QUIT FC FULLY → relaunch → 06
node spike/report.mjs        # grades all seven, writes docs/spike-report.md
```

Then re-read the abort conditions in [`docs/08` Part F](docs/08-distribution-legal-business-risk.md) **with real numbers in hand**.

### If the blocker is still live
Safe work that's robust to any spike outcome:

| Next | Ticket | Why it's safe |
|---|---|---|
| Event log + effect application | doc 06 #18 | Pure sim, no FC assumptions |
| Advance-time loop | doc 06 #19 | Pseudocode is in doc 02 §3 |
| `tools/mock-fc` | doc 07 A2 | **Highest leverage available right now** — a fake bridge replaying recorded snapshots makes the whole sync pipeline testable without launching a football game. Turns a 20-minute test cycle into 20 seconds. |
| `packages/sim/balance/ai.ts` | doc 18 #1 | One hour; forces the tuning conversation before code depends on the numbers |
| Memory `canHold()` + property test | doc 18 #6 | Deliberately ahead of the memory system — the knowledge boundary is wrong *everywhere at once* if wrong, and very hard to retrofit |

**Do not build:** the import pipeline, field mappings, or snapshot parsing. All of it encodes assumptions about FC's schema that `02_schema_dump.lua` will either confirm or correct. Building it now is how you get a mapping layer written against a schema that doesn't exist.

---

## 6. Traps

1. **Don't run the spike against a career you care about.** `05_persist_write.lua` writes to the save. It's disarmed by default (`BACKED_UP = false`) and 06 restores everything, but a crash between them leaves marker values in place.
2. **Between 05 and 06 you must quit FC completely.** Returning to the main menu is not enough and invalidates the test.
3. **Don't edit a shipped migration.** `migrate.ts` refuses on checksum mismatch, by design. Add a new one.
4. **Don't change the RNG.** See §4.4.
5. **Don't add memory offsets outside `bridge/readers/fixtures_offsets.lua`.** One file, guarded by a build check. This rule is what makes an FC patch a JSON update instead of an archaeology expedition.
6. **`spike/out/` is git-ignored on purpose** — it can contain career data.
7. **Don't mark anything `verified: true` in `compat/manifest.json`** unless *you personally* ran the bridge on that pair. That flag unlocks writes to a real career. There's a test asserting nothing is verified yet; when you flip one, that test needs updating deliberately, not reflexively.
8. **The AI layer is not next.** Doc 19 §4 is an explicit NO-GO on starting it now, with reasons. Stage 0 (the deterministic half — memory, emotion, promises, escalation) is Phase 3 work and is where essentially all the value is.

---

## 7. Doc index

| Doc | Contents |
|---|---|
| [00](docs/00-verdict-and-feasibility.md) | **Start here for the technical picture.** Capability-by-capability evidence, feasibility matrix, confirmed vs assumed |
| [01](docs/01-product-concept.md) | Name, pitch, audience, pillars, differentiation, the gameplay loop |
| [02](docs/02-systems-and-simulation.md) | Ten game systems; fidelity tiers; time model; determinism; advance-time pseudocode |
| [03](docs/03-sync-architecture.md) | Protocol, identity mapping, **source-of-truth matrix**, checkpoints, write pipeline |
| [04](docs/04-stack-architecture-repo-schema.md) | Stack decision, Mermaid architecture, repo tree, full SQL schema |
| [05](docs/05-ui-specification.md) | Design principles, navigation, accessibility, 20 screen specs |
| [06](docs/06-mvp-roadmap-tickets.md) | **MVP scope, 8 phases, the first 30 tickets** |
| [07](docs/07-testing-and-narrative.md) | Test levels, invariants, CI soak plan, the AI boundary |
| [08](docs/08-distribution-legal-business-risk.md) | Packaging, Bridge Doctor, FC-patch runbook, legal, business model, risk register, **abort conditions** |
| [10–19](docs/10-ai-verdict-and-doctrine.md) | The AI layer. Doctrine → opportunity map → character/memory/emotion → conversation/actors → narrative/events → tools/schemas/prompts → safety/cost/latency → architecture → **40 tickets** → risks/verdict |
| [adr/0001](docs/adr/0001-sqlite-driver.md) | The sqlite driver decision and what it costs |
| [compatibility.md](docs/compatibility.md) | This machine's detected versions + the support policy |
| [spike-report.md](docs/spike-report.md) | Auto-generated. All seven checks currently UNKNOWN. |

---

## 8. Honest status of every claim

- Everything in `docs/00` labelled **[C]** was read in the Live Editor source or wiki and is cited. Everything **[A]** is unverified.
- **Nothing about the bridge has been executed.** Not one Lua script has run against a real game.
- The server, detector, migrations, RNG, checkpoints and compat manifest **have** been executed and tested locally.
- The AI cost figures in doc 16 §3 are estimates over assumed prompt sizes. Re-measure with `count_tokens` before publishing any of them.
- Effort estimates (600–970 h base, +410–620 h AI) are honest ranges, not motivational ones.

## 9. Legal posture, briefly

Unofficial, unaffiliated, offline-only. Ships zero EA assets and no EA code. Depends on a third-party tool that runs FC without its anticheat — whose own wiki says using it may put an EA account at risk. That disclosure belongs in onboarding, the README, and the site. Get real legal advice before the first paid release. Full analysis: doc 08 Part B.
