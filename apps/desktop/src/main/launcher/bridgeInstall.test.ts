import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyBridgeInstall, planBridgeInstall } from './bridgeInstall.js';

let temporaryDirectory: string;
let source: string;
let liveEditor: string;

function writeSource(entry = 'print("v1")\n', transport = 'return { version = 1 }\n'): void {
  fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(source, 'tenure_bridge.lua'), entry);
  fs.writeFileSync(path.join(source, 'lib', 'transport.lua'), transport);
}

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-installer-'));
  source = path.join(temporaryDirectory, 'source');
  liveEditor = path.join(temporaryDirectory, 'live-editor');
  writeSource();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('bridge installer', () => {
  it('previews and verifies a fresh installation', () => {
    const plan = planBridgeInstall(source, liveEditor);
    expect(plan.files.map((file) => file.action)).toEqual(['create', 'create']);
    expect(plan.files[0]?.diff).toContain('+++ proposed');

    const result = applyBridgeInstall(plan, { installedAt: 100 });
    expect(result).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    expect(fs.readFileSync(
      path.join(liveEditor, 'lua', 'tenure', 'tenure_bridge.lua'),
      'utf8',
    )).toBe('print("v1")\n');
    expect(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'))).toMatchObject({
      format: 1,
      installedAt: 100,
    });
    expect(planBridgeInstall(source, liveEditor).files.every(
      (file) => file.action === 'unchanged',
    )).toBe(true);
  });

  it('updates only a file that still matches the last installed checksum', () => {
    applyBridgeInstall(planBridgeInstall(source, liveEditor), { installedAt: 100 });
    writeSource('print("v2")\n');
    const upgrade = planBridgeInstall(source, liveEditor);
    expect(upgrade.files.map((file) => [file.relativePath, file.action])).toEqual([
      ['lib/transport.lua', 'unchanged'],
      ['tenure_bridge.lua', 'update'],
    ]);
    expect(upgrade.files.find((file) => file.action === 'update')?.diff)
      .toContain('-print("v1")');
    applyBridgeInstall(upgrade, { installedAt: 200 });
    expect(fs.readFileSync(
      path.join(liveEditor, 'lua', 'tenure', 'tenure_bridge.lua'),
      'utf8',
    )).toBe('print("v2")\n');
  });

  it('never overwrites a user-modified file without explicit consent', () => {
    applyBridgeInstall(planBridgeInstall(source, liveEditor), { installedAt: 100 });
    const target = path.join(liveEditor, 'lua', 'tenure', 'tenure_bridge.lua');
    fs.writeFileSync(target, '-- user customization\n');
    writeSource('print("v2")\n');

    const conflicted = planBridgeInstall(source, liveEditor);
    expect(conflicted.files.find((file) => file.relativePath === 'tenure_bridge.lua')?.action)
      .toBe('conflict');
    expect(() => applyBridgeInstall(conflicted, { installedAt: 200 }))
      .toThrow(/Refusing to overwrite user-modified/);
    expect(fs.readFileSync(target, 'utf8')).toBe('-- user customization\n');

    const result = applyBridgeInstall(conflicted, {
      installedAt: 200,
      allowUserModified: true,
    });
    expect(result.overwrittenConflicts).toBe(1);
    expect(fs.readFileSync(target, 'utf8')).toBe('print("v2")\n');
  });

  it('refuses a stale plan if source or destination changed after preview', () => {
    const plan = planBridgeInstall(source, liveEditor);
    fs.mkdirSync(path.dirname(plan.files[0]?.targetPath ?? ''), { recursive: true });
    fs.writeFileSync(plan.files[0]?.targetPath ?? '', '-- appeared after preview\n');
    expect(() => applyBridgeInstall(plan, { installedAt: 100 }))
      .toThrow(/changed after preview/);
  });
});
