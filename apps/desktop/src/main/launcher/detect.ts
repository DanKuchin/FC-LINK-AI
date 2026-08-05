import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface RegistryInstall {
  readonly displayName: string;
  readonly installLocation: string;
}

export interface DetectedInstall {
  readonly found: boolean;
  readonly path: string | null;
  readonly source: 'manual' | 'registry' | 'known_path' | 'none';
  readonly problem?: string;
}

export interface EnvironmentDetection {
  readonly platform: NodeJS.Platform;
  readonly game: DetectedInstall & { readonly build: string | null };
  readonly liveEditor: DetectedInstall & {
    readonly version: string | null;
    readonly versionTable: Readonly<Record<string, unknown>> | null;
    readonly requiredForBuild: readonly string[] | null;
  };
}

export interface DetectionOptions {
  readonly platform?: NodeJS.Platform;
  readonly homeDirectory?: string;
  readonly manualGamePath?: string | null;
  readonly manualLiveEditorPath?: string | null;
  readonly registryOutput?: string;
  readonly exists?: (candidate: string) => boolean;
  readonly readText?: (file: string) => string;
}

const GAME_MANIFEST = path.join('__Installer', 'installerdata.xml');
const LIVE_EDITOR_MANIFEST = 'version_info.json';

function liveEditorVersion(value: unknown): string | null {
  if (typeof value === 'string' && /^v?\d+(?:\.\d+){1,3}$/i.test(value.trim())) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = liveEditorVersion(child);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Readonly<Record<string, unknown>>;
  for (const key of ['ver', 'version', 'stable', 'latest']) {
    if (record[key] === undefined) continue;
    const found = liveEditorVersion(record[key]);
    if (found !== null) return found;
  }
  for (const child of Object.values(record)) {
    const found = liveEditorVersion(child);
    if (found !== null) return found;
  }
  return null;
}

export function parseRegistryInstalls(output: string): RegistryInstall[] {
  const installs: RegistryInstall[] = [];
  let displayName: string | undefined;
  let installLocation: string | undefined;

  const flush = () => {
    if (displayName !== undefined && installLocation !== undefined) {
      installs.push({ displayName, installLocation });
    }
    displayName = undefined;
    installLocation = undefined;
  };

  for (const line of output.split(/\r?\n/)) {
    if (/^\s*HKEY_/i.test(line)) {
      flush();
      continue;
    }
    const value = /^\s*(DisplayName|InstallLocation)\s+REG_\w+\s+(.+?)\s*$/i.exec(line);
    if (value?.[1]?.toLowerCase() === 'displayname') displayName = value[2];
    if (value?.[1]?.toLowerCase() === 'installlocation') installLocation = value[2];
  }
  flush();
  return installs;
}

function queryWindowsRegistry(): string {
  const roots = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const chunks: string[] = [];
  for (const root of roots) {
    try {
      chunks.push(execFileSync('reg', ['query', root, '/s'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }));
    } catch {
      // An absent registry view is ordinary on Windows; retain results from the other view.
    }
  }
  return chunks.join('\n');
}

function firstExisting(
  candidates: readonly { readonly path: string; readonly source: DetectedInstall['source'] }[],
  exists: (candidate: string) => boolean,
): { readonly path: string; readonly source: DetectedInstall['source'] } | undefined {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalised = path.normalize(candidate.path);
    if (seen.has(normalised.toLowerCase())) continue;
    seen.add(normalised.toLowerCase());
    if (exists(normalised)) return { path: normalised, source: candidate.source };
  }
  return undefined;
}

export function detectEnvironment(options: DetectionOptions = {}): EnvironmentDetection {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const exists = options.exists ?? fs.existsSync;
  const readText = options.readText ?? ((file: string) => fs.readFileSync(file, 'utf8'));
  const registry = platform === 'win32'
    ? parseRegistryInstalls(options.registryOutput ?? queryWindowsRegistry())
    : [];

  const registryGamePaths = registry
    .filter((entry) => /EA SPORTS FC.?\s*26|^FC 26$/i.test(entry.displayName))
    .map((entry) => ({ path: entry.installLocation, source: 'registry' as const }));
  const gameCandidate = firstExisting([
    ...(options.manualGamePath
      ? [{ path: options.manualGamePath, source: 'manual' as const }]
      : []),
    ...registryGamePaths,
    { path: 'C:\\Program Files\\EA Games\\FC 26', source: 'known_path' },
    { path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\FC 26', source: 'known_path' },
    { path: 'D:\\Steam\\steamapps\\common\\FC 26', source: 'known_path' },
  ], exists);

  let gameBuild: string | null = null;
  let gameProblem: string | undefined;
  if (gameCandidate !== undefined) {
    const manifest = path.join(gameCandidate.path, GAME_MANIFEST);
    try {
      const match = /<gameVersion\s+version=['"]([^'"]+)['"]/.exec(readText(manifest));
      gameBuild = match?.[1] ?? null;
      if (gameBuild === null) gameProblem = `Build number is missing from ${manifest}`;
    } catch (error) {
      gameProblem = `Cannot read FC build manifest ${manifest}: ${(error as Error).message}`;
    }
  }

  const liveEditorCandidate = firstExisting([
    ...(options.manualLiveEditorPath
      ? [{ path: options.manualLiveEditorPath, source: 'manual' as const }]
      : []),
    { path: 'C:\\FC 26 Live Editor', source: 'known_path' },
    { path: path.join(homeDirectory, 'Desktop', 'FC 26 Live Editor'), source: 'known_path' },
    { path: 'D:\\FC 26 Live Editor', source: 'known_path' },
  ], (candidate) => exists(path.join(candidate, LIVE_EDITOR_MANIFEST)));

  let versionTable: Readonly<Record<string, unknown>> | null = null;
  let detectedLiveEditorVersion: string | null = null;
  let requiredForBuild: readonly string[] | null = null;
  let liveEditorProblem: string | undefined;
  if (liveEditorCandidate !== undefined) {
    const manifest = path.join(liveEditorCandidate.path, LIVE_EDITOR_MANIFEST);
    try {
      const parsed = JSON.parse(readText(manifest)) as {
        readonly le_ver?: Readonly<Record<string, unknown>>;
        readonly compatibility?: Readonly<Record<string, unknown>>;
      };
      versionTable = parsed.le_ver ?? null;
      detectedLiveEditorVersion = liveEditorVersion(versionTable);
      const required = gameBuild === null ? undefined : parsed.compatibility?.[gameBuild];
      requiredForBuild = Array.isArray(required) && required.every((item) => typeof item === 'string')
        ? required
        : null;
    } catch (error) {
      liveEditorProblem = `Cannot parse Live Editor manifest ${manifest}: ${(error as Error).message}`;
    }
  }

  return {
    platform,
    game: {
      found: gameCandidate !== undefined,
      path: gameCandidate?.path ?? null,
      source: gameCandidate?.source ?? 'none',
      build: gameBuild,
      ...(gameProblem === undefined ? {} : { problem: gameProblem }),
    },
    liveEditor: {
      found: liveEditorCandidate !== undefined,
      path: liveEditorCandidate?.path ?? null,
      source: liveEditorCandidate?.source ?? 'none',
      version: detectedLiveEditorVersion,
      versionTable,
      requiredForBuild,
      ...(liveEditorProblem === undefined ? {} : { problem: liveEditorProblem }),
    },
  };
}
