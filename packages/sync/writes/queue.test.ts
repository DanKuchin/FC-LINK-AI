import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type Db } from '../../persistence/db.js';
import { migrate } from '../../persistence/migrate.js';
import {
  acknowledgeInstruction,
  collectInstructions,
  enqueueInstruction,
  listInstructions,
  markInstructionDurable,
} from './queue.js';

let directory: string;
let db: Db;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-queue-'));
  db = openDatabase(path.join(directory, 'career.sqlite'));
  migrate(db, { now: 1 });
  db.run(
    `INSERT INTO careers (
      id, name, save_uid, master_seed, current_date, schema_version,
      created_at, updated_at
    ) VALUES (1, 'Career', 'save-1', 'seed', 20000, 2, 1, 1)`,
  );
});

afterEach(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function enqueue(key: string, now = 100) {
  return enqueueInstruction(db, {
    careerId: 1,
    idempotencyKey: key,
    kind: 'noop',
    target: { playerId: 7 },
    params: { value: 10 },
    now,
  });
}

describe('write queue', () => {
  it('deduplicates identical work and rejects key reuse for different work', () => {
    const first = enqueue('key-1');
    const same = enqueue('key-1', 200);
    expect(same.id).toBe(first.id);
    expect(listInstructions(db, 1)).toHaveLength(1);
    expect(() => enqueueInstruction(db, {
      careerId: 1,
      idempotencyKey: 'key-1',
      kind: 'noop',
      target: { playerId: 8 },
      params: { value: 10 },
      now: 300,
    })).toThrow(/reused for different work/);
  });

  it('delivers bounded batches and does not redeliver before the retry window', () => {
    for (let index = 0; index < 12; index += 1) enqueue(`key-${index}`, index);
    const first = collectInstructions(db, { careerId: 1, now: 1000 });
    expect(first).toHaveLength(10);
    expect(first.every((item) => item.state === 'sent' && item.attempts === 1)).toBe(true);
    const second = collectInstructions(db, { careerId: 1, now: 1001 });
    expect(second).toHaveLength(2);
    expect(collectInstructions(db, { careerId: 1, now: 1002 })).toEqual([]);
    const retried = collectInstructions(db, {
      careerId: 1,
      now: 31_001,
      retryAfterMs: 30_000,
      limit: 1,
    });
    expect(retried[0]).toMatchObject({ idempotencyKey: 'key-0', attempts: 2 });
  });

  it('requires applied then post-restart durability before terminal success', () => {
    enqueue('key-1');
    collectInstructions(db, { careerId: 1, now: 1000 });
    const applied = acknowledgeInstruction(db, {
      idempotencyKey: 'key-1',
      result: 'applied',
      observed: { value: 10 },
      now: 1100,
    });
    expect(applied).toMatchObject({
      state: 'applied',
      observed: { value: 10 },
    });
    expect(collectInstructions(db, { careerId: 1, now: 99_000 })).toEqual([]);

    const durable = markInstructionDurable(db, 'key-1', 2000);
    expect(durable.state).toBe('durable');
    expect(markInstructionDurable(db, 'key-1', 3000).state).toBe('durable');
  });

  it('records failed acknowledgements and refuses impossible transitions', () => {
    enqueue('key-1');
    expect(() => markInstructionDurable(db, 'key-1', 500)).toThrow(/from state pending/);
    collectInstructions(db, { careerId: 1, now: 1000 });
    expect(() => acknowledgeInstruction(db, {
      idempotencyKey: 'key-1',
      result: 'failed',
      now: 1100,
    })).toThrow(/requires an error/);
    const failed = acknowledgeInstruction(db, {
      idempotencyKey: 'key-1',
      result: 'failed',
      error: 'read-back mismatch',
      now: 1100,
    });
    expect(failed).toMatchObject({
      state: 'failed',
      lastError: 'read-back mismatch',
    });
    expect(() => acknowledgeInstruction(db, {
      idempotencyKey: 'key-1',
      result: 'applied',
      now: 1200,
    })).toThrow(/from state failed/);
  });

  it('keeps append-only attempt evidence', () => {
    enqueue('key-1');
    collectInstructions(db, { careerId: 1, now: 1000 });
    acknowledgeInstruction(db, {
      idempotencyKey: 'key-1',
      result: 'applied',
      now: 1100,
    });
    expect(db.all(
      'SELECT attempt_number, sent_at, acknowledged_at, result FROM sync_operation_attempts',
    )).toEqual([{
      attempt_number: 1,
      sent_at: 1000,
      acknowledged_at: 1100,
      result: 'applied',
    }]);
  });
});
