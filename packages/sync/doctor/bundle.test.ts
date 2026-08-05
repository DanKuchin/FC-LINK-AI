import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDiagnosticBundle, redactDiagnosticText } from './bundle.js';

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-diagnostics-'));
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('diagnostic bundle', () => {
  it('redacts credentials and career identity', () => {
    const input = [
      'Authorization: Bearer abcDEF123._-',
      '{"token":"bridge-secret","save_uid":"career-secret","master_seed":"seed-secret"}',
      'saveUid=other-secret',
    ].join('\n');
    const output = redactDiagnosticText(input);
    expect(output).not.toContain('abcDEF123');
    expect(output).not.toContain('bridge-secret');
    expect(output).not.toContain('career-secret');
    expect(output).not.toContain('seed-secret');
    expect(output).not.toContain('other-secret');
    expect(output.match(/\[REDACTED\]/g)?.length).toBe(5);
  });

  it('writes an atomic standard ZIP with only explicit support data', () => {
    const outputPath = path.join(temporaryDirectory, 'exports', 'diagnostics.zip');
    const result = createDiagnosticBundle({
      outputPath,
      createdAt: 123,
      versions: {
        app: '0.0.0',
        saveSchema: 3,
        bridgeProtocol: 1,
        compatibilityManifest: 1,
      },
      conditions: [{
        id: 'lua_not_running',
        state: 'error',
        title: 'Lua bridge connection',
        cause: 'No hello was received.',
        offer: 'Run the bridge script.',
        deepLink: 'tenure://sync-doctor/bridge',
      }],
      logs: [{
        name: '../bridge.ndjson',
        content: '{"token":"secret-token","message":"hello"}\n',
      }],
    });

    const bytes = fs.readFileSync(outputPath);
    const visible = bytes.toString('utf8');
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.readUInt32LE(bytes.length - 22)).toBe(0x06054b50);
    expect(result.entries).toEqual([
      'bundle-manifest.json',
      'sync-doctor.json',
      'logs/bridge.ndjson',
    ]);
    expect(visible).toContain('User-initiated local export');
    expect(visible).toContain('lua_not_running');
    expect(visible).toContain('[REDACTED]');
    expect(visible).not.toContain('secret-token');
    expect(fs.existsSync(`${outputPath}.tmp`)).toBe(false);
    if (process.platform !== 'win32') {
      expect(fs.statSync(outputPath).mode & 0o777).toBe(0o600);
    }
  });
});
