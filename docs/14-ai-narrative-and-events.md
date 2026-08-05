# 14 — Narrative Director, Emergent Stories, and the Event Architecture

---

## 1. The narrative director

### 1.1 What it is and is not

It **detects** stories in the event log, **tracks** them, and **allocates attention**. It does not create events, does not influence outcomes, and does not decide what happens next. It is a read-only observer with one output: which arcs currently deserve the player's and the media system's attention.

### 1.2 Arc state

```sql
-- Migration 0003
CREATE TABLE narrative_arcs (
  id             INTEGER PRIMARY KEY,
  career_id      INTEGER NOT NULL REFERENCES careers(id),
  kind           TEXT    NOT NULL,      -- breakthrough | decline | rivalry | rebuild | redemption | …
  subject_type   TEXT    NOT NULL, subject_id INTEGER NOT NULL,
  counterpart_type TEXT, counterpart_id INTEGER,
  state          TEXT    NOT NULL       -- emerging | active | dormant | resolved | abandoned
                 CHECK (state IN ('emerging','active','dormant','resolved','abandoned')),
  tension        INTEGER NOT NULL DEFAULT 0,   -- 0..100, drives attention
  attention      INTEGER NOT NULL DEFAULT 0,   -- 0..100, decays without new evidence
  opened_on      INTEGER NOT NULL,
  last_evidence_on INTEGER NOT NULL,
  resolved_on    INTEGER,
  resolution     TEXT,
  evidence_json  TEXT    NOT NULL DEFAULT '[]',  -- sim_event ids ONLY
  user_centric   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_arcs_live ON narrative_arcs (career_id, state, attention DESC);
```

### 1.3 Detection

Detectors are pure functions over the event log, run at week and month boundaries:

```ts
interface ArcDetector {
  kind: string;
  detect(ctx: SimContext): ArcCandidate[];   // reads sim_events; returns evidence ids
}
// e.g. 'breakthrough': a player with origin='youth', age ≤ 21, whose minutes
// crossed a threshold this season AND whose form is above the squad median.
```

Rules that keep it honest:

- **`evidence_json` may contain only `sim_event` ids.** An arc with no evidence cannot exist; a detector that wants to invent one has nowhere to put it.
- **Attention decays** ~15%/week without new evidence. Stale stories fade rather than being force-fed.
- **Resolution is observed, not imposed.** An arc resolves when the *simulation* produces a resolving event. The director never nudges toward an ending.
- **A hard cap of 5 active arcs**, with at most 3 user-centric. The other 2 slots are reserved for the world — this is the mechanism that stops the user being the centre of every story, and it is a cap, not a preference.
- **Connecting to history** is a query: when an arc opens, the detector searches for prior arcs sharing a subject and links them. That's how "he's back at the club that sold him" happens without scripting.

### 1.4 The seven-stage vocabulary is observational

The broader Living Football Director uses seven labels—**seed, signal,
escalation, decision, consequence, echo, resolution**—to describe what the event
history currently supports. They are not a screenplay funnel.

An arc can fade after a seed, resolve at a signal, skip a user decision because
none is valid, remain dormant for years, or reopen when a later event creates an
echo. The Director cannot create the next stage, raise tension to hit a pacing
target or protect the arc from a player who sells its central character. It
observes the state produced by the simulation.

### 1.5 Resonance and reincorporation

Significant events receive deterministic motif tags such as `promise`,
`authority`, `loyalty`, `second_chance`, `academy`, `former_club`, and
`public_reversal`. When a new event shares actors, commitments, causal ancestry
or motifs, the Director may link the older event as a sourced echo. This turns
memory into changed context instead of decorative callback text.

Reincorporation research found stronger internal narrative unity and greater use
of significant player actions, but not a corresponding automatic improvement in
reported story quality or agency. The metric cannot be “number of callbacks.” A
playtest must show that the user noticed, understood and valued the connection.
See [doc 20 §5.5](20-living-football-director.md#55-resonance-the-past-becomes-mechanically-relevant-again).

### 1.6 Agency and the Director's exact output

The Director outputs presentation decisions only:

```ts
interface DirectorSelection {
  arcId: number;
  viewpointCharacterId: number | null;
  surface: 'background' | 'inbox' | 'meeting' | 'chapter';
  evidenceEventIds: readonly number[];
  validIntentIds: readonly string[];
  attentionReason: readonly string[];
}
```

It does not output effects, deltas, event proposals or a desired resolution.
Every valid user action remains available. If two displayed intents would lead
to the same effect categories and follow-up eligibility, they are one choice
with tone variants rather than two fake choices. Director on/off must yield
byte-identical canonical state for the same user actions.

---

## 2. Twenty emergent story examples

Each follows: **trigger → systems → interpretations → memories → decisions → branches → long consequence.** None is scripted; each is a path the systems allow.

**1 · The unexpected debut.** Injury forces a 17-year-old into the XI → academy, selection, media, dressing room → academy director validated; the senior in that position feels threatened; supporters notice a local name → `debut_given` (permanent, high valence), `threatened_by_youth` → whether to start him again → he keeps the place / senior demands assurances / agent circles → a cult hero, or a sold prospect and a broken supporter relationship.

**2 · The promise that came due.** July: "you'll start." November: four straight benchings → promises, emotion, dressing room → the player counts; teammates notice; the agent is told → `promise_broken` (permanent) → keep it, renegotiate, or absorb it → trust collapse and a transfer request / a costly restoration → the player's testimony shapes how the *next* signing's agent negotiates with you.

**3 · The director who backed you.** A bad run; the sporting director defends you publicly against the chair → board politics, media → the chair's patience drops toward the *director*, not just you → `defended_publicly` on both sides → whether you protect him later → you owe him and he knows it → when he's forced out, your position weakens sharply.

**4 · The captaincy misjudgement.** You strip the armband to shock a senior → dressing room, emotion, leadership → he complies publicly and withdraws privately; the leadership group re-forms without him → `captaincy_removed` (permanent, strongly negative) → reintegrate or move him on → form recovery / a dressing room that has learned you'll do that → his replacement leads differently because of what he saw.

**5 · The expensive failure.** A club-record signing underperforms for two seasons → finance, media, board, dressing room → the finance director's warnings look prescient; a journalist who backed the deal is defensive; the squad resents the wage → `signing_failed`, `warning_ignored` → cut losses at a loss, or persist → wage-structure constraints for years; the finance director's stance on every future request hardens.

**6 · The veteran's last season.** A 35-year-old club servant declines → development, dressing room, supporters, contract → he knows; the squad watches how you treat him; supporters have opinions → `handled_with_dignity` or `discarded` (both permanent, club-level) → minutes, a role, a send-off → he becomes a coach / he leaves badly → institutional memory: how this club treats its veterans, which future signings' agents cite.

**7 · The hijack.** A deal is agreed; a rival with a live rivalry edge bids at the deadline → transfers, agents, rivals, media → the agent uses it for leverage; the selling club is indifferent; the rival manager enjoys it publicly → `hijacked_by`, agent relationship damaged → match it, walk, or pivot → a rivalry that resurfaces every window for a decade.

**8 · The academy pathway that paid.** Three years of loans and minutes for one prospect → academy, finance, board → the academy director's standing rises; the finance director sees an asset → `pathway_completed` → sell at peak or build around him → funds a rebuild / becomes the identity of the team → the board's recruitment philosophy shifts toward youth, changing what they'll fund.

**9 · The relegation that revealed people.** Relegation → board, contracts, dressing room, finance → release clauses trigger; some stay, some don't; the ones who stay are remembered → `stayed_after_relegation` (permanent, very high) → who to keep, who to cash in → promotion with a core who chose you / a rebuild with strangers → those who stayed carry disproportionate dressing-room weight for years.

**10 · The manager who wouldn't spend.** You bank two windows to fix wages → finance, board, supporters, media → the finance director is delighted; supporters are not; a tabloid finds an angle → `withheld_investment` (club memory) → hold the line or concede → financial stability and supporter erosion / spending and losing your one ally → the board's *next* mandate is written against this record.

**11 · The homesick signing.** A young foreign signing has adaptation problems → personality, dressing room, development → a same-language teammate helps or doesn't; the physio flags it before the coach does → `struggled_settling`, `helped_by` → loan home, mentor, patience → a breakthrough season two / a write-off → the mentor's standing rises; a mentoring relationship that persists.

**12 · The journalist you humiliated.** You publicly correct a prediction → media, reputation → that journalist's bias hardens; others notice your posture → `embarrassed_publicly` (journalist memory, permanent) → escalate or reset → a persistent hostile voice / an uneasy truce → during your next bad run, that hostility becomes a board-facing problem.

**13 · The player who saved you.** A striker's late winner ends a losing run days before a board review → results, board, arcs → the board's patience resets; he knows what he did → `saved_the_manager` (mutual, permanent) → what you owe him → he becomes untouchable in your selection logic — a bias you now have to manage → three years later, dropping him is a squad event.

**14 · Ownership change.** New owners with different priorities → board, finance, mandate → your allies lose authority; the new mandate contradicts the old one → `mandate_superseded`, `ally_removed` → adapt, resist, leave → a rebuild you didn't choose / a sacking → your reputation now carries "clashed with ownership," which changes which clubs approach you.

**15 · The rejected transfer request.** A key player asks to leave; the club refuses → contracts, agents, dressing room, media → he complies and resents; the agent goes public; teammates take sides → `request_refused` (permanent) → integrate, freeze out, or sell late → a season of managed tension / a fire sale → the agent's other clients now negotiate with you differently.

**16 · The rebuild that took three seasons.** Deliberate youth-first strategy with a board that half-agreed → board, academy, finance, supporters → the sporting director champions it; the chair counts league positions; supporters divide → `strategy_agreed`, then annual `progress_reviewed` → hold or abandon at each review → vindication / sacked in year two with the squad you built handed to someone else → either way the club's identity changed.

**17 · The former player, now opposition.** A player you sold faces you → rivals, media, supporters, arcs → he has something to prove; supporters are conflicted; the media has the story pre-written → arc links to the original sale event → team selection, press posture → he scores / he's anonymous → the sale is re-litigated publicly regardless.

**18 · The agent who burned you.** An agent bluffs a deadline, you call it, the deal collapses publicly → agents, media, transfers → he needs to recover face; other clients hear → `negotiation_hostile` (permanent) → deal with him again or blacklist → better terms elsewhere at the cost of access to his stable → three seasons later he represents the one player you need.

**19 · The injury that changed a career.** A long-term injury to a player on an upward arc → injuries, development, contract, emotion → confidence falls; the board sees a wasting asset; the physio has a view → `long_term_injury`, `backed_during_injury` → renew during injury, or wait → he returns and remembers who backed him / he leaves on a free → the "backed him" memory is one of the strongest loyalty modifiers in the model.

**20 · The job you took, and the one you didn't.** A bigger club approaches mid-season → reputation, board, dressing room, media → the squad hears; the board's trust is contingent on what you do; supporters watch → `stayed_when_courted` or `left_mid_season` (both permanent, both club-level and world-level) → go or stay → staying buys enormous credit that decays if results don't follow; leaving follows you to every subsequent job → years later, an opposing manager or journalist raises it.

**The common shape:** in every one, the *event* is deterministic, the *memory* is a row, the *decision* is the user's, and the *AI's* only job is that when someone finally says something about it, they sound like a person who was there.

---

## 3. Event-driven architecture

### 3.1 Taxonomy and reaction budget

| Event | Base importance | Who cares | AI? | Max reactions | Cooldown |
|---|---:|---|---|---:|---|
| `match_completed` | 30 | board, squad, media, supporters | only if arc-relevant | 1 | per match |
| `player_benched` | 15 | that player | no (accumulates) | 0 | — |
| `player_benched_significant` (final/derby/post-promise) | 55 | player, agent | yes | 1 | 21 days |
| `player_substituted_early` | 20 | that player | rarely | 1 | 14 days |
| `player_debut` | 60 | player, academy dir., supporters, media | yes | 2 | — |
| `contract_offer` / `rejected` | 45 / 55 | player, agent, board | yes | 1 | 7 days |
| `transfer_bid` / `completed` / `collapsed` | 40 / 65 / 60 | many | yes | 2 | per negotiation |
| `promise_created` | 35 | recipient | no (silent record) | 0 | — |
| `promise_kept` | 50 | recipient, witnesses | yes | 1 | — |
| **`promise_broken`** | **90** | recipient, agent, dressing room | **yes** | 2 | — |
| `injury` / `recovery` | 40 / 30 | player, physio, board | sometimes | 1 | — |
| `captaincy_change` | 70 | squad leadership | yes | 2 | — |
| `board_objective_changed` | 65 | directors | yes | 1 | — |
| `financial_crisis` | 80 | finance dir., board, media | yes | 2 | 30 days |
| `winning_streak` / `losing_streak` | 45 / 60 | board, media, supporters | yes | 1 | 14 days |
| `derby` | 55 | supporters, media, rivals | yes | 2 | per fixture |
| `elimination` | 60 | board, supporters, media | yes | 1 | — |
| `promotion` / `relegation` | 95 / 95 | everyone | yes | 4 | — |
| `trophy` | 100 | everyone | yes | 4 | — |
| `manager_job_offer` | 85 | board, squad, media | yes | 2 | — |
| `staff_departure` | 45 | affected staff, board | sometimes | 1 | — |
| `youth_breakthrough` | 65 | academy dir., media | yes | 2 | — |
| `media_controversy` | 60 | journalists, board | yes | 2 | 14 days |

### 3.2 Importance scoring — the suppression mechanism

```ts
function reactionScore(event, character, ctx): number {
  const base        = IMPORTANCE[event.kind];
  const proximity   = personalRelevance(character, event);      // 0..1
  const emotional   = 1 + emotionalCharge(character) * 0.5;     // 1..1.5
  const arc         = ctx.arcs.involving(character, event) ? 1.35 : 1;
  const novelty     = 1 - recentSimilarReactions(character, event.kind, 30) * 0.3;
  const fatigue     = 1 - globalReactionsThisWeek(ctx) * 0.08;  // world-level damper
  return base * proximity * emotional * arc * novelty * fatigue;
}

const THRESHOLD = 55;   // tunable, lives in packages/sim/balance
```

Then three hard gates, in order: **character cooldown** → **drama budget** (§D of doc 11) → **per-week global cap** (default 6 AI-rendered reactions). Anything that fails a gate is dropped silently and never queued.

**The success metric for this system is its refusal rate.** Target: in a normal week, **0–2** reactions fire out of 40+ candidate (event × character) pairs. If a soak test shows the weekly average climbing above 4, the threshold is wrong, not the content.

### 3.3 Ordering and determinism

Candidates are evaluated in a deterministic order — `(importance DESC, kind ASC, character_id ASC)` — never in map-iteration order, and each reaction's RNG comes from `streams(masterSeed, tick).for('reaction', characterId)`. Same seed, same day, same set of reactions, every time.
