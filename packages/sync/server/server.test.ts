import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BridgeServer, type BridgeRequestLog } from './server.js';

const servers: BridgeServer[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-server-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function request(
  baseUrl: string,
  route: string,
  token?: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('loopback bridge server', () => {
  it('binds loopback, writes the handshake, and rejects missing or wrong tokens', async () => {
    const logs: BridgeRequestLog[] = [];
    const server = new BridgeServer({
      dataDirectory: temporaryDirectory(),
      handlers: { onRequest: (entry) => logs.push(entry) },
    });
    servers.push(server);
    const started = await server.start();

    expect(started.handshake.base_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(fs.existsSync(started.handshakePath)).toBe(true);
    expect((await request(started.handshake.base_url, '/v1/ping')).status).toBe(401);
    expect((await request(started.handshake.base_url, '/v1/ping', 'wrong')).status).toBe(401);
    const accepted = await request(
      started.handshake.base_url,
      '/v1/ping',
      started.handshake.token,
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true, protocol: 1 });
    expect(logs.map((entry) => entry.status)).toEqual([401, 401, 200]);

    await server.close();
    expect(fs.existsSync(started.handshakePath)).toBe(false);
  });

  it('dispatches hello, events, commands, acks and committed snapshots', async () => {
    const received: { kind: string; value: unknown }[] = [];
    const server = new BridgeServer({
      dataDirectory: temporaryDirectory(),
      handlers: {
        onHello: (value) => { received.push({ kind: 'hello', value }); },
        onEvent: (value) => { received.push({ kind: 'event', value }); },
        onAck: (value) => { received.push({ kind: 'ack', value }); },
        onSnapshot: (value) => { received.push({ kind: 'snapshot', value }); },
        getCommands: () => [{ idempotency_key: 'command-1', kind: 'noop' }],
      },
    });
    servers.push(server);
    const { handshake } = await server.start();

    expect((await request(handshake.base_url, '/v1/hello', handshake.token, {
      save_uid: 'save-1',
      in_career: true,
    })).status).toBe(200);
    expect((await request(handshake.base_url, '/v1/event', handshake.token, {
      event_name: 'DAY_PASSED',
    })).status).toBe(200);
    const commands = await request(handshake.base_url, '/v1/commands', handshake.token);
    expect(await commands.json()).toEqual({
      ok: true,
      commands: [{ idempotency_key: 'command-1', kind: 'noop' }],
    });
    expect((await request(handshake.base_url, '/v1/ack', handshake.token, {
      idempotency_key: 'command-1',
      result: 'applied',
    })).status).toBe(200);

    const payload = JSON.stringify({ opaque: '⚽' });
    const checksum = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
    for (const [index, part] of [payload.slice(0, 5), payload.slice(5)].entries()) {
      expect((await request(handshake.base_url, '/v1/snapshot', handshake.token, {
        transfer_id: 'snapshot-1',
        seq: index + 1,
        of: 2,
        name: 'career-load',
        payload: part,
        checksum,
      })).status).toBe(200);
    }

    expect(received.map((entry) => entry.kind)).toEqual([
      'hello',
      'event',
      'ack',
      'snapshot',
    ]);
    expect(received.at(-1)?.value).toMatchObject({ payload, checksum });
  });

  it('fails a fixed-port collision without publishing a handshake and can retry', async () => {
    const first = new BridgeServer({ dataDirectory: temporaryDirectory() });
    servers.push(first);
    const started = await first.start();
    const occupiedPort = Number(new URL(started.handshake.base_url).port);
    const secondDirectory = temporaryDirectory();
    const second = new BridgeServer({
      dataDirectory: secondDirectory,
      port: occupiedPort,
    });
    servers.push(second);

    await expect(second.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(second.address).toBeUndefined();
    expect(fs.existsSync(path.join(secondDirectory, 'bridge', 'handshake.json'))).toBe(false);

    await first.close();
    const retried = await second.start();
    expect(retried.handshake.port).toBe(occupiedPort);
  });
});
