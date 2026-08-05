import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseManifest,
  type CompatibilityManifest,
} from '@tenure/sync/compat/manifest.js';
import type { CompatibilityManifestSummary } from '../../shared/ipc.js';

export const USER_MANIFEST_FILENAME = 'compatibility-manifest.json';

export interface CompatibilityManifestServiceOptions {
  readonly dataDirectory: string;
  readonly bundled: CompatibilityManifest;
}

interface ResolvedManifest {
  readonly manifest: CompatibilityManifest;
  readonly source: 'bundled' | 'user';
  readonly problem: string | null;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`updated_at is not a valid date: ${value}`);
  return parsed;
}

function validateOverride(
  candidate: CompatibilityManifest,
  bundled: CompatibilityManifest,
): void {
  if (candidate.manifest_version !== bundled.manifest_version) {
    throw new Error(
      `Manifest format ${candidate.manifest_version} is not supported by this app; ` +
      `expected ${bundled.manifest_version}.`,
    );
  }
  if (timestamp(candidate.updated_at) < timestamp(bundled.updated_at)) {
    throw new Error(
      `Manifest ${candidate.updated_at} is older than bundled baseline ${bundled.updated_at}.`,
    );
  }
}

export class CompatibilityManifestService {
  private readonly options: CompatibilityManifestServiceOptions;
  private readonly overridePath: string;

  constructor(options: CompatibilityManifestServiceOptions) {
    this.options = options;
    this.overridePath = path.join(options.dataDirectory, USER_MANIFEST_FILENAME);
  }

  manifest(): CompatibilityManifest {
    return this.resolve().manifest;
  }

  status(): CompatibilityManifestSummary {
    const resolved = this.resolve();
    return {
      manifestVersion: resolved.manifest.manifest_version,
      updatedAt: resolved.manifest.updated_at,
      source: resolved.source,
      overridePath: this.overridePath,
      problem: resolved.problem,
    };
  }

  install(sourcePath: string): CompatibilityManifestSummary {
    const raw = fs.readFileSync(sourcePath, 'utf8');
    const candidate = parseManifest(raw);
    validateOverride(candidate, this.options.bundled);

    fs.mkdirSync(this.options.dataDirectory, { recursive: true, mode: 0o700 });
    const staged = `${this.overridePath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(staged, raw, { mode: 0o600, flag: 'wx' });
      fs.renameSync(staged, this.overridePath);
      try {
        fs.chmodSync(this.overridePath, 0o600);
      } catch {
        // The current user's LOCALAPPDATA directory is the Windows ACL boundary.
      }
    } catch (error) {
      fs.rmSync(staged, { force: true });
      throw error;
    }
    return this.status();
  }

  private resolve(): ResolvedManifest {
    if (!fs.existsSync(this.overridePath)) {
      return { manifest: this.options.bundled, source: 'bundled', problem: null };
    }
    try {
      const manifest = parseManifest(fs.readFileSync(this.overridePath, 'utf8'));
      validateOverride(manifest, this.options.bundled);
      return { manifest, source: 'user', problem: null };
    } catch (error) {
      return {
        manifest: this.options.bundled,
        source: 'bundled',
        problem:
          `Ignored invalid user compatibility manifest at ${this.overridePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
      };
    }
  }
}
