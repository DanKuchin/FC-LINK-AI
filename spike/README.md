# Phase 0 — the spike

The point of this folder is to answer seven questions before a single line of the
real application gets written. Nothing here is production code and none of it will
survive into Phase 1 unchanged. That is deliberate.

**Total time: about 3 hours, most of it waiting for a football game to load.**

---

## Before you start

1. **Back up a career save and use a throwaway copy.** Live Editor's own docs warn
   that database writes can break a career. Step 5 writes to your save.
2. Live Editor advises **turning off automatic game updates** — a patch mid-spike
   invalidates your results.
3. Live Editor must be in an **antivirus-excluded folder** (its own requirement).

---

## Order of operations

### 0. Check the environment — 2 minutes, no game needed

```bash
node spike/detect.mjs
```

Finds the game and Live Editor, reads your build number, and tells you whether the
pair is compatible. **If it says your Live Editor doesn't know your build, stop
here and fix that first** — nothing below will work.

### 1. Install the scripts — 1 minute

```bash
pnpm spike:install
```

Copies the six Lua scripts into `<Live Editor>\lua\tenure\` and pre-creates the
output folders (Lua cannot make directories).

### 2. Start the server, then launch the game

```bash
node spike/server.mjs
```

Leave it running. Then: Live Editor launcher → **Run Game** → load your career.
Open the overlay (**F9**) → Features → Lua Engine → execute.

### 3. Run the scripts in order

| Script | What it answers | Writes to your save? |
|---|---|---|
| `01_hello.lua` | Does the transport work at all? Is the save UID readable? | no |
| `02_schema_dump.lua` | What tables and fields actually exist? | no |
| `03_export_core.lua` | How long does a real import take? | no |
| `04_fixtures_probe.lua` | **Do fixtures/results read on this build?** | no |
| `05_persist_write.lua` | (arm it first) writes a marker into each candidate table | **yes** |
| `06_persist_verify.lua` | Did the write survive a full restart? Then restores it. | yes (restore) |

Scripts 02 and 03 take a few minutes each. Watch the Live Editor console output.

Between 05 and 06 you must: **save in-game → quit FC completely → relaunch →
load the same career.** Skipping the full quit invalidates the whole test.

### 4. Report

```bash
node spike/report.mjs
```

Writes `docs/spike-report.md` grading all seven checks. `UNKNOWN` is a real result
and is never reported as a pass.

---

## What each result means

- **04 fails** → fixtures and results must be entered by hand until the offsets are
  re-derived. Not fatal, but re-read the abort conditions before continuing: a
  companion where you type in every scoreline is a different product.
- **06 shows everything REVERTED** → FC is read-only in practice. The MVP is
  designed to write nothing, so this is survivable — but the product must be
  re-scoped deliberately and said out loud, not discovered in month six.
- **04 projects a slow import** → delta snapshots become mandatory rather than an
  optimisation.
- **02 finds no `career_*` tables** → you almost certainly ran it outside career
  mode. Load a save first.

---

## Files

```
spike/
├─ detect.mjs           environment + compatibility check (no game needed)
├─ server.mjs           loopback HTTP server + handshake  (Tickets 3, 4)
├─ install-scripts.ps1  copies the Lua into Live Editor
├─ report.mjs           grades the seven checks
└─ out/                 what the server received (git-ignored)

bridge/spike/
├─ 01_hello.lua           Ticket 5
├─ 02_schema_dump.lua     Ticket 6
├─ 03_export_core.lua     Ticket 7
├─ 04_fixtures_probe.lua  Ticket 8
├─ 05_persist_write.lua   Ticket 9a
└─ 06_persist_verify.lua  Ticket 9b
```

Lua output lands in `%LOCALAPPDATA%\Tenure\spike\`.
