import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../packages/persistence/db.js';
import { migrate } from '../../packages/persistence/migrate.js';

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-crash-'));
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('process-kill recovery', () => {
  it('discards an interrupted day transaction and reopens with integrity intact', async () => {
    const file = path.join(temporaryDirectory, 'career.db');
    let db = openDatabase(file);
    migrate(db, { now: 1 });
    db.run(
      `INSERT INTO careers (
        id, name, save_uid, master_seed, current_date, schema_version,
        created_at, updated_at
      ) VALUES (1, 'Crash test', 'crash-save', 'seed', 20000, 3, 1, 1)`,
    );
    db.close();

    const childSource = `
      import { DatabaseSync } from 'node:sqlite';
      const database = new DatabaseSync(${JSON.stringify(file)});
      database.exec('PRAGMA journal_mode = WAL');
      database.exec('BEGIN IMMEDIATE');
      database.prepare('UPDATE careers SET current_date = 20001, tick_index = 1 WHERE id = 1').run();
      process.stdout.write('READY\\n');
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    while (!output.includes('READY')) {
      await Promise.race([
        once(child.stdout, 'data'),
        once(child, 'exit').then(() => {
          throw new Error('child exited before opening its day transaction');
        }),
      ]);
    }

    expect(child.kill('SIGKILL')).toBe(true);
    await once(child, 'exit');

    db = openDatabase(file);
    const career = db.get<{ current_date: number; tick_index: number }>(
      'SELECT careers.current_date AS current_date, tick_index FROM careers WHERE id = 1',
    );
    expect(career).toEqual({ current_date: 20000, tick_index: 0 });
    expect(db.integrityProblem()).toBeNull();
    db.close();
  });
});
