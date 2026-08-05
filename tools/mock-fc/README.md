# `tools/mock-fc`

A schema-agnostic stand-in for the FC Live Editor Lua bridge. It replays an
ordered scenario against the companion's loopback HTTP server using the real
handshake token and protocol routes.

It deliberately does **not** parse or normalise FC data. Snapshot files are read
as opaque UTF-8 text, split without corrupting multi-byte characters, checksummed,
and sent through `POST /v1/snapshot`. This lets recorded snapshots exercise the
sync pipeline before or without launching FC.

## Run

Start the companion or Phase 0 server so it writes a handshake file, then run:

```bash
pnpm mock-fc -- --scenario tools/mock-fc/examples/minimal.json
```

Use a non-default handshake:

```bash
pnpm mock-fc -- \
  --scenario tools/mock-fc/examples/minimal.json \
  --handshake /path/to/handshake.json
```

Validate a scenario without sending traffic:

```bash
pnpm mock-fc -- --scenario tools/mock-fc/examples/minimal.json --dry-run
```

The client refuses non-loopback URLs so the bearer token cannot be sent to a
remote host accidentally.

## Scenario format

```json
{
  "version": 1,
  "name": "minimal replay",
  "steps": [
    {
      "kind": "hello",
      "body": {
        "save_uid": "mock-career",
        "game_build": "mock",
        "le_version": "mock",
        "in_career": true
      }
    },
    {
      "kind": "snapshot",
      "name": "career-load",
      "file": "snapshot.json",
      "chunk_bytes": 262144
    },
    {
      "kind": "event",
      "body": { "event_name": "DAY_PASSED" }
    },
    {
      "kind": "poll_commands",
      "default_result": "applied",
      "acknowledgements": {
        "command-key": { "observed_value": 123 }
      }
    }
  ]
}
```

Supported steps are `hello`, `snapshot`, `event`, `log`, `ack`,
`poll_commands`, and `sleep`. A snapshot may use either `file` or `inline`, but
not both. Paths are resolved relative to the scenario file.

Real recorded snapshots belong under `tests/fixtures/snapshots/`, which is
git-ignored because career data may be sensitive. Commit only deliberately
anonymised fixtures.
