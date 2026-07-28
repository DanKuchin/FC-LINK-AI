import { app, dialog, ipcMain } from 'electron';
import path from 'node:path';
import {
  IPC_CHANNELS,
  type BridgeInstallPreview,
  type BridgeInstallSummary,
  type CheckpointSummary,
  type CompatibilityManifestInstallResult,
  type CompatibilityManifestSummary,
  type DoctorConditionView,
  type EnvironmentSummary,
  type FixturePlayer,
  type ManualResultCommit,
  type ManualResultDraft,
  type ManualResultPlayerLine,
  type MatchPrepState,
  type PendingFixture,
  type PostMatchCheckpointIssue,
  type PostMatchCheckpointRetry,
  type RestoreCheckpointResult,
  type SquadView,
  type SyncStatus,
  type VersionSurface,
} from '../../shared/ipc.js';

export interface DesktopServices {
  readonly sqliteAvailable: boolean;
  readonly compatibilityManifestVersion: () => number;
  readonly syncStatus: () => SyncStatus;
  readonly doctorConditions: () => readonly DoctorConditionView[];
  readonly squad: () => SquadView;
  readonly compatibilityManifest: () => CompatibilityManifestSummary;
  readonly installCompatibilityManifest: (
    selectedPath: string,
  ) => CompatibilityManifestSummary;
  readonly environment: () => EnvironmentSummary;
  readonly setManualGamePath: (selectedPath: string) => EnvironmentSummary;
  readonly setManualLiveEditorPath: (selectedPath: string) => EnvironmentSummary;
  readonly previewBridgeInstall: () => BridgeInstallPreview;
  readonly applyBridgeInstall: (allowUserModified: boolean) => BridgeInstallSummary;
  readonly pendingFixtures: () => readonly PendingFixture[];
  readonly fixturePlayers: (fixtureId: number) => readonly FixturePlayer[];
  readonly commitManualResult: (draft: ManualResultDraft) => ManualResultCommit;
  readonly postMatchCheckpointIssues: () => readonly PostMatchCheckpointIssue[];
  readonly retryPostMatchCheckpoint: (matchResultId: number) => PostMatchCheckpointRetry;
  readonly matchPrepState: (manualResultModeConfirmed: boolean) => MatchPrepState;
  readonly createPreMatchCheckpoint: (manualResultModeConfirmed: boolean) => MatchPrepState;
  readonly listCheckpoints: () => readonly CheckpointSummary[];
  readonly restoreCheckpoint: (checkpointId: string) => RestoreCheckpointResult | Promise<RestoreCheckpointResult>;
  readonly exportDiagnostics: (outputPath: string) => void | Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, name: string): number {
  const value = record[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return value;
}

function parsePlayerLine(value: unknown): ManualResultPlayerLine {
  if (!isRecord(value)) throw new Error('Every player line must be an object.');
  const rating = value.rating;
  if (rating !== null && (typeof rating !== 'number' || !Number.isFinite(rating))) {
    throw new Error('rating must be a finite number or null.');
  }
  return {
    playerId: numberField(value, 'playerId'),
    appearances: numberField(value, 'appearances') as 0 | 1,
    goals: numberField(value, 'goals'),
    assists: numberField(value, 'assists'),
    yellow: numberField(value, 'yellow'),
    red: numberField(value, 'red'),
    cleanSheet: numberField(value, 'cleanSheet') as 0 | 1,
    rating,
  };
}

function parseManualResult(value: unknown): ManualResultDraft {
  if (!isRecord(value)) throw new Error('Manual result must be an object.');
  if (!Array.isArray(value.playerLines)) throw new Error('playerLines must be an array.');
  const optionalScore = (name: 'homePens' | 'awayPens'): number | null | undefined => {
    const score = value[name];
    if (score === undefined || score === null) return score;
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new Error(`${name} must be a finite number or null.`);
    }
    return score;
  };
  const homePens = optionalScore('homePens');
  const awayPens = optionalScore('awayPens');
  return {
    fixtureId: numberField(value, 'fixtureId'),
    homeGoals: numberField(value, 'homeGoals'),
    awayGoals: numberField(value, 'awayGoals'),
    ...(homePens === undefined ? {} : { homePens }),
    ...(awayPens === undefined ? {} : { awayPens }),
    playerLines: value.playerLines.map(parsePlayerLine),
  };
}

export function registerIpc(services: DesktopServices): void {
  ipcMain.handle(IPC_CHANNELS.versions, (): VersionSurface => ({
    app: app.getVersion(),
    saveSchema: 4,
    bridgeProtocol: 1,
    compatibilityManifest: services.compatibilityManifestVersion(),
    sqliteAvailable: services.sqliteAvailable,
  }));
  ipcMain.handle(IPC_CHANNELS.syncStatus, () => services.syncStatus());
  ipcMain.handle(IPC_CHANNELS.doctorConditions, () => services.doctorConditions());
  ipcMain.handle(IPC_CHANNELS.squadGet, () => services.squad());
  ipcMain.handle(
    IPC_CHANNELS.compatibilityStatus,
    () => services.compatibilityManifest(),
  );
  ipcMain.handle(
    IPC_CHANNELS.compatibilityInstall,
    async (): Promise<CompatibilityManifestInstallResult> => {
      const selection = await dialog.showOpenDialog({
        title: 'Install a Tenure compatibility manifest',
        properties: ['openFile'],
        filters: [{ name: 'JSON manifest', extensions: ['json'] }],
      });
      if (selection.canceled || selection.filePaths[0] === undefined) {
        return { cancelled: true, status: services.compatibilityManifest() };
      }
      return {
        cancelled: false,
        status: services.installCompatibilityManifest(selection.filePaths[0]),
      };
    },
  );
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
  ipcMain.handle(IPC_CHANNELS.resultPendingFixtures, () => services.pendingFixtures());
  ipcMain.handle(IPC_CHANNELS.resultFixturePlayers, (_event, fixtureId: unknown) => {
    if (typeof fixtureId !== 'number' || !Number.isInteger(fixtureId) || fixtureId <= 0) {
      throw new Error('Fixture ID is invalid.');
    }
    return services.fixturePlayers(fixtureId);
  });
  ipcMain.handle(IPC_CHANNELS.resultCommitManual, (_event, draft: unknown) =>
    services.commitManualResult(parseManualResult(draft)));
  ipcMain.handle(
    IPC_CHANNELS.resultCheckpointIssues,
    () => services.postMatchCheckpointIssues(),
  );
  ipcMain.handle(IPC_CHANNELS.resultRetryCheckpoint, (_event, matchResultId: unknown) => {
    if (
      typeof matchResultId !== 'number' ||
      !Number.isInteger(matchResultId) ||
      matchResultId <= 0
    ) {
      throw new Error('Match result ID is invalid.');
    }
    return services.retryPostMatchCheckpoint(matchResultId);
  });
  ipcMain.handle(IPC_CHANNELS.matchPrepState, (_event, manualConfirmed: unknown) => {
    if (typeof manualConfirmed !== 'boolean') throw new Error('Manual-mode choice is invalid.');
    return services.matchPrepState(manualConfirmed);
  });
  ipcMain.handle(IPC_CHANNELS.matchPrepCheckpoint, (_event, manualConfirmed: unknown) => {
    if (typeof manualConfirmed !== 'boolean') throw new Error('Manual-mode choice is invalid.');
    return services.createPreMatchCheckpoint(manualConfirmed);
  });
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
