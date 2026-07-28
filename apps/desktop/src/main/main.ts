import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiagnosticBundle } from '@tenure/sync/doctor/bundle.js';
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
import type {
  BridgeInstallPreview,
  EnvironmentSummary,
  SyncStatus,
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
    requiredLiveEditor: detected.liveEditor.requiredForBuild,
    problem: detected.game.problem ??
      detected.liveEditor.problem ??
      (detected.platform === 'win32' ? null : 'FC integration requires Windows.'),
  };
}

function syncStatusFor(environment: EnvironmentSummary): SyncStatus {
  if (!environment.gameFound || !environment.liveEditorFound) {
    return {
      state: 'offline',
      label: 'Offline — playable',
      detail: !environment.gameFound
        ? 'EA Sports FC 26 was not found. Choose its installation in Sync Doctor.'
        : 'FC Live Editor was not found. Choose its installation in Sync Doctor.',
      writesEnabled: false,
    };
  }
  if (environment.problem !== null || environment.gameBuild === null) {
    return {
      state: 'attention',
      label: 'Integration needs attention',
      detail: environment.problem ?? 'The FC build number could not be read.',
      writesEnabled: false,
    };
  }
  if (environment.requiredLiveEditor === null) {
    return {
      state: 'attention',
      label: 'Unsupported game build',
      detail: `FC build ${environment.gameBuild} is absent from Live Editor's compatibility table.`,
      writesEnabled: false,
    };
  }
  return {
    state: 'offline',
    label: 'Detected — bridge not connected',
    detail: `FC ${environment.gameBuild} requires Live Editor ${environment.requiredLiveEditor.join('–')}.`,
    writesEnabled: false,
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
        versions: await window.tenure?.versions?.()
      }))`,
      true,
    ) as { readonly preloadReady: boolean; readonly versions?: { readonly sqliteAvailable: boolean } };
    if (!smokeState.preloadReady || smokeState.versions?.sqliteAvailable !== true) {
      process.stderr.write(
        'TENURE_SMOKE_FAILED: typed preload API or Electron node:sqlite runtime is unavailable\n',
      );
      app.exit(1);
    } else {
      process.stdout.write(
        'TENURE_SMOKE_OK: renderer, typed preload API, IPC, and node:sqlite are available\n',
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
  registerIpc({
    sqliteAvailable: await sqliteAvailable(),
    syncStatus: () => syncStatusFor(detect()),
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
    listCheckpoints: () => checkpointService.list(),
    restoreCheckpoint: (checkpointId) => checkpointService.restore(checkpointId),
    exportDiagnostics: (outputPath) => {
      createDiagnosticBundle({
        outputPath,
        createdAt: Date.now(),
        versions: {
          app: app.getVersion(),
          saveSchema: 3,
          bridgeProtocol: 1,
          compatibilityManifest: 1,
        },
        conditions: [],
        logs: [{
          name: 'desktop.ndjson',
          content: `${JSON.stringify({
            at: Date.now(),
            state: 'offline',
            reason: 'No live FC career is connected.',
          })}\n`,
        }],
      });
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
