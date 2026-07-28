# TENURE — working title

An original companion management game for **EA Sports FC 26** (PC, offline career only).
You run the club; FC plays the matches. Nothing your club sees is ever forgotten.

> **Status: planning + foundations.** The next step is a technical spike that decides whether the project is real — currently blocked on a Live Editor version mismatch.
>
> **New here? Read [HANDOFF.md](HANDOFF.md) first** — it's the map, the reasoning behind each decision, and the list of traps.

---

## Verdict in one paragraph

**Viable with major limitations — conditional GO.** FC 26 Live Editor exposes a documented Lua API with generic access to the career database, per-player season statistics, a career-mode event hook, a stable per-save unique id, and an HTTP client that can reach a local server. That is enough to build the loop. But writes carry the tool author's own save-corruption warnings, an unknown subset of tables silently fail to persist, fixtures and results are only reachable by walking raw memory offsets that break on FC patches, and there is no per-match data at all — match detail must be derived by diffing snapshots. The product design therefore commits to **read-heavy, write-thin**: FC is a match engine and a result oracle, and the interesting half of the game lives in the systems FC cannot contradict.

Full reasoning and evidence: [docs/00-verdict-and-feasibility.md](docs/00-verdict-and-feasibility.md).

---

## Documents

| Doc | Contents |
|---|---|
| [00 — Verdict & feasibility](docs/00-verdict-and-feasibility.md) | Executive verdict, what this is technically, capability-by-capability evidence, feasibility matrix, confirmed vs assumed |
| [01 — Product concept](docs/01-product-concept.md) | Name, pitch, audience, pillars, differentiation, gameplay loop, first-launch → end-of-season experience |
| [02 — Systems & simulation](docs/02-systems-and-simulation.md) | All ten game systems specified; fidelity tiers; time model; determinism; advance-time pseudocode |
| [03 — Sync architecture](docs/03-sync-architecture.md) | Protocol, identity mapping, **source-of-truth matrix**, checkpoints, write pipeline, the transfer-mismatch failure and how it is prevented |
| [04 — Stack, architecture, repo, schema](docs/04-stack-architecture-repo-schema.md) | Stack comparison and decision, Mermaid architecture, repository tree, full initial SQL schema |
| [05 — UI specification](docs/05-ui-specification.md) | Design principles, navigation, accessibility, 20 screen specs |
| [06 — MVP, roadmap, tickets](docs/06-mvp-roadmap-tickets.md) | MVP scope and exclusions, 8 phases with exit criteria, **the first 30 tickets in execution order** |
| [07 — Testing & narrative](docs/07-testing-and-narrative.md) | Unit/integration/save/simulation/compatibility tests, invariants, CI soak plan, the AI boundary |
| [08 — Distribution, legal, business, risk](docs/08-distribution-legal-business-risk.md) | Packaging, Bridge Doctor, FC-patch runbook, legal posture, business model, ranked risk register, effort, go/no-go |

### AI layer (Stage 0 lands in Phase 3; nothing here is on the MVP critical path)

| Doc | Contents |
|---|---|
| [10 — Verdict & doctrine](docs/10-ai-verdict-and-doctrine.md) | Recommendation, design philosophy, the control boundary and how it's enforced |
| [11 — Opportunity map](docs/11-ai-opportunity-map.md) | All 16 AI opportunities specified, ranked feature matrix, **the first vertical slice** |
| [12 — Character, memory, emotion](docs/12-ai-character-memory-emotion.md) | Lazy character model, memory schema and decay, the knowledge boundary, emotion model |
| [13 — Conversation & actors](docs/13-ai-conversation-and-actors.md) | Hybrid conversation design, agents, board/staff, media, supporters, rivals, scouting |
| [14 — Narrative & events](docs/14-ai-narrative-and-events.md) | Narrative director, **20 emergent story examples**, event taxonomy and the suppression engine |
| [15 — Tools, schemas, prompts](docs/15-ai-tools-schemas-prompts.md) | Permission ladder, 12 JSON schemas, 5-layer prompts, 6 worked prompts, anti-repetition |
| [16 — Safety, cost, latency, controls](docs/16-ai-safety-cost-latency-controls.md) | Hallucination gates, local vs cloud, cost model, latency budgets, presets |
| [17 — Architecture & schema](docs/17-ai-architecture-and-schema.md) | Mermaid architecture + 3 sequence diagrams, migrations 0002–0004, interfaces, debug console |
| [18 — Evaluation, roadmap, tickets](docs/18-ai-testing-roadmap-tickets.md) | Deterministic + model evals, 6 stages, **the first 40 AI tickets** |
| [19 — Risks, rejects, decision](docs/19-ai-risks-rejects-and-decision.md) | Risk register, 11 rejected features, effort, go/no-go, next seven actions |

---

## Key decisions at a glance

- **Stack:** Electron + TypeScript + React + `better-sqlite3`. One language everywhere; simulation packages stay pure TS with zero Electron/React imports so a Tauri port is a shell swap, not a rewrite.
- **IPC:** the companion hosts a token-authenticated loopback HTTP server; the in-game Lua bridge is the client (it can only be a client). Atomic file-drop fallback.
- **MVP deep system:** Board & Mandate — companion-authoritative, zero FC writes, and it *is* the product thesis.
- **MVP writes nothing to FC.** The first write (`SetTransferBudget`) lands in Phase 3, after a durability harness proves it survives a restart.
- **Determinism is structural:** one master seed, derived counter-based streams, an append-only event log with deterministic keys. Same seed → identical save.
- **Money cannot appear:** balance is `SUM(financial_transactions)`, never a stored number.
- **Business model:** free alpha, one-time purchase per major version, optional supporter tier that buys timing — never exclusive access. No subscription; FC's annual cycle makes that a promise that can't be kept.

---

## The next seven actions

1. **Back up a career save and duplicate it.** Never spike against a save you care about. Confirm you can restore it. *(30 min)*
2. **Get Live Editor running and confirm the version pair.** Note your FC 26 build number and the LE version; check them against [`version.json`](https://github.com/xAranaktu/FC-26-Live-Editor/blob/main/version.json). Write both into `docs/compatibility.md`. *(1 h)*
3. **Run the stock scripts first, unmodified**: `list_players.lua`, `export_season_stats.lua`, `export_fixtures.lua` from the Live Editor repo. Whether `export_fixtures.lua` works on your build is the single highest-value fact you can learn today — it tells you if the fragile path is alive. *(2 h)*
4. **Ticket 6 — dump the real schema.** Write the Lua that walks `GetDBTablesNames()` → `GetDBTableFields()` → row counts and writes JSON. Commit the output. Stop guessing at table names. *(3 h)*
5. **Ticket 9 — prove persistence.** Pick five candidate tables, write a value, save, quit, relaunch, read it back. Record the results in `docs/persistence-<build>.md`. This answers the biggest unknown in the plan. *(4 h)*
6. **Tickets 3–5 — first contact.** A ~200-line Node HTTP server plus a Lua script that POSTs `{LE_VERSION, game build, IsInCM(), GetSaveUID()}` to it. Prove the transport works through your antivirus and firewall before building anything on top of it. *(4 h)*
7. **Write the spike report** — measured snapshot times, which of the seven Phase 0 checks passed, what surprised you — and re-read the abort conditions in [doc 08 Part F](docs/08-distribution-legal-business-risk.md) with real numbers in hand. Only then start Ticket 1. *(2 h)*

Roughly 17 hours. At the end of it you will know whether to build this, and no plan can tell you that in advance.

---

## Evidence and sources

Every technical claim in these documents is labelled **[C]** confirmed / **[I]** inferred / **[A]** assumption / **[P]** proposed. Primary sources:

- [FC 26 Live Editor — repository](https://github.com/xAranaktu/FC-26-Live-Editor) (README, `version.json`, `changelog.txt`, `lua/*.lua`)
- [Lua API v2](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/LUA-API-v2) · [Lua API v1 function reference](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/LUA-API) · [Events](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/LUA-API-v2-Events) · [HTTP requests](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/LUA-API-v2-HTTP-Requests) · [Database editor](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/Editing-Database) · [Getting started + anticheat disclaimer](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/Getting-Started)
- Example scripts read in full: `lua/export_fixtures.lua` (memory-offset fixture/standings reads), `lua/export_season_stats.lua` (`LE.db:GetTable` iteration), `lua/extend_user_team_players_contracts.lua` (`career_playercontract` fields), `lua/auto_max_user_team_form_morale_sharpness.lua` (career event ids), `lua/track_cm_events.lua`
- Market reference (studied, not copied): [gaffergame.com](https://gaffergame.com/) and its [Patreon](https://www.patreon.com/cw/GafferGame)

---

## Disclaimers

Unofficial and unaffiliated. Not endorsed by or associated with Electronic Arts. EA SPORTS FC and related marks belong to Electronic Arts Inc.

This project depends on a third-party community tool that runs EA Sports FC without its anticheat. Offline single-player only; online modes are never touched. The tool's own documentation states that using it may put an EA account at risk. Use at your own discretion.
