import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectEnvironment, parseRegistryInstalls } from './detect.js';

describe('Windows environment detection', () => {
  it('parses uninstall records without combining values from different keys', () => {
    const output = `
HKEY_LOCAL_MACHINE\\Software\\One
    DisplayName    REG_SZ    EA SPORTS FC™ 26
    InstallLocation    REG_SZ    C:\\Games\\FC 26

HKEY_LOCAL_MACHINE\\Software\\Two
    DisplayName    REG_SZ    Another App
    InstallLocation    REG_SZ    C:\\Other
`;
    expect(parseRegistryInstalls(output)).toEqual([
      { displayName: 'EA SPORTS FC™ 26', installLocation: 'C:\\Games\\FC 26' },
      { displayName: 'Another App', installLocation: 'C:\\Other' },
    ]);
  });

  it('finds FC through the registry and reads its exact build', () => {
    const game = path.normalize('C:\\Games\\FC 26');
    const liveEditor = path.normalize('C:\\FC 26 Live Editor');
    const files = new Map<string, string>([
      [path.join(game, '__Installer', 'installerdata.xml'), '<gameVersion version="1.0.138.57785"/>'],
      [path.join(liveEditor, 'version_info.json'), JSON.stringify({
        le_ver: { stable: { ver: 'v26.3.5' } },
        compatibility: { '1.0.138.57785': ['v26.3.5'] },
      })],
    ]);
    const detected = detectEnvironment({
      platform: 'win32',
      homeDirectory: 'C:\\Users\\tester',
      registryOutput: `
HKEY_LOCAL_MACHINE\\Software\\FC
 DisplayName REG_SZ EA SPORTS FC 26
 InstallLocation REG_SZ C:\\Games\\FC 26
`,
      exists: (candidate) => candidate === game || files.has(candidate),
      readText: (file) => {
        const value = files.get(file);
        if (value === undefined) throw new Error('ENOENT');
        return value;
      },
    });
    expect(detected.game).toMatchObject({
      found: true,
      path: game,
      source: 'registry',
      build: '1.0.138.57785',
    });
    expect(detected.liveEditor).toMatchObject({
      found: true,
      path: liveEditor,
      source: 'known_path',
      version: 'v26.3.5',
      requiredForBuild: ['v26.3.5'],
    });
  });

  it('prefers explicit manual paths and reports a malformed manifest plainly', () => {
    const game = path.normalize('E:\\Manual FC');
    const liveEditor = path.normalize('E:\\Manual LE');
    const detected = detectEnvironment({
      platform: 'win32',
      manualGamePath: game,
      manualLiveEditorPath: liveEditor,
      registryOutput: '',
      exists: (candidate) =>
        candidate === game || candidate === path.join(liveEditor, 'version_info.json'),
      readText: (file) => {
        if (file.endsWith('installerdata.xml')) return '<gameVersion version="build-manual"/>';
        return '{bad json';
      },
    });
    expect(detected.game).toMatchObject({ found: true, source: 'manual', build: 'build-manual' });
    expect(detected.liveEditor).toMatchObject({ found: true, source: 'manual', version: null });
    expect(detected.liveEditor.problem).toMatch(/Cannot parse Live Editor manifest/);
  });

  it('returns actionable not-found state on non-Windows hosts', () => {
    const detected = detectEnvironment({
      platform: 'darwin',
      exists: () => false,
      registryOutput: 'ignored',
    });
    expect(detected.game).toMatchObject({ found: false, source: 'none', build: null });
    expect(detected.liveEditor).toMatchObject({ found: false, source: 'none', version: null });
  });
});
