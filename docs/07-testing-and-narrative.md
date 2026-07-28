# 07 — Testing Strategy, Soak Tests, and the Narrative/AI Layer

## Part A — Testing

The unusual property of this product is that **the most likely catastrophic bug is not a crash — it is a save that is quietly wrong.** The test strategy is built around that.

### A1. Unit tests (fast, pure, no I/O)
Player development; fitness/sharpness decay and recovery; transfer valuation; every financial calculation; board confidence computation; event selection and weighting; date progression and calendar edge cases (leap years, window boundaries, season-spanning fixtures); RNG stream derivation; promise lifecycle transitions.

Rule: **every system in `packages/sim` is a pure function of `(state, ctx) → effects[]`, so all of it is unit-testable with no database.** If a system needs I/O to be tested, it is designed wrong.

### A2. Integration tests
Lua export → JSON parse → normalisation → entity mapping; write instruction build → send → ack → state transition; conflict detection on divergent snapshots; recovery from partial batches; protocol version mismatch handling; the full import pipeline against recorded real snapshots.

**Key asset: `tools/mock-fc`** — a fake bridge that replays recorded snapshot fixtures. It makes 90% of sync work testable without launching a football game, which is the difference between a 20-minute test cycle and a 20-second one. Build it in Phase 1, not Phase 4.

### A3. Save integrity tests
Atomic write under a killed process (`process.kill` mid-transaction → the save opens and has lost at most one day); interrupted checkpoint; migration from every historical schema version (keep a corpus of real old saves in `tests/fixtures/saves/`); deliberately corrupted files fail loudly and offer restore; duplicate event insertion is a no-op; restore-from-checkpoint produces a byte-identical database digest.

### A4. Simulation tests
1, 5 and 10 simulated seasons headless. Assertions:

- **Population stability** — total players ±5% per season; age pyramid keeps a plausible shape; no cohort collapse.
- **Promotion/relegation** — league membership is preserved exactly across rollover (count in = count out).
- **Ageing and retirement** — retirement rate stays inside a defined band; no 45-year-old squads.
- **Squad-size limits** — no club below its minimum or above its maximum at any window close.
- **Financial corridor** — aggregate wage and fee inflation stays inside a per-season band; no club with impossible negative equity; **balance always equals `SUM(financial_transactions)`**.
- **Transfer-market balance** — deals per window and price distribution inside a defined corridor; no single club accumulating a third of the world's talent.
- **Determinism** — the same seed run twice produces identical database digests. This is the single most valuable assertion in the suite.

### A5. Compatibility tests
Supported FC build set; supported Live Editor version set; clean Windows install vs. one with mod-manager mods present (`-dataPath FIFAModData` — documented as supported by Live Editor **[C]**); missing fields in a snapshot; changed table/field names; unknown game build (must degrade to read-only, never crash); antivirus-excluded folder paths.

### A6. Invariants (asserted continuously, not just in tests)
```
1  No player holds two active permanent contracts        (enforced by unique index)
2  Every fixture belongs to a valid competition + season
3  A completed transfer implies matching club ownership in both systems, or an open divergence
4  League membership persists across rollover
5  Money never appears: balance == SUM(financial_transactions)
6  Reprocessing a sync operation never duplicates its effect
7  Every narrative event references a real sim_event
8  Every promise state change is a new row, never an edit
9  current_date advances monotonically
10 No sim_event exists without a tick and a deterministic event_key
```
Run these as a **`checkInvariants(db)` function called after every season rollover in normal play** (not just in CI), logging violations to the diagnostic bundle. A user hitting invariant 5 should have it detected before they notice their budget is wrong.

### A7. Soak tests in CI
- **Nightly** GitHub Actions job: 10 seasons × 3 seeds, headless, on the mock world. Fails on any invariant violation, on wall-clock regression > 20%, or on a determinism mismatch.
- Emits a **balance report** artifact — economy curves, market volume, age pyramid, title distribution — so drift is visible as a chart, not discovered in a player's season 7.
- **Weekly** long soak: 25 seasons × 5 seeds. This is where population and inflation bugs surface.
- Determinism check: every seeded run is executed twice and the two database digests must match.

---

## Part B — Narrative and AI

**The rule, restated because it is the one that gets broken under deadline pressure: the simulation decides what happened; the narrative layer decides only how it is worded.** Generative AI never controls financial, transfer, competition, board or development logic.

### B1. Architecture

One interface, two implementations:

```ts
interface NarrativeProvider {
  render(request: NarrativeRequest): Promise<NarrativeOutput>
}
// TemplateProvider  — default, offline, deterministic, ships in v1
// LlmProvider       — opt-in, cached, rate-limited, always falls back to templates
```

`NarrativeRequest` carries **only structured facts** already committed to the database, plus the `sim_event_id` that authorises the text to exist. `NarrativeOutput` is validated against a schema, then stored with `generator = 'template' | 'llm'` so any sentence in the game can be traced to its producer.

### B2. Use-case evaluation

| Use case | AI worth it? | Facts supplied | Creative freedom | Forbidden |
|---|---|---|---|---|
| Press-conference wording | **Yes** | question topic, asker, recent results, open promises, board stance | tone, phrasing, journalist voice | inventing results, players, quotes attributed to real people, numbers |
| Inbox messages | **Partly** | event type, subjects, amounts, dates | phrasing, register | changing any figure; adding an action the sim didn't authorise |
| Player conversations | **Yes** | player traits, grievance cause, history with manager | voice, emotional register | promising anything the sim doesn't model; inventing backstory contradicting data |
| Scouting prose | **Yes** | attribute *ranges*, scout bias, confidence | descriptive language | stating a precise value the scout doesn't know |
| News articles | **Yes** | source event, table state, form | angle, headline | events with no `sim_event_id` |
| Board dialogue | **Careful** | director priorities, patience, the specific events they noticed | voice | stating a decision the sim hasn't made |
| Season summaries | **Yes** | full season record | structure, emphasis | any statistic not in the record |

### B3. Non-negotiable constraints on the AI path
- **Off by default.** Templates ship first and must be good enough to launch with. If the template version isn't shippable, the feature isn't ready.
- **Schema-validated output.** Any response failing validation is discarded and the template used. No retry loops in the player's face.
- **Cached forever**, keyed by `hash(sim_event_id, template_id, provider, model)`. A given event is worded once, per save. This also makes it reproducible.
- **Rate-limited and budgeted.** A visible per-session cap and a running cost estimate.
- **Numbers are never generated.** All figures come from the template layer and are inserted after generation, not produced by the model.
- **Privacy:** requests contain only in-game facts. No file paths, no save contents, no user identifiers. If a user brings their own key, it is stored in the OS credential store, never in the save.
- **Offline is the default state**, not a degraded one.

### B4. The template system (which must be good on its own)
- Templates are **data** (`packages/narrative/templates/*.json`), selected by `(event kind, actor voice, context tags)` with weighted variants and deterministic selection from the event's RNG stream — so the same event always produces the same sentence.
- Variables interpolate only from a whitelisted fact set.
- Journalist/director "voices" are template sets, not model prompts, so personality survives with AI switched off.
- **Coverage test:** every `sim_event` kind must have at least one template, asserted in CI. A game that says "an event occurred" has failed.
