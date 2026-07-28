import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompatibilityManifest } from '../../../../../packages/sync/compat/manifest.js';
import {
  CompatibilityManifestService,
  USER_MANIFEST_FILENAME,
} from './compatibilityManifestService.js';

const bundled: CompatibilityManifest = {
  manifest_version: 1,
  updated_at: '2026-07-28',
  builds: {
    baseline: {
      live_editor: { min: 'v1.0.0', max: 'v1.0.0' },
      verified: false,
    },
  },
};

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-manifest-service-'));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function write(name: string, value: unknown): string {
  const file = path.join(directory, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function newer(overrides: Partial<CompatibilityManifest> = {}): CompatibilityManifest {
  return {
    manifest_version: 1,
    updated_at: '2026-07-29',
    builds: {
      current: {
        live_editor: { min: 'v2.0.0', max: 'v2.0.1' },
        verified: false,
      },
    },
    ...overrides,
  };
}

describe('desktop compatibility manifest service', () => {
  it('uses the bundled baseline until a user explicitly installs an override', () => {
    const service = new CompatibilityManifestService({ dataDirectory: directory, bundled });
    expect(service.status()).toEqual({
      manifestVersion: 1,
      updatedAt: '2026-07-28',
      source: 'bundled',
      overridePath: path.join(directory, USER_MANIFEST_FILENAME),
      problem: null,
    });

    const status = service.install(write('incoming.json', newer()));
    expect(status).toMatchObject({
      manifestVersion: 1,
      updatedAt: '2026-07-29',
      source: 'user',
      problem: null,
    });
    expect(service.manifest().builds.current).toBeDefined();
    expect(fs.existsSync(path.join(directory, USER_MANIFEST_FILENAME))).toBe(true);
  });

  it('falls back to the bundled manifest when a dropped override is damaged', () => {
    write(USER_MANIFEST_FILENAME, { broken: true });
    const service = new CompatibilityManifestService({ dataDirectory: directory, bundled });
    expect(service.manifest()).toBe(bundled);
    expect(service.status()).toMatchObject({
      source: 'bundled',
      updatedAt: '2026-07-28',
    });
    expect(service.status().problem).toMatch(/Ignored invalid user compatibility manifest/);
  });

  it('validates before replacing the last known-good override', () => {
    const service = new CompatibilityManifestService({ dataDirectory: directory, bundled });
    service.install(write('valid.json', newer()));
    const installed = fs.readFileSync(
      path.join(directory, USER_MANIFEST_FILENAME),
      'utf8',
    );
    expect(() => service.install(write('older.json', {
      ...newer(),
      updated_at: '2026-07-27',
    }))).toThrow(/older than bundled baseline/);
    expect(fs.readFileSync(path.join(directory, USER_MANIFEST_FILENAME), 'utf8'))
      .toBe(installed);
    expect(service.status().source).toBe('user');
  });

  it('rejects an unsupported manifest format without installing it', () => {
    const service = new CompatibilityManifestService({ dataDirectory: directory, bundled });
    expect(() => service.install(write('future.json', newer({
      manifest_version: 2,
    })))).toThrow(/format 2 is not supported/);
    expect(fs.existsSync(path.join(directory, USER_MANIFEST_FILENAME))).toBe(false);
  });
});
