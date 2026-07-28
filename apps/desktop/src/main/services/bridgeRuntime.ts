import fs from 'node:fs';
import {
  openDatabase,
  type Db,
} from '@tenure/persistence/db.js';
import {
  archiveSnapshot,
  verifyArchivedSnapshot,
  type SnapshotRecord,
} from '@tenure/persistence/snapshots.js';
import {
  evaluateSupport,
  type CompatibilityManifest,
} from '@tenure/sync/compat/manifest.js';
import {
  diagnoseSync,
  doctorSummary,
  type DoctorCondition,
  type DoctorInput,
} from '@tenure/sync/doctor/doctor.js';
import type { DiagnosticLog } from '@tenure/sync/doctor/bundle.js';
import {
  BridgeServer,
  type BridgePeer,
  type BridgeRequestLog,
  type StartedBridgeServer,
} from '@tenure/sync/server/server.js';
import type {
  EnvironmentSummary,
  SyncStatus,
} from '../../shared/ipc.js';

const MAX_LOG_ENTRIES = 500;
const MAX_LOG_DETAIL_BYTES = 32 * 1024;

interface RuntimeLogEntry {
  readonly at: number;
  readonly kind: string;
  readonly detail: string;
}

interface CareerEvidence {
  readonly expectedSaveUid: string;
  readonly currentInGameDate: number;
  readonly snapshotInGameDate: number | null;
  readonly mappingConflicts: number;
  readonly failedWrites: number;
  readonly sentWithoutAck: number;
  readonly corruptedSnapshots: number;
}

export interface BridgeRuntimeOptions {
  /** User-data root; BridgeServer creates its own `bridge/` child. */
  readonly dataDirectory: string;
  readonly careerPath: string;
  readonly snapshotDirectory: string;
  readonly manifest: CompatibilityManifest;
  readonly hostEnvironment?: () => EnvironmentSummary;
  readonly now?: () => number;
}

function count(db: Db, sql: string): number {
  return db.get<{ count: number }>(sql)?.count ?? 0;
}

function normalizedInGameDate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value !== 'string') return null;
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const milliseconds = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(milliseconds)) return null;
  return Math.floor(milliseconds / 86_400_000);
}

export class BridgeRuntime {
  private readonly options: BridgeRuntimeOptions;
  private readonly server: BridgeServer;
  private readonly entries: RuntimeLogEntry[] = [];
  private peer: BridgePeer | null = null;
  private bridgeStartedAt: number | null = null;
  private helloSeenAt: number | null = null;
  private serverAccessError: string | null = null;
  private careerAccessError: string | null = null;
  private snapshotAccessError: string | null = null;

  constructor(options: BridgeRuntimeOptions) {
    this.options = options;
    this.server = new BridgeServer({
      dataDirectory: options.dataDirectory,
      now: () => this.now(),
      handlers: {
        onHello: (peer) => {
          this.peer = peer;
          this.helloSeenAt = this.now();
          this.record('bridge.hello', peer);
        },
        onEvent: (event) => this.record('bridge.event', event),
        onLog: (log) => this.record('bridge.log', log),
        onAck: (ack) => this.record('bridge.ack', ack),
        onSnapshot: (snapshot) => this.archive(snapshot),
        getCommands: () => [],
        onRequest: (request) => this.recordRequest(request),
      },
    });
  }

  get address(): StartedBridgeServer | undefined {
    return this.server.address;
  }

  async start(): Promise<StartedBridgeServer | null> {
    try {
      const started = await this.server.start();
      this.bridgeStartedAt = this.now();
      this.serverAccessError = null;
      this.record('desktop.bridge_started', {
        base_url: started.handshake.base_url,
        protocol: started.handshake.protocol,
      });
      return started;
    } catch (error) {
      this.serverAccessError = error instanceof Error ? error.message : String(error);
      this.record('desktop.bridge_start_failed', { error: this.serverAccessError });
      return null;
    }
  }

  async close(): Promise<void> {
    await this.server.close();
  }

  conditions(environment: EnvironmentSummary): readonly DoctorCondition[] {
    const evidence = this.readCareerEvidence();
    const reportedBuild = this.peer?.game_build;
    const compatibility = evaluateSupport(this.options.manifest, {
      gameBuild: reportedBuild === undefined || reportedBuild === 'detected_by_host'
        ? environment.gameBuild
        : reportedBuild,
      liveEditorVersion: this.peer?.le_version ?? environment.liveEditorVersion,
    });
    const accessErrors = [
      this.serverAccessError,
      this.careerAccessError,
      this.snapshotAccessError,
    ].filter((value): value is string => value !== null);
    const input: DoctorInput = {
      fcFound: environment.gameFound,
      liveEditorFound: environment.liveEditorFound,
      compatibility,
      now: this.now(),
      bridgeStartedAt: this.bridgeStartedAt,
      helloSeenAt: this.helloSeenAt,
      inCareer: this.peer?.in_career ?? null,
      connectedSaveUid: this.peer?.save_uid ?? null,
      bridgeAccessError: accessErrors.length === 0 ? null : accessErrors.join(' '),
      ...(evidence === null ? {} : {
        expectedSaveUid: evidence.expectedSaveUid,
        currentInGameDate: evidence.currentInGameDate,
        snapshotInGameDate: evidence.snapshotInGameDate,
        mappingConflicts: evidence.mappingConflicts,
        failedWrites: evidence.failedWrites,
        sentWithoutAck: evidence.sentWithoutAck,
        corruptedSnapshots: evidence.corruptedSnapshots,
      }),
    };
    return diagnoseSync(input);
  }

  syncStatus(environment: EnvironmentSummary): SyncStatus {
    const conditions = this.conditions(environment);
    const summary = doctorSummary(conditions);
    const lua = conditions.find((item) => item.id === 'lua_not_running');
    const compatibility = conditions.find((item) => item.id === 'unsupported_version_pair');
    if (lua !== undefined && lua.state !== 'ok') {
      const setupError = conditions.find((item) =>
        item.state === 'error' &&
        (item.id === 'fc_not_found' ||
          item.id === 'live_editor_not_found' ||
          item.id === 'unsupported_version_pair' ||
          item.id === 'permission_or_av_block'));
      return {
        state: setupError === undefined || lua.state === 'warning' ? 'offline' : 'attention',
        label: lua.state === 'warning'
          ? 'Waiting for Lua bridge'
          : setupError === undefined
            ? 'Offline — playable'
            : 'Integration needs attention',
        detail: setupError?.cause ?? lua.cause,
        writesEnabled: false,
      };
    }
    if (summary.errors > 0) {
      const first = conditions.find((item) => item.state === 'error');
      return {
        state: 'attention',
        label: 'Connected — action required',
        detail: first?.cause ?? 'Sync Doctor found a blocking condition.',
        writesEnabled: false,
      };
    }
    if (summary.warnings > 0) {
      return {
        state: 'offline',
        label: 'Connected — read-only',
        detail: compatibility?.state === 'warning'
          ? compatibility.cause
          : 'The bridge is connected with a non-blocking warning.',
        writesEnabled: false,
      };
    }
    return {
      state: 'connected',
      label: 'Connected and current',
      detail: 'The Lua bridge, career identity, and latest snapshot are current.',
      writesEnabled: false,
    };
  }

  diagnosticLogs(): readonly DiagnosticLog[] {
    return [{
      name: 'bridge-runtime.ndjson',
      content: this.entries
        .map((entry) => JSON.stringify(entry))
        .join('\n') + (this.entries.length === 0 ? '' : '\n'),
    }];
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private record(kind: string, value: unknown): void {
    let detail: string;
    try {
      detail = JSON.stringify(value);
    } catch {
      detail = JSON.stringify({ error: 'value was not JSON serializable' });
    }
    const bytes = Buffer.from(detail);
    if (bytes.length > MAX_LOG_DETAIL_BYTES) {
      detail = `${bytes.subarray(0, MAX_LOG_DETAIL_BYTES).toString('utf8')}…[truncated]`;
    }
    this.entries.push({ at: this.now(), kind, detail });
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_LOG_ENTRIES);
    }
  }

  private recordRequest(request: BridgeRequestLog): void {
    this.record('bridge.request', request);
  }

  private readCareerEvidence(): CareerEvidence | null {
    if (!fs.existsSync(this.options.careerPath)) {
      this.careerAccessError = null;
      return null;
    }
    const db = openDatabase(this.options.careerPath);
    try {
      const career = db.get<{
        id: number;
        save_uid: string;
        current_date: number;
      }>(
        `SELECT id, save_uid, careers.current_date AS current_date
         FROM careers
         ORDER BY id
         LIMIT 1`,
      );
      if (career === undefined) {
        this.careerAccessError = null;
        return null;
      }
      const snapshots = db.all<SnapshotRecord>(
        `SELECT *
         FROM sync_snapshots
         WHERE career_id = ?
         ORDER BY taken_at DESC, id DESC`,
        career.id,
      );
      const evidence = {
        expectedSaveUid: career.save_uid,
        currentInGameDate: career.current_date,
        snapshotInGameDate: snapshots[0]?.in_game_date ?? null,
        mappingConflicts: count(
          db,
          'SELECT COUNT(*) AS count FROM sync_divergences WHERE resolved_at IS NULL',
        ),
        failedWrites: count(
          db,
          "SELECT COUNT(*) AS count FROM sync_operations WHERE state = 'failed'",
        ),
        sentWithoutAck: count(
          db,
          "SELECT COUNT(*) AS count FROM sync_operations WHERE state = 'sent'",
        ),
        corruptedSnapshots: snapshots.filter(
          (snapshot) => verifyArchivedSnapshot(snapshot) !== null,
        ).length,
      };
      this.careerAccessError = null;
      return evidence;
    } catch (error) {
      this.careerAccessError = `Cannot inspect the active career: ${
        error instanceof Error ? error.message : String(error)
      }`;
      return null;
    } finally {
      db.close();
    }
  }

  private archive(snapshot: {
    readonly name: string;
    readonly transfer_id: string;
    readonly payload: string;
    readonly bytes: number;
    readonly checksum: string;
  }): void {
    if (!fs.existsSync(this.options.careerPath)) {
      this.record('bridge.snapshot_rejected', {
        transfer_id: snapshot.transfer_id,
        reason: 'No active Tenure career exists.',
      });
      return;
    }
    const db = openDatabase(this.options.careerPath);
    try {
      const career = db.get<{ id: number; save_uid: string }>(
        'SELECT id, save_uid FROM careers ORDER BY id LIMIT 1',
      );
      if (career === undefined || this.peer?.save_uid !== career.save_uid) {
        this.record('bridge.snapshot_rejected', {
          transfer_id: snapshot.transfer_id,
          reason: 'The connected FC save does not match the active Tenure career.',
        });
        return;
      }
      const archived = archiveSnapshot(db, {
        careerId: career.id,
        directory: this.options.snapshotDirectory,
        reason: snapshot.name,
        payload: snapshot.payload,
        takenAt: this.now(),
        protocol: 1,
        gameBuild: this.peer.game_build === 'detected_by_host'
          ? this.options.hostEnvironment?.().gameBuild ?? null
          : this.peer.game_build ?? null,
        liveEditorVersion: this.peer.le_version ?? null,
        inGameDate: normalizedInGameDate(this.peer.in_game_date),
      });
      this.record('bridge.snapshot_archived', {
        transfer_id: snapshot.transfer_id,
        snapshot_id: archived.record.id,
        reason: snapshot.name,
        bytes: archived.bytes,
        checksum: archived.record.checksum,
      });
      this.snapshotAccessError = null;
    } catch (error) {
      this.snapshotAccessError = `Cannot archive the received snapshot: ${
        error instanceof Error ? error.message : String(error)
      }`;
      throw error;
    } finally {
      db.close();
    }
  }
}
