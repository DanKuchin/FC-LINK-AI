export const IPC_CHANNELS = {
  versions: 'system:versions',
  syncStatus: 'sync:status',
  checkpointList: 'checkpoint:list',
  diagnosticExport: 'diagnostic:export',
} as const;

export interface VersionSurface {
  readonly app: string;
  readonly saveSchema: number;
  readonly bridgeProtocol: number;
  readonly compatibilityManifest: number;
  readonly sqliteAvailable: boolean;
}

export interface SyncStatus {
  readonly state: 'connected' | 'offline' | 'attention';
  readonly label: string;
  readonly detail: string;
  readonly writesEnabled: boolean;
}

export interface CheckpointSummary {
  readonly id: string;
  readonly label: string;
  readonly createdAt: number;
  readonly verified: boolean;
}

export interface TenureDesktopApi {
  readonly versions: () => Promise<VersionSurface>;
  readonly syncStatus: () => Promise<SyncStatus>;
  readonly listCheckpoints: () => Promise<readonly CheckpointSummary[]>;
  readonly exportDiagnostics: () => Promise<{ readonly cancelled: boolean; readonly path?: string }>;
}

declare global {
  interface Window {
    readonly tenure: TenureDesktopApi;
  }
}
