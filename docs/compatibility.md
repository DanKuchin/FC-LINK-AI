# Compatibility matrix

Regenerate the "detected" section with `node spike/detect.mjs` (writes `spike/out/environment.json`).

## This machine — detected 2026-07-28

| | |
|---|---|
| Game | `D:\Steam\steamapps\common\FC 26` — **Steam edition** |
| Game build | **1.0.138.57785** (from `__Installer\installerdata.xml`) |
| Live Editor | `C:\FC 26 Live Editor` |
| LE version table shipped with that install | silver `v26.3.4` · bronze `v26.3.3` · public `v26.3.3` |
| Required LE for build 1.0.138.57785 | **`v26.3.5`** (per the upstream `version.json`) |
| Verdict | ⛔ **Incompatible.** The installed Live Editor's newest known build is `1.0.136.57334`. It will not inject into `1.0.138.57785`. |

### What to do about it

Three options, in order of preference:

1. **Update Live Editor to v26.3.5.** At the time of writing that is the *silver* tier
   release on [Aranaktu's Patreon](https://www.patreon.com/collection/1744907); the
   public build is `v26.3.4`. Check whether v26.3.5 has since gone public before paying.
2. **Wait** for v26.3.5 to reach the public tier, then update.
3. **Roll the game back** to a build your Live Editor supports and turn off automatic
   updates. Live Editor's own [Getting Started](https://github.com/xAranaktu/FC-26-Live-Editor/wiki/Getting-Started)
   page lists "turn off game updates" as a safety measure. Note that the Steam manifest
   for this install has `autoUpdateEnabled="1"` and `treatUpdatesAsMandatory="1"`.

**Nothing in the Phase 0 spike will run until this is resolved** — the Lua engine only
exists once Live Editor has injected. `node spike/detect.mjs` re-checks in two seconds.

### Steam edition note

The Live Editor README states it "should work on all platforms, although EA App is the
recommended one." This install is the Steam edition. If injection misbehaves after the
version pair is correct, that is the first variable to suspect — and it is worth
recording, because it also means the product must be tested against both storefronts.

---

## Support policy (product-level, from doc 08)

| State | Meaning | App behaviour |
|---|---|---|
| **supported** | The (game build, LE version) pair is in the shipped manifest and has been tested | Full function, writes enabled |
| **untested** | Pair is plausible but unverified | Reads and full offline play; **writes disabled** |
| **unsupported** | Pair is known-bad, or the build is unknown to the manifest | Offline mode only; manual result entry; nothing is sent to the game |

The manifest is data, not code — it updates without an application release, so a game
patch on a Tuesday can be handled the same day.

## Tested pairs

| Game build | Title update | LE version | Fixtures probe | Persistence | Notes |
|---|---|---|---|---|---|
| 1.0.138.57785 | — | (blocked) | not run | not run | LE too old on this machine |

Fill a row in per tested combination. `Fixtures probe` is the verdict from
`04_fixtures_probe.lua`; `Persistence` is the summary from `06_persist_verify.lua`.
