import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bridgeHandshakePath,
  createBridgeHandshake,
  removeBridgeHandshake,
  writeBridgeHandshake,
} from './handshake.js';
import { SnapshotAssembler, SnapshotChunkError } from './chunks.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-protocol-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('bridge handshake', () => {
  it('writes atomically with a restricted mode and removes cleanly', () => {
    const directory = temporaryDirectory();
    const handshake = createBridgeHandshake(4242, {
      token: 'a'.repeat(64),
      now: new Date('2026-07-28T12:00:00.000Z'),
      pid: 123,
    });
    const written = writeBridgeHandshake(directory, handshake);

    expect(written).toBe(bridgeHandshakePath(directory));
    expect(JSON.parse(fs.readFileSync(written, 'utf8'))).toEqual(handshake);
    expect(fs.readdirSync(path.dirname(written))).toEqual(['handshake.json']);
    if (process.platform !== 'win32') {
      expect(fs.statSync(written).mode & 0o777).toBe(0o600);
    }

    removeBridgeHandshake(directory);
    expect(fs.existsSync(written)).toBe(false);
    expect(() => removeBridgeHandshake(directory)).not.toThrow();
  });
});

describe('snapshot chunk assembly', () => {
  const payload = JSON.stringify({ rows: ['café', '⚽', 3] });
  const checksum = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
  const chunk = (seq: number, part: string, overrides: Record<string, unknown> = {}) => ({
    transfer_id: 'transfer-1',
    seq,
    of: 3,
    name: 'career-load',
    payload: part,
    checksum,
    ...overrides,
  });

  it('commits only after every chunk and preserves ordering', () => {
    const assembler = new SnapshotAssembler();
    const parts = [payload.slice(0, 5), payload.slice(5, 13), payload.slice(13)];

    expect(assembler.add(chunk(2, parts[1] ?? ''))).toMatchObject({
      state: 'pending',
      have: 1,
    });
    expect(assembler.add(chunk(2, parts[1] ?? ''))).toMatchObject({
      state: 'pending',
      duplicate: true,
      have: 1,
    });
    expect(assembler.add(chunk(1, parts[0] ?? ''))).toMatchObject({
      state: 'pending',
      have: 2,
    });
    expect(assembler.add(chunk(3, parts[2] ?? ''))).toMatchObject({
      state: 'committed',
      payload,
      checksum,
      bytes: Buffer.byteLength(payload),
    });
    expect(assembler.inFlight).toBe(0);
  });

  it('rejects conflicting metadata and bad checksums without committing', () => {
    const assembler = new SnapshotAssembler();
    assembler.add(chunk(1, 'one'));
    expect(() => assembler.add(chunk(2, 'two', { of: 4 }))).toThrowError(
      expect.objectContaining({ code: 'transfer_conflict' }),
    );

    const bad = new SnapshotAssembler();
    bad.add(chunk(1, 'one'));
    bad.add(chunk(2, 'two'));
    expect(() => bad.add(chunk(3, 'three'))).toThrowError(
      expect.objectContaining({ code: 'checksum_mismatch' }),
    );
    expect(bad.inFlight).toBe(0);
  });

  it('caps in-flight transfers and payload size', () => {
    const limited = new SnapshotAssembler({ maxTransfers: 1, maxTransferBytes: 4 });
    limited.add(chunk(1, '1234'));
    expect(() => limited.add(chunk(1, 'x', { transfer_id: 'transfer-2' }))).toThrowError(
      expect.objectContaining({ code: 'too_many_transfers' }),
    );
    expect(() => limited.add(chunk(2, '5'))).toThrowError(
      expect.objectContaining({ code: 'payload_too_large' }),
    );
  });

  it('uses named error codes for malformed chunks', () => {
    const assembler = new SnapshotAssembler();
    expect(() => assembler.add(chunk(0, 'x'))).toThrow(SnapshotChunkError);
  });
});
