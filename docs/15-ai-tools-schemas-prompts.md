# 15 — Tools, Permissions, Schemas, Prompts, and Anti-Repetition

---

## 1. Tool and permission model

### 1.1 The permission ladder

| Level | What it may do | Where used | Ships in |
|---|---|---|---|
| **L0 — Render only** | Receives a frozen fact sheet, returns prose. No tools at all. | Character utterances, media, scouting prose, retrospectives | Stage 1 |
| **L1 — Parse only** | Receives user text, returns one intent from a closed enum. | Free-text conversation | Stage 2 |
| **L2 — Select from menu** | Receives 2–5 pre-validated candidate reactions, returns one id + wording. | Character reaction choice | Stage 3 |
| **L3 — Propose** | May emit a *proposal* the simulation validates and may reject. Never applied without either a rule check or user confirmation. | Staff recommendations, narrative arc suggestions | Stage 4 |
| **L4 — Act** | **Does not exist. There is no level at which a model mutates state.** | — | never |

### 1.2 Why there are no read tools

The brief lists read tools (`read_player_profile`, `read_contract`, …). This design **rejects giving the model read access**, and the reason is not caution — it is that fact-sheet assembly is where the knowledge boundary is enforced (doc 12 §2.6). A journalist with a `read_contract` tool can fetch a wage figure they should not know; a journalist handed a fact sheet cannot, because the number is not in the context window. Pre-assembly also makes the prompt cacheable, the call single-shot, the cost predictable, and the interaction replayable from stored inputs.

The fact-sheet assembler is deterministic TypeScript with the same shape as a tool layer — it just runs before the call rather than during it.

### 1.3 Proposal tools (L3, Stage 4+)

Defined with `strict: true` and `additionalProperties: false` so parameter validation is guaranteed **[C]**:

| Tool | Returns | Validation before anything happens |
|---|---|---|
| `propose_reaction` | candidate id + expression | id must be in the supplied menu |
| `propose_staff_recommendation` | recommendation ref + emphasis | must be within `authority` and `knowledge` |
| `propose_press_story` | angle + source `sim_event_id` | event must exist, be visible to that journalist |
| `propose_arc_attention` | arc id + delta | arc must exist; delta clamped |
| `request_calculation` | a named deterministic computation | fixed catalogue; the sim computes and returns |

**Explicitly forbidden and structurally impossible** (no tool, no schema field, no code path): changing money, moving players, editing attributes, completing transfers, altering results, creating injuries, editing tables, deleting records, touching FC memory, arbitrary SQL, asserting unsupported facts.

---

## 2. Structured output schemas

All outputs go through `output_config: {format: {type: 'json_schema', schema}}`, using `client.messages.parse()` so validation happens in the SDK **[C]**. Every schema sets `additionalProperties: false` and lists everything in `required` — a hard requirement for strict mode **[C]**.

### 2.1 Shared envelope

```ts
interface AiEnvelope {
  schema_version: 1;
  grounded_event_ids: number[];   // every sim_event this output leans on
  confidence: number;             // 0..1
}
```

The grounding validator asserts `grounded_event_ids ⊆ factSheet.eventIds`. A single foreign id discards the whole output.

### 2.2 The twelve schemas

```ts
// 1 — Character dialogue
interface CharacterUtterance extends AiEnvelope {
  speaker: { type: CharacterType; id: number };
  audience: 'manager' | 'squad' | 'press' | 'board' | 'public';
  tone: 'warm'|'neutral'|'guarded'|'frustrated'|'angry'|'resigned'|'defiant'|'pleased';
  lines: string[];                    // 1–3, ≤ 240 chars each
  references_memory_ids: number[];    // ⊆ supplied memories
  emotional_state_expressed: EmotionBand;
}

// 2 — Character reaction (Stage 3: selection from a menu)
interface CharacterReaction extends AiEnvelope {
  chosen_candidate_id: string;        // MUST be one of the supplied ids
  rationale_facts: number[];          // which facts drove it
  expression: CharacterUtterance;
}

// 3 — Player request
interface PlayerRequest extends AiEnvelope {
  request_kind: 'playing_time'|'new_contract'|'transfer'|'role_change'|'reassurance';
  escalation_stage: 'concern'|'private_warning'|'formal_request'|'agent_involved'|'public_pressure'|'transfer_request';
  stated_reason_ref: number;          // a sim_event id
  expression: CharacterUtterance;
}

// 4 — Agent negotiation move.  NOTE: no numeric fields anywhere.
interface AgentNegotiationMove extends AiEnvelope {
  move: 'accept'|'counter'|'stall'|'deadline'|'invoke_rival'|'leak'|'ultimatum'|'walk_away';
  justification_ref: number;
  tone: 'cordial'|'businesslike'|'pressuring'|'hostile';
  prose: string;                      // may contain {{fee}}, {{wage}}, {{deadline}} slots ONLY
}

// 5 — Staff recommendation
interface StaffRecommendation extends AiEnvelope {
  recommendation_ref: string;         // from the supplied candidate set
  strength: 'weak'|'moderate'|'strong';
  caveats: string[];
  declines_to_answer: boolean;        // the honest "not my area" path
  prose: string;
}

// 6 — Media article
interface MediaArticle extends AiEnvelope {
  journalist_id: number;
  provenance: 'verified'|'rumour'|'planted';
  headline: string;                   // ≤ 90 chars
  body: string;                       // ≤ 900 chars
  quotes: { source_event_id: number; verbatim: string }[];   // verbatim from stored records
  claims: { text: string; supporting_event_id: number }[];
}

// 7 — Press-conference interpretation (user text → structured)
interface PressInterpretation extends AiEnvelope {
  intent: ManagerIntent; strength: 'soft'|'firm'|'emphatic';
  condition?: ConditionTag;
  targets: CharacterRef[];
  public: boolean;
  evidence_span: string;              // the words that carried the meaning
  alternatives: { intent: ManagerIntent; confidence: number }[];   // for the < 0.75 path
}

// 8 — Memory creation (Stage 3+, still validated)
interface MemoryProposal extends AiEnvelope {
  holder: CharacterRef; subject?: CharacterRef;
  kind: string; significance: number; valence: number;
  visibility: 'public'|'private'|'club'|'pair';
  facts: Record<string, string | number | boolean>;
}

// 9 — Narrative arc update
interface ArcUpdate extends AiEnvelope {
  arc_id: number;
  attention_delta: number;            // clamped to ±20 by the sim
  suggested_state?: 'active'|'dormant'|'resolved';
  justification_event_ids: number[];
}

// 10 — Season-summary claim
interface SummaryClaim extends AiEnvelope {
  text: string;
  support: { kind: 'event'; id: number } | { kind: 'aggregate'; query_id: string; value: string };
}
interface SeasonSummary extends AiEnvelope { title: string; sections: { heading: string; claims: SummaryClaim[] }[] }

// 11 — User-intent interpretation (conversation) — same shape as (7)
// 12 — Suggested deterministic action
interface ActionProposal extends AiEnvelope {
  action_id: string;                  // from the supplied catalogue
  params_ref: string;
  requires_user_confirmation: true;   // literal true — not a variable
}
```

### 2.3 Worked example — a real output

```json
{
  "schema_version": 1,
  "grounded_event_ids": [88412, 88455, 91003],
  "confidence": 0.86,
  "speaker": { "type": "board_member", "id": 7 },
  "audience": "manager",
  "tone": "guarded",
  "lines": [
    "Three in a row now, and the Wednesday game was the one I said we couldn't afford to lose.",
    "I backed the summer plan in front of the chair. I'd like something to point at when he asks me again on Monday."
  ],
  "references_memory_ids": [2041],
  "emotional_state_expressed": { "trust": "falling", "patience": "thin" }
}
```

Validation performed: schema ✓ · `grounded_event_ids ⊆ factSheet` ✓ · `references_memory_ids ⊆ retrieved` ✓ · no numeric claim outside the fact sheet ✓ · `speaker` matches the requested character ✓ · length caps ✓.

---

## 3. Prompt architecture

### 3.1 Five layers, ordered for cache stability

Render order is `tools → system → messages` **[C]**, and caching is a strict prefix match — one byte earlier in the prefix invalidates everything after it **[C]**. So the layers are ordered *by volatility*, most stable first:

| Layer | Contents | Volatility | Approx tokens |
|---|---|---|---|
| **1 · Global system** | world rules, no-invention rule, forbidden topics, output contract, tone bounds | never changes | ~1,200 |
| **2 · Role** | player / director / journalist / agent / scout: what this *kind* of person does, their register, their constraints | changes per role (7 total) | ~700 |
| **3 · Character** | traits (banded), voice tag, authority, knowledge scope, relationship summary | per character, stable for weeks | ~350 |
| **4 · Context** | the event, club state, retrieved memories, emotion bands, public/private facts | **every call** | ~700 |
| **5 · Task** | what to produce, the candidate menu, the schema reminder | every call | ~250 |

Layers 1+2 are the cache breakpoint. Layers 3–5 come after it.

### 3.2 The caching trap that changes the design

**Minimum cacheable prefix is model-dependent, and Haiku 4.5's is 4,096 tokens** — versus 1,024 on Sonnet 5 and 512 on Opus 5. **[C]**

Haiku 4.5 is the recommended workhorse for character calls. But layers 1+2 come to roughly **1,900 tokens** — comfortably *below* Haiku's threshold, which means **the cache silently does nothing**: no error, just `cache_creation_input_tokens: 0` **[C]**. This is exactly the kind of thing that is discovered three months in via an unexplained bill.

Three options, and the recommendation:

1. **Deliberately enrich layers 1+2 past 4,096 tokens** for the Haiku path — a richer world-rules block, a fuller role brief, few-shot exemplars per role. This is not padding: the extra content is *voice exemplars*, which improve output quality anyway, and it converts a 4,000-token prefix from full price to ~0.1× on every subsequent call. **Recommended.**
2. Accept no caching on Haiku. At ~2,600 input tokens/call the difference is small in absolute terms (see doc 16 §3), so this is survivable — just don't believe you're caching when you aren't.
3. Route character calls to Sonnet 5 (1,024 min) to get caching. Costs 3× per token; only worth it if quality demands Sonnet anyway.

**Verification is mandatory, not optional:** assert `cache_read_input_tokens > 0` on the second call of a session in the integration test **[C]**. And keep the volatile content strictly after the breakpoint — no timestamps, no per-request ids, no unsorted JSON in layers 1–3 **[C]**.

### 3.3 Six sample prompts

Abbreviated to the parts that matter. In all six, layers 1–2 are identical and cached.

**(a) Unhappy substitute**
```
[L3 CHARACTER] Marc Dubois, 24, left winger. professionalism: high ·
ambition: very high · loyalty: moderate · consistency: moderate · pressure: low.
Voice: direct_ambitious. Authority: may raise his own selection, role, contract.
Knowledge: his own contract, public squad facts. NOT other players' terms.

[L4 CONTEXT] Event #88455: omitted from the XI, 4th consecutive league match.
Emotion: trust=falling · frustration=high · confidence=low · belonging=neutral.
Memories (3): #2041 promise of regular starts, 12 Jul, unresolved ·
#2103 started and scored in the cup, 4 Sep · #2190 replaced at half-time, 19 Oct.
Club: 11th, one win in six. Window: closed. He is not transfer-listed.

[L5 TASK] He has decided to raise this privately (the simulation has already
decided this — do not decide whether he speaks). Produce CharacterUtterance:
1–3 lines, ≤240 chars each. He may reference at most one memory by its content.
He must not state a number that is not above. He must not threaten to leave —
that is a later escalation stage and is not available to him.
```

**(b) Contract negotiation (agent)**
```
[L4] Agent Renata Silva. Style: pressuring. Relationship with you: −20 (a
collapsed deal in Jan 2027, #71204). Move selected by the engine: `deadline`.
Genuine competing interest: NO (this is a bluff — the sim knows; you do not
reveal that). Facts: contract expires in 11 months; client is a first-team regular.
[L5] Produce AgentNegotiationMove with move="deadline". Prose only.
Use {{deadline}} and {{wage}} slots — do NOT write any number yourself.
```

**(c) Hostile journalist**
```
[L4] Alan Petrie, tabloid, reliability 0.4, bias −35, relationship −40.
Memory #3301: he predicted a top-four finish for you in August; you are 14th.
Event #91002: a third straight defeat. Provenance: verified.
Knowledge: public facts only — no wages, no private conversations.
[L5] Produce MediaArticle. Headline ≤90 chars. Every claim needs a supporting
event id. You may reference his own failed prediction. Any quote must be verbatim
from the supplied press records — do not paraphrase into quotation marks.
```

**(d) Board budget dispute**
```
[L4] Priya Raman, finance director. Priorities: wage ratio 0.5 · debt 0.3 ·
squad value 0.2. Patience: low. Authority: may refuse spending above budget;
may NOT set sporting objectives.
Facts: wage/revenue 71% (board limit 65%) · balance £4.2m · request £9m ·
two instalments due Jan. Memory #4102: you promised in July to reduce the wage bill.
[L5] Produce CharacterUtterance, audience="manager". She refuses (the sim decided).
She must give her actual reason from the facts above. She may reference #4102.
She must not comment on team selection — outside her authority.
```

**(e) Recruitment meeting**
```
[L4] Head scout Tomás Beck. Judgement 62 · bias physical · region Iberia ·
7 observations. Band supplied: ability 61–74, potential 70–86, confidence 0.55.
Head of recruitment disagrees: band 55–66, confidence 0.71, bias technical.
[L5] Produce two StaffRecommendations, one per scout, each describing only
its OWN band. Neither may state a precise rating. Neither may reference the
other's numbers. Disagreement should be visible in emphasis, not in argument.
```

**(f) Season retrospective**
```
[L4] Season 2029/30. Final position 4th (predicted 11th). 38 P · 19 W · 9 D · 10 L.
Top scorer: A. Kovač 21 (#…). Youth debuts: 3. Net spend −£12m.
Promises: 4 made, 3 kept, 1 broken (#4102). Board: mandate met.
Arcs resolved: 'breakthrough:Kovač' · 'rebuild:complete'. [Full event digest attached.]
[L5] Produce SeasonSummary, 3–5 sections. EVERY claim carries a `support` —
an event id or a named aggregate query. Claims without support are invalid output.
Do not characterise anything not present above.
```

---

## 4. Anti-repetition

Repetition is the failure mode most likely to make players switch AI off. Nine mechanisms, in order of how much work they do:

**1 · The escalation ladder (does 60% of the work).** A concern is not a request is not an ultimatum. Each stage requires its own deterministic precondition and *consumes* the lower stage — a player who has escalated cannot go back to mild concern about the same subject. The ladder for playing time:

| Stage | Precondition | Cooldown before next |
|---|---|---|
| private concern | 3 omissions, or 1 broken promise | 21 days |
| private warning | 2 further omissions after concern, trust falling | 21 days |
| formal request | warning unaddressed for 30 days | 30 days |
| agent involved | request refused or ignored, agent style permits | 30 days |
| public pressure | agent involved + `publicPressureWillingness` high | 45 days |
| transfer request | all above + window open + a plausible destination exists | terminal |

Six months of real grievance produces at most **six** interactions, each different in kind rather than in wording.

**2 · Topic exhaustion.** `(character, topic)` records how many times it has been raised. Past a cap, the topic is closed until new evidence arrives — and "new evidence" means a new `sim_event`, not the passage of time.

**3 · Semantic similarity detection.** Before display, compare the candidate line against this character's last 20 utterances using trigram Jaccard similarity (no embeddings needed at this volume). > 0.6 → regenerate once with the near-duplicate supplied as an explicit exclusion; still similar → fall back to a template variant not used recently.

**4 · Character-specific vocabulary.** Each `VoiceTag` carries a small lexicon and a set of banned generic phrases. This is what stops every character sounding like the same helpful assistant, and it costs nothing at runtime.

**5 · Memory-aware reference.** A character who has already cited a memory in conversation gets it down-weighted for the next N interactions, so he doesn't tell you about his July promise five times.

**6 · Refusal to generate.** The most effective anti-repetition tool. If the only thing a character has to say is what they said last time, the correct output is *nothing*. The importance gate does this by default.

**7 · Deterministic UI instead of prose.** Squad reactions to a signing are a UI row of faces with a mood indicator, not eleven generated sentences. Reserve prose for the one character with something specific to say.

**8 · Summarising repeated complaints.** Three players unhappy about the same thing produce one dressing-room item naming them, not three utterances.

**9 · Hard length and turn caps.** ≤ 3 lines per utterance, ≤ 240 chars each, ≤ 4 turns per conversation. Terse characters read as characters; verbose ones read as chatbots.
