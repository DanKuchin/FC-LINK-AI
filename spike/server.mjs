// TENURE — Phase 0 spike server (Tickets 3 + 4)
//
// A loopback HTTP server that the in-game Lua bridge talks to.
// Zero dependencies on purpose: this must be trivial to run and trivial to trust.
//
//   node spike/server.mjs
//
// It writes %LOCALAPPDATA%\Tenure\bridge\handshake.json so the Lua side can find
// the port and token without anything being hard-coded.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PROTOCOL = 1;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const LOCALAPPDATA = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
const DATA_DIR = path.join(LOCALAPPDATA, 'Tenure');
const BRIDGE_DIR = path.join(DATA_DIR, 'bridge');
const SPIKE_DIR = path.join(DATA_DIR, 'spike'); // where the Lua file-writers drop output
const OUT_DIR = path.join(REPO, 'spike', 'out'); // where the server records what it received

for (const d of [DATA_DIR, BRIDGE_DIR, SPIKE_DIR, OUT_DIR, path.join(OUT_DIR, 'snapshots')]) {
  fs.mkdirSync(d, { recursive: true });
}

const TOKEN = crypto.randomBytes(32).toString('hex');

// ── logging ──────────────────────────────────────────────────────────────────
const started = Date.now();
const stamp = () => new Date().toISOString().slice(11, 23);
const log = (...a) => console.log(`${stamp()} ·`, ...a);
const logLine = fs.createWriteStream(path.join(OUT_DIR, 'server.ndjson'), { flags: 'a' });
const record = (obj) => logLine.write(JSON.stringify({ at: Date.now(), ...obj }) + '\n');

// ── state ────────────────────────────────────────────────────────────────────
/** @type {{save_uid?:string, le_version?:string, game_build?:string, seen_at?:number}} */
let peer = {};
/** in-flight chunked transfers, keyed by transfer id */
const transfers = new Map();
/** write instructions waiting to be collected by the bridge. Empty during the spike. */
const commands = [];
let requestCount = 0;

// ── helpers ──────────────────────────────────────────────────────────────────
function readBody(req, limitBytes = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error(`body exceeds ${limitBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj ?? {});
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function authorised(req) {
  const h = req.headers['authorization'] ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  if (!m) return false;
  const given = Buffer.from(m[1].trim());
  const want = Buffer.from(TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function safeName(s) {
  return String(s ?? 'unnamed').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

// ── handlers ─────────────────────────────────────────────────────────────────
const routes = {
  /** First contact. The bridge announces who and what it is. */
  'POST /v1/hello': (body) => {
    peer = { ...body, seen_at: Date.now() };
    log('HELLO');
    log(`   save_uid   ${body.save_uid ?? '(none — career not loaded?)'}`);
    log(`   le_version ${body.le_version ?? '?'}`);
    log(`   game_build ${body.game_build ?? '?'}`);
    log(`   in_career  ${body.in_career}`);
    if (body.in_game_date) log(`   game date  ${body.in_game_date}`);
    fs.writeFileSync(path.join(OUT_DIR, 'hello.json'), JSON.stringify(body, null, 2));
    record({ kind: 'hello', body });
    return { ok: true, protocol: PROTOCOL, server_uptime_ms: Date.now() - started };
  },

  /** Diagnostics forwarded from inside the game process. */
  'POST /v1/log': (body) => {
    log(`   [lua] ${body.level ?? 'info'}: ${body.message}`);
    record({ kind: 'log', body });
    return { ok: true };
  },

  /** Career-mode events (DAY_PASSED, PRE_MATCH, INJURY, …). */
  'POST /v1/event': (body) => {
    log(`EVENT ${body.event_name ?? body.event_id}`);
    record({ kind: 'event', body });
    return { ok: true };
  },

  /**
   * A chunk of a larger payload. Chunks are only committed once every sequence
   * number has arrived AND the whole-transfer checksum matches — a half-received
   * snapshot must never be mistaken for a complete one.
   */
  'POST /v1/snapshot': (body) => {
    const { transfer_id, seq, of, payload, checksum, name } = body;
    if (!transfer_id || !Number.isInteger(seq) || !Number.isInteger(of)) {
      return { ok: false, error: 'transfer_id, seq and of are required' };
    }
    let t = transfers.get(transfer_id);
    if (!t) {
      t = { of, name: name ?? transfer_id, parts: new Map(), started: Date.now() };
      transfers.set(transfer_id, t);
      log(`SNAPSHOT ${t.name} — receiving ${of} chunk(s)`);
    }
    if (t.parts.has(seq)) return { ok: true, duplicate: true, have: t.parts.size, of: t.of };
    t.parts.set(seq, String(payload ?? ''));

    if (t.parts.size < t.of) return { ok: true, have: t.parts.size, of: t.of };

    const assembled = Array.from({ length: t.of }, (_, i) => t.parts.get(i + 1) ?? '').join('');
    const actual = crypto.createHash('sha256').update(assembled).digest('hex');
    transfers.delete(transfer_id);

    if (checksum && checksum !== `sha256:${actual}`) {
      log(`   REJECTED ${t.name}: checksum mismatch`);
      record({ kind: 'snapshot.rejected', transfer_id, reason: 'checksum' });
      return { ok: false, error: 'checksum mismatch', expected: checksum, actual: `sha256:${actual}` };
    }

    const file = path.join(OUT_DIR, 'snapshots', `${safeName(t.name)}-${Date.now()}.json`);
    fs.writeFileSync(file, assembled);
    const ms = Date.now() - t.started;
    log(`   COMMITTED ${t.name} — ${(assembled.length / 1024).toFixed(1)} KiB in ${ms} ms → ${path.relative(REPO, file)}`);
    record({ kind: 'snapshot.committed', name: t.name, bytes: assembled.length, ms, file });
    return { ok: true, committed: true, bytes: assembled.length, ms };
  },

  /** Pending write instructions. Deliberately always empty during Phase 0. */
  'GET /v1/commands': () => ({ ok: true, commands }),

  /** Result of an attempted write, reported back with its idempotency key. */
  'POST /v1/ack': (body) => {
    log(`ACK ${body.idempotency_key} → ${body.result}`);
    record({ kind: 'ack', body });
    return { ok: true };
  },
};

// ── server ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  requestCount += 1;
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const key = `${req.method} ${url.pathname}`;

  if (url.pathname === '/v1/ping') return send(res, 200, { ok: true, protocol: PROTOCOL });

  if (!authorised(req)) {
    log(`401 ${key} (bad or missing token)`);
    return send(res, 401, { ok: false, error: 'unauthorised' });
  }

  const handler = routes[key];
  if (!handler) return send(res, 404, { ok: false, error: `no route for ${key}` });

  try {
    let body = {};
    if (req.method !== 'GET') {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    }
    return send(res, 200, handler(body, url));
  } catch (err) {
    log(`500 ${key}: ${err.message}`);
    record({ kind: 'error', route: key, error: err.message });
    return send(res, 500, { ok: false, error: err.message });
  }
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const handshake = {
    protocol: PROTOCOL,
    port,
    token: TOKEN,
    base_url: `http://127.0.0.1:${port}`,
    spike_out_dir: SPIKE_DIR,
    created_at: new Date().toISOString(),
    pid: process.pid,
  };
  // atomic write: the Lua side may be reading this at any moment
  const target = path.join(BRIDGE_DIR, 'handshake.json');
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(handshake, null, 2));
  fs.renameSync(tmp, target);

  console.log('');
  console.log('  TENURE spike server');
  console.log('  ───────────────────────────────────────────────────────────');
  console.log(`  listening   http://127.0.0.1:${port}`);
  console.log(`  handshake   ${target}`);
  console.log(`  lua output  ${SPIKE_DIR}`);
  console.log(`  received    ${OUT_DIR}`);
  console.log('  ───────────────────────────────────────────────────────────');
  console.log('  Now run bridge/spike/01_hello.lua from the Live Editor Lua Engine.');
  console.log('  Ctrl+C to stop.');
  console.log('');
});

function shutdown() {
  log(`shutting down after ${requestCount} request(s)`);
  try { fs.unlinkSync(path.join(BRIDGE_DIR, 'handshake.json')); } catch { /* already gone */ }
  logLine.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
