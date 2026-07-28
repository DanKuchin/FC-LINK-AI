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
| `pnpm check` | pass; 18 files, 130 tests |
| Electron cold-boot smoke | pass; renderer + preload + typed IPC + Electron `node:sqlite` |
| Process killed mid-day transaction | pass; prior day restored, SQLite integrity clean |
| Migration corpus | pass; schema v1 opens at v3 with career row preserved |
| Sync Doctor | pass; all 12 conditions in doc 08 A5 exercised |
| Loopback bridge | pass; token rejection/acceptance, hello/event/log/ack/commands/chunks |
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
- Build-sensitive offsets isolated to `bridge/readers/fixtures_offsets.lua`.
- Host-recorded build guard rejects unknown FC/Live Editor pairs before pointer reads.
- Chunked snapshot protocol with duplicate, ordering, size, and checksum protection.
- Opaque raw snapshot archive with database metadata and checksum verification.
- Mock FC replay bridge for fast loopback integration tests.

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
| Electron shell | implemented | production build and self-terminating cold-boot smoke pass |
| Typed IPC boundary | implemented | sandbox + context isolation; renderer boundary test |
| SQLite + migrations | implemented | Electron runtime check plus persistence suite |
| Checkpoint/restore core | implemented | checksum, integrity check, safety copy, retention tests |
| FC + Live Editor detection | implemented locally | registry, known-path, manifest and manual-path fixture tests; live Windows validation pending |
| Bridge installer | implemented locally | diff preview, SHA-256 verification, tamper conflict and explicit overwrite consent |
| Squad screen | presentation shell | clearly labelled sample data; live data waits for schema |
| Result confirmation screen | presentation shell | no auto-commit; manual fallback represented |
| Import pipeline | blocked correctly | requires recorded real schema |
| Snapshot diffing | blocked correctly | requires recorded before/after fixtures |
| Real-match cold-start exit twice | pending | requires Windows FC + completed import/diff |

The UI intentionally states when it is displaying sample presentation data. It
does not present the shell as a working import.

## Phase 2 — career foundation

| Deliverable | Status | Evidence / blocker |
|---|---|---|
| Full club/player import | blocked correctly | requires real schema fixture |
| Migration framework + old-save test | implemented | shipped v1 → v3 migration preserves the career |
| Backup/restore | implemented | verified list, confirmation, atomic restore, safety copy and restore-history UI workflow |
| Sync Doctor v1 | core implemented, shell present | 12 failure classes, recovery offers and deep links |
| Idempotent write queue | implemented, not enabled | stable keys, max-10 batches, attempts, ack/read-back/durability states |
| Compatibility manifest | implemented | supported/untested/unsupported policy; nothing marked verified |
| Diagnostic bundle | implemented | standard ZIP, atomic mode 0600, bounded logs, credential/save-ID redaction |
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

## Remaining critical path

1. Run and commit the Phase 0 evidence from a throwaway Windows career.
2. Review the recorded schema and anonymise the fixture.
3. Implement mapping/import only against that fixture.
4. Record pre/post snapshots for a played match and implement the diff.
5. Wire imported career services into Squad and Result confirmation, then feed
   live bridge logs and Doctor conditions into diagnostics.
6. Repeat the real-match flow twice from a cold start.
7. Re-run this audit; only then mark Phases 0–2 complete.
