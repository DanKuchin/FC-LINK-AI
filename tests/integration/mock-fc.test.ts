import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  chunkUtf8,
  loopbackBaseUrl,
  parseScenario,
  replayScenario,
  type MockFcScenario,
} from '../../tools/mock-fc/replay.ts';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-mock-fc-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('mock FC bridge', () => {
  it('replays ordered messages and reconstructable, checksummed snapshot chunks', async () => {
    const directory = temporaryDirectory();
    const scenarioFile = path.join(directory, 'scenario.json');
    const snapshot = JSON.stringify({
      opaque: 'café ⚽',
      rows: Array.from({ length: 20 }, (_, id) => ({ id })),
    });
    fs.writeFileSync(path.join(directory, 'snapshot.json'), snapshot);

    const scenario: MockFcScenario = parseScenario({
      version: 1,
      name: 'integration',
      steps: [
        { kind: 'hello', body: { save_uid: 'mock-save' } },
        { kind: 'snapshot', name: 'career-load', file: 'snapshot.json', chunk_bytes: 17 },
        { kind: 'event', body: { event_name: 'DAY_PASSED' } },
      ],
    });
    fs.writeFileSync(scenarioFile, JSON.stringify(scenario));

    const seenRoutes: string[] = [];
    const snapshotParts = new Map<number, string>();
    let expectedParts = 0;
    let expectedChecksum = '';
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input);
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer test-token');
      seenRoutes.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (url.pathname === '/v1/snapshot') {
        snapshotParts.set(Number(body.seq), String(body.payload));
        expectedParts = Number(body.of);
        expectedChecksum = String(body.checksum);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await replayScenario(scenario, {
      handshake: {
        protocol: 1,
        token: 'test-token',
        base_url: 'http://127.0.0.1:4242',
      },
      scenarioFile,
      fetchImpl,
    });

    const assembled = Array.from(
      { length: expectedParts },
      (_, index) => snapshotParts.get(index + 1) ?? '',
    ).join('');
    expect(assembled).toBe(snapshot);
    expect(expectedChecksum).toBe(
      `sha256:${crypto.createHash('sha256').update(snapshot).digest('hex')}`,
    );
    expect(seenRoutes[0]).toBe('POST /v1/hello');
    expect(seenRoutes.at(-1)).toBe('POST /v1/event');
    expect(result).toMatchObject({
      scenario: 'integration',
      snapshots: 1,
      snapshot_bytes: Buffer.byteLength(snapshot),
    });
  });

  it('chunks UTF-8 without splitting characters', () => {
    const chunks = chunkUtf8('a⚽b⚽c', 4);
    expect(chunks.join('')).toBe('a⚽b⚽c');
    for (const chunk of chunks) expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(4);
  });

  it('rejects ambiguous snapshot sources and non-loopback handshakes', () => {
    expect(() => parseScenario({
      version: 1,
      name: 'bad',
      steps: [{ kind: 'snapshot', name: 'x', file: 'x.json', inline: {} }],
    })).toThrow(/exactly one/);
    expect(() => loopbackBaseUrl({
      protocol: 1,
      token: 'secret',
      base_url: 'https://example.com',
    })).toThrow(/non-loopback/);
  });

  it('polls commands and acknowledges each idempotency key safely', async () => {
    const acknowledged: Record<string, unknown>[] = [];
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === '/v1/commands') {
        return new Response(JSON.stringify({
          ok: true,
          commands: [
            { idempotency_key: 'command-1' },
            { idempotency_key: 'command-2' },
          ],
        }));
      }
      acknowledged.push(
        JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      );
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;

    const scenario = parseScenario({
      version: 1,
      name: 'commands',
      steps: [{
        kind: 'poll_commands',
        default_result: 'applied',
        acknowledgements: {
          'command-2': {
            idempotency_key: 'must-not-override',
            result: 'failed',
            observed_value: 42,
          },
        },
      }],
    });
    const result = await replayScenario(scenario, {
      handshake: {
        protocol: 1,
        token: 'test-token',
        base_url: 'http://127.0.0.1:4242',
      },
      scenarioFile: '/unused/scenario.json',
      fetchImpl,
    });

    expect(acknowledged).toEqual([
      { idempotency_key: 'command-1', result: 'applied' },
      { idempotency_key: 'command-2', result: 'failed', observed_value: 42 },
    ]);
    expect(result.commands_acknowledged).toBe(2);
    expect(result.requests).toBe(3);
  });

  it('rejects protocol mismatches before sending traffic', async () => {
    const scenario = parseScenario({
      version: 1,
      name: 'wrong protocol',
      steps: [{ kind: 'hello', body: {} }],
    });
    await expect(replayScenario(scenario, {
      handshake: {
        protocol: 2,
        token: 'test-token',
        base_url: 'http://127.0.0.1:4242',
      },
      scenarioFile: '/unused/scenario.json',
    })).rejects.toThrow(/protocol mismatch/);
  });
});
