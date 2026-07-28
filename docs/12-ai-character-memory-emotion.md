# 12 — Character, Memory, and Emotion Architecture

---

## 1. Character architecture

### 1.1 The multi-agent question, answered

Five options were on the table. The recommendation is **rule-based state machines with LLM expression, driven by a lazy activation model** — option 4 with a thin orchestrator.

| Option | Verdict |
|---|---|
| One shared LLM, separate prompts | Too thin — no state, no consistency, no memory. This is what "add a chatbot" looks like. |
| Orchestrator + character profiles | Close, but implies the model drives the loop. It must not. |
| **Persistent autonomous agents** | **Reject.** 17,000 players × continuous reasoning is an unbounded cost and an unbounded consistency problem, and it buys nothing a scheduled deterministic tick doesn't. See doc 19. |
| **Rule-based FSM + LLM expression** | **Recommended.** State, transitions, cooldowns and effects are code; the model renders. Testable, replayable, cheap, switch-off-able. |
| Hybrid | This *is* the hybrid — the split is by responsibility, not by character. |

### 1.2 The lazy character lifecycle

A "character" is not a running process. It is a row that gets loaded, consulted, and put back.

```
sim_event emitted
   └→ interest resolver: which characters care about this event kind + subject?   (SQL)
      └→ importance score computed per (event, character)                          (pure fn)
         └→ below threshold / on cooldown / drama budget spent → STOP (no cost)
            └→ ACTIVATE:
               1. load deterministic state (personality, emotion, relationships)
               2. retrieve memories (bounded: ≤7, scored)
               3. compute VALID REACTIONS from the FSM                     ← simulation decides
               4. select one (Stage 0–2: deterministic; Stage 3: LLM picks from the menu)
               5. apply effects, write sim_event, write memory              ← simulation decides
               6. render wording (template, or LLM)                        ← the only AI step
               7. deactivate — nothing persists in process memory
```

Steps 1–5 run with no model at all. Step 6 is the only place an API key is needed, and it is skippable.

### 1.3 Character record

```ts
interface CharacterRef { type: CharacterType; id: number }
type CharacterType =
  | 'player' | 'board_member' | 'staff' | 'agent' | 'journalist'
  | 'rival_manager' | 'supporter_group';

interface CharacterCore {
  ref: CharacterRef;
  displayName: string;
  /** Stable voice identity — selects template sets AND seeds the role prompt layer. */
  voice: VoiceTag;                       // e.g. 'blunt_veteran', 'measured_technocrat'
  traits: PersonalityTraits;             // 1–100, derived deterministically, rarely changes
  authority: AuthorityScope;             // what this character may even talk about
  knowledge: KnowledgeScope;             // what they can possibly know (see §2.6)
  seed: string;                          // derivation seed — regeneratable, auditable
}
```

`traits` are derived, not rolled: age, potential gap, international reputation, contract situation and squad status feed a seeded derivation (already implemented for players in `packages/sim/systems/personality.ts`). This matters because a randomly-rolled personality that contradicts what the user knows about a real footballer breaks the fiction instantly.

---

## 2. Memory architecture

### 2.1 Storage decision: SQL only. No vector database in v1.

Compare honestly:

| Option | Verdict for this product |
|---|---|
| **SQL only (+ FTS5)** | **Recommended.** A ten-season career produces on the order of **5,000–20,000** memory rows across all characters. **[A]** Retrieval is `WHERE subject_id = ? AND character_id = ? ORDER BY score DESC LIMIT 7`. That is a millisecond, indexed. |
| Vector DB | Rejected for v1. Adds an embedding model, a similarity index, a dependency, a migration story, and a cost line — to solve a problem that does not exist at this scale. |
| Hybrid SQL + embeddings | Deferred. The *one* place it might earn its place is free-text search over a decade of career history for the retrospective feature. `sqlite-vec` alongside FTS5 with reciprocal-rank fusion is the well-trodden pattern if that day comes **[C]**, and both live in the same SQLite file — so this is an additive change, not a rewrite. |
| Knowledge graph | Rejected. `relationships` already *is* a graph, queried relationally. A second graph store buys nothing. |

**The honest reasoning:** memory retrieval here is *not* semantic search. It is "what does this specific person remember about this specific subject, weighted by significance and recency." That is a scoring query over a small, well-typed table. Reaching for embeddings would be importing a solution to somebody else's scale problem.

### 2.2 Memory taxonomy

| Kind | Holder | Lifespan | Example |
|---|---|---|---|
| **Short-term** | individual | ≤ 90 days, decays fast | "I was left out at Everton" |
| **Long-term** | individual | years, decays slowly | "He gave me my debut" |
| **Emotional** | individual | attached to a relationship edge, not an event | resentment toward the manager |
| **Relationship** | pair | until superseded | "We fell out over the captaincy" |
| **Institutional** | club | permanent | "This club sold its best player three summers running" |
| **Public** | world | permanent, queryable by anyone | a completed transfer, a result, a press quote |
| **Private** | individual | permanent, restricted | what was said in a one-to-one |
| **Distorted** | individual | derived at read time | a low-`professionalism` player's version of a conversation |

Distortion is a *read-time transformation*, never a stored lie: the row is true, and `distortion` describes how this character misremembers it. This keeps the audit trail honest and makes "why did he say that?" answerable.

### 2.3 Schema

```sql
-- APPEND ONLY. Migration 0002.
CREATE TABLE character_memories (
  id             INTEGER PRIMARY KEY,
  career_id      INTEGER NOT NULL REFERENCES careers(id),
  holder_type    TEXT    NOT NULL,      -- player | board_member | staff | agent | journalist | club | world
  holder_id      INTEGER NOT NULL,
  subject_type   TEXT,                  -- who/what it is about
  subject_id     INTEGER,
  kind           TEXT    NOT NULL,      -- promise_made | benched | debut_given | defended_publicly | …
  sim_event_id   INTEGER NOT NULL REFERENCES sim_events(id),   -- grounding, non-negotiable
  occurred_on    INTEGER NOT NULL,
  significance   INTEGER NOT NULL,      -- 1..100 at formation
  valence        INTEGER NOT NULL,      -- -100..100, from THIS holder's perspective
  visibility     TEXT    NOT NULL       -- public | private | club | pair
                 CHECK (visibility IN ('public','private','club','pair')),
  distortion     TEXT,                  -- null | exaggerated | minimised | misattributed
  facts_json     TEXT    NOT NULL,      -- structured, prose-free
  decay_rate     REAL    NOT NULL DEFAULT 1.0,
  permanent      INTEGER NOT NULL DEFAULT 0,
  superseded_by  INTEGER REFERENCES character_memories(id),    -- compression pointer
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_mem_recall  ON character_memories (career_id, holder_type, holder_id, subject_type, subject_id, occurred_on);
CREATE INDEX idx_mem_signif  ON character_memories (career_id, holder_type, holder_id, significance DESC)
                              WHERE superseded_by IS NULL;

-- Compressed summaries. Also append-only; originals are never deleted, only pointed away from.
CREATE TABLE memory_summaries (
  id            INTEGER PRIMARY KEY,
  career_id     INTEGER NOT NULL REFERENCES careers(id),
  holder_type   TEXT    NOT NULL,
  holder_id     INTEGER NOT NULL,
  subject_type  TEXT, subject_id INTEGER,
  kind          TEXT    NOT NULL,       -- e.g. 'repeated_omission'
  count         INTEGER NOT NULL,
  first_on      INTEGER NOT NULL,
  last_on       INTEGER NOT NULL,
  significance  INTEGER NOT NULL,
  valence       INTEGER NOT NULL,
  facts_json    TEXT    NOT NULL,
  source_ids_json TEXT  NOT NULL        -- the memory ids folded in — provenance preserved
);
```

### 2.4 What is stored, and what is not

**Store** (all of these change a future decision): promises made/kept/broken · selection decisions at *significant* moments only (finals, derbies, after a promise) · public defence or criticism · debut given · captaincy granted/removed · transfer request refused/accepted · a teammate sold · a conversation outcome · a negotiation that turned hostile · a board refusal · a prediction a journalist made.

**Do not store:** routine selections, routine results, anything with `significance < 20`, anything already derivable from `sim_events` by query (the event log *is* the archive; `character_memories` is the *subjective index* over it).

### 2.5 Decay, compression, and bounded growth

```
effective_significance = significance
                       × exp(-decay_rate × days_since / HALF_LIFE_DAYS)
                       × (permanent ? 1 : 1)          // permanent skips decay entirely
```

Four rules keep the table from growing without limit:

1. **Season-boundary compression.** ≥ 4 memories of the same `(holder, subject, kind)` within a season collapse into one `memory_summaries` row; originals get `superseded_by` set. A player doesn't remember eleven separate benchings, he remembers *"that autumn."*
2. **Decay pruning.** At rollover, non-permanent memories with `effective_significance < 5` are marked superseded.
3. **Permanent set.** Debuts, trophies, sackings, relegations, career-defining transfers, kept and broken promises never decay.
4. **Per-holder cap.** Soft cap of 200 live memories per character; exceeding it forces early compression.

Projected steady state: **< 25,000 rows for a ten-season career.** A soak test asserts it.

### 2.6 Preventing a character from knowing what they cannot know

This is the failure that destroys immersion fastest, and it is fixed in the retrieval layer, not the prompt.

```ts
function canHold(holder: CharacterRef, memory: MemoryRow): boolean {
  switch (memory.visibility) {
    case 'public':  return true;
    case 'club':    return sameClub(holder, memory);
    case 'pair':    return isParty(holder, memory);
    case 'private': return isHolder(holder, memory);
  }
}
```

`retrieveMemories()` applies this filter *before* scoring, so an unauthorised memory can never reach a fact sheet. Separately, `KnowledgeScope` gates fact-sheet assembly: a journalist's sheet never contains wage figures; a squad player's never contains another player's contract. **A prompt instruction saying "don't mention private information" is not a control — the information must not be in the context window.**

### 2.7 Retrieval scoring

```ts
score = effectiveSignificance
      * (1 + 0.6 * subjectMatch)        // about the current subject
      * (1 + 0.4 * kindRelevance)       // relevant to this event kind
      * (1 + 0.5 * unresolvedArc)       // part of a live narrative arc
      * (1 + 0.3 * relationshipWeight)  // involves someone they care about
      * recencyBoost;
```

Take the top **7**, hard cap. More context does not produce better character writing; it produces longer prompts, higher cost, and a model that name-drops.

### 2.8 Conflicting memories

Two characters remembering the same event differently is *correct* and must be preserved — that is the "different characters interpret the same event differently" requirement. Implementation: one `sim_event`, N `character_memories` rows with different `valence`, `significance` and `distortion`. Nothing reconciles them. The event log holds the fact; the memories hold the interpretations.

---

## 3. Relationship and emotion model

### 3.1 State

```sql
-- Migration 0002
CREATE TABLE character_emotions (
  character_type TEXT NOT NULL, character_id INTEGER NOT NULL,
  career_id      INTEGER NOT NULL REFERENCES careers(id),
  trust        INTEGER NOT NULL DEFAULT 50,   -- toward the manager
  respect      INTEGER NOT NULL DEFAULT 50,
  resentment   INTEGER NOT NULL DEFAULT 0,
  confidence   INTEGER NOT NULL DEFAULT 50,   -- in themselves
  frustration  INTEGER NOT NULL DEFAULT 0,
  belonging    INTEGER NOT NULL DEFAULT 50,   -- at this club
  pressure     INTEGER NOT NULL DEFAULT 0,    -- external, felt
  updated_on   INTEGER NOT NULL,
  PRIMARY KEY (career_id, character_type, character_id)
);
```

Seven values, not eleven. `affection`, `fear`, `loyalty` and `motivation` were cut because each was either a rename of one above or had no distinct gameplay consequence. **A value that doesn't change a decision doesn't exist** — the same rule as attributes.

### 3.2 How events move them

```ts
delta = baseDelta(eventKind)
      * personalityModifier(traits, eventKind)   // e.g. high professionalism halves frustration gains
      * contextModifier(clubState, careerStage)
      * (1 - resistance(currentValue));          // asymptotic: extremes are hard to reach
```

- **Personality modifies magnitude, never direction.** A loyal player still resents being dropped; he resents it less. This is what keeps characters legible.
- **Asymptotic approach** means trust at 90 moves slowly and trust at 50 moves fast. Nobody flips from devoted to hostile in one week.
- **Decay toward a personal baseline** (derived from traits), not toward 50 — a naturally suspicious character returns to suspicious.
- **A hard per-tick cap** on total movement, so no single event can cause a personality change. Anything larger requires a *sequence*, which by construction leaves an audit trail.

### 3.3 What the model sees

Never raw integers. The fact sheet carries **bands**: `trust: 'guarded'`, `frustration: 'high'`, plus a `trajectory: 'falling'`. Three reasons: bands are stable under balance changes (retuning a constant doesn't invalidate every cached line), they prevent the model from quoting a number the UI doesn't show, and they map cleanly onto the language constraints below.

### 3.4 Constraining language by emotional state

The role prompt layer receives hard bounds, not suggestions:

```
trust=guarded, resentment=high, respect=high →
  MUST NOT: warm address, expressions of gratitude, agreement without condition
  MUST: professional register, at least one condition or reservation
  MAY: reference a specific past grievance from the supplied memories
```

The grounding validator checks the MUST NOTs it can check mechanically (banned phrase classes, forbidden entity references). The rest is covered by the character-consistency evaluation in doc 18.

### 3.5 Not exposing values to the user

The Player and Boardroom screens show **stated positions and observable behaviour**, never numbers. "He has not spoken to you since the Villa game" is information. "Trust: 34" is a debug view — available in the AI debug console, never in the game.
