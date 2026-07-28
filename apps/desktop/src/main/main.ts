import { app, BrowserWindow, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@tenure/persistence/db.js';
import { recordDiagnosticRun } from '@tenure/persistence/diagnostics.js';
import { parseManifest } from '@tenure/sync/compat/manifest.js';
import { createDiagnosticBundle } from '@tenure/sync/doctor/bundle.js';
import { doctorSummary } from '@tenure/sync/doctor/doctor.js';
import compatibilityManifestJson from '../../../../packages/sync/compat/manifest.json' with { type: 'json' };
import { registerIpc } from './ipc/register.js';
import {
  applyBridgeInstall as applyBridgeInstallPlan,
  planBridgeInstall,
  type BridgeInstallPlan,
} from './launcher/bridgeInstall.js';
import {
  detectEnvironment,
  type EnvironmentDetection,
} from './launcher/detect.js';
import { CheckpointService } from './services/checkpointService.js';
import { ResultService } from './services/resultService.js';
import { MatchPrepService } from './services/matchPrepService.js';
import { BridgeRuntime } from './services/bridgeRuntime.js';
import { SquadService } from './services/squadService.js';
import type {
  BridgeInstallPreview,
  EnvironmentSummary,
} from '../shared/ipc.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const smokeTest = process.env.TENURE_SMOKE_TEST === '1';
if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  app.setPath('userData', path.join(process.env.LOCALAPPDATA, 'Tenure'));
}

function environmentSummary(detected: EnvironmentDetection): EnvironmentSummary {
  return {
    gameFound: detected.game.found,
    gamePath: detected.game.path,
    gameBuild: detected.game.build,
    liveEditorFound: detected.liveEditor.found,
    liveEditorPath: detected.liveEditor.path,
    liveEditorVersion: detected.liveEditor.version,
    requiredLiveEditor: detected.liveEditor.requiredForBuild,
    problem: detected.game.problem ??
      detected.liveEditor.problem ??
      (detected.platform === 'win32' ? null : 'FC integration requires Windows.'),
  };
}

async function sqliteAvailable(): Promise<boolean> {
  try {
    await import('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#171815',
    title: 'Tenure',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(directory, '../preload/preload.cjs'),
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (smokeTest) {
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') {
        process.stderr.write(`[renderer] ${details.message}\n`);
      }
    });
  }
  await window.loadFile(path.join(directory, '../../dist/index.html'));
  if (smokeTest) {
    const smokeState = await window.webContents.executeJavaScript(
      `Promise.resolve().then(async () => ({
        preloadReady: typeof window.tenure?.versions === 'function',
        versions: await window.tenure?.versions?.(),
        doctorConditions: await window.tenure?.doctorConditions?.(),
        squadSurface: {
          table: document.querySelector('table caption')?.textContent,
          sortableColumns: document.querySelectorAll('th[aria-sort]').length,
          densityControl: document.querySelector('[data-density] select') !== null,
          playerProfile: document.querySelector('.player-profile h2')?.textContent
        }
      }))`,
      true,
    ) as {
      readonly preloadReady: boolean;
      readonly versions?: { readonly sqliteAvailable: boolean };
      readonly doctorConditions?: readonly unknown[];
      readonly squadSurface?: {
        readonly table?: string;
        readonly sortableColumns: number;
        readonly densityControl: boolean;
        readonly playerProfile?: string;
      };
    };
    if (
      !smokeState.preloadReady ||
      smokeState.versions?.sqliteAvailable !== true ||
      smokeState.doctorConditions?.length !== 12 ||
      smokeState.squadSurface?.table !== 'Managed first-team squad' ||
      smokeState.squadSurface.sortableColumns < 6 ||
      !smokeState.squadSurface.densityControl ||
      !smokeState.squadSurface.playerProfile
    ) {
      process.stderr.write(
        'TENURE_SMOKE_FAILED: preload, node:sqlite, live Doctor, or Squad trust surface is unavailable\n',
      );
      app.exit(1);
    } else {
      process.stdout.write(
        'TENURE_SMOKE_OK: renderer, typed IPC, node:sqlite, live Doctor, and Squad trust surface are available\n',
      );
      window.close();
      app.quit();
    }
  }
  return window;
}

app.whenReady().then(async () => {
  const dataDirectory = app.getPath('userData');
  const bridgeSourceDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'bridge')
    : path.resolve(directory, '../../../../bridge');
  let manualGamePath: string | null = null;
  let manualLiveEditorPath: string | null = null;
  let pendingBridgePlan: BridgeInstallPlan | null = null;
  const detect = () => environmentSummary(detectEnvironment({
    manualGamePath,
    manualLiveEditorPath,
  }));
  const checkpointService = new CheckpointService({
    checkpointDirectory: path.join(dataDirectory, 'checkpoints'),
    activeCareerPath: path.join(dataDirectory, 'career.db'),
  });
  const resultService = new ResultService({
    careerPath: path.join(dataDirectory, 'career.db'),
    checkpointDirectory: path.join(dataDirectory, 'checkpoints'),
  });
  const matchPrepService = new MatchPrepService({
    careerPath: path.join(dataDirectory, 'career.db'),
    checkpointDirectory: path.join(dataDirectory, 'checkpoints'),
  });
  const squadService = new SquadService({
    careerPath: path.join(dataDirectory, 'career.db'),
  });
  const bridgeRuntime = new BridgeRuntime({
    dataDirectory,
    careerPath: path.join(dataDirectory, 'career.db'),
    snapshotDirectory: path.join(dataDirectory, 'snapshots'),
    manifest: parseManifest(JSON.stringify(compatibilityManifestJson)),
    hostEnvironment: detect,
  });
  await bridgeRuntime.start();
  app.on('will-quit', () => {
    void bridgeRuntime.close();
  });
  registerIpc({
    sqliteAvailable: await sqliteAvailable(),
    syncStatus: () => bridgeRuntime.syncStatus(detect()),
    doctorConditions: () => bridgeRuntime.conditions(detect()),
    squad: () => squadService.get(),
    environment: detect,
    setManualGamePath: (selectedPath) => {
      manualGamePath = selectedPath;
      return detect();
    },
    setManualLiveEditorPath: (selectedPath) => {
      manualLiveEditorPath = selectedPath;
      pendingBridgePlan = null;
      return detect();
    },
    previewBridgeInstall: (): BridgeInstallPreview => {
      const environment = detect();
      if (environment.liveEditorPath === null) {
        throw new Error('Select the FC Live Editor installation before previewing the bridge.');
      }
      pendingBridgePlan = planBridgeInstall(bridgeSourceDirectory, environment.liveEditorPath);
      return {
        files: pendingBridgePlan.files.map((file) => ({
          relativePath: file.relativePath,
          action: file.action,
          diff: file.diff,
        })),
        hasConflicts: pendingBridgePlan.files.some((file) => file.action === 'conflict'),
      };
    },
    applyBridgeInstall: (allowUserModified) => {
      if (pendingBridgePlan === null) throw new Error('Preview the bridge changes before installing.');
      const result = applyBridgeInstallPlan(pendingBridgePlan, {
        installedAt: Date.now(),
        allowUserModified,
      });
      pendingBridgePlan = null;
      return result;
    },
    pendingFixtures: () => resultService.listPendingFixtures(),
    fixturePlayers: (fixtureId) => resultService.listFixturePlayers(fixtureId),
    commitManualResult: (draft) => resultService.commitManual(draft),
    matchPrepState: (manualConfirmed) => matchPrepService.state(manualConfirmed),
    createPreMatchCheckpoint: (manualConfirmed) =>
      matchPrepService.createCheckpoint(manualConfirmed),
    listCheckpoints: () => checkpointService.list(),
    restoreCheckpoint: (checkpointId) => checkpointService.restore(checkpointId),
    exportDiagnostics: (outputPath) => {
      const createdAt = Date.now();
      const conditions = bridgeRuntime.conditions(detect());
      const result = createDiagnosticBundle({
        outputPath,
        createdAt,
        versions: {
          app: app.getVersion(),
          saveSchema: 3,
          bridgeProtocol: 1,
          compatibilityManifest: 1,
        },
        conditions,
        logs: bridgeRuntime.diagnosticLogs(),
      });
      const careerPath = path.join(dataDirectory, 'career.db');
      if (fs.existsSync(careerPath)) {
        const db = openDatabase(careerPath);
        try {
          const career = db.get<{ id: number }>('SELECT id FROM careers ORDER BY id LIMIT 1');
          recordDiagnosticRun(db, {
            careerId: career?.id ?? null,
            createdAt,
            summary: doctorSummary(conditions),
            bundlePath: result.path,
          });
        } finally {
          db.close();
        }
      }
    },
  });
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
