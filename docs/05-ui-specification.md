# 05 — UI and Visual Direction

## 1. Design principles

1. **Documents, not dashboards.** This is a reading game. The primary metaphor is the club's paperwork — memos, reports, minutes, ledgers — not a broadcast overlay with animated rings. It differentiates instantly from every other football product, which all look like a TV graphics package.
2. **One decision per screen, one truth per number.** If a screen has two competing primary actions, it is two screens.
3. **Every number is traceable.** Any figure the simulation produced can be clicked to reveal its causal chain. This is pillar 3 made physical.
4. **Uncertainty is drawn, not hidden.** Unknown values render as *ranges* with a confidence band. A scouted player never shows a fake precise number.
5. **Sync state is ambient and never lies.** A persistent strip: green (connected & current), amber (offline / stale, playable), red (divergence needs you). Amber must feel normal, because it will be the most common state.
6. **Density is a setting, not a decision.** Comfortable / compact / dense, applied via CSS custom properties.

## 2. Typography and colour

- **Type:** one humanist sans for UI (Inter or IBM Plex Sans) + one tabular-figure mono for all numeric columns (JetBrains Mono / IBM Plex Mono). Tabular figures are non-negotiable in a league table. Optional condensed grotesque for headlines only.
- **Scale:** 12 / 14 / 16 / 20 / 28 / 40, ratio-locked, scaled by a single root font-size the user controls.
- **Colour:** near-neutral base (paper/ink in light, charcoal/bone in dark), **one** accent for interactive affordances, and a semantic set (positive / caution / negative / info). Club colours appear only as a thin identity stripe — never as chart series, never as text colour.
- **Colour-blind:** every state is encoded twice (colour + shape/label). Ship deuteranopia/protanopia/tritanopia-safe palettes and test the three of them; never encode "good/bad" by hue alone.
- **Reduced motion:** honour `prefers-reduced-motion`; all transitions become instant. Motion is never load-bearing for meaning.

## 3. Navigation

- **Primary rail** (left, icon+label, collapsible): Home · Squad · Tactics · Transfers · Scouting · Academy · Board · Finances · Inbox · World · Calendar.
- **Context tabs** within a section, never nested more than two deep.
- **Command palette (Ctrl+K)** — the real navigation for a power user: jump to any player, club, screen, or action by typing.
- **Back/forward history** with a breadcrumb, because this is a browsing app.
- **Controller:** full gamepad support via a focus-ring model — d-pad/stick moves focus, A activates, B backs out, LB/RB switch sections, Y opens the palette, triggers scroll tables. Every screen must be operable without a mouse (this is also the keyboard accessibility story, done once).
- **Keyboard:** `Ctrl+K` palette, `Ctrl+S` checkpoint, `Space` advance time, `Enter` confirm, `Esc` back, `1–9` section jump, `?` shortcut sheet, `Ctrl+D` Sync Doctor.

## 4. Global states

| State | Rule |
|---|---|
| **Empty** | Always says what will fill it and how. "No scouting reports yet — assign a scout to a region." Never a bare "No data." |
| **Loading** | Skeletons that match final layout for < 1 s; a determinate progress list with counts for anything longer. Never a spinner for a multi-second import |
| **Error** | Plain sentence + what it means + one primary recovery action + "copy diagnostic". No stack traces in the face, always in the clipboard |
| **Stale** | Any panel whose data predates the last snapshot shows an inline "as of <date>" marker rather than pretending to be live |
| **Degraded** | When writes are disabled (unsupported build), affected controls are visible with a lock icon and a one-line reason — never silently missing |

---

## 5. Screen specifications

Each: **purpose · content · actions · navigation · states · what must never be added.**

**1. Home dashboard** — *Purpose:* what needs you today. *Content:* next fixture, 3–8 inbox items needing decisions, board mood in one sentence with a "why" link, squad availability, one league snippet. *Actions:* advance time, open decision, prepare match. *States:* pre-season, mid-week, matchday, crisis. *Never:* a wall of stat tiles. If everything is on Home, nothing is.

**2. Squad** — *Purpose:* judge the group. *Content:* dense table — name, age, position, ability (or range), fitness, form, morale, contract expiry, squad role. Saved column presets. *Actions:* set squad roles, open conversations, list for transfer, compare. *Never:* training micro-management.

**3. Player profile** — *Purpose:* one footballer as a person. *Content:* header (identity, contract, status), tabbed: Attributes / Form & fitness / History / **Relationships & promises** / Scouting / Valuation. *Actions:* conversation, promise, renew, list. *States:* your player vs. an outside player (fog applied). *Never:* fake precision on unscouted players.

**4. Tactics and lineup** — *Purpose:* declare intent that FC will honour. *Content:* pitch view, XI + bench, role assignments, availability warnings. *Actions:* set XI, save shapes. *Note:* MVP is **advisory only** (it does not write to FC); label that honestly on the screen. *Never:* a pretend match-engine preview.

**5. Transfer hub** — *Purpose:* the market as a workspace. *Content:* shortlist, open negotiations with states and deadlines, incoming interest, budget header, window countdown. *Actions:* open enquiry, respond, withdraw. *Never:* a searchable list of every perfect player.

**6. Negotiation** — *Purpose:* one conversation with memory. *Content:* the full turn history as a transcript, current offer builder (fee/structure/wage/clauses), counterparty stance *with the stated reason*, deadline. *Actions:* offer, revise, walk away. *Never:* a slider that reveals the acceptance threshold.

**7. Scouting centre** — *Purpose:* buy knowledge. *Content:* map/region view, scouts and assignments, report queue, confidence-sorted findings. *Actions:* assign, recall, brief. *Never:* filters that let you sort the world by true ability.

**8. Academy** — *Purpose:* bet on teenagers. *Content:* intake cohort, prospects with ceiling ranges, pathway status. *Actions:* promote, loan, release, mentor. *Never:* guaranteed potential numbers.

**9. Boardroom** — *Purpose:* three people, three agendas. *Content:* one card per director — their stated position, their priorities, what they have noticed (drawn from recorded events), the mandate and its progress. *Actions:* request funds, renegotiate mandate, make/decline promises. *Never:* a confidence bar. If the board's feeling can be reduced to a percentage, this screen has failed.

**10. Finances** — *Purpose:* can I afford this, and for how long. *Content:* balance and its ledger, wage bill vs budget, obligations by season, board targets. *Actions:* set wage policy, review commitments. *Never:* an unexplained number — every figure links to its transactions.

**11. Dressing room** — *Purpose:* the social state of the group. *Content:* leadership group, friendship/rivalry graph, open grievances **with their causes**. *Actions:* address a grievance, team talk. *Never:* random unhappiness with no listed cause.

**12. Inbox** — *Purpose:* the queue of things that need you. *Content:* grouped by urgency, decisions pinned to the top, everything else archivable. *Actions:* decide, defer, archive. *Never:* congratulatory noise. If it doesn't need you or teach you, it isn't a message.

**13. World news** — *Purpose:* the league is alive without you. *Content:* transfers, sackings, results elsewhere, storylines. *Never:* fabricated events with no simulation source.

**14. Competitions** — *Purpose:* where everyone stands. *Content:* tables, fixtures, form, top scorers, with a provenance marker on each (synced from FC / computed here).

**15. Calendar** — *Purpose:* time as terrain. *Content:* month grid, fixtures, deadlines, expiries, promise due dates. *Actions:* advance to next event, jump.

**16. Match preparation** — *Purpose:* the checkpoint moment. *Content:* opponent brief, availability, your XI, **and an explicit pre-match snapshot status**. *Actions:* take snapshot → launch FC. *Rule:* the launch button is disabled until the pre-match snapshot exists or the user explicitly chooses manual-result mode.

**17. Post-match review** — *Purpose:* verify, then feel it. *Content:* the diffed result and per-player lines, side by side with "what we imported", a confirm control, then reactions. *Actions:* confirm / correct / re-import. *Never:* auto-commit in the MVP.

**18. Sync Doctor** — *Purpose:* make failure legible and fixable. *Content:* a checklist of every precondition with its live state, the divergence list, the pending write queue, checkpoint list with restore, "export diagnostic bundle". *Actions:* re-test, repair, restore, disable writes. *Rule:* every error the app can produce links here with a deep link to the relevant row.

**19. Settings** — display/density/type-size, motion, colour-blind palette, controller, paths, compatibility, narrative provider (templates vs. AI, default templates), backups, data folder, **and a plain-language "what this app touches" page**.

**20. Career history** — *Purpose:* your tenure, across clubs. *Content:* seasons, clubs, honours, record, sackings, the promises you kept and broke, notable players developed. This is the screen the whole product is arguing for; it should be the most beautiful one in the app.
