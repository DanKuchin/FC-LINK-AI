// TENURE — environment detection (early cut of Ticket 23)
//
//   node spike/detect.mjs
//
// Finds FC 26 and FC 26 Live Editor, reads the game build number, and checks the
// pair against Live Editor's own compatibility table. A wrong pair is the most
// common reason "nothing happens" — so it is worth knowing in five seconds.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ok = (s) => `  [ok]   ${s}`;
const warn = (s) => `  [warn] ${s}`;
const bad = (s) => `  [FAIL] ${s}`;

// stderr is silenced: `reg query` is noisy for keys that simply lack the value,
// which is the common case when scanning every uninstall entry.
const REG_OPTS = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };

function regQuery(key, value) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', value], REG_OPTS);
    const m = new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`, 'i').exec(out);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// ── FC 26 ────────────────────────────────────────────────────────────────────
function findGame() {
  const candidates = [];
  for (const root of [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]) {
    try {
      const keys = execFileSync('reg', ['query', root], REG_OPTS).split(/\r?\n/);
      for (const k of keys) {
        if (!k.trim()) continue;
        const name = regQuery(k.trim(), 'DisplayName');
        if (name && /EA SPORTS FC.?\s*26|^FC 26$/i.test(name)) {
          const loc = regQuery(k.trim(), 'InstallLocation');
          if (loc && fs.existsSync(loc)) candidates.push(loc);
        }
      }
    } catch { /* key absent */ }
  }
  for (const guess of [
    'C:\\Program Files\\EA Games\\FC 26',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FC 26',
    'D:\\Steam\\steamapps\\common\\FC 26',
  ]) {
    if (fs.existsSync(guess)) candidates.push(guess);
  }
  return [...new Set(candidates)];
}

function gameBuild(dir) {
  const manifest = path.join(dir, '__Installer', 'installerdata.xml');
  if (!fs.existsSync(manifest)) return null;
  const m = /<gameVersion\s+version=['"]([^'"]+)['"]/.exec(fs.readFileSync(manifest, 'utf8'));
  return m ? m[1] : null;
}

// ── Live Editor ──────────────────────────────────────────────────────────────
function findLiveEditor() {
  const guesses = [
    'C:\\FC 26 Live Editor',
    path.join(os.homedir(), 'Desktop', 'FC 26 Live Editor'),
    'D:\\FC 26 Live Editor',
  ];
  return guesses.filter((g) => fs.existsSync(path.join(g, 'version_info.json')));
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log('\n  TENURE — environment check');
console.log('  ───────────────────────────────────────────────────────────');

const games = findGame();
let build = null;
let gameDir = null;
if (games.length === 0) {
  console.log(bad('EA Sports FC 26 not found. Set the path manually in local.config.json.'));
} else {
  gameDir = games[0];
  console.log(ok(`FC 26: ${gameDir}`));
  build = gameBuild(gameDir);
  if (build) console.log(ok(`build: ${build}`));
  else console.log(warn('could not read the build number from __Installer\\installerdata.xml'));
  if (fs.existsSync(path.join(gameDir, 'steam_appid.txt'))) {
    console.log(warn('Steam edition. Live Editor documents the EA App edition as recommended.'));
  }
}

const les = findLiveEditor();
let leInfo = null;
let leDir = null;
if (les.length === 0) {
  console.log(bad('FC 26 Live Editor not found (looked for version_info.json).'));
} else {
  leDir = les[0];
  console.log(ok(`Live Editor: ${leDir}`));
  try {
    leInfo = JSON.parse(fs.readFileSync(path.join(leDir, 'version_info.json'), 'utf8'));
    const tiers = Object.entries(leInfo.le_ver ?? {})
      .map(([t, v]) => `${t}=${v.ver}`)
      .join('  ');
    console.log(ok(`shipped version table: ${tiers}`));
  } catch (e) {
    console.log(warn(`could not parse version_info.json: ${e.message}`));
  }
  const autorun = path.join(leDir, 'lua', 'autorun');
  console.log(fs.existsSync(autorun) ? ok(`lua autorun folder: ${autorun}`) : warn('no lua\\autorun folder'));
}

// ── the compatibility verdict ────────────────────────────────────────────────
console.log('  ───────────────────────────────────────────────────────────');
if (build && leInfo) {
  const required = leInfo.compatibility?.[build];
  const known = leInfo.game_ver?.[build];
  if (!required) {
    console.log(bad(`This Live Editor build does not know game build ${build}.`));
    console.log(`         Its newest known build is ${Object.keys(leInfo.game_ver ?? {})[0] ?? '?'}.`);
    console.log('         → You need a newer Live Editor, or the game must stay on an older patch.');
    console.log('         → Live Editor advises turning OFF automatic game updates.');
  } else {
    console.log(ok(`game build ${build}${known ? ` (title update ${known})` : ''} requires Live Editor ${required.join(' – ')}`));
    console.log('         Confirm your installed Live Editor version in its launcher window.');
  }
} else {
  console.log(warn('Not enough information for a compatibility verdict.'));
}

const detected = {
  recorder_version: 2,
  detected_at: new Date().toISOString(),
  platform: process.platform,
  game_dir: gameDir,
  game_build: build,
  is_steam: gameDir ? fs.existsSync(path.join(gameDir, 'steam_appid.txt')) : null,
  live_editor_dir: leDir,
  live_editor_version_table: leInfo?.le_ver ?? null,
  required_le_for_build: build && leInfo ? (leInfo.compatibility?.[build] ?? null) : null,
};
fs.mkdirSync(path.join(process.cwd(), 'spike', 'out'), { recursive: true });
fs.writeFileSync(
  path.join(process.cwd(), 'spike', 'out', 'environment.json'),
  JSON.stringify(detected, null, 2),
);
if (process.env.LOCALAPPDATA) {
  const bridgeDirectory = path.join(process.env.LOCALAPPDATA, 'Tenure', 'bridge');
  fs.mkdirSync(bridgeDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(bridgeDirectory, 'environment.json'),
    JSON.stringify(detected, null, 2),
  );
}
console.log('  ───────────────────────────────────────────────────────────');
console.log('  written: spike/out/environment.json');
if (process.env.LOCALAPPDATA) {
  console.log(`  written: ${path.join(process.env.LOCALAPPDATA, 'Tenure', 'bridge', 'environment.json')}`);
}
console.log('');
