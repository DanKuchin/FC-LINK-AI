# 01 — Product Identity, Audience, and the Player Experience

## 1. Five candidate names

| Name | Reading | Risk |
|---|---|---|
| **TENURE** | The length and quality of your time in a job. Exactly the thesis: your record, your patience, your enemies. | Common word — needs a trademark search before money changes hands |
| **MANDATE** | What the board hired you to do, and what you negotiated. | Slightly cold; also a common word |
| **BOOT ROOM** | Institutional memory, staff culture, the room where the club's real knowledge lives. | Strongly associated with a specific real club's history — avoid |
| **THE LONG GAME** | Multi-decade view. | Generic, poor search results |
| **CLUB RECORD** | Double meaning: transfer record / historical record. | Reads like a stats site |

**Selected: TENURE** (working title). One word, unclaimed in this genre, and it names the emotional core rather than the subject matter — which is what separates it from the fifty products called *Football Manager Something*. Action item before any paid release: trademark search in the intended markets, plus a domain/handle sweep. **[P]**

## 2. Pitch

> **TENURE** is a football management career where nothing is forgotten. Your promises, your refusals and your record follow you from club to club — and when the whistle blows, you play the match yourself in EA Sports FC.

## 3. Target player

The specific person, not a demographic: **someone who already plays FC 26 Career Mode on PC, already installs mods, and already keeps a spreadsheet.** They are not asking for a better match engine — they have one. They are asking for consequences. They have probably bounced off Football Manager either because it has no match to play or because its depth is a second job.

Secondary: the Football Manager player who misses playing the games.

Explicitly **not** the target: console players, Ultimate Team players, anyone unwilling to run a third-party tool. That is a large exclusion and it is correct — see doc 07.

## 4. Emotional promise

**"Someone will remember this."** Not "you have 400 sliders." The feeling being sold is the low hum of accumulated obligation: the winger you promised minutes to in August, the director who backed you when the board didn't, the chairman at the club you walked out on four years ago who is now the one interviewing you.

## 5. Three pillars

1. **Institutional memory.** Every promise, refusal, favour and grudge is a first-class record with an actor, a date, a decay rate, and a way of resurfacing. Nothing is a hidden float on an entity.
2. **The job, not the club.** You have a career, not a save. Reputation is portable, you can be sacked, headhunted, or stuck at a level; the world keeps its records about you across clubs and decades.
3. **Legible causality.** Any outcome can be opened and traced to the chain of reasons that produced it. No black boxes.

Pillar 3 is the sleeper. It is a *design* differentiator (FM famously hides its reasoning), a *trust* mechanism (when sync goes wrong, the user needs to see why), and it is nearly free — the deterministic event log the simulation already needs for reproducibility *is* the explanation UI. One system, three payoffs.

### The broader north star

TENURE is not ultimately an event generator. It is an **institutional football
career**. The manager negotiates decision rights, delegates authority, states
principles, builds coalitions, spends political capital and creates precedents.
Players, directors, agents, staff, journalists and supporters can hold different
evidence-backed views of the same event. A deterministic Living Football
Director then curates the most meaningful parts of that reality without changing
it.

The expansion adds one obligation to all three pillars: the player must be able
to *author a position*, not merely answer an inbox item. “I will build through
the academy” becomes a recorded commitment whose later fulfilment or reversal
changes what clubs, colleagues and players believe about the manager. The full
architecture and deliberately delayed scope are in [doc 20](20-living-football-director.md).

## 6. Deliberately not included in the identity

Dropped from the brainstorm on purpose: supporter culture, ownership takeovers, tactical familiarity systems, decade-scale club culture drift, create-a-club, dynamic league narratives. All good. All Phase 5+. A solo developer who tries to ship the union of these ships nothing.

## 7. Why choose this over the alternatives

| Versus | Their advantage | Why someone picks TENURE |
|---|---|---|
| **FC 26 Career Mode** | Free, built in, zero setup | Career Mode forgets. Nobody remembers your promises; the board is a bar; the world outside your club barely moves |
| **Football Manager** | Overwhelmingly deeper, licensed, 20 years of iteration | No match to play. TENURE is for people who want to *play* the fixture their decisions built, and who want a smaller, legible ruleset instead of a simulation they'll never fully see |
| **Spreadsheet roleplay** | Infinitely flexible, free | The spreadsheet doesn't push back. No agent says no, no director resigns, no rival hijacks. Also: results import themselves |
| **FC realism mods** (e.g. database/realism overhauls) | Change the game itself; larger audiences | Those improve FC's numbers. TENURE adds a layer FC does not have at all. Complementary, not competing — and it should be explicitly compatible with mod-loaded installs |
| **GAFFER** | First mover, ~1,200 patrons, ships weekly | A different thesis and a different deal: TENURE is playable offline with FC closed, does not gate builds behind an active subscription, publishes its compatibility matrix and its failure modes, and is architected write-thin so it can't corrupt a save it doesn't need to touch. Compete on trust and durability, not on feature count — you will lose a feature race against a five-week sprint cadence |

Be honest about the last row: **GAFFER is ahead and moving fast.** Beating it on breadth is not available. Beating it on *not losing people's careers* is.

---

## 8. The complete gameplay loop

```
   ┌─────────────────────────────────────────────────────────┐
   │  1. Companion opens. Sync status is the first thing      │
   │     you see: green / amber / red, never ambiguous.       │
   ├─────────────────────────────────────────────────────────┤
   │  2. Inbox. 3–8 items that need you. Each is a decision   │
   │     or a consequence of an earlier one.                  │
   ├─────────────────────────────────────────────────────────┤
   │  3. Decide. Board conversations, promises, squad,        │
   │     market, staff. Every decision writes a record.       │
   ├─────────────────────────────────────────────────────────┤
   │  4. Advance to the next fixture. World ticks. Other      │
   │     clubs act. Records age.                              │
   ├─────────────────────────────────────────────────────────┤
   │  5. Match prep → PRE-MATCH CHECKPOINT (snapshot taken)   │
   ├─────────────────────────────────────────────────────────┤
   │  6. Launch FC from the companion. Play the fixture.      │
   ├─────────────────────────────────────────────────────────┤
   │  7. Return. POST-MATCH SNAPSHOT. Diff → who played,      │
   │     scored, got booked, got injured. Result confirmed    │
   │     by the user before it is committed.                  │
   ├─────────────────────────────────────────────────────────┤
   │  8. Consequences. Board reacts, promises come due,       │
   │     media reacts, players react, table updates.          │
   │     ATOMIC CHECKPOINT WRITTEN.                           │
   └────────────────────────── back to 2 ────────────────────┘
```

Step 7's user confirmation is not friction to be optimised away. It is the trust surface: the moment the user verifies the machine understood their match. Ship it in the MVP and only consider auto-confirm once the diff has been right a thousand times.

---

## 9. Player experience, first launch to end of season one

### 9.1 First launch (target: under 6 minutes, and it must be honest about what it's doing)

1. **Welcome + the deal.** One screen, plain language: what this is, that it is unofficial, that it requires a third-party tool, that it is offline-only, that Ultimate Team is never touched, and that using memory-editing tools carries a risk EA could act on. Do not bury this. The user must actively continue.
2. **Detect FC 26.** Scan EA App / Steam registry paths; allow manual browse. Read the executable's file version → this is the compatibility key.
3. **Detect Live Editor.** Look for the launcher; if absent, link out and explain. Never bundle it, never mirror it.
4. **Compatibility check.** Compare (FC build, LE version) against the shipped manifest. Three outcomes: *supported*, *untested — reads only, writes disabled*, *unsupported — offline mode only*.
5. **Install the bridge script** into the Live Editor scripts folder, with a diff shown before writing. Then write the handshake file.
6. **Connection test.** A live checklist that lights up one row at a time: server up → script loaded → career detected → save UID read → 10-row test read → round-trip latency. Any failure links straight into the Bridge Doctor with the specific cause.
7. **Local data.** Create `%LOCALAPPDATA%\Tenure\`, initialise SQLite, run migrations to head.
8. **Presentation.** Text size, reduced motion, colour-blind palette, controller on/off. Set here because a management game is a reading game, and reading settings are accessibility settings.

**Where trust is lost here:** step 3 (people will not understand why a second tool is needed — explain in one sentence and one diagram), step 4 (an amber state must never look like a failure), step 6 (a red row with no explanation is the number one abandonment point).

### 9.2 Career connection

1. Choose: **new companion career from a live FC save**, or **reconnect an existing companion career**.
2. Import snapshot: teams → players → contracts → squad links → current date → competitions in scope. Show a real progress list with counts, not a spinner.
3. Choose the club you manage; confirm it matches FC's `career_users` record.
4. **Reconciliation pass.** Anything missing, ambiguous or duplicated is listed for the user with a proposed resolution and an explicit *Accept all* / *Review each*. Missing data is never silently defaulted.
5. **Generation pass.** The companion invents what FC does not have: personalities, relationships, agents, board members, journalists, existing promises, club expectations. Seeded from `(save_uid, entity_id)` so it is stable and reproducible forever.
6. **Checkpoint 0** written and marked as the restore point.

**Where trust is lost:** the generation pass. If a player's invented personality contradicts what the user knows about that real player, the illusion breaks immediately. Mitigation: derive personality from data FC already has (age, potential gap, international reputation, nationality, contract situation) rather than pure randomness, and let the user edit any generated fact in the first session. **[P]**

### 9.3 A normal session

Open → sync banner → inbox → decisions → advance → prepare → play → import → confirm → consequences → checkpoint. Two hard rules:

- **Nothing irreversible happens without a checkpoint immediately before it.**
- **The app is fully playable with FC closed.** Sync-dependent actions are visibly queued, not disabled with no explanation.

### 9.4 End of season

Ordered, and each stage is a screen the user can read rather than a cutscene: competition resolution → promotion/relegation → contract expiries → financial settlement → development pass → retirements → youth intake → board review of the mandate → your contract decision (renew / be sacked / be approached elsewhere) → history records written → new-season reconciliation against FC.

That last step is the dangerous one. FC will have done its own rollover: new fixtures, transfers made by AI clubs, promoted teams. The companion must diff its own projected new season against FC's actual new season and present the differences as a *reconciliation report*, not silently pick a winner. Season rollover is where a companion product most plausibly loses a career, and it deserves its own phase (Phase 5) and its own soak tests.

**Where trust is lost across the season:** any moment the two worlds visibly disagree — the table says one thing in FC and another in the companion. The counter is not to be perfect. It is to *detect the disagreement first and say so before the user finds it.*
