import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Handshake {
  readonly protocol: number;
  readonly token: string;
  readonly base_url?: string;
  readonly port?: number;
}

interface MessageStep {
  readonly kind: 'hello' | 'event' | 'log' | 'ack';
  readonly body: Readonly<Record<string, unknown>>;
  readonly delay_ms?: number;
}

interface SnapshotStep {
  readonly kind: 'snapshot';
  readonly name: string;
  readonly file?: string;
  readonly inline?: unknown;
  readonly transfer_id?: string;
  readonly chunk_bytes?: number;
  readonly delay_ms?: number;
}

interface PollCommandsStep {
  readonly kind: 'poll_commands';
  readonly acknowledgements?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly default_result?: string;
  readonly delay_ms?: number;
}

interface SleepStep {
  readonly kind: 'sleep';
  readonly delay_ms: number;
}

export type ReplayStep = MessageStep | SnapshotStep | PollCommandsStep | SleepStep;

export interface MockFcScenario {
  readonly version: 1;
  readonly name: string;
  readonly steps: readonly ReplayStep[];
}

export interface ReplayResult {
  readonly scenario: string;
  readonly requests: number;
  readonly snapshots: number;
  readonly snapshot_bytes: number;
  readonly commands_acknowledged: number;
}

export interface ReplayOptions {
  readonly handshake: Handshake;
  readonly scenarioFile: string;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly onProgress?: (message: string) => void;
}

const ROUTES = {
  hello: '/v1/hello',
  event: '/v1/event',
  log: '/v1/log',
  ack: '/v1/ack',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object`);
}

function assertNonNegativeDelay(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function parseStep(value: unknown, index: number): ReplayStep {
  const label = `steps[${index}]`;
  assertRecord(value, label);
  const kind = value.kind;
  assertNonNegativeDelay(value.delay_ms, `${label}.delay_ms`);

  if (kind === 'sleep') {
    if (!Number.isInteger(value.delay_ms) || Number(value.delay_ms) < 0) {
      throw new Error(`${label}.delay_ms is required for a sleep step`);
    }
    return { kind, delay_ms: Number(value.delay_ms) };
  }

  if (kind === 'snapshot') {
    if (typeof value.name !== 'string' || value.name.length === 0) {
      throw new Error(`${label}.name must be a non-empty string`);
    }
    const hasFile = typeof value.file === 'string' && value.file.length > 0;
    const hasInline = Object.hasOwn(value, 'inline');
    if (hasFile === hasInline) {
      throw new Error(`${label} must provide exactly one of file or inline`);
    }
    if (value.chunk_bytes !== undefined &&
        (!Number.isInteger(value.chunk_bytes) || Number(value.chunk_bytes) < 4)) {
      throw new Error(`${label}.chunk_bytes must be an integer of at least 4`);
    }
    if (value.transfer_id !== undefined &&
        (typeof value.transfer_id !== 'string' || value.transfer_id.length === 0)) {
      throw new Error(`${label}.transfer_id must be a non-empty string`);
    }
    return {
      kind,
      name: value.name,
      ...(hasFile ? { file: String(value.file) } : { inline: value.inline }),
      ...(value.transfer_id === undefined ? {} : { transfer_id: value.transfer_id }),
      ...(value.chunk_bytes === undefined ? {} : { chunk_bytes: Number(value.chunk_bytes) }),
      ...(value.delay_ms === undefined ? {} : { delay_ms: Number(value.delay_ms) }),
    };
  }

  if (kind === 'poll_commands') {
    if (value.acknowledgements !== undefined) {
      assertRecord(value.acknowledgements, `${label}.acknowledgements`);
      for (const [key, acknowledgement] of Object.entries(value.acknowledgements)) {
        assertRecord(acknowledgement, `${label}.acknowledgements.${key}`);
      }
    }
    if (value.default_result !== undefined &&
        (typeof value.default_result !== 'string' || value.default_result.length === 0)) {
      throw new Error(`${label}.default_result must be a non-empty string`);
    }
    return {
      kind,
      ...(value.acknowledgements === undefined
        ? {}
        : { acknowledgements: value.acknowledgements as Record<string, Record<string, unknown>> }),
      ...(value.default_result === undefined ? {} : { default_result: value.default_result }),
      ...(value.delay_ms === undefined ? {} : { delay_ms: Number(value.delay_ms) }),
    };
  }

  if (kind === 'hello' || kind === 'event' || kind === 'log' || kind === 'ack') {
    assertRecord(value.body, `${label}.body`);
    return {
      kind,
      body: value.body,
      ...(value.delay_ms === undefined ? {} : { delay_ms: Number(value.delay_ms) }),
    };
  }

  throw new Error(`${label}.kind is not supported`);
}

export function parseScenario(value: unknown): MockFcScenario {
  assertRecord(value, 'scenario');
  if (value.version !== 1) throw new Error('scenario.version must be 1');
  if (typeof value.name !== 'string' || value.name.length === 0) {
    throw new Error('scenario.name must be a non-empty string');
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new Error('scenario.steps must be a non-empty array');
  }
  return {
    version: 1,
    name: value.name,
    steps: value.steps.map(parseStep),
  };
}

export function loadScenario(file: string): MockFcScenario {
  return parseScenario(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
}

export function loadHandshake(file: string): Handshake {
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  assertRecord(value, 'handshake');
  if (!Number.isInteger(value.protocol) || Number(value.protocol) < 1) {
    throw new Error('handshake.protocol must be a positive integer');
  }
  if (typeof value.token !== 'string' || value.token.length === 0) {
    throw new Error('handshake.token must be a non-empty string');
  }
  if (value.base_url !== undefined && typeof value.base_url !== 'string') {
    throw new Error('handshake.base_url must be a string');
  }
  if (value.port !== undefined &&
      (!Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65_535)) {
    throw new Error('handshake.port must be an integer from 1 to 65535');
  }
  if (value.base_url === undefined && value.port === undefined) {
    throw new Error('handshake must provide base_url or port');
  }
  return {
    protocol: Number(value.protocol),
    token: value.token,
    ...(value.base_url === undefined ? {} : { base_url: value.base_url }),
    ...(value.port === undefined ? {} : { port: Number(value.port) }),
  };
}

export function loopbackBaseUrl(handshake: Handshake): string {
  const base = handshake.base_url ?? `http://127.0.0.1:${String(handshake.port)}`;
  const url = new URL(base);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname)) {
    throw new Error(`refusing to send a bridge token to non-loopback URL: ${base}`);
  }
  return url.toString().replace(/\/$/, '');
}

export function chunkUtf8(text: string, maxBytes: number): string[] {
  if (!Number.isInteger(maxBytes) || maxBytes < 4) {
    throw new Error('maxBytes must be an integer of at least 4');
  }
  if (text.length === 0) return [''];

  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes > 0 && bytes + characterBytes > maxBytes) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += character;
    bytes += characterBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function snapshotText(step: SnapshotStep, scenarioFile: string): string {
  if (step.file !== undefined) {
    return fs.readFileSync(path.resolve(path.dirname(scenarioFile), step.file), 'utf8');
  }
  const serialised = JSON.stringify(step.inline);
  if (serialised === undefined) throw new Error(`snapshot ${step.name} inline value is not JSON`);
  return serialised;
}

async function requestJson(
  fetchImpl: typeof fetch,
  baseUrl: string,
  token: string,
  method: 'GET' | 'POST',
  route: string,
  body?: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const response = await fetchImpl(`${baseUrl}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const parsed = text.length === 0 ? {} : JSON.parse(text) as unknown;
  if (!response.ok) {
    throw new Error(`${method} ${route} failed with ${response.status}: ${text}`);
  }
  if (isRecord(parsed) && parsed.ok === false) {
    throw new Error(`${method} ${route} was rejected: ${text}`);
  }
  return parsed;
}

export async function replayScenario(
  scenario: MockFcScenario,
  options: ReplayOptions,
): Promise<ReplayResult> {
  if (options.handshake.protocol !== scenario.version) {
    throw new Error(
      `protocol mismatch: scenario=${scenario.version}, handshake=${options.handshake.protocol}`,
    );
  }
  const baseUrl = loopbackBaseUrl(options.handshake);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const progress = options.onProgress ?? (() => undefined);
  let requests = 0;
  let snapshots = 0;
  let snapshotBytes = 0;
  let commandsAcknowledged = 0;

  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index];
    if (step === undefined) continue;

    if (step.kind === 'sleep') {
      if (step.delay_ms > 0) await sleep(step.delay_ms);
      continue;
    }
    if (step.delay_ms !== undefined && step.delay_ms > 0) await sleep(step.delay_ms);

    if (step.kind === 'snapshot') {
      const payload = snapshotText(step, options.scenarioFile);
      const checksum = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
      const chunks = chunkUtf8(payload, step.chunk_bytes ?? 256 * 1024);
      const transferId = step.transfer_id ??
        `mock_${index + 1}_${checksum.slice('sha256:'.length, 'sha256:'.length + 16)}`;
      progress(`snapshot ${step.name}: ${chunks.length} chunk(s)`);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        await requestJson(fetchImpl, baseUrl, options.handshake.token, 'POST', '/v1/snapshot', {
          transfer_id: transferId,
          seq: chunkIndex + 1,
          of: chunks.length,
          name: step.name,
          checksum,
          payload: chunks[chunkIndex] ?? '',
        });
        requests += 1;
      }
      snapshots += 1;
      snapshotBytes += Buffer.byteLength(payload);
      continue;
    }

    if (step.kind === 'poll_commands') {
      const response = await requestJson(
        fetchImpl,
        baseUrl,
        options.handshake.token,
        'GET',
        '/v1/commands',
      );
      requests += 1;
      assertRecord(response, 'GET /v1/commands response');
      if (!Array.isArray(response.commands)) {
        throw new Error('GET /v1/commands response must contain a commands array');
      }
      for (const command of response.commands) {
        assertRecord(command, 'command');
        const key = command.idempotency_key;
        if (typeof key !== 'string' || key.length === 0) {
          throw new Error('every command must carry an idempotency_key');
        }
        const scripted = step.acknowledgements?.[key] ?? {};
        const scriptedResult = scripted.result;
        if (scriptedResult !== undefined &&
            (typeof scriptedResult !== 'string' || scriptedResult.length === 0)) {
          throw new Error(`acknowledgement ${key}.result must be a non-empty string`);
        }
        await requestJson(fetchImpl, baseUrl, options.handshake.token, 'POST', '/v1/ack', {
          ...scripted,
          idempotency_key: key,
          result: scriptedResult ?? step.default_result ?? 'applied',
        });
        requests += 1;
        commandsAcknowledged += 1;
      }
      continue;
    }

    progress(`${step.kind}`);
    await requestJson(
      fetchImpl,
      baseUrl,
      options.handshake.token,
      'POST',
      ROUTES[step.kind],
      step.body,
    );
    requests += 1;
  }

  return {
    scenario: scenario.name,
    requests,
    snapshots,
    snapshot_bytes: snapshotBytes,
    commands_acknowledged: commandsAcknowledged,
  };
}
