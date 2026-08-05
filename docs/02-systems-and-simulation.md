# 02 — Game Systems and World Simulation

Every system below is specified in the same shape: **Fantasy / Inputs / State / Decisions / Outputs / Depends on / Fails when / Screens / MVP / Later / Tests.**

A rule that applies to all of them: **a property that does not change a decision does not exist.** If you cannot name the screen where a number changes what the player does, delete the number.

---

## A. Squad and player model

- **Fantasy:** "I know things about my players that the ratings don't show."
- **Inputs:** FC `players` row (attributes, potential, age, positions, international reputation), `career_playercontract`, minutes played from snapshot diffs, match outcomes, manager actions.
- **State:** *Visible* — position, age, contract, squad status, fitness, form. *Hidden* — true ceiling, professionalism, ambition, loyalty, pressure handling, consistency, adaptability, injury proneness. *Derived* — current ability estimate, sharpness, morale, tactical familiarity.
- **Decisions:** selection, squad status assignment, training focus, mentoring pairs, conversations, renewal, sale.
- **Outputs:** development deltas, morale events, injury risk, transfer interest from other clubs, dressing-room effects.
- **Depends on:** sync (minutes, results), dressing room, contracts, academy.
- **Fails when:** hidden values drift far from FC's actual attributes and the player notices the two games disagree about the same footballer.
- **Screens:** Squad, Player profile.
- **MVP:** age, position, contract, fitness, form, morale, squad status, **five** hidden traits (professionalism, ambition, loyalty, consistency, pressure). Five, not thirty-eight. Each one must be visible in an explanation string somewhere or it gets cut.
- **Later:** development curves with peak-age modelling, adaptability/language, injury-proneness, career goals.
- **Tests:** development is monotonic under fixed inputs; ten-season ageing keeps the population's age pyramid stable; no attribute escapes bounds.

**Design note.** Do not re-simulate ability. FC owns attributes; the companion owns *interpretation*. Companion-side development should express itself as **development-plan XP nudges** (a confirmed write) and as its own "current ability estimate" for scouting/valuation — not as a competing attribute model. This halves the sync surface and it is more honest.

---

## B. Transfers

- **Fantasy:** "This deal took three weeks and cost me a favour."
- **Inputs:** club needs, budget, player valuation, agent, relationships, window state, rival intent.
- **State:** a `transfer_negotiation` with a status machine and a full turn history: `enquiry → interest → terms(club) → terms(player) → agreement → registration → completed | collapsed | hijacked | withdrawn`.
- **Decisions:** open/withdraw, bid structure (fee, instalments, add-ons, sell-on, buy-back), wage/bonus package, deadline behaviour.
- **Outputs:** squad change, financial obligations across seasons, relationship deltas with club/agent/player, media events, a durable memory of how you behaved.
- **Depends on:** finance, contracts, scouting, relationships, world sim, **and the riskiest FC write**.
- **Fails when:** the companion believes a transfer happened and FC does not. See doc 04 §6 — this exact failure is the one the architecture is built around.
- **Screens:** Transfer hub, Negotiation, Player profile.
- **MVP:** *import-only*. Record transfers FC has already done. **No writes.**
- **Phase 3:** full negotiation with agents, rival interest, clauses and instalments, and a verified single write path.
- **Tests:** a negotiation cannot skip states; instalments sum to the fee; every completed transfer produces matching club ownership on both sides or an open reconciliation item.

**Design a negotiation as a conversation with memory, not a price slider.** The one mechanic worth stealing from real football: *a rejection is information*. Every rejected bid should tell the player something specific (valuation, structure, timing, or that the selling club simply dislikes you), and that reason must come from the sim's own state so it can be shown truthfully.

---

## C. Contracts

- **Fantasy:** "I promised him he'd start. He's on the bench in October."
- **Inputs:** player status/ambition/agent, club wage structure, market comparables, time remaining.
- **State:** wage, length, bonuses, release clause, **promises** (playing time, squad role, a future sale, European football).
- **Decisions:** offer/renew/refuse/let expire; which promises to make.
- **Outputs:** wage bill, morale, leverage, disputes, agent relationship, future grievance events.
- **Depends on:** finance, dressing room, relationships.
- **Fails when:** promises are cheap. If breaking one costs nothing, the whole pillar collapses.
- **Screens:** Player profile → Contract, Inbox.
- **MVP:** wage, length, expiry, and **one** promise type (playing time) with real consequences.
- **Later:** clauses, bonuses, disputes, agent leverage, renewal timing games.
- **Tests:** no player holds two active permanent contracts; expiry produces exactly one outcome (renewal, free transfer, or retirement); a broken promise always generates a traceable event.

---

## D. Board and ownership

- **Fantasy:** "Three people, three agendas, and I need two of them."
- **Inputs:** results, finances, mandate terms, promises, spending, squad age profile, external offers for your players.
- **State:** per-person `patience`, `trust`, `priority weights`, `relationship_with_manager`, `authority scope`, plus an append-only memory of what they have seen you do.
- **Decisions (theirs):** approve/refuse spending, back or undermine you, override a colleague, sack you.
- **Decisions (yours):** which battles to fight, what to promise at hiring, whether to accept a mandate you can't meet.
- **Outputs:** budget changes, mandate revisions, inbox pressure, job security, the sack.
- **Depends on:** results (sync), finance, media, promises.
- **Fails when:** it degenerates into a single hidden number with three faces drawn on it.
- **Screens:** Boardroom, Inbox.
- **MVP:** **this is the MVP deep system.** Chair, sporting director, finance director. Each has 3 weighted priorities, patience, memory, and a distinct voice. A negotiated mandate at hire. Confidence expressed as *stated positions with reasons*, never a bar.
- **Later:** ownership change, academy director, director resignations and factional politics.
- **Tests:** board confidence is a pure function of the recorded event history (replayable); no director acts outside their authority scope; sacking requires a documented threshold crossing.

**Why the board is the right MVP system:** it is 100% companion-authoritative (zero FC writes), it consumes exactly the data the confirmed read path provides (results, table position, squad, finances), and it is the pillar. It converts "results imported correctly" into "someone reacted to my season," which is the entire value proposition, at the lowest possible technical risk.

---

## E. Scouting and recruitment

- **Fantasy:** "My scout in Portugal is good at one thing and I know what it is."
- **State:** scouts with region/role/judgement/bias; assignments; reports with *ranges*, not values; report age; conflicting opinions.
- **Outputs:** shortlists, valuation confidence, recruitment meetings.
- **MVP:** knowledge fog only — unscouted players show ranges and a confidence band; assignments narrow them over time. Two scouts.
- **Later:** specialisms, bias, disagreement between scouts, data-vs-eye conflict, brief-driven recruitment.
- **Tests:** a report's range always contains the true value; confidence never decreases without a reason; stale reports decay deterministically.

---

## F. Academy

- **Fantasy:** "I saw him at 16 and I was right."
- **MVP:** an intake event, prospects with a *range* of ceilings, and one decision that matters (promote / loan / release).
- **Later:** mentoring, positional development, breakthrough events, rival poaching, failed prospects with narrative weight.
- **Tests:** intake sizes stay in bounds across ten seasons; potential ranges narrow monotonically as evidence accrues; the population does not inflate.

---

## G. Finances

- **Fantasy:** "I can afford him. I cannot afford him *and* the wage bill in two years."
- **State:** balance, transfer budget, wage budget, revenue streams, instalments payable/receivable, debt, board targets.
- **Rules:** **money cannot appear.** Every balance change is a row in `financial_transactions`; balance is `SUM(transactions)`, never a stored mutable number. This single rule kills an entire class of economy bugs and makes the whole system auditable and explainable.
- **MVP:** balance, transfer budget, wage budget, simple revenue (matchday + prize + sponsor), one board financial target.
- **Later:** instalments, clauses, debt, owner injections, PSR-style rules, multi-season projection.
- **Tests:** balance always equals the transaction sum; no negative wage bills; ten-season inflation stays inside a defined corridor.

---

## H. Dressing room

- **Fantasy:** "The senior players have decided how they feel about this."
- **MVP:** leadership group (3–5 players by status/personality), a small friendship/rivalry graph, and reactions to **two** triggers only: playing-time grievances and transfer decisions.
- **Later:** factions, nationality/language clusters, team talks, trust arcs.
- **Anti-drama rule:** grievances require an *evidenced precondition* (a broken promise, N consecutive omissions, a sold friend) and each player has a cooldown. No random unhappiness. Ever. **[P]**
- **Tests:** no grievance without a preceding recorded cause; the number of active grievances per season stays inside a soak-tested band.

---

## I. Media and narrative

- **Fantasy:** "That quote is going to follow me."
- **State:** named journalists with styles and a memory of your quotes; storylines with lifespans; a public reputation vector.
- **MVP:** deterministic template-driven inbox and news, three journalists, and **quote memory** — anything you say in a press moment is stored and can be quoted back at you later.
- **Later:** rumours, supporter reaction, reputation-driven job offers.
- **Hard rule:** the simulation decides what happened; the narrative layer decides only how it is worded. See doc 06.
- **Tests:** every narrative event references a real simulation event id; no narrative event can be generated without a source event.

---

## J. World simulation

Everything above applies to the user's club. The world needs the same *outputs* at a fraction of the cost.

**Three fidelity tiers:**

| Tier | Who | What runs | Cost target |
|---|---|---|---|
| **Deep** | User's club | Every system, daily | unbounded (it's one club) |
| **Medium** | Clubs in the user's competitions + realistic transfer partners (~60–120 clubs) | Squad planning monthly, transfers during windows, results from a lightweight model, finances quarterly | ~2–5 ms/club/month |
| **Shallow** | Everyone else (~500+ clubs, ~15k players) | Aggregate only: table positions from strength ratings, ageing and retirement once per season, a small number of transfers sampled rather than simulated | ~50 µs/club/month |

**How to simulate 17,000 players without dying:**
1. **Do not tick players.** Tick *clubs*; players are updated in batch passes at defined boundaries (weekly form, monthly development, seasonal ageing).
2. **Promote on demand.** A shallow club becomes medium the moment the user interacts with it (scouts it, bids for it, is drawn against it) and stays medium for a season. Most of the world is never touched.
3. **Sample, don't enumerate.** Background transfer activity picks *k* plausible deals per window from a scored candidate list rather than evaluating every pair.
4. **Vectorised SQL for batch passes.** Ageing, contract expiry, and wage accrual are single `UPDATE … WHERE` statements, not loops in application code.
5. **Budget enforcement in tests.** A season advance for a 640-club world must complete inside a fixed wall-clock budget (target: **< 3 s**, hard fail at 10 s) and that budget is asserted in CI.

---

## K. Institution, authority and precedent

- **Fantasy:** “I did not just sign a player; I won the argument over who is
  allowed to shape this club.”
- **Inputs:** ownership model, mandate, role appointments, delegated
  responsibilities, board votes, user principles, promises and repeated
  evidence from the event log.
- **State:** a versioned club constitution; per-decision authority grants
  (`recommend`, `approve`, `veto`, `execute`, `informed`); formal and informal
  influence; delegations; favours; evidence-backed club precedents.
- **Decisions:** negotiate authority when hired, delegate or reclaim a
  responsibility, seek approval, form a coalition, challenge a veto, amend a
  club principle.
- **Outputs:** valid action space, political consequences, mandate changes,
  staff autonomy, club-identity evidence and future hiring expectations.
- **Depends on:** board, staff, promises, relationships, finance and the event
  log. It does not depend on an FC write.
- **Fails when:** authority is cosmetic, a character acts outside scope without
  an explicit override, or “club culture” changes from one isolated event.
- **Screens:** Boardroom → Operating Model, Staff → Responsibilities, Decision
  lens, Club history.
- **MVP:** the three Board & Mandate actors already have authority scopes. No new
  surface beyond showing who can decide what.
- **Later:** negotiated job control, delegation, ownership transition,
  coalitions, formal versus informal power and precedent-driven club identity.
- **Tests:** every executed institutional action has a valid authority path or a
  recorded override; a constitution change is versioned; every precedent retains
  source event ids; replay produces identical authority and precedent state.

## L. Manager identity and career authorship

- **Fantasy:** “Clubs do not see a level and a trophy count. They know how I
  operate, because I have behaved that way for ten years.”
- **Inputs:** stated principles, promises, spending, selection, delegation,
  public positions, staff treatment, crisis decisions, results and career moves.
- **State:** evidence-backed reputation facets held separately by constituencies;
  active principles; contradictions; career chapters; portable relationships.
- **Decisions:** declare or retire a principle, accept a compromise, explain a
  reversal, leave or stay, choose which part of a record to defend in an
  interview.
- **Outputs:** job compatibility, mandate terms, staff willingness, agent posture,
  supporter expectations and callbacks at future clubs.
- **Depends on:** institution, memory, media, board, promises and world
  simulation.
- **Fails when:** identity is an XP tree, a self-selected label grants mechanical
  benefits, or every constituency sees the same private evidence.
- **Screens:** Manager profile, Career timeline, Interviews, Season chapter.
- **MVP:** a traceable record of promises and mandate performance.
- **Later:** operating philosophy, constituency-specific reputation, career
  chapters and privacy-safe scenario capsules. See
  [doc 20](20-living-football-director.md).
- **Tests:** no reputation facet changes without evidence; fixed replay yields
  fixed identity; different holders may disagree only because their evidence or
  weighting differs; a chapter claim without provenance cannot be stored.

---

## 3. Time model

**Hybrid: a daily tick that mostly does nothing, plus an event queue that does the work.**

- **Daily:** date advance, scheduled-event dispatch, injury/suspension countdowns, contract expiry checks, negotiation deadlines. Cheap by construction — a day with no due events costs one queue peek.
- **Weekly:** form and sharpness, training, scouting report progress, medium-tier club results.
- **Monthly:** development pass, finances, squad planning for medium clubs, board review of trajectory, shallow-tier aggregate advance.
- **Window-triggered:** transfer market open/close, registration deadlines.
- **Season-triggered:** the rollover sequence in doc 01 §9.4.
- **Purely reactive:** anything caused by a match import, a user decision, or a promise coming due.

### Determinism

This is not optional; it is the foundation of testability, of the "legible causality" pillar, and of the user being able to reload without the world silently changing.

- One **master seed** per career, stored in `careers.master_seed`.
- No global RNG. Every draw comes from a **derived stream**: `stream = hash(master_seed, tick_index, stream_id, entity_id, purpose)`, then a counter-based PRNG (PCG-XSH-RR or splitmix64 — ~40 lines, no dependency).
- Consequence: the same career at the same tick always produces the same outcome, whether it is computed now, recomputed after a reload, or replayed in a test ten months later.
- **Every random draw is logged** with its stream and inputs in dev builds. That log is what powers "why did this happen?".
- **Event de-duplication:** every generated event carries a deterministic id `hash(tick, kind, subject_id, cause_event_id)`. Inserting the same id twice is a no-op (`INSERT … ON CONFLICT DO NOTHING`). This is what makes replay and partial-failure recovery safe.

### Main advance-time loop (pseudocode)

```
function advanceTo(career, targetDate):
  assert(targetDate > career.currentDate)

  while career.currentDate < targetDate:
    tick = career.tickIndex + 1
    day  = career.currentDate + 1 day

    beginTransaction()                       // one DB transaction per day
      ctx = { career, day, tick, rng: streams(career.masterSeed, tick) }

      // 1. Deterministic ordering. Never iterate a hash map.
      due = queue.popDueEvents(day)          // ordered by (priority, kind, subjectId)

      // 2. Dispatch. Handlers are pure(ctx, state) -> effects[]
      effects = []
      for e in due:
        if eventLog.has(e.id): continue      // idempotent replay guard
        effects += handlers[e.kind](ctx, e)

      // 3. Cadence passes
      if day.isMonday:            effects += weeklyPass(ctx)
      if day.isFirstOfMonth:      effects += monthlyPass(ctx)
      if windowBoundary(day):     effects += windowPass(ctx)
      if day == seasonEnd:        effects += seasonRolloverPass(ctx)

      // 4. Apply. Effects are the ONLY way state changes.
      for f in effects:
        applyEffect(f)                       // writes rows + appends to event log
        queue.schedule(f.followUps)

      // 5. Stop conditions surface to the UI, they do not silently continue
      if effects.any(e => e.requiresUserDecision):
        career.currentDate = day
        commitTransaction()
        return PAUSED(reason: e)

      career.currentDate = day
      career.tickIndex   = tick
    commitTransaction()

  return COMPLETED
```

Four properties this shape buys you: one transaction per day (a crash loses at most one day), an append-only event log that doubles as the explanation UI, replay-safety via event ids, and a natural pause point for anything needing the user.

---

## 4. Entity list

`career, season, competition, club, team, player, staff, manager_profile, agent, journalist, board_member, contract, promise, authority_grant, club_principle, belief, precedent, narrative_arc, career_chapter, transfer_negotiation, transfer_transaction, fixture, match_result, player_match_stat, injury, suspension, relationship, scout_assignment, scouting_report, financial_transaction, narrative_event, message, historical_record, sim_event, sync_snapshot, sync_operation, external_id_mapping`

Append-only by policy: `sim_event`, `financial_transaction`, `narrative_event`, `historical_record`, `player_match_stat`, `sync_operation`, `promise`, `authority_grant`, `belief`, `precedent`, `career_chapter` (state changes are new rows referencing the original, never edits).
