import { app, dialog, ipcMain } from 'electron';
import path from 'node:path';
import {
  IPC_CHANNELS,
  type CheckpointSummary,
  type SyncStatus,
  type VersionSurface,
} from '../../shared/ipc.js';

export interface DesktopServices {
  readonly sqliteAvailable: boolean;
  readonly listCheckpoints: () => readonly CheckpointSummary[];
  readonly exportDiagnostics: (outputPath: string) => void | Promise<void>;
}

export function registerIpc(services: DesktopServices): void {
  ipcMain.handle(IPC_CHANNELS.versions, (): VersionSurface => ({
    app: app.getVersion(),
    saveSchema: 3,
    bridgeProtocol: 1,
    compatibilityManifest: 1,
    sqliteAvailable: services.sqliteAvailable,
  }));
  ipcMain.handle(IPC_CHANNELS.syncStatus, (): SyncStatus => ({
    state: 'offline',
    label: 'Offline — playable',
    detail: 'No live FC career is connected. Import remains disabled until a verified schema fixture exists.',
    writesEnabled: false,
  }));
  ipcMain.handle(IPC_CHANNELS.checkpointList, () => services.listCheckpoints());
  ipcMain.handle(IPC_CHANNELS.diagnosticExport, async () => {
    const result = await dialog.showSaveDialog({
      title: 'Export diagnostic bundle',
      defaultPath: path.join(app.getPath('documents'), 'tenure-diagnostics.zip'),
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    });
    if (result.canceled || result.filePath === '') return { cancelled: true };
    await services.exportDiagnostics(result.filePath);
    return { cancelled: false, path: result.filePath };
  });
}
