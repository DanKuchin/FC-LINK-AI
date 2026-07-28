import { useEffect, useState } from 'react';
import type {
  BridgeInstallPreview,
  CheckpointSummary,
  EnvironmentSummary,
  SyncStatus,
  VersionSurface,
} from '../shared/ipc.js';

type Screen = 'squad' | 'result' | 'doctor';

const sampleSquad = [
  ['M. Hale', 'GK', '29', '78–81', '100', 'Calm', '2028'],
  ['J. Okafor', 'CB', '24', '75–79', '92', 'Good', '2029'],
  ['R. Santos', 'CM', '21', '71–80', '86', 'Rising', '2027'],
  ['A. Mercer', 'ST', '27', '80–82', '74', 'Strong', '2028'],
] as const;

export function App() {
  const [screen, setScreen] = useState<Screen>('squad');
  const [versions, setVersions] = useState<VersionSurface | null>(null);
  const [checkpoints, setCheckpoints] = useState<readonly CheckpointSummary[]>([]);
  const [environment, setEnvironment] = useState<EnvironmentSummary | null>(null);
  const [bridgePreview, setBridgePreview] = useState<BridgeInstallPreview | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [sync, setSync] = useState<SyncStatus>({
    state: 'offline',
    label: 'Offline — playable',
    detail: 'Waiting for the desktop service.',
    writesEnabled: false,
  });

  useEffect(() => {
    void window.tenure.versions().then(setVersions);
    void window.tenure.syncStatus().then(setSync);
    void window.tenure.environment().then(setEnvironment);
    void window.tenure.listCheckpoints().then(setCheckpoints);
  }, []);

  const restore = async (checkpointId: string) => {
    try {
      const result = await window.tenure.restoreCheckpoint(checkpointId);
      if (!result.restored) return;
      setRecoveryMessage(`Restored checkpoint. Safety copy: ${result.safetyCopyPath}`);
      setCheckpoints(await window.tenure.listCheckpoints());
    } catch (error) {
      setRecoveryMessage(`Restore failed: ${(error as Error).message}`);
    }
  };

  const exportDiagnostics = async () => {
    try {
      const result = await window.tenure.exportDiagnostics();
      if (!result.cancelled) setRecoveryMessage(`Diagnostic bundle exported to ${result.path ?? ''}`);
    } catch (error) {
      setRecoveryMessage(`Diagnostic export failed: ${(error as Error).message}`);
    }
  };

  const browse = async (kind: 'game' | 'liveEditor') => {
    const detected = kind === 'game'
      ? await window.tenure.browseForGame()
      : await window.tenure.browseForLiveEditor();
    setEnvironment(detected);
    setSync(await window.tenure.syncStatus());
    setBridgePreview(null);
  };

  const previewBridge = async () => {
    try {
      setBridgePreview(await window.tenure.previewBridgeInstall());
      setRecoveryMessage('Review every bridge-file change before installing.');
    } catch (error) {
      setRecoveryMessage(`Bridge preview failed: ${(error as Error).message}`);
    }
  };

  const installBridge = async (allowUserModified: boolean) => {
    try {
      const result = await window.tenure.applyBridgeInstall(allowUserModified);
      setRecoveryMessage(
        `Bridge install: ${result.created} created, ${result.updated} updated, ` +
        `${result.unchanged} unchanged, ${result.overwrittenConflicts} conflict(s) overwritten.`,
      );
      setBridgePreview(null);
    } catch (error) {
      setRecoveryMessage(`Bridge install failed: ${(error as Error).message}`);
    }
  };

  return (
    <div className="shell">
      <aside className="rail">
        <div className="wordmark">TENURE<span>club office</span></div>
        <nav aria-label="Primary">
          <button className={screen === 'squad' ? 'active' : ''} onClick={() => setScreen('squad')}>
            Squad
          </button>
          <button className={screen === 'result' ? 'active' : ''} onClick={() => setScreen('result')}>
            Result
          </button>
          <button className={screen === 'doctor' ? 'active' : ''} onClick={() => setScreen('doctor')}>
            Sync Doctor
          </button>
        </nav>
        <p className="rail-note">Read-only foundation build</p>
      </aside>
      <main>
        <button className={`sync-strip ${sync.state}`} onClick={() => setScreen('doctor')}>
          <strong>{sync.label}</strong><span>{sync.detail}</span>
        </button>
        {screen === 'squad' && <Squad />}
        {screen === 'result' && <Result />}
        {screen === 'doctor' && (
          <Doctor
            sync={sync}
            versions={versions}
            environment={environment}
            bridgePreview={bridgePreview}
            checkpoints={checkpoints}
            recoveryMessage={recoveryMessage}
            onRestore={restore}
            onExportDiagnostics={exportDiagnostics}
            onBrowse={browse}
            onPreviewBridge={previewBridge}
            onInstallBridge={installBridge}
          />
        )}
      </main>
    </div>
  );
}

function Squad() {
  return (
    <section className="paper">
      <header>
        <p className="eyebrow">First team · as of schema fixture</p>
        <h1>Squad register</h1>
        <p className="lede">Ranges remain ranges until scouting or FC provides reliable evidence.</p>
      </header>
      <div className="notice">Sample presentation data — live import is intentionally locked pending the Phase 0 schema dump.</div>
      <table>
        <thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>Ability</th><th>Fitness</th><th>Form</th><th>Contract</th></tr></thead>
        <tbody>{sampleSquad.map((row) => (
          <tr key={row[0]}>{row.map((cell, index) => <td key={cell} className={index > 1 ? 'number' : ''}>{cell}</td>)}</tr>
        ))}</tbody>
      </table>
    </section>
  );
}

function Result() {
  return (
    <section className="paper narrow">
      <header>
        <p className="eyebrow">Post-match review</p>
        <h1>Nothing commits unseen.</h1>
        <p className="lede">A before/after snapshot pair will appear here for confirmation or correction.</p>
      </header>
      <div className="result-card">
        <span>Home</span><strong>— : —</strong><span>Away</span>
      </div>
      <div className="notice">Match extraction is blocked until a real recorded schema fixture exists. Manual entry remains the designed fallback.</div>
      <div className="actions"><button disabled>Confirm import</button><button className="secondary">Enter manually</button></div>
    </section>
  );
}

interface DoctorProps {
  readonly sync: SyncStatus;
  readonly versions: VersionSurface | null;
  readonly environment: EnvironmentSummary | null;
  readonly bridgePreview: BridgeInstallPreview | null;
  readonly checkpoints: readonly CheckpointSummary[];
  readonly recoveryMessage: string;
  readonly onRestore: (checkpointId: string) => Promise<void>;
  readonly onExportDiagnostics: () => Promise<void>;
  readonly onBrowse: (kind: 'game' | 'liveEditor') => Promise<void>;
  readonly onPreviewBridge: () => Promise<void>;
  readonly onInstallBridge: (allowUserModified: boolean) => Promise<void>;
}

function Doctor({
  sync,
  versions,
  environment,
  bridgePreview,
  checkpoints,
  recoveryMessage,
  onRestore,
  onExportDiagnostics,
  onBrowse,
  onPreviewBridge,
  onInstallBridge,
}: DoctorProps) {
  const checks = [
    ['Desktop shell', 'ok', 'Typed preload boundary active'],
    ['SQLite runtime', versions?.sqliteAvailable ? 'ok' : 'error', versions?.sqliteAvailable ? 'node:sqlite available' : 'Bundled runtime lacks node:sqlite'],
    ['FC + Live Editor', 'warning', sync.detail],
    ['Career schema', 'warning', 'Real schema fixture has not been recorded'],
    ['Writes', 'ok', 'Disabled by policy through Phase 2'],
  ] as const;
  return (
    <section className="paper">
      <header>
        <p className="eyebrow">Recovery and support</p>
        <h1>Sync Doctor</h1>
        <p className="lede">Every blocked path names its cause and leaves the career playable.</p>
      </header>
      <div className="checks">{checks.map(([name, state, detail]) => (
        <article key={name} className={`check ${state}`}>
          <span className="state-mark" aria-label={state}>{state === 'ok' ? '✓' : state === 'warning' ? '!' : '×'}</span>
          <div><strong>{name}</strong><p>{detail}</p></div>
        </article>
      ))}</div>
      <div className="versions">
        <span>app {versions?.app ?? '…'}</span>
        <span>save schema {versions?.saveSchema ?? '…'}</span>
        <span>bridge {versions?.bridgeProtocol ?? '…'}</span>
        <span>manifest {versions?.compatibilityManifest ?? '…'}</span>
      </div>
      <section className="environment">
        <div className="section-heading">
          <div><p className="eyebrow">Local integration</p><h2>FC environment</h2></div>
          <button className="secondary" onClick={() => void onPreviewBridge()}>
            Preview bridge install
          </button>
        </div>
        <div className="path-row">
          <div>
            <strong>EA Sports FC 26</strong>
            <p>{environment?.gamePath ?? 'Not found'}{environment?.gameBuild ? ` · ${environment.gameBuild}` : ''}</p>
          </div>
          <button onClick={() => void onBrowse('game')}>Browse</button>
        </div>
        <div className="path-row">
          <div>
            <strong>FC Live Editor</strong>
            <p>{environment?.liveEditorPath ?? 'Not found'}</p>
          </div>
          <button onClick={() => void onBrowse('liveEditor')}>Browse</button>
        </div>
        {environment?.problem ? <p className="recovery-message">{environment.problem}</p> : null}
        {bridgePreview ? (
          <div className="bridge-preview">
            {bridgePreview.files.map((file) => (
              <details key={file.relativePath}>
                <summary><span>{file.relativePath}</span><em>{file.action}</em></summary>
                {file.diff ? <pre>{file.diff}</pre> : <p>No change.</p>}
              </details>
            ))}
            <div className="actions">
              <button onClick={() => void onInstallBridge(false)}>
                Install reviewed changes
              </button>
              {bridgePreview.hasConflicts ? (
                <button className="danger" onClick={() => void onInstallBridge(true)}>
                  Overwrite modified files
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
      <section className="recovery">
        <div className="section-heading">
          <div><p className="eyebrow">Verified recovery points</p><h2>Checkpoints</h2></div>
          <button className="secondary" onClick={() => void onExportDiagnostics()}>
            Export diagnostics
          </button>
        </div>
        {checkpoints.length === 0
          ? <p className="empty">No checkpoints yet. Tenure creates one before every irreversible action.</p>
          : checkpoints.map((checkpoint) => (
            <article className="checkpoint" key={checkpoint.id}>
              <div>
                <strong>{checkpoint.label}</strong>
                <p>{new Date(checkpoint.createdAt).toLocaleString()} · {checkpoint.verified ? 'verified' : 'failed verification'}</p>
              </div>
              <button
                disabled={!checkpoint.verified}
                onClick={() => void onRestore(checkpoint.id)}
              >
                Restore
              </button>
            </article>
          ))}
        <p className="recovery-message" aria-live="polite">{recoveryMessage}</p>
      </section>
    </section>
  );
}
