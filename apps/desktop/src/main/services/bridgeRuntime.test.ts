import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../../../packages/persistence/db.js';
import { migrate } from '../../../../../packages/persistence/migrate.js';
import type { CompatibilityManifest } from '../../../../../packages/sync/compat/manifest.js';
import type { EnvironmentSummary } from '../../shared/ipc.js';
import { BridgeRuntime } from './bridgeRuntime.js';

const manifest: CompatibilityManifest = {
  manifest_version: 1,
  updated_at: '2026-07-28',
  builds: {
    'build-1': {
      live_editor: { min: 'v1.0.0', max: 'v1.0.0' },
      verified: true,
    },
  },
};

const environment: EnvironmentSummary = {
  gameFound: true,
  gamePath: 'C:\\FC 26',
  gameBuild: 'build-1',
  liveEditorFound: true,
  liveEditorPath: 'C:\\FC Live Editor',
  liveEditorVersion: 'v1.0.0',
  requiredLiveEditor: ['v1.0.0'],
  problem: null,
};

let directory: string;
let careerPath: string;
let runtime: BridgeRuntime | null;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-bridge-runtime-'));
  careerPath = path.join(directory, 'career.db');
  runtime = null;
  const db = openDatabase(careerPath);
  migrate(db, { now: 1 });
  db.run(
    `INSERT INTO careers (
      id, name, save_uid, master_seed, current_date, schema_version, created_at, updated_at
    ) VALUES (1, 'Bridge', 'save-1', 'seed', 20000, 3, 1, 1)`,
  );
  db.close();
});

afterEach(async () => {
  await runtime?.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function createRuntime(now = 100_000): BridgeRuntime {
  runtime = new BridgeRuntime({
    dataDirectory: directory,
    careerPath,
    snapshotDirectory: path.join(directory, 'snapshots'),
    manifest,
    hostEnvironment: () => environment,
    now: () => now,
  });
  return runtime;
}

async function post(
  active: BridgeRuntime,
  route: string,
  body: Readonly<Record<string, unknown>>,
): Promise<Response> {
  const started = active.address;
  if (started === undefined) throw new Error('Bridge runtime is not started.');
  return fetch(`${started.handshake.base_url}${route}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${started.handshake.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function hello(active: BridgeRuntime, saveUid = 'save-1'): Promise<void> {
  const response = await post(active, '/v1/hello', {
    save_uid: saveUid,
    le_version: 'v1.0.0',
    game_build: 'build-1',
    in_career: true,
    in_game_date: 20000,
  });
  expect(response.status).toBe(200);
}

async function productionHello(active: BridgeRuntime): Promise<void> {
  const response = await post(active, '/v1/hello', {
    protocol: 1,
    kind: 'hello',
    save_uid: 'save-1',
    le_version: 'v1.0.0',
    game_build: 'detected_by_host',
    in_career: true,
    in_game_date: '2024-10-04',
    lua_version: 'Lua 5.4',
  });
  expect(response.status).toBe(200);
}

async function snapshot(active: BridgeRuntime, payload = '{"players":[]}'): Promise<void> {
  const checksum = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
  const response = await post(active, '/v1/snapshot', {
    transfer_id: 'transfer-1',
    seq: 1,
    of: 1,
    name: 'pre_match',
    payload,
    checksum,
  });
  expect(response.status).toBe(200);
}

describe('desktop bridge runtime', () => {
  it('starts the production loopback bridge and turns live evidence into Doctor state', async () => {
    const active = createRuntime();
    const started = await active.start();
    expect(started, active.diagnosticLogs()[0]?.content).not.toBeNull();
    expect(started?.handshake.base_url).toMatch(/^http:\/\/127\.0\.0\.1:/);

    await hello(active);
    await snapshot(active);

    const conditions = active.conditions(environment);
    expect(conditions).toHaveLength(12);
    expect(conditions.every((condition) => condition.state === 'ok')).toBe(true);
    expect(active.syncStatus(environment)).toEqual({
      state: 'connected',
      label: 'Connected and current',
      detail: 'The Lua bridge, career identity, and latest snapshot are current.',
      writesEnabled: false,
    });

    const db = openDatabase(careerPath);
    const archived = db.get<{
      reason: string;
      in_game_date: number;
      raw_path: string;
    }>('SELECT reason, in_game_date, raw_path FROM sync_snapshots');
    db.close();
    expect(archived).toMatchObject({ reason: 'pre_match', in_game_date: 20000 });
    expect(fs.readFileSync(archived?.raw_path ?? '', 'utf8')).toBe('{"players":[]}');
    expect(active.diagnosticLogs()[0]?.content).toContain('bridge.snapshot_archived');
  });

  it('rejects snapshot evidence from a different save and reports the mismatch', async () => {
    const active = createRuntime();
    expect(await active.start(), active.diagnosticLogs()[0]?.content).not.toBeNull();
    await hello(active, 'other-save');
    await snapshot(active);

    const wrongSave = active.conditions(environment)
      .find((condition) => condition.id === 'wrong_save');
    expect(wrongSave?.state).toBe('error');
    const db = openDatabase(careerPath);
    expect(db.all('SELECT * FROM sync_snapshots')).toHaveLength(0);
    db.close();
    expect(active.diagnosticLogs()[0]?.content).toContain('bridge.snapshot_rejected');
  });

  it('uses the host-detected build for the production Lua sentinel', async () => {
    const active = createRuntime();
    expect(await active.start(), active.diagnosticLogs()[0]?.content).not.toBeNull();
    await productionHello(active);
    await snapshot(active);
    const compatibility = active.conditions(environment)
      .find((condition) => condition.id === 'unsupported_version_pair');
    expect(compatibility?.state).toBe('ok');
    const db = openDatabase(careerPath);
    expect(db.get<{ game_build: string }>(
      'SELECT game_build FROM sync_snapshots',
    )?.game_build).toBe('build-1');
    db.close();
  });

  it('surfaces a retained snapshot checksum failure in the live Doctor evidence', async () => {
    const active = createRuntime();
    expect(await active.start(), active.diagnosticLogs()[0]?.content).not.toBeNull();
    await hello(active);
    await snapshot(active, 'evidence');
    const db = openDatabase(careerPath);
    const archived = db.get<{ raw_path: string }>('SELECT raw_path FROM sync_snapshots');
    db.close();
    fs.appendFileSync(archived?.raw_path ?? '', 'tamper');

    const corrupt = active.conditions(environment)
      .find((condition) => condition.id === 'corrupted_snapshot');
    expect(corrupt).toMatchObject({ state: 'error', count: 1 });
  });
});
