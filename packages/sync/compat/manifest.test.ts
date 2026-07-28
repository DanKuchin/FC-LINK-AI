import { describe, expect, it } from 'vitest';
import {
  ManifestError,
  compareVersions,
  evaluateSupport,
  loadManifest,
  parseManifest,
  parseVersion,
  type CompatibilityManifest,
} from './manifest.js';

const manifest = parseManifest(
  JSON.stringify({
    manifest_version: 1,
    updated_at: '2026-07-28',
    builds: {
      '1.0.138.57785': { live_editor: { min: 'v26.3.5', max: 'v26.3.5' }, verified: false },
      '1.0.136.57334': { title_update: 'v1.6.2', live_editor: { min: 'v26.3.4', max: 'v26.3.4' }, verified: true },
      '1.0.135.54147': { live_editor: { min: 'v26.3.0', max: 'v26.3.2' }, verified: true },
    },
  }),
);

describe('version comparison', () => {
  it('parses with or without the v prefix', () => {
    expect(parseVersion('v26.3.5')).toEqual([26, 3, 5]);
    expect(parseVersion('26.3.5')).toEqual([26, 3, 5]);
    expect(parseVersion('1.0.138.57785')).toEqual([1, 0, 138, 57785]);
  });

  it('orders correctly, including uneven segment counts', () => {
    expect(compareVersions('v26.3.5', 'v26.3.4')).toBe(1);
    expect(compareVersions('v26.3.4', 'v26.3.5')).toBe(-1);
    expect(compareVersions('v26.3', 'v26.3.0')).toBe(0);
    expect(compareVersions('v26.10.0', 'v26.9.9')).toBe(1); // not string ordering
    expect(compareVersions('1.0.138.57785', '1.0.136.57334')).toBe(1);
  });

  it('rejects nonsense', () => {
    expect(() => parseVersion('not-a-version')).toThrow(ManifestError);
  });
});

describe('manifest loading', () => {
  it('loads the shipped manifest and it is internally consistent', () => {
    const shipped = loadManifest();
    expect(shipped.manifest_version).toBe(1);
    expect(Object.keys(shipped.builds).length).toBeGreaterThan(20);
    for (const [build, support] of Object.entries(shipped.builds)) {
      expect(build, 'build keys look like 1.0.138.57785').toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(compareVersions(support.live_editor.min, support.live_editor.max)).toBeLessThanOrEqual(0);
    }
  });

  it('nothing in the shipped manifest is marked verified yet', () => {
    // Guards against optimism: `verified` unlocks writes to a real career, so it
    // may only be set by someone who has actually run the bridge on that pair.
    const shipped = loadManifest();
    const verified = Object.entries(shipped.builds).filter(([, s]) => s.verified === true);
    expect(verified.map(([b]) => b)).toEqual([]);
  });

  it('rejects malformed manifests loudly', () => {
    expect(() => parseManifest('not json')).toThrow(ManifestError);
    expect(() => parseManifest('{}')).toThrow(/manifest_version/);
    expect(() => parseManifest('{"manifest_version":1}')).toThrow(/builds/);
    expect(() =>
      parseManifest('{"manifest_version":1,"builds":{"1.0.0.1":{}}}'),
    ).toThrow(/live_editor/);
    expect(() =>
      parseManifest('{"manifest_version":1,"builds":{"1.0.0.1":{"live_editor":{"min":"v2","max":"v1"}}}}'),
    ).toThrow(/above max/);
  });
});

describe('support verdicts', () => {
  const check = (gameBuild: string | null, liveEditorVersion: string | null) =>
    evaluateSupport(manifest as CompatibilityManifest, { gameBuild, liveEditorVersion });

  it('a tested pair is supported and may write', () => {
    const v = check('1.0.136.57334', 'v26.3.4');
    expect(v.state).toBe('supported');
    expect(v.writesEnabled).toBe(true);
    expect(v.readsEnabled).toBe(true);
    expect(v.titleUpdate).toBe('v1.6.2');
  });

  it('an untested but plausible pair reads and does not write', () => {
    const v = check('1.0.138.57785', 'v26.3.5');
    expect(v.state).toBe('untested');
    expect(v.readsEnabled).toBe(true);
    expect(v.writesEnabled).toBe(false);
    expect(v.reason).toMatch(/writing to your career is disabled/);
  });

  it('a Live Editor that is too old is unsupported, and says so usefully', () => {
    const v = check('1.0.138.57785', 'v26.3.4');
    expect(v.state).toBe('unsupported');
    expect(v.writesEnabled).toBe(false);
    expect(v.reason).toContain('v26.3.5');
    expect(v.reason).toMatch(/Update Live Editor/);
  });

  it('a Live Editor newer than the tested range is also unsupported', () => {
    const v = check('1.0.135.54147', 'v26.9.9');
    expect(v.state).toBe('unsupported');
    expect(v.reason).toMatch(/newer than the tested range/);
  });

  it('accepts anything inside an inclusive range', () => {
    for (const le of ['v26.3.0', 'v26.3.1', 'v26.3.2']) {
      expect(check('1.0.135.54147', le).state).toBe('supported');
    }
  });

  it('an unknown build points at the likely cause', () => {
    const v = check('1.0.999.1', 'v26.3.5');
    expect(v.state).toBe('unsupported');
    expect(v.reason).toMatch(/not in the compatibility list/);
    expect(v.reason).toMatch(/the game updated/);
    expect(v.reason).toMatch(/run offline/);
  });

  it('handles missing information without throwing', () => {
    expect(check(null, 'v26.3.5').state).toBe('unsupported');
    expect(check('1.0.138.57785', null).state).toBe('unsupported');
    expect(check('1.0.138.57785', 'garbage').reason).toMatch(/unreadable version/);
  });

  it('every verdict reason is a complete sentence a user could act on', () => {
    const cases = [
      check('1.0.136.57334', 'v26.3.4'),
      check('1.0.138.57785', 'v26.3.5'),
      check('1.0.138.57785', 'v26.3.4'),
      check('1.0.999.1', 'v26.3.5'),
      check(null, null),
    ];
    for (const v of cases) {
      expect(v.reason.length).toBeGreaterThan(30);
      expect(v.reason.endsWith('.')).toBe(true);
      expect(v.reason).not.toMatch(/undefined|null|NaN|\[object/);
    }
  });

  it('this machine today: build 1.0.138.57785 with the installed Live Editor', () => {
    // The real situation on the development machine, kept as a regression case.
    const v = evaluateSupport(loadManifest(), { gameBuild: '1.0.138.57785', liveEditorVersion: 'v26.3.4' });
    expect(v.state).toBe('unsupported');
    expect(v.requiredLiveEditor).toEqual({ min: 'v26.3.5', max: 'v26.3.5' });
  });
});
