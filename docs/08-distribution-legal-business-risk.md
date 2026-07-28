# 08 — Distribution, Legal Risk, Business Model, Risk Register, Effort, Decision

## Part A — Distribution and maintenance

### A1. Packaging
Ship **both**: a portable ZIP (primary — this audience already runs portable tools and antivirus-excluded folders) and an NSIS installer (secondary, for people who expect one). No admin rights required for either. All user data lives in `%LOCALAPPDATA%\Tenure\`, never beside the executable, so an update can never touch a save.

### A2. Version surfaces
Four independent versions must be tracked and displayed together on the About/Doctor screen:
`app version` · `save schema version` · `bridge protocol version` · `compatibility manifest version`.

Most support problems are a mismatch between two of these. Showing all four turns "it doesn't work" into a one-line diagnosis.

### A3. Update flow
1. Check on launch, **never** auto-download without consent.
2. Show what changed, including whether a **save migration** is required.
3. **Automatic checkpoint before update.** Always.
4. Update → migrate → verify (`checkInvariants`) → report.
5. **Rollback:** keep the previous app version and the pre-update checkpoint for 30 days; one-click revert.
6. **Bridge scripts update independently of the app** and are versioned by protocol, so a script fix does not require an app release.
7. The **compatibility manifest updates independently of everything** — a signed JSON fetched (with consent) or dropped in manually, so an FC patch on a Tuesday can be handled without a build on a Tuesday.

### A4. Release channels
`stable` (public), `beta` (opt-in, one week ahead), `dev` (supporters + testers). Every channel gets the same code; only timing differs. **No build is ever exclusive to paying users indefinitely** — see Part C.

### A5. Bridge Doctor

A single screen that can name eleven specific conditions, each with a plain-language cause and one recovery action:

| # | Condition | Detection | Offer |
|---|---|---|---|
| 1 | FC 26 not found | registry/path scan fails | Browse manually |
| 2 | Live Editor not found | launcher absent | Link to the official source (never a mirror) |
| 3 | Unsupported version pair | manifest lookup | Continue read-only / offline mode |
| 4 | Lua script not running | no `hello` within timeout | Reinstall script; show the exact run steps |
| 5 | Career not loaded | `IsInCM()` false | "Load your career, then retry" |
| 6 | Wrong save connected | `save_uid` mismatch | Switch career / abort |
| 7 | Stale export | snapshot older than in-game date | Re-snapshot |
| 8 | Permission / AV block | file or port error | Show the exact folder to exclude and why |
| 9 | Entity mapping conflict | ambiguous id match | Review list, resolve individually |
| 10 | Failed write | ack error or read-back mismatch | Retry / abandon / restore checkpoint |
| 11 | Missing acknowledgement | timeout with instruction `sent` | Verify on next load; keep pending |
| 12 | Corrupted snapshot | checksum mismatch | Discard and re-snapshot (never import) |

Every error message anywhere in the app deep-links here. **No dead-end errors.**

### A6. When an FC patch breaks integration
This is a *when*, not an *if* — Live Editor's own `version.json` maps 27 FC 26 builds across ~10 tool versions. **[C]**

The runbook, in order and pre-written:
1. **Detect automatically.** Unknown build → the app enters read-only, tells the user plainly, and keeps every offline feature working.
2. **Publish within 24 h** a compatibility-matrix update marking the build unsupported. This is a JSON change, not a release.
3. **Diagnose:** did table/field names change (rare, historically stable) or did memory offsets move (likely)?
4. **Offsets:** patch `bridge/compat/<build>.lua` only. Ship as a bridge-script update, no app release.
5. **Structural change:** communicate an honest timeline. Do not guess.
6. **Always available meanwhile:** manual result entry keeps every career playable. The product must never be fully dead because a football game patched.

---

## Part B — Legal and dependency risk

*Not legal advice. A practical risk posture for a solo developer, and a list of things to actually ask a lawyer before charging money.*

| Risk | Assessment | Action |
|---|---|---|
| **EA intellectual property** | The app ships no EA code, no EA assets, and does not modify game files. It reads memory of a legally owned copy through a third-party tool. This is the same posture the wider FC modding scene has occupied for years without mass enforcement — which is a description of tolerance, not permission | Ship zero EA content. Never mirror EA files |
| **Trademarks** | "EA Sports FC" may be used *nominatively* to state compatibility; it may not appear in branding, logo, icon, domain or store art | Marketing line: "for use with EA Sports FC 26 on PC." No EA logos anywhere, ever |
| **Club badges / kits / player photos** | Do not ship, do not host, do not bundle | Text-only by default. Optional local import from the user's own installation, entirely user-initiated, nothing bundled or distributed |
| **Player names and data** | Names are read from the user's own game at runtime and stored in *their* local save. Nothing is redistributed | Never ship a database file. Never upload career data anywhere |
| **Static football data we ship** | Only original, non-derived reference data (competition structures, generic name pools that we author) | Document provenance of every file in `packages/football-data/PROVENANCE.md` |
| **Dependency on Live Editor** | The hardest risk. It requires **Patreon authentication against an online server** as of v26.3.5, and its author distributes exclusively via Patreon **[C]** | Never bundle or mirror it. Contact the author for written acknowledgement before any paid release. Abstract the bridge behind an interface so a second backend is possible |
| **Anticheat bypass** | Live Editor runs the game without EAAC and its own wiki states *"Using the tool may flag your account and EA may ban it later on… I can't guarantee anything"* **[C]** | Do not build or ship any bypass. Disclose the risk in onboarding, in the README and on the site, in the user's own words-first language. Offline-only, always |
| **Terms of service** | Using memory-editing tools plausibly conflicts with EA's user agreement | Position explicitly and only as single-player, offline, non-competitive. Never touch online modes. Say so loudly |
| **Charging money** | Selling a product whose function depends on circumventing an anticheat is the sharpest edge in this list | Free during alpha (which is honest anyway). Get actual legal advice before the first paid release |
| **Open-source licences** | Electron/React/SQLite are permissive; verify everything transitively | `license-checker` in CI; ship a third-party notices file |
| **User-generated asset packs** | Community packs will appear and will contain infringing art | Support local import only; host nothing; no in-app gallery or distribution |
| **Takedown risk** | Low-to-moderate now, rises sharply with commercial visibility | Keep the source in a private repo until the posture is settled; keep an off-platform backup; have a "what if" plan rather than a surprise |

**The two disclaimers that must appear in onboarding, the site, and the README:**
> Unofficial and unaffiliated. Not endorsed by or associated with Electronic Arts. EA SPORTS FC and related marks belong to Electronic Arts Inc.

> Requires a third-party community tool that runs EA Sports FC without its anticheat. Offline single-player only. Using such tools may put your EA account at risk. Use at your own discretion.

---

## Part C — Business model

**Recommended: free public alpha → one-time purchase per major version, with an optional supporter tier that buys early access, never exclusive access.**

Why not a subscription: FC ships annually and patches fortnightly. A subscription creates a standing promise to keep pace with EA's release schedule — a promise a solo developer at 12 h/week cannot keep, and one that turns every EA patch into a refund conversation. It also makes the product hostage: cancel and lose the game you're mid-career in. That is exactly the trust position TENURE is competing on.

| Element | Decision |
|---|---|
| **Free forever** | The whole alpha period. Core career loop, sync, Bridge Doctor, save restore. Anything related to *not losing your data* is never paywalled |
| **Paid** | v1.0 as a one-time purchase (suggested £12–£18 / $15–$22), including all updates for that major version — which in practice means one FC cycle |
| **Next FC version** | A new major version at a discounted upgrade price for existing owners. This aligns revenue with the actual recurring cost (annual recompatibility work) rather than pretending it doesn't exist |
| **Supporter tier** | Optional, small (~£4/mo): dev channel, roadmap voting, name in credits, direct feedback channel. It buys *timing and involvement*, never features and never access to something the free build lacks permanently |
| **Refunds** | 14 days, no questions, and an explicit statement that alpha software may break with any EA patch |
| **Credibility before charging** | Publish the compatibility matrix, the known-issues list, the honest architecture, and the failure modes. Charge only after: three consecutive FC patches survived, ≥ 200 tester sessions with zero unrecoverable saves, and legal advice on Part B |
| **Never** | Fabricated market figures, countdown-timer pressure, or promising features that depend on unproven capabilities |

Cost base: essentially zero (a domain, a code-signing certificate ~£200/yr — worth it, since an unsigned exe from a modding scene is a SmartScreen wall and a trust problem, and optional LLM costs which are opt-in and user-funded).

---

## Part D — Ranked risk register

| # | Risk | P | Impact | Early warning | Prevention | Recovery | Phase |
|---|---|---|---|---|---|---|---|
| 1 | **Live Editor changes, gates, or is abandoned** (Patreon auth already required **[C]**) | Med | **Fatal** | Auth failures in logs; author goes quiet; new tiers | Abstract behind a bridge interface; never depend on tier-exclusive features; keep the read path on stable table APIs | Offline-only mode remains fully playable; manual result entry; a second backend becomes the roadmap | 0 |
| 2 | **Save corruption / data loss** | Med | **Fatal to trust** | Invariant violations; restore requests | Checkpoints everywhere; write-thin; atomic transactions; verification before durability | One-click restore; diagnostic bundle; publish a post-mortem | 1–2 |
| 3 | **Sync mismatch users discover before you do** | **High** | High | Divergence counts rising; forum reports | Reconciliation on every snapshot; user confirmation of results; visible provenance | Sync Doctor repair; accept-FC path; unsynced-but-playable mode | 2–3 |
| 4 | **FC title update breaks memory offsets** | **High** (~every 2–3 weeks **[C]**) | Med | New build hash appears | Prefer table APIs; isolate offsets in one guarded file; manifest updates without releases | Read-only mode; manual entry; 24 h matrix update | 0, ongoing |
| 5 | **Scope explosion** | **High** | High | Tickets growing past their phase; "just one more system" | Phase gates with written exit criteria; the exclusion list in doc 06 is a contract | Cut to MVP; ship the smaller thing | all |
| 6 | **Solo-developer burnout** | Med-High | **Fatal** | Missed weeks; refactor-instead-of-ship; dread | 10–15 h/wk is the plan not the floor; phase gates give real completion points; nothing has a public date | Pause without shame; the architecture survives a three-month gap because it's documented and tested | all |
| 7 | **Users expect Football Manager depth immediately** | **High** | Med | "Where are the tactics?" as the top feedback theme | Position precisely: a *companion*, one deep system done well; publish what is deliberately absent | Communicate the roadmap honestly; do not panic-build breadth | 6–7 |
| 8 | **Snapshot too slow to be usable** | Med | High | Ticket 7's measurement | Delta snapshots; cache names once; scope by competition | Reduce fidelity tiers; import in background | 0 |
| 9 | **Multi-season instability** (population/economy drift) | Med | High | Soak charts bending | Nightly 10-season soak from Phase 2; corridors asserted in CI | Balance is data — fix without a code release | 4–5 |
| 10 | **Unrealistic transfer market** | Med | Med | Soak reports; tester complaints | Corridor tests; sampled background deals; valuation unit tests | Rebalance via data | 4 |
| 11 | **Weak AI club behaviour** | Med | Med | Implausible squads in soaks | Rule-based planning with explicit needs; no LLM in the loop | Iterate rules; it's isolated | 4 |
| 12 | **Installation friction kills adoption** | **High** | Med | Drop-off at onboarding step 3–6 | Guided first run; Bridge Doctor; a video; AV-exclusion instructions written for humans | Watch a real install; rewrite the step that fails | 6–7 |
| 13 | **Legal complaint / takedown** | Low-Med | High | Contact from a rights holder | Original branding, zero assets, offline-only, loud disclaimers | Comply immediately; the source and community survive a domain | 7 |
| 14 | **Simulation too slow at world scale** | Med | Med | Season-advance budget breached in CI | Fidelity tiers; batch SQL; budget asserted from Phase 4 | Shrink medium tier; simplify shallow tier | 4 |
| 15 | **Content demand exceeds one person** (templates, names, data) | Med | Med | Repetitive text in testing | Templates are data; coverage test; community contribution path later | Accept less variety; prioritise the ten most-seen events | 4–6 |
| 16 | **A competitor ships the same thing faster** | **High** | Low-Med | Already true | Do not race on features; win on trust, durability and offline independence | Keep going; this market has room for more than one, and neither is EA | all |

Owner for all sixteen: the developer. That is the actual risk profile of a solo project, and pretending otherwise helps nobody.

---

## Part E — Estimated effort

| Phase | Hours | Weeks @ 12.5 h |
|---|---:|---:|
| 0 Spike | 20–40 | 2–3 |
| 1 Vertical slice | 60–100 | 5–8 |
| 2 Career foundation | 80–120 | 6–10 |
| 3 Board + first write | 100–150 | 8–12 |
| 4 World simulation | 120–200 | 10–16 |
| 5 Season rollover | 80–120 | 6–10 |
| 6 Private alpha | 60–100 | 5–8 |
| 7 Public alpha | 80–140 | 6–11 |
| **Total** | **600–970** | **48–78 (12–18 months)** |

Add 15–25% for the annual FC recompatibility cycle, recurring forever.

AI assistance is already priced in. It roughly halves the UI, schema, plumbing and test work; it does approximately nothing for the memory-offset work, the sync semantics, or the balance tuning — which are the parts that actually decide whether this ships.

---

## Part F — Go / No-go

**Conditional GO.**

Go, because the confirmed read path (generic table access + season stats + career events + a stable save UID + HTTP from inside the process) is genuinely sufficient to build the loop, and because the chosen product thesis deliberately lives in the half of the design FC cannot contradict.

Conditional, because five things are unmeasured and two of them can kill it: snapshot cost, and whether writes persist. Both are answered in Phase 0 for under 40 hours of work.

**Abort conditions — decide these now, while it is cheap to be honest:**
- Fixtures/results cannot be read on the current build **and** the offsets cannot be re-derived → the loop requires manual entry for every match. *Continue only if you would still want the game with manual scores.* Most people wouldn't. Stop.
- A full snapshot takes > 5 minutes → the session ritual is intolerable. Stop unless delta snapshots fix it.
- No table proves durably writable → the product is read-only forever. *That is still a viable product under this design* (the board/promise thesis needs no writes), but it must be re-scoped and re-pitched deliberately, not discovered later.
- Live Editor's auth becomes unavailable or hostile → stop until an alternative exists.
