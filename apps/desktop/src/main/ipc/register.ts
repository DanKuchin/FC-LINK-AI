import { app, dialog, ipcMain } from 'electron';
import path from 'node:path';
import {
  IPC_CHANNELS,
  type BridgeInstallPreview,
  type BridgeInstallSummary,
  type CheckpointSummary,
  type EnvironmentSummary,
  type RestoreCheckpointResult,
  type SyncStatus,
  type VersionSurface,
} from '../../shared/ipc.js';

export interface DesktopServices {
  readonly sqliteAvailable: boolean;
  readonly syncStatus: () => SyncStatus;
  readonly environment: () => EnvironmentSummary;
  readonly setManualGamePath: (selectedPath: string) => EnvironmentSummary;
  readonly setManualLiveEditorPath: (selectedPath: string) => EnvironmentSummary;
  readonly previewBridgeInstall: () => BridgeInstallPreview;
  readonly applyBridgeInstall: (allowUserModified: boolean) => BridgeInstallSummary;
  readonly listCheckpoints: () => readonly CheckpointSummary[];
  readonly restoreCheckpoint: (checkpointId: string) => RestoreCheckpointResult | Promise<RestoreCheckpointResult>;
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
  ipcMain.handle(IPC_CHANNELS.syncStatus, () => services.syncStatus());
  ipcMain.handle(IPC_CHANNELS.environmentGet, () => services.environment());
  ipcMain.handle(IPC_CHANNELS.environmentBrowseGame, async () => {
    const selection = await dialog.showOpenDialog({
      title: 'Select the EA Sports FC 26 installation',
      properties: ['openDirectory'],
    });
    return selection.canceled || selection.filePaths[0] === undefined
      ? services.environment()
      : services.setManualGamePath(selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.environmentBrowseLiveEditor, async () => {
    const selection = await dialog.showOpenDialog({
      title: 'Select the FC Live Editor installation',
      properties: ['openDirectory'],
    });
    return selection.canceled || selection.filePaths[0] === undefined
      ? services.environment()
      : services.setManualLiveEditorPath(selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.bridgeInstallPreview, () => services.previewBridgeInstall());
  ipcMain.handle(
    IPC_CHANNELS.bridgeInstallApply,
    async (_event, allowUserModified: unknown): Promise<BridgeInstallSummary> => {
      if (typeof allowUserModified !== 'boolean') throw new Error('Installer consent is invalid.');
      const confirmation = await dialog.showMessageBox({
        type: allowUserModified ? 'warning' : 'question',
        title: allowUserModified ? 'Overwrite modified bridge files?' : 'Install bridge scripts?',
        message: allowUserModified
          ? 'Replace the user-modified files shown in the preview?'
          : 'Apply the bridge-script changes shown in the preview?',
        detail: 'Tenure verifies every installed file by SHA-256 after writing.',
        buttons: [allowUserModified ? 'Overwrite and install' : 'Install', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      });
      if (confirmation.response !== 0) {
        return { created: 0, updated: 0, unchanged: 0, overwrittenConflicts: 0 };
      }
      return services.applyBridgeInstall(allowUserModified);
    },
  );
  ipcMain.handle(IPC_CHANNELS.checkpointList, () => services.listCheckpoints());
  ipcMain.handle(IPC_CHANNELS.checkpointRestore, async (_event, checkpointId: unknown) => {
    if (typeof checkpointId !== 'string' || checkpointId.length === 0 || checkpointId.length > 200) {
      throw new Error('Checkpoint ID is invalid.');
    }
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: 'Restore checkpoint?',
      message: 'Restore this checkpoint and replace the active career?',
      detail: 'Tenure will keep a safety copy of the current career before replacing it.',
      buttons: ['Restore', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirmation.response !== 0) return { restored: false, cancelled: true };
    return services.restoreCheckpoint(checkpointId);
  });
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
