import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from './ipc.js';

describe('desktop IPC contract', () => {
  it('has unique, namespaced channels', () => {
    const channels = Object.values(IPC_CHANNELS);
    expect(new Set(channels).size).toBe(channels.length);
    for (const channel of channels) expect(channel).toMatch(/^[a-z][a-z-]*:[a-z][a-z-]*$/);
  });

  it('keeps Electron and Node out of renderer source', () => {
    const renderer = path.resolve(import.meta.dirname, '../renderer');
    const violations: string[] = [];
    for (const file of fs.readdirSync(renderer)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const source = fs.readFileSync(path.join(renderer, file), 'utf8');
      if (/from ['"]electron['"]|from ['"]node:/.test(source)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
