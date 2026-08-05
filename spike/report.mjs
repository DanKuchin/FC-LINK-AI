// TENURE — Phase 0 spike report
//
//   node spike/report.mjs
//
// Collects whatever the Lua scripts produced and grades the seven Phase 0 checks
// from docs/00-verdict-and-feasibility.md §3.9. Writes docs/spike-report.md.
//
// UNKNOWN is a valid outcome and is never dressed up as a pass.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { gradePhaseZero } from './report-core.mjs';

const LOCALAPPDATA = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
const SPIKE = path.join(LOCALAPPDATA, 'Tenure', 'spike');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'spike', 'out');

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const newest = (dir, re) => {
  try {
    return fs.readdirSync(dir).filter((f) => re.test(f)).sort().pop() ?? null;
  } catch { return null; }
};
const firstNdjson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').split('\n')[0]); } catch { return null; }
};
const lastNdjson = (p) => {
  try {
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  } catch { return null; }
};
const readNdjson = (p) => {
  try {
    return fs.readFileSync(p, 'utf8').trim().split('\n')
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
};

// ── gather ───────────────────────────────────────────────────────────────────
const rawEnv = readJson(path.join(OUT, 'environment.json'));
const env = rawEnv?.recorder_version === 2 ? rawEnv : null;
const helloHistory = readNdjson(path.join(OUT, 'server.ndjson'))
  .filter((entry) => entry.recorder_version === 2 && entry.kind === 'hello');
const recordedHello = helloHistory.at(-1)?.body ?? null;
const rawFallbackHello = readJson(path.join(SPIKE, 'hello_fallback.json'));
const fallbackHello = rawFallbackHello?.recorder_version === 2 ? rawFallbackHello : null;

const schemaFile = newest(SPIKE, /^schema_\d+\.ndjson$/);
const schemaMeta = schemaFile ? firstNdjson(path.join(SPIKE, schemaFile)) : null;
const schemaSummary = schemaFile ? lastNdjson(path.join(SPIKE, schemaFile)) : null;

let careerTables = [];
let biggest = [];
if (schemaFile) {
  const rows = fs.readFileSync(path.join(SPIKE, schemaFile), 'utf8')
    .trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && r.record === 'table');
  careerTables = rows.filter((r) => /^career/i.test(r.name)).map((r) => `${r.name} (${r.row_count ?? '?'} rows, ${r.field_count ?? '?'} fields)`);
  biggest = rows.filter((r) => typeof r.row_count === 'number')
    .sort((a, b) => b.row_count - a.row_count).slice(0, 12)
    .map((r) => `${r.name}: ${r.row_count}${r.row_count_capped ? '+ (capped)' : ''}`);
}

const exportDir = newest(SPIKE, /^export_\d+$/);
const timing = readJson(path.join(SPIKE, exportDir ?? '', 'timing.json')) ?? readJson(path.join(SPIKE, 'timing.json'));

const fixturesFile = newest(SPIKE, /^fixtures_\d+\.ndjson$/);
const fixtures = fixturesFile ? firstNdjson(path.join(SPIKE, fixturesFile)) : null;

const persistenceHistory = readNdjson(path.join(SPIKE, 'persist_history.ndjson'));
const matchDiff = readJson(path.join(SPIKE, 'match_diff.json'));
const transferWrite = readJson(path.join(SPIKE, 'transfer_write_result.json'));

// ── grade ────────────────────────────────────────────────────────────────────
const { gates: checks, proceed } = gradePhaseZero({
  environment: env,
  helloHistory,
  schemaMeta,
  schemaSummary,
  timing,
  fixtures,
  matchDiff,
  persistenceHistory,
  transferWrite,
});

// ── write ────────────────────────────────────────────────────────────────────
const icon = { PASS: '🟢', CONCERN: '🟡', FAIL: '🔴', UNKNOWN: '⚪' };
const lines = [];
lines.push('# Phase 0 — spike report');
lines.push('');
lines.push(`Generated ${new Date().toISOString()}. Regenerate with \`node spike/report.mjs\`.`);
lines.push('');
lines.push('## Environment');
lines.push('');
if (env) {
  lines.push(`- Game: \`${env.game_dir ?? '?'}\``);
  lines.push(`- Build: **${env.game_build ?? '?'}**${env.is_steam ? ' (Steam edition)' : ''}`);
  lines.push(`- Live Editor: \`${env.live_editor_dir ?? '?'}\``);
  lines.push(`- Required LE for this build: ${env.required_le_for_build ? env.required_le_for_build.join(' – ') : '**unknown to the installed LE**'}`);
} else {
  lines.push('- not detected — run `node spike/detect.mjs`');
}
if (recordedHello) {
  lines.push(`- Live Editor reported over HTTP: \`${recordedHello.le_version}\`, in-game date ${recordedHello.in_game_date || '?'}`);
} else if (fallbackHello) {
  lines.push(`- Live Editor file fallback only: \`${fallbackHello.le_version}\`, in-game date ${fallbackHello.in_game_date || '?'}`);
}
lines.push('');
lines.push('## Phase 0 gates');
lines.push('');
lines.push('This table combines the seven technical questions in doc 00 §3.9 with the');
lines.push('additional measurable exit safeguards in doc 06. Only an all-PASS table');
lines.push('authorises Phase 1; `CONCERN`, `FAIL`, and `UNKNOWN` all remain blocking.');
lines.push('');
lines.push('| | Check | Result | Detail |');
lines.push('|---|---|---|---|');
for (const c of checks) lines.push(`| ${icon[c.state]} | ${c.name} | **${c.state}** | ${c.detail} |`);
lines.push('');

if (biggest.length) {
  lines.push('## Largest tables');
  lines.push('');
  lines.push(biggest.map((b) => `- ${b}`).join('\n'));
  lines.push('');
}
if (careerTables.length) {
  lines.push('## Career-scoped tables found');
  lines.push('');
  lines.push(careerTables.map((t) => `- \`${t}\``).join('\n'));
  lines.push('');
}
if (timing?.tables) {
  lines.push('## Export timings');
  lines.push('');
  lines.push('| Table | Rows | ms | rows/s |');
  lines.push('|---|---:|---:|---:|');
  for (const t of timing.tables) {
    lines.push(`| ${t.table} | ${t.rows ?? '—'} | ${t.elapsed_ms ?? '—'} | ${t.rows_per_sec ?? '—'} |`);
  }
  if (timing.name_lookup?.ms_per_lookup) {
    lines.push('');
    lines.push(`Name lookup: **${timing.name_lookup.ms_per_lookup.toFixed(2)} ms** each (${timing.name_lookup.sampled} sampled).`);
  }
  lines.push('');
}

const blocking = checks.filter((c) => c.state !== 'PASS');
lines.push('## Verdict');
lines.push('');
if (proceed) {
  lines.push('Every Phase 0 technical question and roadmap safeguard passed. **Proceed to Phase 1.**');
} else {
  lines.push(`**Do not claim Phase 0 complete. ${blocking.length} gate(s) are not PASS:** ` +
    `${blocking.map((gate) => gate.id).join(', ')}.`);
  lines.push('Re-read the abort conditions in `docs/08-distribution-legal-business-risk.md` Part F before schema-dependent implementation.');
}
lines.push('');

fs.mkdirSync(path.join(REPO, 'docs'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'docs', 'spike-report.md'), lines.join('\n'));

console.log('');
for (const c of checks) console.log(`  ${icon[c.state]} ${c.state.padEnd(8)} ${c.name}`);
console.log('');
console.log('  written: docs/spike-report.md');
console.log('');
