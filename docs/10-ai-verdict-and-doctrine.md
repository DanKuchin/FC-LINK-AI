# 10 — AI: Executive Recommendation, Doctrine, and the Control Boundary

> Evidence labels as elsewhere: **[C]** confirmed with a citation · **[I]** inferred · **[A]** assumption · **[P]** proposed design.

---

## 1. Executive recommendation

**Build the AI layer. Build it fourth.**

The football world can absolutely be made to feel like it notices, remembers and responds — but almost none of that feeling comes from a language model. It comes from a deterministic memory of what the manager did, a set of characters whose reactions are *caused* rather than sampled, and a scarcity rule that makes interactions rare enough to matter. The LLM's job is to make those reactions sound like a person said them.

Concretely, the recommendation is:

1. **AI is a renderer and a parser, never a decider.** Two jobs only: turn a simulation-decided fact into words, and turn the user's words into one of a fixed set of intents. Everything between those two ends is deterministic TypeScript.
2. **The action space is always a menu.** When AI "chooses" a character's reaction, it chooses from candidates the simulation already computed and validated. It never proposes an action the rules didn't offer.
3. **Ship the template implementation first and make it good enough to launch.** If the game is not enjoyable with `NarrativeProvider = TemplateProvider`, adding an LLM will paper over a design problem at 5,000 API calls a season.
4. **Route on task, not on prestige.** Classification and character lines go to Haiku 4.5; season-scale prose goes to Sonnet 5. Opus-tier belongs in development (authoring templates, tuning personalities), not in the per-event hot path.
5. **Sequence it after the bridge is proven.** None of this is on the critical path for doc 06's MVP, and building it before the Phase 0 spike answers whether results can be imported would be building a reaction layer with nothing to react to.

**The uncomfortable part of the recommendation:** the largest risk here is *not* hallucination. It is that generated dialogue is cheap and infinite, and a football manager's attention is not. A game where every player will talk to you at any time about anything has destroyed the thing that makes a conversation matter. **Scarcity is the feature.** Most of the design work below is about not generating text.

---

## 2. AI design philosophy

Six principles, in priority order. Where two conflict, the higher one wins.

**1 · The simulation is the only source of truth.**
Every generated sentence traces to a row in `sim_events`. If there is no event, there is no line of dialogue — not a hedged one, not a generic one, none. This is already enforced in the schema: `narrative_events.sim_event_id` is `NOT NULL` with a foreign key, and there is a test for it.

**2 · Determinism first, expression second.**
Build the emotion, memory, relationship and reaction systems with no model attached. When they work — when a director's confidence is a pure function of the event log and you can replay a season to the same board state — *then* let a model choose the words. This ordering is not aesthetic; it is what makes the AI layer optional, testable, and cheap to switch off.

**3 · A menu, never a blank page.**
The LLM's output space is always constrained: a JSON schema, an enum of intents, a set of candidate reactions. An LLM asked "what does this player do?" can invent a transfer request out of nothing. An LLM asked "which of these three valid reactions fits this personality, and how would he say it?" cannot.

**4 · Scarcity over volume.**
A player who asks about playing time once, in November, after being left out four times, is a character. A player who comments after every match is a notification. The event importance scoring in doc 14 exists to *suppress* dialogue, and its success metric is how much it refuses to generate.

**5 · Consistency over surprise.**
Characters should be predictable enough that the player can form a model of them, and change slowly enough that the change is legible. A director who is patient in August and volcanic in September without a recorded cause is a bug, not drama.

**6 · The player must always be able to tell what is simulated and what is written.**
Numbers, outcomes, and money come from the simulation and are shown as such. Prose is prose. When AI is off, the game says so plainly and loses nothing structural.

---

## 3. What AI controls, and what it must never touch

### 3.1 The boundary

| The simulation decides (deterministic, testable, replayable) | AI may decide (expression only) |
|---|---|
| Match results, table positions, competition rules | How a result is *described* and by whom |
| Money: balances, budgets, wages, fees, instalments | How a finance director *argues* about money |
| Contracts, transfers, registration, squad membership | The *language* of a negotiation turn |
| Injuries, suspensions, fitness, form, development | How a physio or player *talks about* an injury |
| Personality trait values, emotion values, relationship values | How those values *sound* in a given sentence |
| Promises: creation, state, whether one is broken | How a broken promise is *raised* |
| Board confidence, objectives, the sack | How each director *phrases* their position |
| Which characters react at all, and how strongly | Which of the offered valid reactions is chosen |
| Whether a memory is formed, and its significance | How that memory is *recalled* in conversation |
| Every consequence of a user decision | Nothing |

### 3.2 How the separation is enforced technically

Four mechanisms, each independently sufficient to stop a rogue model, deliberately stacked:

**(a) The model has no write path.** There is no code path from an LLM response to a mutating SQL statement. The AI layer returns `NarrativeOutput` or `IntentInterpretation` objects. Those are consumed by deterministic systems that decide, on their own rules, whether to emit an effect. Enforced by the existing boundary test — `packages/narrative` may not import `packages/persistence` — extended to forbid it importing `packages/sim/engine` too.

**(b) Facts are supplied, never fetched.** The model receives a `FactSheet`: a frozen, whitelisted projection built by a deterministic assembler. It has no tool that reads the database. "Tools" in this design are *proposal* tools — their outputs are suggestions the simulation may reject — and even those arrive in Stage 3, not Stage 1.

**(c) Every output is schema-validated, then fact-checked.** Schema validation (`output_config.format` with a JSON schema **[C]**) catches shape. A second pass — the grounding validator — checks that every entity id, number and event reference in the output appeared in the `FactSheet`. Anything else is discarded and the template used.

**(d) The narrative row cannot exist without the fact.** `narrative_events.sim_event_id NOT NULL REFERENCES sim_events(id)` is the last line of defence, and it is in the database rather than in application code on purpose.

### 3.3 The one thing this boundary costs

Being honest about the trade: a model constrained this tightly cannot produce the emergent surprise that people imagine when they picture "AI in a game." It will never invent a scandal you didn't simulate. That is the correct trade for a management game whose entire value proposition is that consequences are real — but it does mean **the interestingness has to come from the simulation design, not from the model.** If the simulation is shallow, no amount of prompt engineering will rescue it, and the AI layer will read as elaborate ways of saying "we drew 1–1."

---

## 4. Where this sits in the plan

Relative to the roadmap in doc 06:

| Phase | Status | AI work |
|---|---|---|
| 0 — spike | **blocked on Live Editor** | none |
| 1 — vertical slice | not started | none |
| 2 — career foundation | not started | none |
| 3 — Board & Mandate | not started | **Stage 0**: deterministic characters, emotions, memory, reaction selection, templates. No LLM. |
| 4 — world simulation | not started | **Stage 1–2**: LLM expression + intent parsing, one character type |
| 5 — season rollover | not started | **Stage 3**: reaction selection from candidates; season retrospectives |
| 6–7 — alpha | not started | **Stage 4–5**: narrative director, media, rivals |

**Stage 0 is not a preamble to the AI work. Stage 0 is most of the AI work.** The model arrives in Phase 4 and does two narrow jobs. If Stage 0 slips, everything after it should slip with it rather than being replaced by prompting.
