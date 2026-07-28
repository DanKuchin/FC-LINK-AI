import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiagnosticBundle } from '@tenure/sync/doctor/bundle.js';
import { registerIpc } from './ipc/register.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const smokeTest = process.env.TENURE_SMOKE_TEST === '1';

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
  registerIpc({
    sqliteAvailable: await sqliteAvailable(),
    listCheckpoints: () => [],
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
