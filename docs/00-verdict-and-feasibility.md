# 00 — Executive Verdict, What This Is, and Technical Feasibility

> Evidence labels used throughout every document in this folder:
> **[C]** Confirmed — read in official docs/source, with a citation.
> **[I]** Inferred — reasonable deduction from confirmed facts, not directly stated.
> **[A]** Assumption — belief with no evidence yet; must be tested.
> **[P]** Proposed design — my recommendation, not a fact about anything that exists.

---

## 1. Executive verdict

**Viable with major limitations. Conditional GO**, gated on a ~30-hour technical spike (Phase 0) passing seven specific checks.

The integration is more achievable than it looks in one direction and much weaker than it looks in the other:

- **Reading the career is solid.** There is a documented, generic, table-oriented database API over FC 26's in-memory career database, plus a documented per-player season statistics call, plus a documented career-mode event hook, plus a stable per-save unique identifier. All four are the foundation of a working companion. **[C]**
- **Writing to the career is the weak side.** Writes exist and are documented, but the tool's own author attaches explicit save-corruption warnings to the most important one (`TransferPlayer`), and the Live Editor wiki states plainly that *not all database tables persist into the career file* — some edits silently revert on restart. **[C]**
- **Fixtures, results and league tables — the data your loop most depends on — are not exposed through a stable API at all.** The official example script reads them by walking raw pointers at hard-coded offsets (`FCEDataManager + 0x60`, `+ 0x88`). Those offsets are bound to a specific game build. **[C]**
- **Per-match detail does not exist as a readable object.** Only cumulative season aggregates per player per competition are documented. Match-level stats must be derived by diffing snapshots. **[C] + [I]**

The correct product shape that falls out of this evidence is **read-heavy, write-thin**: treat FC as a *match engine and a result oracle*, not as a database you drive. Every design decision in these documents follows from that.

The larger risks are not technical. They are: a hard dependency on a third-party tool that now requires Patreon authentication against an online server, an annual game release that resets compatibility, and a solo developer with 10–15 hours a week trying to out-scope Football Manager. The plan below is built to survive all three.

---

## 2. What this product actually is, technically

Strip the marketing away and it is four processes on one Windows machine:

1. **EA Sports FC 26** — running normally, in an offline Manager Career.
2. **FC 26 Live Editor** — a C++ DLL injected into the game process that exposes an in-game Lua 5.4.6 runtime with access to the career database and to raw memory. **[C]** ([README](https://github.com/xAranaktu/FC-26-Live-Editor), [LUA API v2](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/LUA-API-v2))
3. **A bridge script** written by us, running inside that Lua runtime, which snapshots the career and pushes it out over HTTP or files.
4. **The companion application** — a normal Windows desktop app owning its own SQLite database, which is the actual game.

The companion is not a mod. It patches nothing, ships no EA code, and reads no protected asset. It is a client of a community tool's scripting API.

**The single most important architectural fact:** FC's career is not a durable store you can write to and trust. Your own SQLite database is. FC is upstream of *results* and downstream of *a small number of carefully chosen writes*, and nothing else.

---

## 3. Feasibility report — capability by capability

### 3.1 Confirmed: how the bridge is possible at all

| Capability | Mechanism | Evidence |
|---|---|---|
| Detect that a career is loaded | `IsInCM()` returns bool | [C] [LUA API](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/LUA-API) |
| Stable identity for a specific career save | `GetSaveUID()` → 31-char string, persisted in the `agents` table at `agentid == 499999`, generated on first call | [C] same page |
| Enumerate every accessible table | `GetDBTablesNames()` | [C] |
| Enumerate a table's columns | `GetDBTableFields(name)` | [C] |
| Read all rows of a table | `GetDBTableRows(name)`; v2 equivalent `LE.db:GetTable(n)` + `GetFirstRecord/GetNextValidRecord/GetRecordFieldValue` | [C] + [C] `lua/export_season_stats.lua` |
| Write a single field | `EditDBTableField(field)` / v2 `SetRecordFieldValue(rec, field, val)` | [C] + [C] `lua/extend_user_team_players_contracts.lua` |
| Insert / delete rows | `InsertDBTableRow`, `DeleteDBTableRow` | [C] |
| Season stats per player per competition | `GetPlayersStats()` → array of `{teamid, playerid, compobjid, app, goals, assists, yellow, red, avg, clean_sheets, motm*, two_yellow*, goals_conceded*, saves*}` (*author marks these four "not sure if data is correct") | [C] |
| Hook the career event stream | `AddEventHandler("post__CareerModeEvent", fn)`; event ids include `ENUM_CM_EVENT_MSG_DAY_PASSED`, `ENUM_CM_EVENT_MSG_ABOUT_TO_ENTER_PREMATCH`, `ENUM_CM_EVENT_MSG_POST_LOAD_PREPARE`, `ENUM_CM_EVENT_MSG_INJURY` | [C] [Events](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/LUA-API-v2-Events) + `lua/auto_max_user_team_form_morale_sharpness.lua` |
| Hook tool startup | `LEInitDoneEvent` | [C] |
| Talk to an external process over HTTP | `HTTP:send(REQUEST:new{...})` — GET/POST, headers, cookies, auth, raw body; built on [libcpr](https://github.com/libcpr/cpr); `json` lib available in-runtime | [C] [HTTP Requests](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/LUA-API-v2-HTTP-Requests) |
| Talk to an external process over files | Standard Lua `io.open`/`io.write`, `os.getenv('USERPROFILE')` | [C] `lua/export_fixtures.lua`, `lua/export_season_stats.lua` |
| Read the in-career current date | `GetCurrentDate()` → `{day, month, year}`, `:ToInt()` | [C] `lua/extend_user_team_players_contracts.lua` |
| Read raw memory | `MEMORY:ReadInt/ReadShort/ReadChar/ReadBool/ReadPointer/ReadMultilevelPointer` | [C] `lua/export_fixtures.lua` |

**Known career-mode table names, confirmed by appearing in official scripts or docs:** `players`, `teams`, `teamplayerlinks`, `editedplayernames`, `manager`, `agents`, `career_users` (16 fields incl. `sponsorid`, `seasoncount`, `playertype`), `career_playercontract` (fields incl. `playerid`, `contract_status`, `contract_date`, `last_status_change_date`, `duration_months`), `career_presignedcontract`. **[C]**

### 3.2 Confirmed: what you can write, and the warnings attached

| Write | Notes / author's own warnings |
|---|---|
| `TransferPlayer(playerid, to_teamid, fee, wage, months, from_teamid, release_clause)` | **"This can damage/break your career save… Use with caution. Remember about backups."** Works even when the window is closed. Wage only applies for transfers to the user's club. **[C]** |
| `LoanPlayer(...)` | Same warning; "Tested only in Manager Career Mode." `loantobuy` must stay `-1`. **[C]** |
| `TerminateLoan`, `ReleasePlayerFromTeam`, `DeletePresignedContract` | Same warning class. **[C]** |
| `AddPlayerToTransferList` / `LoanList` / `RemovePlayerFrom*` | Safe-looking. Author warns a player must not be on both lists. **[C]** |
| `SetTransferBudget(int)` / `GetTransferBudget()` | User club only, career mode only. **[C]** |
| `SetPlayerForm/Morale/Sharpness` (0–100, morale 0–120) | **User-team players only.** **[C]** |
| `SetPlayerFitness` (5–95) | Any player. Out-of-range values "may bug the whole player/game". **[C]** |
| `PlayerSetValueInDevelopementPlan(pid, field, xp)` | Development plans override the `players` table for user-team players — so writing `players.dribbling` on your own squad may be ineffective. **[C]** |
| Arbitrary field writes on any accessible table | **[C]** — but see the persistence caveat below. |

### 3.3 The three findings that shape the whole product

**Finding 1 — Not all writes persist.** The Database Editor page states: *"not all database tables can be permanently edited. Only some tables are stored inside the career file, so others will reset every time you restart the game."* It recommends opening the career file in RDBM25 to see which tables are real. **[C]** ([Editing Database](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/Editing-Database))

→ Consequence: **every table we intend to write must be individually proven persistent by a write→quit→reload→read test.** This is Ticket 12. Until a table passes, it is read-only.

**Finding 2 — Fixtures, results and standings are offset-scraped, not API-provided.** `export_fixtures.lua` obtains them by `GetPlugin(ENUM_djb2IFCEInterface_CLSS)` → `ReadMultilevelPointer(…, {0x18,0x10,0x08,0x00})` → `+0x60` (fixture list) and `+0x88` (standings list), then walks fixed-size 0x18 records reading fields at literal byte offsets. **[C]**

→ Consequence: the most business-critical read path in the product is the most patch-fragile part of the whole stack. It must be isolated behind one module, version-gated, and have a manual-entry fallback (`Enter the score yourself`) so a broken offset degrades the product instead of killing it.

**Finding 3 — There is no per-match data.** `GetPlayersStats()` returns *cumulative season totals per player per competition*. No documented API returns a single match's events, scorers, minutes, or ratings. **[C]**

→ Consequence: match detail must be **derived by diffing** a pre-match snapshot against a post-match snapshot. That gives you: who played (apps +1), who scored (goals +n), assists, cards, clean sheets, and a per-match rating derivable from the `avg` aggregate. It does *not* give you minute-by-minute events. **[I]** This is genuinely enough for a management game, but it must be designed for from day one, and it *requires* the pre-match snapshot to exist — which makes the checkpoint discipline in doc 04 mandatory rather than nice-to-have.

### 3.4 Feasibility matrix

| Data / operation | Verdict | Route | Notes |
|---|---|---|---|
| Career loaded? | **Confirmed** | `IsInCM()` | |
| Career identity | **Confirmed** | `GetSaveUID()` | Survives sessions; the key our whole mapping table hangs off |
| Current in-game date | **Confirmed** | `GetCurrentDate()` | |
| Players (attributes, potential, age, contract-valid-until, positions) | **Confirmed** | `players` table | ~17k rows; iteration is fast, *name lookups are slow* (author's own comment) |
| Player names | **Confirmed** | `GetPlayerName()` / `editedplayernames` | Slow per-call; batch once at import, cache forever |
| Teams | **Confirmed** | `teams` table, `GetTeamName()` | |
| Squad membership | **Confirmed** | `teamplayerlinks` | Also the authority for jersey numbers |
| Contracts (duration, status, dates) | **Confirmed** | `career_playercontract` | Wage field not yet located — verify in spike |
| Wages | **Likely, prototype** | probably `career_playercontract` or a sibling career table | Enumerate fields at runtime (Ticket 9) |
| Transfer budget | **Confirmed** | `GetTransferBudget()` | User club only |
| Other clubs' budgets / finances | **Likely, prototype** | some `career_*` table | If absent → companion-authoritative |
| Season stats per player | **Confirmed** | `GetPlayersStats()` | Only for competitions the user's club shares + European/international cups. `motm/saves/goals_conceded/two_yellow` flagged unreliable by author |
| Fixtures + dates | **Likely, prototype (fragile)** | raw memory walk | Version-locked offsets |
| Results / scores | **Likely, prototype (fragile)** | same | Same |
| League tables | **Likely, prototype (fragile)** | standings walk | Derivable from results anyway — prefer deriving |
| Per-match player stats | **Difficult** | snapshot diff only | No native source |
| Injuries | **Likely, prototype** | `ENUM_CM_EVENT_MSG_INJURY` event exists; a `career_*` injury table probably exists | Enumerate tables in spike |
| Suspensions | **Likely, prototype** | derivable from card totals + competition rules | Prefer deriving in the companion |
| Starting lineup / formation | **Likely, prototype** | LE ships a Formation Editor UI, so the data exists; the Lua path is undocumented | Not needed for MVP |
| Youth / academy players | **Likely, prototype** | LE can "generate youth scout academy reports" (UI); Lua path undocumented | Companion-authoritative is fine |
| Manager data | **Confirmed** | `manager` table (firstname, nationality, …) | |
| Board confidence / objectives | **Not required for MVP** | — | 100% companion-authoritative by design. This is the product. |
| Writing squad membership (a transfer) | **Confirmed but unsafe** | `TransferPlayer` | Author's corruption warning. Gate behind backups + verification |
| Writing budget | **Confirmed** | `SetTransferBudget` | Persistence must still be proven |
| Writing form/morale/sharpness | **Confirmed** | user team only | |
| Writing arbitrary fields | **Confirmed, persistence unproven** | `SetRecordFieldValue` | Per-table proof required |
| Anything Ultimate Team / online | **Excluded by constraint** | — | Never |

### 3.5 Which operations need FC running

**Everything.** The Lua runtime lives inside the game process. There is no offline file parser in this stack. **[C]**

Consequence, and it is a big one for UX: **the companion must be fully usable with FC closed**, running entirely off its last snapshot, queueing any pending writes for the next connected session. That is constraint 9 and it is also just correct — the user will spend far more time in the companion than in FC. Design target: *FC connection is an event, not a state.*

### 3.6 IPC choice

Lua can act as an **HTTP client** and can **read/write files**. It cannot host a server, and there is no documented socket, pipe, or WebSocket API. **[C]** That settles it:

**Primary: local HTTP, companion as server.** Companion binds `127.0.0.1` on an ephemeral port, writes `%LOCALAPPDATA%\Tenure\bridge\handshake.json` containing `{port, token, protocol_version}`. The Lua bridge reads that file at `LEInitDoneEvent`, then:
- `POST /v1/snapshot` — pushes career snapshots (chunked, gzip-free, JSON).
- `GET /v1/commands?since=<cursor>` — long-poll for pending write instructions.
- `POST /v1/ack` — reports per-instruction results with the idempotency key.
- `POST /v1/event` — forwards `CareerModeEvent` ids of interest (day passed, pre-match, injury, post-load).

**Fallback: file drop.** Same JSON envelopes written to `…\bridge\outbox\*.json` and read from `…\bridge\inbox\*.json`, with `.tmp`→rename atomicity. Used automatically when HTTP fails — which it will, because Live Editor lives in an antivirus-excluded folder and users' firewalls are unpredictable. **[I]**

Rejected: SQLite as the interchange (no Lua sqlite binding documented — **[C]** absence), named pipes / WebSockets (no Lua API — **[C]** absence).

### 3.7 Readiness detection, write verification, partial failure

- **Ready** = handshake file read **and** `IsInCM()` true **and** `GetSaveUID()` non-empty **and** `LE_VERSION` in the supported set **and** game build in the supported set. Anything less → the companion shows a *degraded* state, never a silent one.
- **Verify a write** by *reading it back in the same session* and again *after the next `POST_LOAD_PREPARE` event*. A write is `applied` after read-back, `durable` only after surviving a reload. Only durable writes clear from the pending queue.
- **Partial failure** is the normal case, not the exception. Every instruction carries an idempotency key; the companion journal records `pending → sent → applied → durable | failed`. Re-running a batch must be a no-op for anything already `durable`. Reconciliation (doc 04 §6) diffs the next snapshot against companion expectations and produces a repair list the user can see and act on.

### 3.8 How FC patches break this

Directly evidenced, not speculation. Live Editor's own `version.json` maps **27 FC 26 game builds** (`1.0.127.59053` … `1.0.138.57785`) to required Live Editor versions, with the tool moving v26.1.0 → v26.3.5 across them. Its `changelog.txt` entries are frequently just *"Work with FC26 v1.6.x"*. **[C]**

So: roughly a game patch every 2–3 weeks, each one potentially invalidating memory offsets. Table and field *names* have been stable across that range (the same scripts still ship), which is why **the DB-table route is strategically preferable to the memory route wherever a choice exists**. **[I]**

Our defence, in order: (1) prefer tables over offsets; (2) isolate all offset code in one file with a build-version guard; (3) ship a compatibility manifest the app can update without a new release; (4) refuse to write when the build is unrecognised, but still allow reading and full offline play; (5) manual score entry as the terminal fallback.

### 3.9 What must be prototyped before anything is promised

1. Full runtime dump of `GetDBTablesNames()` + `GetDBTableFields()` for every table → the real schema, not the assumed one.
2. Per-table persistence proof (write → save → quit → relaunch → read).
3. Offset-based fixture/standings read on the current build, plus behaviour when it fails.
4. Snapshot-diff match extraction across one real played match.
5. HTTP reachability from inside the game process to a localhost server (AV/firewall interaction).
6. Snapshot cost: wall-clock time and memory to export ~17k players + ~700 teams.
7. One `TransferPlayer` write, verified durable, with a backup/restore path proven first.

These are Phase 0. Nothing in doc 05 onward is safe to promise until all seven pass.

---

## 4. Confirmed vs assumed — the honest summary

**Confirmed enough to build on:** career detection, save identity, generic table read/write, season stats, career event hook, HTTP + file IPC, transfer/loan/budget/form writes.

**Assumed and must be proven:** that writes persist; that fixtures can be read reliably on a current build; that a 17k-player snapshot completes in acceptable time; that wages and injuries are reachable; that a full snapshot cycle can run without destabilising the game.

**Known-false to assume:** that anything visible in FC's UI is therefore extractable. Board confidence, objective progress, negotiation state, scout reports and press content have **no documented read path**. Treat all of them as companion-authoritative fiction — which, conveniently, is exactly where the actual game design wants them.
