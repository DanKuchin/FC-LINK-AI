# 18 — Evaluation, Roadmap, and the First 40 AI Tickets

---

## 1. Testing and evaluation

### 1.1 Deterministic tests (no model, run on every commit)

These cover Stage 0, which is most of the system.

- **Emotion:** each event kind moves each value in the right direction; personality modifies magnitude but never sign; decay returns to the *personal* baseline; the per-tick cap is never exceeded.
- **Memory:** formation from events; significance and valence; decay curve; compression at season boundary preserves `source_ids`; the per-holder cap holds; **the visibility filter never returns an unauthorised row** (property test over random holder/memory pairs).
- **Retrieval:** scoring order is stable; exactly ≤7 returned; the same inputs return the same rows.
- **Reaction FSM:** candidates are always a subset of the legal set; escalation cannot skip a stage; cooldowns are honoured; the drama budget cannot go negative.
- **Importance scoring:** golden-file test over a fixture week — 40 candidate pairs in, an exact expected set of survivors out. **This test is the guard on the whole cost model**, and it should fail loudly whenever a threshold is touched.
- **Determinism:** same seed + same events → identical emotions, memories, arcs, candidate sets, and identical *template* text, byte for byte.

### 1.2 Model evaluations (offline harness, `tools/ai-eval`)

Run against a fixture corpus, not against live careers. Nightly in CI where cost allows; otherwise on demand before a prompt change ships.

| Metric | Method | Gate |
|---|---|---|
| **Schema validity** | run 500 fixture requests | **100%** (structured outputs make this a floor, not a target **[C]**) |
| **Factual grounding** | automated: every id/number in output ∈ fact sheet | **100%**; any failure is a bug, not a score |
| **Knowledge-boundary respect** | fixtures that *tempt* leakage (a journalist asked about wages) | **0 leaks** |
| **Character consistency** | LLM-as-judge (Sonnet 5) scores 1–5 against the trait/emotion brief; 50-item human-labelled calibration set | ≥ 4.0 mean, ≥ 0.7 correlation with human labels |
| **Intent accuracy** | 100+ labelled free-text utterances, including adversarial | ≥ 95% top-1; ≥ 99% "never invents an unavailable intent" |
| **Repetition** | trigram Jaccard across a simulated season's utterances per character | < 5% of pairs above 0.6 |
| **Football plausibility** | human rubric, 30 samples per release | ≥ 4/5 mean |
| **Emotional appropriateness** | judge scores tone against supplied emotion band | ≥ 4.0 mean |
| **Tool/candidate selection** | fraction choosing a candidate a human rater agrees is best-fit | ≥ 80% |
| **Cost** | measured tokens per call type | within 20% of doc 16 §3.1 |
| **Latency** | p50 / p95 per class | p95 < 2.5 s interactive |

**On LLM-as-judge:** it is used only for the subjective axes, always against a human-calibrated subset, and its correlation with human labels is itself reported. A judge score that has drifted from human agreement is a broken instrument, and the calibration set is how that gets noticed.

### 1.3 Scenario tests

Ten end-to-end fixtures, each run in both Simulation Only and Balanced, asserting the *deterministic* outcome is identical and only the prose differs:

player benched repeatedly (the full escalation ladder) · a broken promise · a surprise promotion challenge · a financial crisis · a hostile negotiation · an academy breakthrough · changing clubs mid-career · facing a former player · a board disagreement · **a ten-season career**.

The ten-season run is the important one. It asserts: memory table < 25,000 rows · no character reaches an emotional extreme without a traceable cause chain · arcs open and close (none stuck `active` for > 2 seasons) · drama budget never overdrawn · weekly reaction average ≤ 4 · no repetition-cluster above threshold · and, with AI off, an identical world.

### 1.4 Soak integration

Extend the existing nightly soak (doc 07 §A7) with AI-layer invariants:

```
11 Every narrative_event has a sim_event_id that exists          (already enforced by FK)
12 Every character_memory has a sim_event_id that exists
13 No memory is held by a character who fails canHold()
14 Drama budget spent ≤ allowance, always
15 No character has two active escalation stages on one topic
16 ai_calls.outcome='accepted' implies validation_json has no failures
17 Reaction count per week ≤ the configured cap
18 Emotion values ∈ [0,100]; no single tick moved one by more than the cap
```

---

## 2. Roadmap

| Stage | Phase | Deliverables | Exit criteria | Effort |
|---|---|---|---|---|
| **0 · Deterministic foundation** *(no LLM at all)* | 3 | character records; emotion model; memory (formation, decay, compression, visibility); retrieval; interest resolver; importance scoring; reaction FSM + escalation ladders; cooldowns; drama budget; **template renderer + voice lexicons**; structured conversation UI; AI debug console (template mode) | The vertical slice is fully playable with no API key and is *enjoyable*. Determinism test passes. Golden importance test passes. | **80–120 h** |
| **1 · AI expression** | 4 | `LlmProvider` + Anthropic impl; fact-sheet assembler; prompt layers; the 12 schemas; validator chain; response cache; cost controller; `ai_calls` logging | 500-fixture eval: 100% schema, 100% grounding, ≥ 4.0 consistency. Template fallback proven by fault injection. Cost within 20% of estimate. | **60–90 h** |
| **2 · Intent understanding** | 4 | free-text box; classifier; validity gate; confidence gate; **confirmation UI**; 60-second undo | ≥ 95% intent accuracy on the labelled set; 0 out-of-set intents in 1,000 adversarial inputs; no path applies an intent without confirmation | **40–60 h** |
| **3 · Character reasoning** | 5 | candidate-menu selection (L2); memory-aware reference; anti-repetition (similarity, topic exhaustion); local-provider backend | ≥ 80% candidate agreement; repetition < 5%; local backend passes the same schema gates **[C]** | **50–80 h** |
| **4 · Narrative director** | 5–6 | arc detectors; attention allocation; arc-aware retrieval; season retrospectives with provenance | 10-season soak: no stuck arcs, ≤ 5 active, ≥ 2 non-user-centric; every retrospective claim carries support | **60–90 h** |
| **5 · World intelligence** | 6–7 | journalists + quote memory; staff advisers; agent negotiation language; rival managers; supporter factions; generated biographies | Each ships behind its own toggle; each passes grounding and repetition gates; media provenance grades verified | **120–180 h** |

**Total: 410–620 h** on top of doc 08's 600–970 h. At 12.5 h/week that is another **8–12 months**, landing the full AI layer well after public alpha — which is the correct order.

**Deliberately delayed:** everything in Stage 5 until Stage 0–2 have survived real players; the personalised game master indefinitely; embeddings until a retrieval problem actually appears.

---

## 3. The first 40 tickets

Order is execution order. **Tickets 1–22 involve no model.** Difficulty: S < 2 h · M 2–6 h · L 6–15 h · XL 15 h+. "Auto" = Claude Code can likely do it from the spec.

| # | Title | Purpose | Modules | Acceptance | Tests | Deps | Diff | Auto | Main risk |
|---|---|---|---|---|---|---|---|---|---|
| 1 | AI balance constants file | Thresholds as data, not code | `sim/balance/ai.ts` | Every threshold, cooldown and cap in one typed, documented object | typecheck; no magic numbers elsewhere | — | S | Yes | none |
| 2 | Migration 0002 — memory/emotion/voice | Schema for the deterministic layer | `persistence/migrations` | Tables + indexes create; v1 save migrates | migration + invariant tests | 1 | M | Yes | schema churn later |
| 3 | Emotion model | Seven values that move for reasons | `sim/emotion` | `applyEvent()` pure; personality modifies magnitude only | direction, magnitude, cap, decay-to-baseline | 2 | L | Yes | balance feel |
| 4 | Emotion decay + baseline | Return to character, not to 50 | `sim/emotion` | Baseline derived from traits | 5-season drift stays bounded | 3 | M | Yes | none |
| 5 | Memory formation | Events → subjective rows | `sim/characters/memory` | Only whitelisted kinds; significance + valence computed | golden fixtures | 2,3 | L | Yes | over-storing |
| 6 | Memory visibility + `canHold` | The knowledge boundary | `sim/characters/memory` | Property test over random pairs finds no leak | property + unit | 5 | M | Yes | **highest-value test in the set** |
| 7 | Memory decay + compression | Bounded growth | `sim/characters/memory` | Season compression preserves `source_ids`; cap enforced | 10-season row-count soak | 5 | L | Yes | losing provenance |
| 8 | Memory retrieval + scoring | Top 7, deterministically | `ai/memory` (pure) | Same inputs → same rows, same order | determinism + ordering | 6,7 | M | Yes | none |
| 9 | Character voice registry | Stable identity per character | `sim/characters` | `VoiceTag` derived from seed; persisted | same seed → same voice | 2 | M | Yes | none |
| 10 | Interest resolver | Who cares about this event | `sim/characters` | SQL-backed, indexed, deterministic order | fixture week | 2 | M | Yes | none |
| 11 | Importance scorer | **The suppression engine** | `sim/characters` | Implements doc 14 §3.2 exactly | **golden test: 40 pairs → exact survivor set** | 10 | L | Yes | tuning is the whole game |
| 12 | Cooldown + topic exhaustion | Stop repetition at the source | `sim/characters` | `reaction_cooldowns` honoured; topics close | unit + season sim | 11 | M | Yes | none |
| 13 | Drama budget | Cap simultaneous conflict | `sim/characters` | Never negative; over-budget candidates dropped not queued | soak invariant 14 | 11 | M | Yes | none |
| 14 | Reaction FSM + escalation ladder | Valid candidates only | `sim/characters` | Stages cannot skip; ladder consumes lower stages | state-machine tests | 12,13 | XL | Partly | design-heavy |
| 15 | Effect application for reactions | Consequences are the sim's | `sim/engine` | Reactions emit effects through the existing applier | replay a day twice → identical | 14 | M | Yes | none |
| 16 | Template renderer | The floor the product ships on | `narrative/templates` | Data-driven; deterministic variant selection from the event RNG | **coverage: every event kind has ≥1 template** | 9 | L | Yes | quality of writing |
| 17 | Voice lexicons + banned phrases | Characters sound different with no model | `narrative/voices` | Per-`VoiceTag` lexicon applied by the renderer | manual read-through of 50 samples | 16 | M | Partly | authoring effort |
| 18 | Conversation UI (buttons only) | The action space, visibly | `renderer/screens` | Buttons generated from FSM valid moves | component + a11y | 14 | L | Yes | none |
| 19 | Promise integration | The callback that sells the thesis | `sim/systems/promises` | Conversation intents create promise rows; due dates scheduled | promise lifecycle | 18 | M | Yes | none |
| 20 | AI debug console (template mode) | Observability before there's anything to observe | `renderer/screens/AiDebug` | Shows trigger, candidates, scores, chosen, effects | manual | 11,14 | L | Yes | none |
| 21 | Determinism gate for characters | Lock the guarantee in | `tests` | Same seed → identical emotions, memories, arcs, template text | CI gate | 3–17 | M | Yes | none |
| 22 | **Slice checkpoint: playable with no AI** | Prove Stage 0 stands alone | — | Vertical slice completable; a tester enjoys it | playtest | 1–21 | — | No | **if this fails, stop** |
| 23 | `LlmProvider` interface + template impl | Vendor independence from line one | `ai/provider` | Template provider satisfies the interface | boundary test: no vendor id outside `provider/` | 1 | M | Yes | none |
| 24 | JSON schemas + generated types | The output contract | `ai/schema` | All 12 schemas; `additionalProperties:false`; all fields required **[C]** | schema self-validation | 23 | L | Yes | none |
| 25 | Fact-sheet assembler | The knowledge boundary, again | `ai/facts` | Whitelist only; `KnowledgeScope` filters; untrusted values delimited | leakage fixtures | 6,24 | L | Yes | **security-critical** |
| 26 | Prompt layer builder | Cache-stable prompt assembly | `ai/prompt` | L1..L5; breakpoint after L2; versioned | **prompt-lint: no clock/uuid/unsorted JSON in L1–L3** **[C]** | 25 | L | Yes | cache invalidation |
| 27 | Anthropic provider | The first real backend | `ai/provider/anthropic` | `messages.parse()` + `output_config.format`; Haiku 4.5 default **[C]** | integration vs a recorded fixture | 23,24 | M | Yes | none |
| 28 | Cache measurement harness | Verify caching actually happens | `ai/provider` | Asserts `cache_read_input_tokens > 0` on call 2 **[C]** | integration | 27 | M | Yes | **Haiku's 4096 minimum** |
| 29 | Validator: schema + grounding | The two gates that matter most | `ai/validate` | Foreign id anywhere → reject whole output | adversarial fixtures | 24,25 | L | Yes | none |
| 30 | Validator: permission + consistency | Authority, knowledge, voice | `ai/validate` | Out-of-authority statement → reject | fixtures per character type | 29 | M | Yes | none |
| 31 | Response cache | One event, one wording, forever | `ai/cache` | Keyed by event+template+model+schema | hit/miss + reproducibility | 27 | M | Yes | none |
| 32 | Cost controller + meter | Protect against bugs, not users | `ai/cost` | Per-call estimate; session + monthly caps; UI meter | cap enforcement | 27 | M | Yes | none |
| 33 | `ai_calls` logging (migration 0007) | Replay + audit surface | `persistence`, `ai` | Full record incl. fact sheet and per-gate results | round-trip | 27 | M | Yes | save size |
| 34 | Orchestrator + queue | Priority, cancellation, budget | `ai/orchestrator` | Interactive vs background; cancel is free | queue tests | 31,32 | L | Yes | none |
| 35 | Streaming utterance UI | Make 2 s feel like 0.4 s | `renderer` | First token < 500 ms; template already on screen | manual + p95 | 34 | M | Yes | none |
| 36 | Fault-injection fallback test | Prove the floor holds | `tests` | Kill the provider mid-call → template, no error surfaced | integration | 34 | M | Yes | none |
| 37 | Intent classifier + confidence gate | Free text → closed enum | `ai`, `renderer` | Never returns an out-of-set intent; < 0.75 → show alternatives | 100-item labelled set | 27,18 | L | Yes | misclassification |
| 38 | Interpretation confirmation + undo | Nothing commits unseen | `renderer`, `sim` | Interpretation shown; 60 s undo restores rows and logs a retraction | integration | 37,19 | M | Yes | none |
| 39 | Injection screening at import | Untrusted names, handled | `sync/snapshot`, `ai/facts` | Instruction-shaped names flagged in Sync Doctor, delimited in prompts | adversarial name fixtures | 25 | M | Yes | false positives |
| 40 | `tools/ai-eval` + `tools/ai-replay` | Make prompt changes measurable | `tools` | Replays a stored call without touching the save; scores the corpus | self-test | 33 | L | Yes | judge calibration |

**Note the shape:** the model does not appear until ticket 27, and the checkpoint at ticket 22 exists to make it possible to stop before then. If Stage 0 is not enjoyable without a model, the honest response is to fix the simulation rather than to buy prose.
