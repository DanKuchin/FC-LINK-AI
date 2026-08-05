# 13 — Conversation, Negotiation, and the World's Actors

---

## 1. Conversation design

### 1.1 The comparison

| Approach | Expression | Comprehension risk | Cost | Verdict |
|---|---|---|---|---|
| Fixed dialogue choices | Low | None | Zero | Safe, flat. Football Manager's known weakness. |
| Free text, unconstrained | High | **High** — the game must guess what you meant, and will sometimes be wrong in a way that costs you a player | Per turn | Rejected alone |
| **Contextual action buttons** | Medium | None | Zero | The backbone |
| **Hybrid: buttons + optional free text → same intent set** | High | Low, because interpretation is *shown before it commits* | Only when used | **Recommended** |
| Timed responses | — | — | — | Rejected. Artificial pressure in a game whose subject is deliberation. |
| Public vs private framing | — | — | — | **Adopted as a modifier**, not a separate mode. |

### 1.2 The recommended system

**Contextual action buttons generated from the simulation's valid-move set, plus an always-available free-text box that maps onto exactly the same set.**

The critical property: **free text can never produce an intent the buttons couldn't.** The buttons *are* the action space; the text box is an expressive front door to it. This means the intent parser can never invent a commitment, and a model failure degrades to "I didn't understand that" rather than to an unintended promise.

Public/private is a toggle on the conversation, not a separate system: the same intent carries different weight, different witnesses, and different memory `visibility`.

### 1.3 The intent set

Twelve intents. Fixed, versioned, exhaustive:

```ts
type ManagerIntent =
  | 'promise_playing_time' | 'promise_role' | 'promise_future_move'
  | 'refuse'               | 'defer'        | 'offer_compromise'
  | 'praise'               | 'warn'         | 'criticise'
  | 'defend_publicly'      | 'admit_fault'  | 'avoid_commitment';
```

Each carries `strength: 'soft' | 'firm' | 'emphatic'` and an optional `condition` drawn from a whitelist (`until_january`, `if_form_improves`, `if_fit`, `subject_to_offers`). **The condition list is closed** — a model cannot invent "if you score five goals," because that condition has no simulation rule behind it.

### 1.4 The interpretation pipeline

```
user free text
  → guard: length cap, injection screen (doc 16 §1), profanity is allowed, prompt-shaped text is not
  → classifier call (small model / local model / Haiku 4.5)
     output: { intent, strength, condition?, targets[], confidence, evidence_span }
  → validity check: is this intent in the FSM's currently-valid set for this conversation?
  → confidence gate: < 0.75 → do not guess; present the top 2 as buttons
  → SHOW THE INTERPRETATION: "You're promising him regular starts until January. Send / Edit / Cancel."
  → user confirms
  → deterministic system applies the consequence and writes promise + memory rows
```

**Nothing bypasses the confirmation step.** The brief asks for interpreted intentions to be "shown or made undoable"; this design does the stronger one — shown *and* not yet applied. The one-time cost is a click. The thing it buys is that the user is never surprised by a commitment they didn't make, which in a game about consequences is the whole ballgame.

**Undo** exists as a second layer: for 60 seconds after commit, the conversation panel offers *Take that back* (restores the pre-conversation checkpoint of the affected rows and writes a `retracted` event — the character notices). After that, it stands.

---

## 2. Agents and negotiation

### 2.1 Architecture: deterministic strategy, generated language

```
Agent = { style, riskTolerance, commissionExpectation, publicPressureWillingness,
          clubPreferences[], relationshipWithManager, negotiationHistory[] }

Negotiation FSM states:
  opened → terms_club → terms_player → agreed → registered → completed
                    ↘ stalled ↘ hijacked ↘ collapsed ↘ withdrawn

At each turn the ENGINE computes the legal move set:
  [ accept, counter(fee|structure|wage|clause), stall, deadline_bluff,
    invoke_rival_interest, leak_to_media, ultimatum, walk_away ]

Move SELECTION: weighted by agent style, current leverage, relationship,
                and a deterministic RNG stream.        ← simulation
Move NUMBERS:   computed by the valuation and finance systems.  ← simulation
Move LANGUAGE:  rendered by the model, numbers injected after.  ← AI
```

**The model never selects the move or emits a figure.** The deterministic engine supplies the selected move and valid expression plans. The `AgentNegotiationExpression` schema (doc 15 §4) carries only the selected `move`, a mechanically equivalent `expression_plan_id`, a `justification_ref` pointing at a supplied fact, and prose with `{{fee}}`-style slots the deterministic layer fills. This makes strategy drift and numeric hallucination structurally impossible rather than merely validated after generation.

### 2.2 What each behaviour is grounded in

| Behaviour | Deterministic precondition |
|---|---|
| Ultimatum | leverage ≥ threshold AND deadline within N days AND style permits |
| False deadline | `publicPressureWillingness` high AND no genuine competing offer — the *bluff* is real state the sim tracks, and can be called |
| Leak to media | a real negotiation exists; the leak creates a `rumour`-grade story referencing it |
| Competing offers | a rival club's AI planner has an actual open negotiation row |
| Client dissatisfaction | player emotion crossed a threshold |
| Package deal | both players are on the same club's shortlist |
| Relationship-building | accumulated `relationships` value with this agent |

An agent who is hostile to you is hostile *because* of rows you can inspect. **MVP:** no. **Phase 4+.**

---

## 3. Board and staff

### 3.1 Board: producing gameplay without arbitrariness

Each director holds `priorities_json` (3 weighted concerns), `patience`, `trust`, and `authority_json`. Their position on any question is computed:

```
stance = Σ ( priority.weight × normalisedProgress(priority, currentState) )
       + trustModifier(relationshipWithManager)
       + promiseModifier(open/kept/broken promises relevant to this priority)
       − patienceDecay(consecutiveDisappointments)
```

Every input is a query. The Boardroom "why" panel renders the terms with their source events — which is simultaneously the anti-arbitrariness mechanism, the debug view, and the pillar-3 feature.

**Politics emerges from disagreement, not from a politics system.** When two directors' computed stances diverge past a threshold on a decision within both their authority, a `board_conflict` event fires. Alliances are `relationships` edges between directors. Overruling is an authority-scope rule. None of it is scripted, and none of it is generated.

### 3.2 Staff advisers: useful, biased, occasionally wrong

```ts
interface StaffAdviser {
  judgement: number;         // drives noise magnitude on their estimates
  specialism: string;        // what they're actually good at
  bias: BiasTag;             // 'physical' | 'technical' | 'youth' | 'proven' | 'value'
  philosophy: TacticalTag;
  riskTolerance: number;
  knowledge: KnowledgeScope; // what data they even have
  memoryOfOwnAdvice: number[]; // sim_event ids — they can be reminded they were wrong
}
```

**Wrongness is deterministic and reconstructible.** A scout with `judgement: 40` and `bias: 'physical'` sees a technically excellent, physically slight winger through a noisy, skewed lens — the *estimate* is computed with that noise, and the model narrates the estimate. Afterwards, "why was he wrong?" has an answer: low judgement, wrong specialism, four observations, physical bias. This is the difference between a fallible adviser and a random one.

**Avoiding generic-answer-machine syndrome:** advisers must decline. If a question falls outside `knowledge` or `specialism`, the response is "that's not my area — ask the analyst," not a confident guess. This is enforced by fact-sheet assembly: an adviser who lacks the data does not receive it, so there is nothing to hallucinate from.

---

## 4. Media and supporters

### 4.1 Media actors

```ts
interface Journalist {
  outlet: string; style: 'local'|'national'|'tabloid'|'analyst'|'fan_channel'|'former_player';
  reliability: number;        // how often their rumours are real
  bias: number;               // toward/against the club
  relationshipWithManager: number;
  preferredTopics: string[];
  predictions: PredictionRow[];   // scored later — this is where feuds come from
  quoteMemory: number[];          // sim_event ids of things you actually said
}
```

**Every story has one of three provenances, and there is no fourth:**

| Grade | Source | Presented as |
|---|---|---|
| `verified` | a `sim_event` that occurred | reported fact |
| `rumour` | a *real state* — an open negotiation, an unresolved contract — surfaced with uncertainty | "understood to be" |
| `planted` | a valid actor's deliberate action (agent leak, rival briefing) — itself an event | reported, and *wrong*, traceably |

A `planted` story can be false in the fiction while being fully grounded in the data: the underlying event is "agent X leaked to journalist Y," and the resulting claim is marked false in `narrative_events`. The player can be misled; the system cannot.

**Quote memory** is the mechanism that makes media feel alive: press statements are stored verbatim as structured records, and a journalist quoting you back is retrieving a row, not recalling from a context window.

### 4.2 Supporters — where AI earns its place and where it doesn't

**Numbers (deterministic, no AI):** group approval, attendance, season-ticket sentiment, protest thresholds, cult-hero status accumulation, atmosphere. All tunable, all testable, all in the balance data.

**AI (one sentence, low frequency):** characterising *why* a faction feels what it feels, at moments the simulation flags as significant; naming a cult hero or a villain; a banner line when something genuinely warrants one.

The ratio is deliberate. A supporter base described in prose every week becomes wallpaper. Described three times a season, at moments the simulation says matter, it lands.

---

## 5. Rival managers

**What they can influence** (all deterministic, all implementable):

| Lever | Mechanism |
|---|---|
| Transfer priorities | their club's AI planner weights targets by philosophy + history with you |
| Bid aggression | leverage + rivalry value + financial state |
| Recruitment style | philosophy tag drives candidate scoring |
| Staff choices | poaching probability from `relationships` |
| Press comments | AI-rendered, from real results and real history |
| Job moves | reputation + performance + availability |
| Mind games | a press *posture* choice that affects media narrative and supporter sentiment, never the match |

**What they cannot influence:** the match. FC plays it. The design must not imply otherwise, and no adviser or press line should suggest a rival's tactical choice affected a result the user played themselves.

Rivalries accumulate as `relationships` edges between manager profiles, survive club changes, and are the reason a press comment in season 6 can reference a game in season 2.

---

## 6. Scouting and tactical intelligence

### 6.1 Scouting — the strongest fit for language in the product

The uncertainty is **simulated, then described**:

```
trueAbility           (hidden)
  → observationNoise = f(scout.judgement, observations, regionFamiliarity, competitionQuality)
  → bias             = f(scout.bias, player.attributeProfile)
  → band [low, high] + confidence                            ← simulation
  → prose describing that band without stating a number      ← AI
```

Two scouts disagree because they were handed different bands, computed from their own attributes. Neither is lying and neither is random.

**Hard rules:** never state a precise value; never contradict the band; a "red flag" must correspond to a real hidden attribute or a real event; report age degrades confidence on a schedule.

### 6.2 Tactical — modest by necessity

Restating the ceiling from doc 00, because it constrains this section absolutely: FC yields **cumulative season aggregates**, and per-match lines only by **diffing snapshots**. **[C]** There is no possession, no shots, no xG, no positional data, no in-match events.

Three labels, enforced in the UI:

- **Observed** — squad availability, minutes distribution, form trends, opponent results and scorers, fixture congestion, age/depth profile. Real, useful, and enough for a genuinely helpful adviser.
- **Inferred** — a stated heuristic over observed data ("you've conceded late in four of six — that's usually a fitness pattern"). Shown as a hypothesis with its basis.
- **Unavailable** — the adviser says it doesn't have the data. Pressing structures, defensive shape, chance quality.

An assistant who says "they're vulnerable to crosses" is inventing telemetry the product does not receive. Ship the honest version, label it, and let the credibility of the labelled version carry the feature.
