# 11 — AI Opportunity Map, Feature Matrix, and the First Vertical Slice

Each opportunity uses a compact fixed shape. `Freedom` is what the model may decide; `Forbidden` is what makes the output invalid and triggers the template fallback.

---

## A. Living player personalities

**Experience:** two 24-year-old wingers with identical attributes ask for the same thing in ways you'd never confuse.
**Why not templates:** templates *can* carry personality — but not at the intersection of five traits, an emotional state, a specific grievance and a shared history. The combinatorics defeat authored text somewhere around the third variable.
**Data in:** five personality traits (banded, not raw), current emotion vector (banded), squad status, the triggering event, the 3–7 retrieved memories, contract facts, competition context.
**Out:** `CharacterUtterance` (doc 15 §1).
**Freedom:** register, vocabulary, which of the supplied memories to reference, emphasis, how directly the ask is made.
**Forbidden:** any number not in the fact sheet; any claim about another player's contract; any demand the simulation has not modelled; any reference to an event id not supplied.
**Memory:** grievance history, prior conversations with this manager, promises made to this player.
**Simulation effects:** none directly. The *reaction* the utterance expresses already had its effects applied.
**Latency:** ≤ 2.5 s (user is waiting) · **Cost:** ~1 small call · **Fallback:** trait-banded templates.
**Repetition risk:** high — the mitigation is the escalation ladder in doc 14, not prompt variety.
**Hallucination risk:** medium. **MVP:** no. **Long-term:** core.

**Making it rare enough to matter.** Three gates, all deterministic: (1) an evidenced precondition — a grievance requires N recorded omissions or a broken promise; (2) a per-character cooldown measured in match-days, not real time; (3) a squad-wide **drama budget** (§D). A player who cannot pass all three does not speak, and the UI does not hint that he wanted to.

---

## B. Persistent character memory

**Experience:** in March, a player refers to a promise you made in July — accurately, and with the emotional colour of someone who has been counting.
**Why not templates:** retrieval and salience are database problems; only the *recall phrasing* benefits from a model.
**Data in:** the memory rows themselves (already prose-free structured facts).
**Freedom:** how a memory is characterised ("you told me I'd start" vs "we had an understanding").
**Forbidden:** recalling a memory the character could not hold (§B.6 of doc 12); inventing detail not in the row; misstating the date or outcome.
**MVP:** the *deterministic* memory system, yes — Stage 0. The AI recall phrasing, later.

## C. Conversations

Covered fully in doc 13 §1. The recommendation in one line: **hybrid — contextual action buttons as the primary interface, optional free text that is parsed into one of those same intents, with the interpretation shown before it commits.**

## D. Dressing-room social simulation

**Experience:** the senior players have a collective view, and it has a cause you can point at.
**Why AI helps:** explaining a *configuration* of relationships in one sentence is exactly what language models are good at and what a template cannot do (the graph shape is different every time).
**Freedom:** characterising the mood of a group.
**Forbidden:** asserting a friendship, rivalry or faction that isn't an edge in `relationships`.
**Drama budget — the load-bearing mechanic:** a per-season integer (start: 6 "significant conflicts") plus a per-window cap (max 2 open at once). A candidate conflict that would exceed the budget is *dropped, not deferred* — deferring produces a queue that eventually floods. Budget is spent by severity, refunded slowly, and visible in the AI debug console.
**MVP:** no. **Later:** high value.

## E. Agents and negotiators

**Experience:** a specific agent, with a name and a history with you, plays the market rather than reading a price.
**Why AI helps:** negotiation *language* carries information cheaply — a refusal that says *why* is worth ten sliders.
**Freedom:** phrasing, tone, which valid pressure tactic to lean on rhetorically.
**Forbidden:** every number. Fees, wages, clauses, deadlines are computed and inserted post-generation. The model never emits a figure.
**Architecture:** the agent's *strategy* is a deterministic state machine (doc 13 §2); the model narrates the chosen move.
**MVP:** no. **Later:** high — this is the most-requested system after transfers themselves.

## F. Sporting director and staff advisers

**Experience:** advisers who are useful, biased, and sometimes wrong for a reason you can reconstruct afterwards.
**Why AI helps:** a recommendation reads as advice rather than a readout.
**Freedom:** framing, emphasis, how strongly to push, what to concede.
**Forbidden:** recommending something outside the staff member's authority or knowledge scope; asserting data they don't have access to.
**Being wrong properly:** the *error* is deterministic — a scout with low judgement gets a noisier `ability_low..ability_high` band, and the model narrates the band it was given. The model is never asked to be wrong on purpose; it renders a view that is already biased.
**MVP:** no. **Later:** high.

## G. Boardroom politics

**Experience:** three people who want different things and remember what you promised.
**Why AI helps:** argument construction from a specific financial and sporting position.
**Freedom:** rhetoric, which of their real priorities to lead with, how much to concede.
**Forbidden:** stating a decision the simulation hasn't made; inventing financial figures; speaking outside `authority_json`.
**Avoiding arbitrariness:** every board position is derived from `board_objectives` progress + `financial_transactions` + `promises` + results, all queryable. The Boardroom screen's "why" panel shows the exact events. If the board can't be explained, it's a bug.
**MVP:** **yes — this is the vertical slice.** See §3.

## H. Media ecosystem

**Experience:** a named journalist who got a prediction wrong in September is defensive about it in December.
**Why AI helps:** voice differentiation across many actors is precisely where authored templates become unmaintainable.
**Freedom:** angle, headline, which real fact to lead with, house style.
**Forbidden:** any event without a `sim_event_id`; quoting the manager anything they didn't say (quotes come from stored `promises`/press records verbatim).
**Rumours and misinformation done safely:** three grades, all simulation-created — `verified` (a real event), `rumour` (a real *state*, e.g. an open negotiation, published with uncertainty), and `false` (deliberately planted by a valid actor — an agent using public pressure). A "false" story is still grounded: it references the agent's action event. **There is no fourth grade where the model makes something up.**
**MVP:** no. **Later:** high.

## I. Supporter culture

**Where AI genuinely adds value:** naming and characterising a *faction's* position; cult-hero and villain narratives; a banner or chant line at a moment of real significance.
**Where numbers are strictly better — and this is most of it:** approval, attendance, season-ticket sentiment, protest thresholds. These need to be legible, tunable and testable; prose about them is decoration.
**Anti-pattern this rejects:** a single approval bar. Model 3–5 supporter groups with different priority weights (results / youth / identity / football style / finances), each a small deterministic model. The AI's contribution is one sentence per group per month, at most.
**MVP:** no. **Later:** medium.

## J. Rival managers

**Experience:** a manager who beat you twice, said something about it, and is now in for your best player.
**Why AI helps:** press voice and mind games.
**Freedom:** press comments, tone toward the user.
**Forbidden:** influencing match outcomes (impossible anyway — FC plays the match); claiming results that didn't happen.
**What they can actually influence** — all deterministic, all reachable: transfer target priority, bid aggression, staff poaching, press posture, and whether they take a job that becomes available. **[I]** Team selection and tactical presets are *not* reachable, because the companion cannot write another club's XI into FC.
**MVP:** no. **Later:** medium-high.

## K. Scouting and uncertainty

**Experience:** two scouts disagree, and both reports are honest.
**Why AI helps:** prose that conveys a *range* without stating a number is hard to template well and is the entire point of a scout report.
**Data in:** the report's `ability_low..high` band, confidence, the scout's specialism and bias, sample size, region familiarity.
**Forbidden:** stating a precise ability value; contradicting the band; inventing a red flag with no simulation source.
**Critical rule:** the uncertainty is *simulated* — the noise is applied deterministically from the scout's judgement and the observation count. The model describes the noisy view it was handed. It never generates the uncertainty itself.
**MVP:** no. **Later:** high — this is one of the best fits for language in the whole design.

## L. Tactical intelligence

**This is where the FC data ceiling bites hardest, and the design must say so.** From doc 00: the companion receives **cumulative season aggregates per player per competition**, and per-match lines *derived by diffing snapshots*. There is no possession figure, no shot map, no xG, no positional data, no in-match events. **[C]**

| Advice type | Supportable? |
|---|---|
| Squad balance, age profile, depth by position, fixture congestion, availability | **Yes** — from companion state |
| Opponent form, results, scorers, table position | **Yes** — from imported results |
| Player form and minutes trends | **Yes** — from diffed per-match lines |
| "They're vulnerable to crosses" / pressing traits / shape analysis | **No.** Not derivable. Do not fake it. |
| In-match tactical advice | **No.** No telemetry exists. |

The design rule: an adviser screen labels each claim as **observed** (from imported data), **inferred** (a stated heuristic over observed data), or refuses. An assistant manager who confidently discusses an opponent's pressing structure is lying to the user, and the user will find out the first time they watch the match.
**MVP:** no. **Later:** medium, and deliberately modest.

## M. Narrative director

Covered in doc 14. Detects arcs from the event log; never creates events; can only *raise or lower attention*.

## N. Generated player and staff histories

**Experience:** a regen with a hometown, a childhood club, and a reason he's hard to settle.
**The gameplay rule that keeps this from being decoration:** a generated biography may only contain facts that **already exist as simulation state or become simulation state on generation**. Hometown → a real `relationships` edge to a local club. "Family in Argentina" → an `adaptation` modifier the homesickness system actually reads. If a biographical detail changes nothing, it is cut.
**Avoiding stereotype and contradiction:**
- Nationality never selects personality. Traits are derived from data (age, potential gap, reputation, contract) plus a seeded draw; the biography is written *from* the traits, not the other way round.
- A forbidden-topics list in the global prompt layer: no religion, no politics, no health conditions, no family trauma, no criminality, no sexuality, no ethnic characterisation.
- Generated once, cached forever, stored as structured fields — so it cannot drift between mentions.
- A `regenerate` control on the profile screen, because a generated fact that reads wrong to the player is worse than none.
**MVP:** no. **Later:** medium.

## O. Career history and legacy

**Experience:** an end-of-career retrospective that is *accurate*, and lands because of it.
**Why AI helps:** long-form synthesis over structured records is the single best fit for a language model in this entire product.
**Provenance requirement:** every claim carries the `sim_event_id`s or aggregate query that supports it, stored alongside the text (doc 15 §10). The UI can reveal them. This is not decoration — it is how the retrospective is *tested*.
**Latency:** background, minutes are fine. **Cost:** the largest single call in the product; ~1 per season.
**MVP:** no. **Later:** the highest emotional-value feature in the list.

## P. Personalised game master

**Permitted:** notification grouping and volume; how much narrative prose accompanies an event; which screens get emphasis; tutorial depth; adviser verbosity; suggesting a difficulty or preset change **as a visible prompt the user accepts**.
**Forbidden, absolutely:** altering probabilities, results, injuries, transfer outcomes, board patience, or any simulation value based on observed play style. No secret difficulty adjustment, no manufactured drama, no rubber-banding.
**The rule:** the game master may change **what you are shown**, never **what is true**. Everything it adjusts must be visible and resettable in Settings, and its state must be inspectable.
**MVP:** no. **Later:** low priority, high risk of feeling manipulative. Ship the presets (doc 16 §5) and see whether anyone wants more.

## Q. Club constitution, authority and delegation

**Experience:** the job at one club gives you transfer control; another makes you
win the sporting director's approval, and both arrangements can change during a
crisis.
**Why AI helps:** it does not help decide authority. It can make a formal dispute
read like politics rather than a permissions error.
**Simulation:** versioned authority grants define who may recommend, approve,
veto, execute and be informed for every decision family. Delegation trades user
attention for another character's deterministic policy.
**Forbidden:** an AI-written line creating, bypassing or implying authority that
the constitution does not grant.
**MVP:** authority scope already exists on the three board actors. **Later:** high
value after Board & Mandate; this is a core expansion in doc 20.

## R. Evidence-backed manager identity

**Experience:** clubs approach you because of how you actually operated, while an
agent distrusts you because your promise record contradicts your public image.
**Why AI helps:** interviews and retrospectives can synthesize a long record.
**Simulation:** reputation facets are derived separately for each constituency
from observed event ids. A declared philosophy creates a commitment, not a bonus.
**Forbidden:** an AI-assigned personality, reputation delta or career label.
**MVP:** promise and mandate record. **Later:** very high—the mechanical completion
of “the job, not the club.”

## S. Belief, provenance and leaks

**Experience:** the captain knows the manager promised a start because the player
told him; the journalist has only a source-backed rumour; the board knows neither.
**Why AI helps:** phrasing uncertainty and conflicting interpretations.
**Simulation:** every belief records holder, proposition, source event, source
actor, grade and confidence; deterministic access and propagation rules decide
who learns what.
**Forbidden:** the model deciding diffusion, truth, confidence or who leaked.
**MVP:** no. **Later:** high, but only after `canHold()` has proved the simpler
memory boundary.

## T. Decision lens and causal affordance

**Experience:** before acting, the user understands why this decision exists,
who knows, which commitments are implicated and which categories of state each
choice can change—without seeing a strategy-guide prediction.
**Why AI helps:** optional concise explanation over an already assembled causal
graph. The template implementation is sufficient.
**Simulation:** every offered option must lead to a meaningfully different state
or follow-up eligibility; otherwise it is the same option and must be merged.
**Forbidden:** recommending the “best” option, revealing hidden values or claiming
a guaranteed reaction.
**MVP:** the Board “why” panel. **Later:** essential across every consequential
screen.

## U. Career chapters and scenario capsules

**Experience:** the game can accurately say “this was the window that changed
your tenure,” show the sourced turning points, and later let the user share a
privacy-safe account of it.
**Why AI helps:** compression and long-form prose over a deterministic selection
of events.
**Simulation:** a chapter compiler selects boundaries, evidence, commitments,
turning points, echoes and unresolved threads. The model does not decide which
events count.
**Forbidden:** unsupported retrospective claims or raw save data in an export.
**MVP:** no. **Later:** highest emotional value; scenario capsules are post-alpha
research. See [doc 20](20-living-football-director.md).

---

## 2. Ranked feature matrix

Scored 1–10. **Difficulty**, **Cost** and **Hallucination** are *risk* scores — higher is worse. `FC-dep` = dependence on data from FC (higher = more exposed to the sync layer's limits).

| # | Feature | Fun | Depth | Unique | Emotion | Replay | Diff | Cost | Halluc | FC-dep | Solo |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | **Deterministic memory + emotion + relationships** | 7 | 10 | 8 | 9 | 9 | 4 | 1 | 1 | 2 | 9 |
| 2 | **Board/director reactions with causal trace** | 8 | 8 | 9 | 8 | 8 | 4 | 2 | 2 | 3 | 9 |
| 3 | **Promises + broken-promise consequences** | 8 | 9 | 8 | 9 | 8 | 3 | 1 | 1 | 2 | 9 |
| 4 | **Intent parsing of free text → structured** | 8 | 6 | 8 | 7 | 6 | 5 | 3 | 4 | 1 | 7 |
| 5 | **Character utterance rendering (LLM voice)** | 8 | 5 | 6 | 8 | 7 | 4 | 4 | 5 | 2 | 8 |
| 6 | **Escalation ladder (concern→request→exit)** | 9 | 9 | 8 | 9 | 8 | 5 | 2 | 2 | 3 | 8 |
| 7 | **Season/career retrospectives with provenance** | 8 | 6 | 9 | 10 | 7 | 4 | 5 | 4 | 4 | 8 |
| 8 | **Scouting reports as ranged prose** | 8 | 8 | 8 | 6 | 8 | 5 | 3 | 5 | 3 | 8 |
| 9 | **Agent negotiation language + strategy FSM** | 9 | 9 | 8 | 8 | 8 | 7 | 4 | 5 | 5 | 6 |
| 10 | **Narrative director (arc detection)** | 8 | 7 | 9 | 8 | 9 | 7 | 3 | 4 | 4 | 6 |
| 11 | **Named journalists with quote memory** | 7 | 6 | 8 | 7 | 8 | 6 | 5 | 6 | 4 | 6 |
| 12 | **Staff advisers with bias** | 7 | 7 | 6 | 6 | 7 | 6 | 4 | 5 | 4 | 6 |
| 13 | **Dressing room + drama budget** | 7 | 8 | 7 | 8 | 8 | 7 | 4 | 5 | 4 | 5 |
| 14 | **Rival managers with history** | 7 | 6 | 8 | 7 | 8 | 7 | 4 | 5 | 5 | 5 |
| 15 | **Generated biographies (gameplay-bearing)** | 6 | 5 | 7 | 7 | 7 | 5 | 3 | 7 | 2 | 7 |
| 16 | **Supporter factions** | 6 | 6 | 7 | 7 | 7 | 6 | 3 | 4 | 4 | 6 |
| 17 | **Tactical/opposition adviser** | 5 | 4 | 3 | 3 | 4 | 6 | 4 | 8 | **9** | 4 |
| 18 | **Personalised game master** | 4 | 3 | 6 | 3 | 5 | 7 | 3 | 6 | 2 | 4 |
| 19 | Autonomous per-player agents | 3 | 5 | 5 | 4 | 5 | **10** | **10** | **9** | 5 | 1 |
| 20 | Real-time match commentary | 2 | 1 | 2 | 2 | 2 | 9 | 8 | **10** | **10** | 1 |

### Grouping

- **Essential foundation (build with no LLM):** 1, 2, 3, 6 — plus the template renderer.
- **Broader institutional foundation (also no LLM):** Q, R and T; add S only
  after the memory visibility boundary is proven.
- **Best MVP AI feature:** 4 + 5, applied to feature 2. See §3.
- **Public-alpha:** 7, 8.
- **Later differentiators:** 9, 10, 11, 12, 13, 14 and U.
- **Experimental:** 15, 16, 18.
- **Reject:** 17 as commonly imagined (see doc 19 §2 — a *modest, honestly-labelled* version survives), 19, 20.

The numerical matrix predates the broader institutional design. Q–U are kept
outside its 1–20 ranking because most are simulation systems rather than AI
features; [doc 20](20-living-football-director.md) gives their adoption and
sequencing decisions.

---

## 3. The first AI vertical slice

### The proposed slice, evaluated

The nine-step slice in the brief (unhappy squad player → conversation → intent → consequence → memory → journalist) is well-constructed and tests the right chain. Two problems with it as a *first* slice:

1. **It requires a deterministic system that doesn't exist yet.** A player grievance needs the squad-status, playing-time-tracking and dressing-room systems. The board system is already the MVP deep system in doc 06 — its deterministic half will exist first.
2. **Step 9 doubles the surface for little extra proof.** Adding a journalist means a second character architecture, a second voice, a public/private knowledge boundary, and a media system — to demonstrate a callback the board can demonstrate on its own.

### The recommended slice

**One director. One mandate. One result. One conversation. One promise. One callback.**

1. At career start, the **sporting director** is generated deterministically: name, three weighted priorities, patience, authority scope, voice tag. Personality from a seeded derivation, not a model.
2. A **mandate** is negotiated in structured UI (no AI): the user accepts or pushes back on a stated objective. Accepting creates a `promise` row.
3. A **result imports from FC** through the existing sync path and writes `sim_events`.
4. The board system deterministically computes the director's reaction: which of `{backing, concern, warning, satisfaction}` fires, with the source events attached. **The simulation has now decided everything.**
5. The LLM renders that reaction in the director's voice, given a fact sheet and 3–5 retrieved memories. Template fallback always available. Output is schema-validated and grounded-checked.
6. The user replies — buttons, or free text parsed into one of six intents, **shown for confirmation before it commits**. The deterministic system applies the consequence and writes a memory.
7. Weeks later, when the promise comes due, the director's next line references it — because the memory row is there, not because the model remembered.

### Why this is the better slice

- It rides on the deep system the roadmap already commits to, so the deterministic half is not extra work.
- It exercises **the entire AI pipeline end to end** — facts → deterministic decision → rendering → intent parsing → consequence → memory → callback — with exactly one character archetype.
- It is the cheapest possible proof: ~2 model calls per match-week.
- It fails loudly. If the sync misimports a result, the director says something visibly wrong, and you find out immediately.
- It contains the one interaction that must feel good for the whole thesis to work: **being held to something you said.**

### Slice exit criteria

- Same career, same seed, same events → identical board state and identical *template* output, byte for byte.
- 100% of rendered lines pass the grounding validator on a 200-line corpus; every failure falls back to a template with no visible error.
- Intent classification ≥ 95% agreement with human labels on a 100-utterance fixture set, and every interpretation is user-confirmable before it commits.
- With AI disabled, the slice is fully playable and still emotionally legible.
- A promise made in week 3 is referenced accurately in week 20.
