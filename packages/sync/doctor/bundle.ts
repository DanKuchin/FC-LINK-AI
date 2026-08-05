import fs from 'node:fs';
import path from 'node:path';
import type { DoctorCondition } from './doctor.js';

const MAX_LOG_FILES = 20;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

export interface DiagnosticVersions {
  readonly app: string;
  readonly saveSchema: number;
  readonly bridgeProtocol: number;
  readonly compatibilityManifest: number;
}

export interface DiagnosticLog {
  readonly name: string;
  readonly content: string;
}

export interface DiagnosticBundleOptions {
  readonly outputPath: string;
  readonly createdAt: number;
  readonly versions: DiagnosticVersions;
  readonly conditions: readonly DoctorCondition[];
  readonly logs?: readonly DiagnosticLog[];
}

export interface DiagnosticBundleResult {
  readonly path: string;
  readonly bytes: number;
  readonly entries: readonly string[];
}

interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) === 1
      ? 0xedb88320 ^ (current >>> 1)
      : current >>> 1;
  }
  return current >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const value of data) {
    crc = (CRC_TABLE[(crc ^ value) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeLogName(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100);
  return base.length > 0 ? base : 'log.ndjson';
}

/**
 * Removes credentials and career identity from user-exported support logs.
 * Raw snapshots are never accepted by this API in the first place.
 */
export function redactDiagnosticText(value: string): string {
  return value
    .replace(
      /("(?:token|authorization|save_uid|saveUid|master_seed|masterSeed)"\s*:\s*)"[^"]*"/gi,
      '$1"[REDACTED]"',
    )
    .replace(/(\bAuthorization\s*:\s*)Bearer\s+[^\s,;]+/gi, '$1Bearer [REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:token|save_uid|saveUid|master_seed|masterSeed)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    );
}

function zip(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

/**
 * Creates a standard store-only ZIP. Export is explicit and local: no upload,
 * telemetry call, database, raw snapshot, or career roster is included.
 */
export function createDiagnosticBundle(
  options: DiagnosticBundleOptions,
): DiagnosticBundleResult {
  const entries: ZipEntry[] = [];
  const manifest = {
    format: 1,
    created_at: options.createdAt,
    privacy:
      'User-initiated local export. Credentials and career identifiers are redacted; raw snapshots are excluded.',
    versions: options.versions,
  };
  entries.push({
    name: 'bundle-manifest.json',
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  });
  entries.push({
    name: 'sync-doctor.json',
    data: Buffer.from(`${JSON.stringify(options.conditions, null, 2)}\n`),
  });

  for (const log of (options.logs ?? []).slice(0, MAX_LOG_FILES)) {
    const redacted = redactDiagnosticText(log.content);
    const limited = Buffer.from(redacted).subarray(0, MAX_LOG_BYTES);
    entries.push({ name: `logs/${safeLogName(log.name)}`, data: limited });
  }

  const output = zip(entries);
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  const staged = `${options.outputPath}.tmp`;
  fs.writeFileSync(staged, output, { mode: 0o600 });
  fs.renameSync(staged, options.outputPath);
  try {
    fs.chmodSync(options.outputPath, 0o600);
  } catch {
    // Windows does not implement POSIX modes; the user profile directory is the boundary there.
  }
  return {
    path: options.outputPath,
    bytes: output.length,
    entries: entries.map((entry) => entry.name),
  };
}
