import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createBridgeHandshake,
  removeBridgeHandshake,
  writeBridgeHandshake,
  type BridgeHandshake,
} from '../protocol/handshake.js';
import {
  SnapshotAssembler,
  SnapshotChunkError,
  type CommittedChunkResult,
  type SnapshotChunk,
} from '../protocol/chunks.js';

export interface BridgePeer {
  readonly save_uid?: string;
  readonly le_version?: string;
  readonly game_build?: string;
  readonly in_career?: boolean;
  readonly in_game_date?: string;
  readonly [key: string]: unknown;
}

export interface BridgeCommand {
  readonly idempotency_key: string;
  readonly [key: string]: unknown;
}

export interface BridgeServerHandlers {
  readonly onHello?: (peer: BridgePeer) => void | Promise<void>;
  readonly onEvent?: (event: Readonly<Record<string, unknown>>) => void | Promise<void>;
  readonly onLog?: (log: Readonly<Record<string, unknown>>) => void | Promise<void>;
  readonly onAck?: (ack: Readonly<Record<string, unknown>>) => void | Promise<void>;
  readonly onSnapshot?: (snapshot: CommittedChunkResult) => void | Promise<void>;
  readonly getCommands?: () => readonly BridgeCommand[] | Promise<readonly BridgeCommand[]>;
  readonly onRequest?: (entry: BridgeRequestLog) => void;
}

export interface BridgeRequestLog {
  readonly at: number;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly authorised: boolean;
  readonly error?: string;
}

export interface BridgeServerOptions {
  readonly dataDirectory: string;
  readonly handlers?: BridgeServerHandlers;
  readonly maxBodyBytes?: number;
  readonly now?: () => number;
}

export interface StartedBridgeServer {
  readonly handshake: BridgeHandshake;
  readonly handshakePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeEqualToken(header: string | undefined, expected: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (match === null) return false;
  const received = Buffer.from(match[1]?.trim() ?? '');
  const wanted = Buffer.from(expected);
  return received.length === wanted.length && crypto.timingSafeEqual(received, wanted);
}

function send(response: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJson(
  request: http.IncomingMessage,
  maxBodyBytes: number,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBodyBytes) throw new Error(`request body exceeds ${maxBodyBytes} bytes`);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!isRecord(value)) throw new Error('request body must be a JSON object');
  return value;
}

function asSnapshotChunk(body: Record<string, unknown>): SnapshotChunk {
  return {
    transfer_id: String(body.transfer_id ?? ''),
    seq: Number(body.seq),
    of: Number(body.of),
    name: String(body.name ?? ''),
    payload: String(body.payload ?? ''),
    checksum: String(body.checksum ?? ''),
  };
}

export class BridgeServer {
  private readonly options: BridgeServerOptions;
  private readonly assembler = new SnapshotAssembler();
  private server: http.Server | undefined;
  private started: StartedBridgeServer | undefined;

  constructor(options: BridgeServerOptions) {
    this.options = options;
  }

  get address(): StartedBridgeServer | undefined {
    return this.started;
  }

  async start(): Promise<StartedBridgeServer> {
    if (this.server !== undefined) throw new Error('bridge server is already started');
    const token = crypto.randomBytes(32).toString('hex');
    const server = http.createServer((request, response) => {
      void this.handle(request, response, token);
    });
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      const address = server.address() as AddressInfo;
      const handshake = createBridgeHandshake(address.port, { token });
      const handshakePath = writeBridgeHandshake(this.options.dataDirectory, handshake);
      this.started = { handshake, handshakePath };
      return this.started;
    } catch (error) {
      this.server = undefined;
      server.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.started = undefined;
    removeBridgeHandshake(this.options.dataDirectory);
    if (server === undefined || !server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }

  private record(
    request: http.IncomingMessage,
    status: number,
    authorised: boolean,
    error?: string,
  ): void {
    this.options.handlers?.onRequest?.({
      at: this.options.now?.() ?? Date.now(),
      method: request.method ?? 'UNKNOWN',
      path: new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
      status,
      authorised,
      ...(error === undefined ? {} : { error }),
    });
  }

  private async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    token: string,
  ): Promise<void> {
    const method = request.method ?? 'GET';
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const authorised = safeEqualToken(
      typeof request.headers.authorization === 'string'
        ? request.headers.authorization
        : undefined,
      token,
    );
    if (!authorised) {
      this.record(request, 401, false);
      send(response, 401, { ok: false, error: 'unauthorised' });
      return;
    }

    try {
      if (method === 'GET' && pathname === '/v1/ping') {
        this.record(request, 200, true);
        send(response, 200, { ok: true, protocol: 1 });
        return;
      }
      if (method === 'GET' && pathname === '/v1/commands') {
        const commands = await this.options.handlers?.getCommands?.() ?? [];
        this.record(request, 200, true);
        send(response, 200, { ok: true, commands });
        return;
      }
      if (method !== 'POST') {
        this.record(request, 404, true);
        send(response, 404, { ok: false, error: `no route for ${method} ${pathname}` });
        return;
      }

      const body = await readJson(request, this.options.maxBodyBytes ?? 64 * 1024 * 1024);
      if (pathname === '/v1/hello') {
        await this.options.handlers?.onHello?.(body as BridgePeer);
        this.record(request, 200, true);
        send(response, 200, { ok: true, protocol: 1 });
        return;
      }
      if (pathname === '/v1/event') {
        await this.options.handlers?.onEvent?.(body);
        this.record(request, 200, true);
        send(response, 200, { ok: true });
        return;
      }
      if (pathname === '/v1/log') {
        await this.options.handlers?.onLog?.(body);
        this.record(request, 200, true);
        send(response, 200, { ok: true });
        return;
      }
      if (pathname === '/v1/ack') {
        await this.options.handlers?.onAck?.(body);
        this.record(request, 200, true);
        send(response, 200, { ok: true });
        return;
      }
      if (pathname === '/v1/snapshot') {
        const result = this.assembler.add(asSnapshotChunk(body));
        if (result.state === 'committed') await this.options.handlers?.onSnapshot?.(result);
        this.record(request, 200, true);
        send(response, 200, { ok: true, ...result });
        return;
      }
      this.record(request, 404, true);
      send(response, 404, { ok: false, error: `no route for ${method} ${pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof SnapshotChunkError || error instanceof SyntaxError ? 400 : 500;
      this.record(request, status, true, message);
      send(response, status, { ok: false, error: message });
    }
  }
}
