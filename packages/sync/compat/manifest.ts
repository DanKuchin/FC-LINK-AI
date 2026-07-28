/**
 * The compatibility manifest.  (Ticket 2)
 *
 * EA patches FC roughly every two to three weeks, and each patch can invalidate
 * the tool this product depends on. Encoding compatibility as *data* means a
 * patch on a Tuesday can be handled the same day, without shipping a build.
 *
 * The verdict drives real behaviour, not a warning banner:
 *   supported   — the pair is known good AND we have tested it. Writes allowed.
 *   untested    — the pair is plausible but unverified. Reads only.
 *   unsupported — the pair is known bad, or the build is unknown. Offline only.
 *
 * Note the asymmetry: `verified` means *we* ran the bridge against that pair.
 * Live Editor saying it supports a build is necessary, not sufficient.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MANIFEST_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'manifest.json',
);

export interface BuildSupport {
  readonly title_update?: string;
  readonly live_editor: { readonly min: string; readonly max: string };
  readonly verified?: boolean;
  readonly notes?: string;
}

export interface CompatibilityManifest {
  readonly manifest_version: number;
  readonly updated_at: string;
  readonly source?: string;
  readonly builds: Readonly<Record<string, BuildSupport>>;
}

export type SupportState = 'supported' | 'untested' | 'unsupported';

export interface Verdict {
  readonly state: SupportState;
  /** One sentence, written to be shown to a user verbatim. */
  readonly reason: string;
  /** Whether the app may send write instructions to the game. */
  readonly writesEnabled: boolean;
  /** Whether the app may read from the game at all. */
  readonly readsEnabled: boolean;
  readonly requiredLiveEditor?: { readonly min: string; readonly max: string };
  readonly titleUpdate?: string;
}

export class ManifestError extends Error {}

/** `v26.3.5` → `[26, 3, 5]`. Tolerates a missing `v` and extra segments. */
export function parseVersion(version: string): number[] {
  const cleaned = version.trim().replace(/^v/i, '');
  const parts = cleaned.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) {
    throw new ManifestError(`Cannot parse version "${version}"`);
  }
  return parts;
}

/** -1, 0 or 1. Missing trailing segments count as zero, so 26.3 === 26.3.0. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

export function loadManifest(file: string = DEFAULT_MANIFEST_PATH): CompatibilityManifest {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new ManifestError(`Cannot read compatibility manifest at ${file}: ${(error as Error).message}`);
  }
  return parseManifest(raw);
}

export function parseManifest(raw: string): CompatibilityManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ManifestError(`Compatibility manifest is not valid JSON: ${(error as Error).message}`);
  }

  const m = parsed as Partial<CompatibilityManifest>;
  if (typeof m.manifest_version !== 'number') throw new ManifestError('manifest_version is missing');
  if (m.builds === undefined || typeof m.builds !== 'object') throw new ManifestError('builds is missing');

  for (const [build, support] of Object.entries(m.builds)) {
    const le = (support as BuildSupport | undefined)?.live_editor;
    if (le === undefined || typeof le.min !== 'string' || typeof le.max !== 'string') {
      throw new ManifestError(`Build ${build} has no live_editor.min/max`);
    }
    // Fail loudly at load rather than producing nonsense verdicts later.
    parseVersion(le.min);
    parseVersion(le.max);
    if (compareVersions(le.min, le.max) > 0) {
      throw new ManifestError(`Build ${build} has min ${le.min} above max ${le.max}`);
    }
  }

  return m as CompatibilityManifest;
}

export interface SupportQuery {
  readonly gameBuild: string | null | undefined;
  readonly liveEditorVersion: string | null | undefined;
}

/**
 * The single place that decides what the application is allowed to do.
 *
 * Every branch returns a sentence a user can act on. "Unsupported" must never
 * be a dead end — the app stays fully playable offline in every case.
 */
export function evaluateSupport(manifest: CompatibilityManifest, query: SupportQuery): Verdict {
  const { gameBuild, liveEditorVersion } = query;

  if (!gameBuild) {
    return {
      state: 'unsupported',
      reason: 'The FC 26 build number could not be read, so compatibility cannot be checked. Tenure will run offline.',
      writesEnabled: false,
      readsEnabled: false,
    };
  }

  const support = manifest.builds[gameBuild];
  if (support === undefined) {
    const newest = Object.keys(manifest.builds).sort((a, b) => compareVersions(b, a))[0];
    return {
      state: 'unsupported',
      reason:
        `FC 26 build ${gameBuild} is not in the compatibility list` +
        (newest ? ` (the newest listed is ${newest})` : '') +
        '. This usually means the game updated. Tenure will run offline until the list is updated.',
      writesEnabled: false,
      readsEnabled: false,
    };
  }

  const required = support.live_editor;
  const base = { requiredLiveEditor: required, ...(support.title_update === undefined ? {} : { titleUpdate: support.title_update }) };

  if (!liveEditorVersion) {
    return {
      ...base,
      state: 'unsupported',
      reason: `FC 26 build ${gameBuild} needs Live Editor ${describeRange(required)}, but no Live Editor version was detected.`,
      writesEnabled: false,
      readsEnabled: false,
    };
  }

  let belowMin: boolean;
  let aboveMax: boolean;
  try {
    belowMin = compareVersions(liveEditorVersion, required.min) < 0;
    aboveMax = compareVersions(liveEditorVersion, required.max) > 0;
  } catch {
    return {
      ...base,
      state: 'unsupported',
      reason: `Live Editor reported an unreadable version ("${liveEditorVersion}").`,
      writesEnabled: false,
      readsEnabled: false,
    };
  }

  if (belowMin || aboveMax) {
    return {
      ...base,
      state: 'unsupported',
      reason:
        `Live Editor ${liveEditorVersion} does not match FC 26 build ${gameBuild}, which needs ` +
        `${describeRange(required)}. ${belowMin ? 'Update Live Editor' : 'This Live Editor is newer than the tested range'}.`,
      writesEnabled: false,
      readsEnabled: false,
    };
  }

  if (support.verified !== true) {
    return {
      ...base,
      state: 'untested',
      reason:
        `FC 26 build ${gameBuild} with Live Editor ${liveEditorVersion} should work but has not been tested with Tenure. ` +
        'Reading is enabled; writing to your career is disabled as a precaution.',
      writesEnabled: false,
      readsEnabled: true,
    };
  }

  return {
    ...base,
    state: 'supported',
    reason: `FC 26 build ${gameBuild} with Live Editor ${liveEditorVersion} is a tested combination.`,
    writesEnabled: true,
    readsEnabled: true,
  };
}

function describeRange(range: { min: string; max: string }): string {
  return range.min === range.max ? range.min : `${range.min} to ${range.max}`;
}

/** Convenience wrapper for callers that just want the answer. */
export function checkSupport(query: SupportQuery, manifestPath?: string): Verdict {
  return evaluateSupport(loadManifest(manifestPath), query);
}
