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

// ── gather ───────────────────────────────────────────────────────────────────
const env = readJson(path.join(OUT, 'environment.json'));
const hello = readJson(path.join(OUT, 'hello.json')) ?? readJson(path.join(SPIKE, 'hello_fallback.json'));
const helloViaHttp = fs.existsSync(path.join(OUT, 'hello.json'));

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

const persist = readJson(path.join(SPIKE, 'persist_test.json'));

// ── grade ────────────────────────────────────────────────────────────────────
const checks = [];
const add = (name, state, detail) => checks.push({ name, state, detail });

add('1. Career detected and save UID stable',
  hello ? (hello.in_career && hello.save_uid ? 'PASS' : 'FAIL') : 'UNKNOWN',
  hello ? `in_career=${hello.in_career}, save_uid=${hello.save_uid || '(none)'}` : 'spike 01 not run');

add('2. Transport works (Lua → local HTTP server)',
  hello ? (helloViaHttp ? 'PASS' : 'PARTIAL') : 'UNKNOWN',
  helloViaHttp ? 'server received /v1/hello' : hello ? 'file fallback only — HTTP blocked or server not running' : 'spike 01 not run');

add('3. Real schema captured',
  schemaSummary ? 'PASS' : 'UNKNOWN',
  schemaSummary ? `${schemaSummary.tables} tables, ${schemaSummary.total_rows_seen} rows, ${schemaSummary.elapsed_ms} ms` : 'spike 02 not run');

const projected = timing?.projected_full_import_ms ?? timing?.export_total_ms;
add('4. Snapshot cost acceptable (< 90 s projected import)',
  projected == null ? 'UNKNOWN' : projected < 90000 ? 'PASS' : projected < 300000 ? 'CONCERN' : 'FAIL',
  projected == null ? 'spike 03 not run' : `${(projected / 1000).toFixed(1)} s projected`);

add('5. Fixtures / results readable on this build',
  fixtures ? (fixtures.verdict === 'PASS' ? 'PASS' : fixtures.verdict === 'PASS_WITH_DOUBT' ? 'CONCERN' : 'FAIL') : 'UNKNOWN',
  fixtures ? `${fixtures.verdict}: ${fixtures.checks?.fixtures_found ?? 0} fixtures, ${fixtures.checks?.played_fixtures ?? 0} played` : 'spike 04 not run');

add('6. Match extraction by snapshot diff',
  'UNKNOWN',
  'requires two exports either side of a played match — Ticket 26');

let persistState = 'UNKNOWN', persistDetail = 'spike 05/06 not run';
if (persist?.tests?.length) {
  const inSession = persist.tests.filter((t) => t.in_session_write).length;
  persistState = 'PARTIAL';
  persistDetail = `${inSession}/${persist.tests.length} in-session writes landed; durability recorded by spike 06`;
}
add('7. A write proven durable across a restart', persistState, persistDetail);

// ── write ────────────────────────────────────────────────────────────────────
const icon = { PASS: '🟢', PARTIAL: '🟡', CONCERN: '🟡', FAIL: '🔴', UNKNOWN: '⚪' };
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
if (hello) lines.push(`- Live Editor reported: \`${hello.le_version}\`, in-game date ${hello.in_game_date || '?'}`);
lines.push('');
lines.push('## The seven checks');
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

const failing = checks.filter((c) => c.state === 'FAIL');
const unknown = checks.filter((c) => c.state === 'UNKNOWN');
lines.push('## Verdict');
lines.push('');
if (failing.length === 0 && unknown.length === 0) {
  lines.push('All seven checks answered and none failed. **Proceed to Phase 1.**');
} else {
  if (failing.length) lines.push(`**${failing.length} check(s) failing.** Re-read the abort conditions in \`docs/08-distribution-legal-business-risk.md\` Part F before writing Phase 1 code.`);
  if (unknown.length) lines.push(`${unknown.length} check(s) still unanswered: ${unknown.map((u) => u.name.split('.')[0]).join(', ')}.`);
}
lines.push('');

fs.mkdirSync(path.join(REPO, 'docs'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'docs', 'spike-report.md'), lines.join('\n'));

console.log('');
for (const c of checks) console.log(`  ${icon[c.state]} ${c.state.padEnd(8)} ${c.name}`);
console.log('');
console.log('  written: docs/spike-report.md');
console.log('');
