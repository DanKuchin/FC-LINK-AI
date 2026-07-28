# 09 — Phase 0–2 implementation audit

**Audited:** 2026-07-28

**Branch:** `codex/phase-0-2`

**Scope:** implementation and evidence required by doc 06 Phases 0, 1 and 2.

## Verdict

The schema-independent foundation is green and substantially ahead of the
handoff baseline. **The Phase 0–2 milestone gates are not yet complete.** The
remaining gates require FC 26 + FC Live Editor on Windows and the real schema
fixture that those tools produce. This audit does not substitute mock data for
that evidence.

The handoff's boundary remains in force: do not implement entity mappings,
snapshot parsing, the import pipeline, or match diffing until the Phase 0 schema
dump is recorded. Those modules would otherwise encode guesses about FC's
database.

## Automated evidence

| Check | Result |
|---|---|
| `pnpm build` | pass; renderer, Electron main and CommonJS preload built |
| `pnpm check` | pass; 29 files, 186 tests |
| Electron cold-boot smoke | pass; no renderer/preload errors; typed IPC + Electron `node:sqlite` + live Doctor + accessible Squad trust surface |
| Process killed mid-day transaction | pass; prior day restored, SQLite integrity clean |
| Migration corpus | pass; desktop startup checkpoints and opens schema v1 at v4 with career row preserved |
| Checkpoint integrity | pass; byte-identical database restore, bundled raw evidence, no partial failed checkpoint |
| Manifest override | pass; validate-before-replace, downgrade refusal, damaged-override fallback |
| Sync Doctor | pass; all 12 conditions in doc 08 A5 exercised |
| Loopback bridge | pass; token rejection/acceptance, clean port-collision recovery, hello/event/log/ack/commands/chunks |
| Phase 0 grader | pass; eleven requirement-aligned gates; only one compatible, coherent all-PASS evidence set can authorise Phase 1 |
| Determinism | pass; two 365-day runs produce identical state |
| Diff hygiene | pass; `git diff --check` |

Doc 08 says “eleven” Bridge Doctor conditions but its table contains **12**.
The implementation and tests use all 12 rows, including corrupted snapshots.

## Phase 0 — technical spike

### Implemented locally

- Atomic, private handshake file with protocol version and a 256-bit token.
- Authenticated loopback-only HTTP server on an ephemeral port.
- Production read-only Lua hello bridge and shared transport.
- Schema dump, core export/timing, fixtures probe, and persistence proof scripts.
- Machine-readable persistence-cycle history and a tested Phase 0 evaluator that
  keeps partial, concerning, malformed, or missing evidence blocking.
- Build-sensitive offsets isolated to `bridge/readers/fixtures_offsets.lua`.
- Host-recorded build guard rejects unknown FC/Live Editor pairs before pointer reads.
- Chunked snapshot protocol with duplicate, ordering, size, and checksum protection.
- Opaque raw snapshot archive with database metadata and checksum verification.
- Mock FC replay bridge for fast loopback integration tests.
- Electron-owned production bridge lifecycle with handshake cleanup, bounded
  request/log capture, matching-save enforcement, and opaque snapshot archival.

### Live gate — pending on Windows

| Required evidence | Status |
|---|---|
| Career detected | pending |
| Save UID stable across complete restart | pending |
| At least 5,000 players exported with measured timing | pending |
| Fixtures read, or a documented named failure | pending |
| One played result read back | pending |
| One write proven durable across complete restart | pending |
| Zero corruption after 20 write/save/restart/restore cycles | pending |

Run `node spike/detect.mjs`, then follow `spike/README.md` on the Windows FC
machine. Never arm the write probe against a career that matters.

## Phase 1 — vertical slice

| Deliverable | Status | Evidence / blocker |
|---|---|---|
| Electron shell | implemented | production build; self-terminating cold boot fails on renderer/preload errors |
| Typed IPC boundary | implemented | sandbox + context isolation; renderer boundary test |
| SQLite + migrations | implemented | Electron runtime check; startup pre-migration checkpoint; packaged SQL assets; v1 → v4 desktop test |
| Checkpoint/restore core | implemented | database + latest raw snapshot, checksums, integrity check, safety copy, retention tests |
| FC + Live Editor detection | implemented locally | registry, known-path, manifest and manual-path fixture tests; live Windows validation pending |
| Bridge installer | implemented locally | diff preview, SHA-256 verification, tamper conflict and explicit overwrite consent |
| Personality generation | implemented | five independently seeded fact-driven traits, explanations and population-direction tests |
| Pre-match launch gate | implemented | verified checkpoint mandatory; current snapshot or explicit manual-mode choice |
| Squad + player profile | internal career adapter implemented | component + accessibility contract; six sort keys, three densities, ranges, contract/condition/personality evidence; FC population waits for schema |
| Result confirmation screen | manual path implemented | full score/player-line form, explicit confirmation, `user_entered` provenance, causal event, durable checkpoint retry after restart |
| Import pipeline | blocked correctly | requires recorded real schema |
| Snapshot diffing | blocked correctly | requires recorded before/after fixtures |
| Real-match cold-start exit twice | pending | requires Windows FC + completed import/diff |

The UI intentionally states when it is displaying sample presentation data. It
does not present the shell as a working import.

## Phase 2 — career foundation

| Deliverable | Status | Evidence / blocker |
|---|---|---|
| Full club/player import | blocked correctly | requires real schema fixture |
| Migration framework + old-save test | implemented | shipped v1 → v4 migration preserves the career after a verified automatic checkpoint |
| Backup/restore | implemented | database + raw-evidence bundle, verified list, confirmation, atomic restore, safety copy and restore-history UI workflow |
| Sync Doctor v1 | implemented locally | 12 live conditions derived from environment, Lua hello, career, snapshots and queue; recovery offers and deep links |
| Idempotent write queue | implemented, not enabled | stable keys, max-10 batches, attempts, ack/read-back/durability states |
| Compatibility manifest | implemented | supported/untested/unsupported policy; atomic manual override without app release; nothing marked verified |
| Diagnostic bundle | implemented | live Doctor state + bounded bridge logs, standard ZIP, atomic mode 0600, credential/save-ID redaction, run history |
| Killed-process durability exit | implemented | real child process killed inside an open day transaction |

## Audit findings corrected in this patch

1. An untested compatibility pair was incorrectly shown as healthy instead of a
   read-only warning.
2. Electron initially emitted the preload as ESM while the sandbox loaded it as
   CommonJS. The stronger smoke test caught it; the preload now loads and the
   typed IPC call completes.
3. The first desktop diagnostic handler wrote plain text with a `.zip` name. The
   Electron main process now bundles and calls the tested ZIP exporter.
4. Raw offsets had lived in the spike launcher. They now exist in exactly one
   guarded reader, enforced by an architecture test.
5. The crash test exposed SQLite's `CURRENT_DATE` keyword collision. Queries in
   the test now qualify `careers.current_date`, documenting the required query
   style for the future repository adapter.
6. The spike-only environment detector had no typed desktop service. Detection
   now covers registry entries, known paths, exact build manifests, compatibility
   tables, manual folder selection, and actionable parse failures.
7. The PowerShell spike copier could silently replace existing Lua files. The
   production installer now previews every file, remembers prior checksums,
   rejects user modifications by default, revalidates the plan before writing,
   and verifies installed SHA-256 values.
8. Checkpoint restore was a tested library with an empty desktop adapter. The
   Sync Doctor now lists verification state, confirms restore, keeps the
   pre-restore safety copy, and appends restore history.
9. Manual-result mode had been represented by a decorative button. It now
   commits a validated score and per-player lines transactionally, records
   `user_entered` provenance, updates fixture state, and emits the same downstream
   fact payload as a normalized synced result.
10. The pre-match rule existed only in prose. A named launch-gate state machine
    now blocks every missing/stale/corrupt case, requires a current verified
    checkpoint even in manual mode, and never infers manual consent from failure.
11. Ticket 17's five hidden traits were absent. Personality generation now uses
    independent deterministic streams and visible age, potential-gap, reputation,
    and contract signals, with an explanation for every value.
12. The tested loopback bridge server was never started by Electron, so the
    production Lua script could not connect to the desktop. Electron now owns
    its lifecycle, writes/removes the private handshake, records bounded logs,
    rejects wrong-save snapshots, and archives matching opaque evidence.
13. The Sync Doctor renderer showed five hard-coded presentation rows while the
    twelve-condition engine and diagnostic ZIP received no live state. Both now
    consume the same current evidence; unavailable evidence is amber instead of
    falsely healthy, and exported bundles include the redacted bridge history.
14. Manual result confirmation accepted a verified pre-match checkpoint from
    any career day. It now requires the checkpoint to match the fixture career's
    current day.
15. The Squad screen was a fixed four-row table. It now reads the internal
    managed squad through typed IPC, preserves unknown ranges, sorts every key
    column, supports three density settings, and exposes a keyboard-operable
    player profile. Sample data remains explicitly labelled when no career exists.
16. Checkpoints copied only SQLite even though the architecture requires the
    latest raw snapshot too. New checkpoints now bundle and verify that evidence;
    restore atomically replaces only a validated snapshot path beneath the career
    data directory, keeps a snapshot safety copy when needed, and leaves the
    restored database byte-identical. Legacy database-only manifests remain readable.
17. The production Lua hello uses `game_build: "detected_by_host"` by design.
    Treating that sentinel as a literal build made every real connection look
    unsupported. Compatibility and archived metadata now use the desktop's
    manifest-derived FC build for that exact payload.
18. The Doctor expired a successful hello after 15 seconds even though the
    shipped Lua bridge has no heartbeat contract. It now shows an initial grace
    warning, fails only when no hello arrives, and retains session evidence once
    a real hello has been received.
19. Electron consumed a build-bundled compatibility manifest even though Phase 2
    requires it to update independently. Sync Doctor now accepts an explicitly
    selected JSON override, validates it before atomic replacement, rejects
    older/unsupported formats, falls back to the bundled baseline if a dropped
    file is damaged, and applies the result to compatibility checks immediately.
20. A manual score committed before its post-match checkpoint was created. If
    checkpoint creation failed, the IPC call threw and invited the user to submit
    the already-durable score again. Schema v4 now records checkpoint state in the
    result transaction, reports checkpoint-only failure honestly, discovers
    pending/failed recovery after restart, and retries idempotently without
    creating a checkpoint for the wrong in-game day.
21. The migration framework passed source tests, but the Electron build omitted
    its SQL files and startup never invoked it. Builds now copy the immutable
    migration corpus, and the desktop creates a verified pre-migration checkpoint
    before opening a v1 career at v4.
22. Ticket 20 required a cold boot with no console errors, but the smoke handler
    only printed renderer errors and still returned success. Renderer console and
    preload errors now fail the run, while the same built-app check asserts the
    navigation, main landmark, named sort buttons, labelled density control,
    keyboard player controls, and live profile region. A component contract suite
    independently covers career evidence and all six sort directions.
23. Ticket 4 named port-collision handling, but an ephemeral-only test could not
    exercise it. The server now accepts a test/diagnostic port override, leaves no
    handshake after `EADDRINUSE`, and can retry cleanly after the port is released;
    production still requests an ephemeral loopback port.
24. The original spike report could say “Proceed to Phase 1” when rows were only
    `PARTIAL` or `CONCERN`; it treated one hello as stable restart identity, never
    consumed step 06 durability results, and omitted the required 20 clean cycles.
    The server now versions hello evidence, step 06 emits and appends strict
    same-career restore records, and a tested eleven-gate evaluator requires every
    doc 00 technical question and doc 06 safeguard to be `PASS`. Evidence files
    are versioned and must agree on the save UID, preventing stale mock output or
    files from different careers from composing a false pass.
    A compatible Windows FC/Live Editor pair is itself a gate, and all artifacts
    must also agree on the Live Editor version.
25. The packaged bridge installer pointed at a resources directory that the
    desktop build never populated. Runtime asset copying now includes both the
    immutable migrations and the complete Lua bridge tree beside Electron main;
    startup fails loudly if the installer entry point is absent.

## Remaining critical path

1. Run and commit the Phase 0 evidence from a throwaway Windows career.
2. Review the recorded schema and anonymise the fixture.
3. Implement mapping/import only against that fixture.
4. Record pre/post snapshots for a played match, implement the diff, and feed its
   normalized output through the now-shared confirmation transaction.
5. Populate the implemented Squad/player-profile adapter from the real import.
6. Repeat the real-match flow twice from a cold start.
7. Re-run this audit; only then mark Phases 0–2 complete.
