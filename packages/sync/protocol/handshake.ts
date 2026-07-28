import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BRIDGE_PROTOCOL_VERSION = 1;

export interface BridgeHandshake {
  readonly protocol: number;
  readonly port: number;
  readonly token: string;
  readonly base_url: string;
  readonly created_at: string;
  readonly pid: number;
}

export function bridgeDirectory(dataDirectory: string): string {
  return path.join(dataDirectory, 'bridge');
}

export function bridgeHandshakePath(dataDirectory: string): string {
  return path.join(bridgeDirectory(dataDirectory), 'handshake.json');
}

export function createBridgeHandshake(
  port: number,
  options: {
    readonly now?: Date;
    readonly pid?: number;
    readonly token?: string;
    readonly protocol?: number;
  } = {},
): BridgeHandshake {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('bridge port must be an integer from 1 to 65535');
  }
  const protocol = options.protocol ?? BRIDGE_PROTOCOL_VERSION;
  if (!Number.isInteger(protocol) || protocol < 1) {
    throw new Error('bridge protocol must be a positive integer');
  }
  const token = options.token ?? crypto.randomBytes(32).toString('hex');
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) {
    throw new Error('bridge token must contain at least 32 safe characters');
  }
  return {
    protocol,
    port,
    token,
    base_url: `http://127.0.0.1:${port}`,
    created_at: (options.now ?? new Date()).toISOString(),
    pid: options.pid ?? process.pid,
  };
}

export function writeBridgeHandshake(
  dataDirectory: string,
  handshake: BridgeHandshake,
): string {
  const directory = bridgeDirectory(dataDirectory);
  const target = bridgeHandshakePath(dataDirectory);
  const temporary = path.join(
    directory,
    `.handshake.${String(handshake.pid)}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(handshake, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(temporary, target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // Windows ACLs do not map cleanly to POSIX modes. The file still lives
      // beneath the current user's LOCALAPPDATA directory.
    }
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Nothing to clean up.
    }
    throw error;
  }
  return target;
}

export function removeBridgeHandshake(dataDirectory: string): void {
  try {
    fs.unlinkSync(bridgeHandshakePath(dataDirectory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
