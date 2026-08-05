# 19 — AI Risks, Rejected Features, Verdict, and Next Actions

---

## 1. Ranked risk register

| # | Risk | P | Impact | Early warning | Prevention | Recovery | Phase |
|---|---|---|---|---|---|---|---|
| 1 | **The AI layer makes the game worse** — chatter replaces meaning | **High** | **Fatal to the feature** | Testers switch it off; "I stopped reading these" | Scarcity by construction (doc 14 §3.2); ticket 22 checkpoint; ship templates first | Raise thresholds; the game is already complete without it | Stage 0 |
| 2 | **Deterministic layer under-built, prompting used to compensate** | **High** | **Fatal** | Prompts growing to encode game rules; "just tell the model to remember" | The stage gates; boundary tests; the model has no state | Stop and build the system properly — this is not recoverable by prompting | Stage 0–1 |
| 3 | Repetition | High | High | Similarity metric climbing; testers skipping dialogue | Escalation ladder, topic exhaustion, refusal-to-generate, voice lexicons | Tighten cooldowns; suppress a topic entirely | Stage 1–3 |
| 4 | Grounding failure reaching the user | Med | **High — breaks the pillar** | Grounding rejection rate > 2% | Five-gate chain; `NOT NULL` FK; numbers never generated | Template fallback is automatic; the FK makes the worst case impossible | Stage 1 |
| 5 | Cost blowout from a bug (not from play) | Med | Med | Session cost meter jumping; `ai_calls` per week climbing | Hard caps; per-event cache; golden importance test | Caps degrade to templates automatically | Stage 1 |
| 6 | Latency ruining the turn | Med | Med | p95 > 3 s | Nothing generative on the critical path; streaming; background queue | Move the class to background | Stage 1 |
| 7 | Character inconsistency / drift | Med | Med | Consistency score < 4.0; testers say "he wouldn't say that" | Bands not raw values; voice lexicons; emotion caps; the consistency eval | Regenerate; tighten the role layer | Stage 1–3 |
| 8 | Intent misclassification costing a player something | Med | **High — trust** | Undo usage; support reports | Closed enum; validity gate; **confirmation before commit**; 60 s undo | Undo; the confirmation step means this should be near-zero | Stage 2 |
| 9 | Prompt injection via modded FC data | Low-Med | Med | Odd entity names in Sync Doctor | Delimiting, sanitisation, and — decisively — no action space | Nothing to recover: injection can only produce text that then fails grounding | Stage 1 |
| 10 | Provider lock-in | Med | Med | Vendor identifiers leaking out of `provider/` | The interface + the boundary test | Swap implementations; schemas are provider-neutral | Stage 1 |
| 11 | Provider price/API change | Med | Low-Med | Release notes | Routing is config; templates always available | Re-route; re-measure | ongoing |
| 12 | Save bloat from `ai_calls` | Med | Low | Save size growth | Cap retention (last 2,000 calls, plus all `template_fallback`) | Prune; it is an append-only log, not state | Stage 1 |
| 13 | Judge-based evaluation drifting | Med | Med | Judge/human correlation < 0.7 | A human-labelled calibration set, re-scored each release | Re-calibrate; fall back to human review | Stage 1 |
| 14 | Content authoring load (templates, lexicons) | **High** | Med | Template coverage test failing; repetitive template text | Templates are data; coverage is a CI gate; prioritise the ten most-seen events | Accept less variety; community contribution later | Stage 0 |
| 15 | Scope creep — building Stage 5 before Stage 2 lands | **High** | High | Journalists appearing before the board works | The stage gates are the contract | Cut back to the slice | all |
| 16 | Users expecting an open-ended AI chat | Med | Low-Med | "Why can't I just talk to anyone?" | Say plainly what the system is and why | Explain the design; do not build it | Stage 2+ |
| 17 | **The Director quietly manipulates outcomes for drama** | Med | **Fatal to trust** | Same actions produce different state with Director off; suspiciously timed crises | Director has a read-only interface; non-interference replay gate; no target emotional curve | Disable Director and invalidate the feature until replay equality is restored | Stage 4+ |
| 18 | Social behavior depends on prompt/model accidents | High if LLM-decided | High | Provider or persona-format change shifts relationships or aggregate outcomes | No runtime LLM social decisions; micro/meso/macro robustness audit | Revert to deterministic candidate and propagation rules | Stage 1+ |
| 19 | Institutional breadth becomes invisible bookkeeping | Med | High | Testers cannot explain who had authority or why a decision mattered | Decision lens; one screen per state; “property changes a decision or is cut” | Remove state that does not alter an understood decision | Stage 6 |
| 20 | Broader vision destroys the shipping sequence | **High** | **Fatal to delivery** | Authority, leaks or chapters begin before Board & Mandate works | Tickets 41–48 are horizon-gated; Phase 0–3 order unchanged | Freeze new systems; return to the last playable gate | all |

---

## 2. Features to reject

For each: why it's attractive, why it's dangerous, and whether a safer version exists.

**Every player as a persistent autonomous agent.**
*Attractive:* the fantasy of a world thinking about you while you're away.
*Dangerous:* 17,000 continuously reasoning entities is unbounded cost, unbounded latency, and — worst — unbounded inconsistency, because nothing constrains what each concludes. It also destroys determinism, which takes the soak tests, replay, and reproducible saves with it.
*Safer version:* **yes, and it's the recommended design.** Lazy activation gives the same felt result — characters that *appear* to have been thinking — at bounded cost, because a memory retrieved on demand is indistinguishable from a memory continuously held.

**AI deciding match results.**
*Attractive:* richer match narratives.
*Dangerous:* the entire product premise is that FC plays the match. Also: no telemetry exists to reason from.
*Safer version:* none needed. This is a category error.

**Unlimited free-text conversation.**
*Attractive:* maximum expression.
*Dangerous:* the game must map arbitrary language onto a finite consequence space, and every mismapping costs the player something real.
*Safer version:* **yes — the hybrid.** Free text is fully available; it resolves to a closed intent set and is confirmed before it commits.

**AI inventing scandals and events.**
*Attractive:* surprise, drama, "emergent storytelling."
*Dangerous:* it severs narrative from simulation. Once a story can exist without a cause, no story has a cause, and the pillar collapses.
*Safer version:* **yes.** Let the *simulation* generate more event types — that is where surprise should come from — and let the model dramatise them.

**AI proposing bounded mechanical effects.**
*Attractive:* the model appears creative while a validator clamps unsafe values.
*Dangerous:* a clamp limits magnitude, not causality. Changing model, prompt or
provider can still turn one career into `trust -4` and another into
`transfer_openness +8`, destroying deterministic replay and making balance
impossible to attribute.
*Safer version:* **yes.** Author deterministic event families and reaction state
machines. At runtime the model receives the selected reaction, a whitelisted
fact sheet, and mechanically equivalent expression plans; it writes only the
expression and never receives an effect field to reproduce or alter.

**A Director targeting an emotional trajectory.**
*Attractive:* cinematic pacing with planned calm and crisis beats.
*Dangerous:* the system begins manufacturing or withholding pressure to steer
the player, which is hidden difficulty adjustment under a narrative name. Quiet
weeks and abruptly ended arcs are legitimate consequences of player agency.
*Safer version:* attention budgets and arc detection only. The Director changes
what is surfaced, never what becomes true.

**AI controlling club finances.**
*Attractive:* organic-feeling economics.
*Dangerous:* money must be auditable. `balance = SUM(financial_transactions)` is already an invariant with a test.
*Safer version:* AI *argues* about money as the finance director. It never moves any.

**AI generating transfers without rules.**
*Attractive:* a market that feels alive.
*Dangerous:* implausible deals compound across seasons and destroy the world faster than anything else in this list.
*Safer version:* rule-based squad planning with deterministic valuation; AI narrates.

**AI replacing the database.**
*Attractive:* no schema work.
*Dangerous:* a language model is not a store. No transactions, no invariants, no migrations, no replay.
*Safer version:* none. SQLite is the store.

**Rewriting the world every day.**
*Attractive:* freshness.
*Dangerous:* cost, latency, and total loss of continuity.
*Safer version:* event-driven reaction, which is the design.

**Voice conversations.**
*Attractive:* immersion.
*Dangerous:* TTS cost per line, voice-consistency problems across hundreds of characters, accessibility complications, and a large build. For a solo developer this is a product on its own.
*Safer version:* possibly one voice — a single narrator for season retrospectives — long after 1.0. Not per-character dialogue.

**Real-time match commentary.**
*Attractive:* obvious.
*Dangerous:* **structurally impossible here.** The bridge yields cumulative season aggregates and per-match lines only by diffing snapshots **[C]**. There are no in-match events to commentate. Any attempt would be pure invention, which is the one thing this design forbids.
*Safer version:* a post-match report built from the *diffed* lines — who played, scored, was booked, was injured — which is honest and already planned.

**AI-generated faces.**
*Attractive:* visual identity for regens.
*Dangerous:* an image pipeline, a licensing question, a consistency problem, storage, and a whole new failure surface — for a product that is deliberately text-first.
*Safer version:* generated *initials/monogram* identity marks, deterministic from the seed. Zero cost, zero risk.

**Personalised game master adjusting difficulty.**
*Attractive:* a game that fits you.
*Dangerous:* the moment a player suspects outcomes are being tuned to their behaviour, every result becomes suspect. In a game whose selling point is consequence, this is the most damaging feature on the list.
*Safer version:* presentation-only personalisation, visible and resettable (doc 11 §P).

---

## 3. Estimated effort

| Stage | Hours |
|---|---:|
| 0 · Deterministic foundation | 80–120 |
| 1 · AI expression | 60–90 |
| 2 · Intent understanding | 40–60 |
| 3 · Character reasoning | 50–80 |
| 4 · Narrative director | 60–90 |
| 5 · World intelligence | 120–180 |
| 6 · Institutional career | 140–220 |
| **AI + institutional total** | **550–840** |
| Base product (doc 08) | 600–970 |
| **Combined** | **1,150–1,810 h ≈ 21–34 months at 12.5 h/week** |

Content authoring — templates, voice lexicons, evaluation corpora — is inside those numbers and is roughly **25% of Stage 0**. It is the part most likely to be underestimated, because it is writing rather than coding.

---

## 4. Go / no-go

**GO on the design. NO-GO on starting it now.**

**Go**, because the doctrine holds under examination: the simulation decides, AI expresses, and every mechanism that could let a model corrupt a career has been designed out rather than guarded against — no write path, no read tools, facts assembled not fetched, numbers never generated, a foreign key that makes an ungrounded narrative row impossible to insert. The cost is genuinely modest (~$0.75/season at normal play), the latency is manageable, the whole layer is switch-off-able, and the vertical slice is small.

**Not now**, for three reasons, in order of weight:

1. **The bridge is still unproven.** Phase 0 has not run — Live Editor won't inject into the current game build. A reaction layer with no imported results to react to is a demo of a prompt.
2. **Stage 0 is where the value is, and Stage 0 is Phase 3 work.** Memory, emotion, promises, escalation and suppression are the features. They need the board system underneath them.
3. **The honest risk ranking puts "the AI makes it worse" first.** Not hallucination, not cost — *volume*. The mitigation is a design discipline that has to be proven against real players, and that requires a game to prove it in.

**The condition for starting:** Phase 3 complete — board, promises, and mandate working, with the deterministic slice playable. Then Stage 0, then the ticket-22 checkpoint, and only then an API key.

**Abort conditions, decided now:**
- Ticket 22 fails — the slice isn't enjoyable without AI → **stop and fix the simulation.** Do not proceed to Stage 1.
- Grounding rejection rate stays above 5% after prompt iteration → the fact-sheet design is wrong; fix it before shipping any generated prose.
- Testers turn AI off and prefer it that way → ship templates as the product and treat AI as an optional extra, permanently.

---

## 5. The exact next seven actions

The first four are not AI work. That is the recommendation, not an oversight.

1. **Unblock Phase 0.** Get Live Editor to a version compatible with FC 26 build `1.0.138.57785`, then run the six spike scripts and `node spike/report.mjs`. Nothing in docs 10–19 matters if results can't be imported. *(~4 h once the tool is updated)*
2. **Finish Phase 1–2** as written in doc 06: the vertical slice, then the career foundation. No AI work runs in parallel — it would be designing reactions to events that don't exist yet. *(the existing roadmap)*
3. **While Phase 3 board work is underway, write `packages/sim/balance/ai.ts`** — ticket 1. Every threshold, cooldown and cap in one typed file, with the reasoning in comments. It costs an hour and it forces the tuning conversation to happen before any code depends on the numbers. *(1 h)*
4. **Write ten template-rendered board reactions by hand**, before any code. Read them aloud. If a director's four possible responses to a bad run are not interesting as authored text, no model will make them interesting. This is the cheapest possible test of the core premise, and it can be done in a text file tonight. *(2 h)*
5. **Build the memory visibility test first** — ticket 6, ahead of tickets 3–5. Write `canHold()` and its property test before the memory system exists. The knowledge boundary is the one thing that, if wrong, is wrong everywhere at once and is very hard to retrofit. *(3 h)*
6. **Assemble the intent corpus early.** Start a file now; every time you imagine something you'd say to a player or a director, write it down with its intended intent. You need 100+ labelled utterances for ticket 37, and collecting them over months of design work is free — collecting them in one sitting is a chore that produces a corpus in your own voice only. *(ongoing, ~0 h)*
7. **Re-measure the cost model with `count_tokens` before publishing any number.** Every figure in doc 16 §3 is an `[A]` estimate over assumed prompt sizes. One call per prompt archetype against `claude-haiku-4-5` converts the whole section from an estimate to a measurement — and the Haiku 4,096-token cache minimum means the answer may change the prompt design. *(1 h, once a key exists)*

Roughly seven hours of AI-specific work, none of it urgent, and four of the seven actions are "finish the thing this depends on."

---

## Sources

- Model IDs, pricing, structured outputs (`output_config.format`, `messages.parse()`), strict tool use, prompt-caching mechanics and per-model minimum cacheable prefixes: the bundled `claude-api` skill (cached 2026-06-24) **[C]**
- FC data ceiling — season aggregates only, per-match detail by snapshot diffing: [docs/00](00-verdict-and-feasibility.md), from [FC 26 Live Editor's Lua API](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/LUA-API) **[C]**
- Grammar-constrained local structured output: [llama.cpp grammars](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md), [structured output overview](https://deepwiki.com/ggml-org/llama.cpp/8.1-grammar-and-structured-output) **[C]**
- Hybrid SQLite retrieval (`sqlite-vec` + FTS5 + reciprocal rank fusion), if embeddings are ever needed: [hybrid RAG in SQLite](https://media.patentllm.org/blog/database/hybrid-rag-200-lines) **[C]**
