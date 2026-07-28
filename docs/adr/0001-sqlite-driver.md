# ADR 0001 — Use Node's built-in `node:sqlite`, behind an adapter

**Status:** accepted · 2026-07-28
**Supersedes:** the `better-sqlite3` line in [doc 04](../04-stack-architecture-repo-schema.md) §1

## Context

Doc 04 chose `better-sqlite3`: mature, synchronous, the obvious pick. Building
the persistence layer surfaced two costs that were not visible when the plan was
written.

1. **Native compilation.** `better-sqlite3` is a native addon. In an Electron app
   it must be rebuilt against Electron's ABI (`electron-rebuild`), which needs a
   working MSVC toolchain on Windows. That is a real ongoing tax for a solo
   developer, and it fails in confusing ways on other people's machines.
2. **Node 22+ ships SQLite.** `node:sqlite` provides `DatabaseSync` with the same
   synchronous shape — `prepare`/`run`/`get`/`all`/`exec` — plus `VACUUM INTO`,
   WAL, and `PRAGMA integrity_check`. Everything the checkpoint and migration
   design needs.

## Decision

Use `node:sqlite`, loaded through `packages/persistence/sqlite-runtime.ts`, and
keep all database access behind the `Db` interface in `db.ts`.

## Consequences

**Good**

- Zero install, zero compilation, no `electron-rebuild` step.
- Tests run instantly with no native build in CI.
- The driver decision is twelve lines in one file.

**Costs, stated plainly**

- `node:sqlite` is marked experimental and prints a warning on first use. The API
  could change under us. Mitigated by the adapter: a breaking change costs one
  file, not a codebase.
- **Electron's bundled Node may not expose it.** This is the real risk and it is
  currently untested — Electron does not arrive until Phase 1. If it turns out to
  be missing, swapping in `better-sqlite3` means reimplementing `sqlite-runtime.ts`
  and `db.ts` against the same interface, which is a few hours, not a rewrite.
- A bundler that does not recognise `node:sqlite` as a builtin will try to resolve
  it from disk. That is exactly what happened with Vite, and it is why the driver
  is loaded via `createRequire` rather than a static import.

## Verification

`packages/persistence/persistence.test.ts` covers foreign-key enforcement,
transaction rollback, nested savepoints, WAL mode, `VACUUM INTO` checkpointing,
integrity checking and restore. If the driver is ever swapped, that file is the
acceptance test for the replacement — it touches no driver-specific API.

## Revisit when

Electron is introduced (Phase 1, Ticket 20). Confirm `node:sqlite` is reachable
from the main process before building anything else on top of it.
