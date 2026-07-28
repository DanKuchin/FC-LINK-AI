import { useEffect, useState } from 'react';
import type {
  BridgeInstallPreview,
  CheckpointSummary,
  EnvironmentSummary,
  FixturePlayer,
  ManualResultPlayerLine,
  MatchPrepState,
  PendingFixture,
  SyncStatus,
  VersionSurface,
} from '../shared/ipc.js';

type Screen = 'squad' | 'prepare' | 'result' | 'doctor';

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

  const refreshCheckpoints = async () => {
    setCheckpoints(await window.tenure.listCheckpoints());
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
          <button className={screen === 'prepare' ? 'active' : ''} onClick={() => setScreen('prepare')}>
            Match prep
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
        {screen === 'prepare' && <MatchPrep onCheckpoint={refreshCheckpoints} />}
        {screen === 'result' && <Result onCommitted={refreshCheckpoints} />}
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

function MatchPrep({ onCheckpoint }: { readonly onCheckpoint: () => Promise<void> }) {
  const [manualMode, setManualMode] = useState(false);
  const [state, setState] = useState<MatchPrepState | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void window.tenure.matchPrepState(manualMode).then(setState);
  }, [manualMode]);

  const checkpoint = async () => {
    try {
      setState(await window.tenure.createPreMatchCheckpoint(manualMode));
      await onCheckpoint();
      setMessage('Verified pre-match checkpoint created.');
    } catch (error) {
      setMessage(`Checkpoint failed: ${(error as Error).message}`);
    }
  };

  return (
    <section className="paper narrow">
      <header>
        <p className="eyebrow">Match preparation</p>
        <h1>Protect the evidence.</h1>
        <p className="lede">FC launch authorization requires a verified recovery point and either a current snapshot or an explicit manual-result choice.</p>
      </header>
      <div className="checks">
        <article className={`check ${state?.checkpointVerified ? 'ok' : 'warning'}`}>
          <span className="state-mark">{state?.checkpointVerified ? '✓' : '!'}</span>
          <div><strong>Pre-match checkpoint</strong><p>{state?.checkpointVerified ? 'Verified for the current career day.' : 'Create the recovery point before launch.'}</p></div>
          <button className="secondary" onClick={() => void checkpoint()}>Create checkpoint</button>
        </article>
        <article className={`check ${state?.snapshotState === 'ready' ? 'ok' : 'warning'}`}>
          <span className="state-mark">{state?.snapshotState === 'ready' ? '✓' : '!'}</span>
          <div><strong>Snapshot evidence</strong><p>{state?.snapshotState ?? 'checking'} — {state?.decision.reason}</p></div>
        </article>
      </div>
      <label className="confirm-line">
        <input type="checkbox" checked={manualMode} onChange={(event) => setManualMode(event.target.checked)} />
        Use manual-result mode for this match. I understand no snapshot-derived player lines will be claimed.
      </label>
      <div className="launch-decision">
        <strong>{state?.decision.allowed ? 'Launch gate cleared' : 'Launch blocked'}</strong>
        <p>{state?.decision.reason}</p>
        {state !== null && !state.decision.allowed ? <p>{state.decision.action}</p> : null}
      </div>
      <button
        className="launch-button"
        disabled={!state?.decision.allowed}
        onClick={() => setMessage(
          'Launch authorization recorded. Start FC with the configured Live Editor launcher.',
        )}
      >
        Continue to Live Editor
      </button>
      <p className="recovery-message" aria-live="polite">{message}</p>
    </section>
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

interface EditablePlayerLine extends FixturePlayer, ManualResultPlayerLine {}

function Result({ onCommitted }: { readonly onCommitted: () => Promise<void> }) {
  const [fixtures, setFixtures] = useState<readonly PendingFixture[]>([]);
  const [fixtureId, setFixtureId] = useState<number | null>(null);
  const [homeGoals, setHomeGoals] = useState('0');
  const [awayGoals, setAwayGoals] = useState('0');
  const [homePens, setHomePens] = useState('');
  const [awayPens, setAwayPens] = useState('');
  const [lines, setLines] = useState<readonly EditablePlayerLine[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');

  const reloadFixtures = async () => {
    const pending = await window.tenure.pendingFixtures();
    setFixtures(pending);
    setFixtureId((current) =>
      current !== null && pending.some((fixture) => fixture.id === current)
        ? current
        : (pending[0]?.id ?? null));
  };

  useEffect(() => {
    void reloadFixtures();
  }, []);

  useEffect(() => {
    if (fixtureId === null) {
      setLines([]);
      return;
    }
    void window.tenure.fixturePlayers(fixtureId).then((players) => {
      setLines(players.map((player) => ({
        ...player,
        playerId: player.id,
        appearances: 0,
        goals: 0,
        assists: 0,
        yellow: 0,
        red: 0,
        cleanSheet: 0,
        rating: null,
      })));
    });
  }, [fixtureId]);

  const updateLine = (playerId: number, patch: Partial<ManualResultPlayerLine>) => {
    setLines((current) => current.map((line) =>
      line.playerId === playerId ? { ...line, ...patch } : line));
  };

  const commit = async () => {
    if (fixtureId === null || !confirmed) return;
    try {
      const result = await window.tenure.commitManualResult({
        fixtureId,
        homeGoals: Number(homeGoals),
        awayGoals: Number(awayGoals),
        ...(homePens === '' ? {} : { homePens: Number(homePens) }),
        ...(awayPens === '' ? {} : { awayPens: Number(awayPens) }),
        playerLines: lines
          .filter((line) =>
            line.appearances === 1 ||
            line.goals > 0 ||
            line.assists > 0 ||
            line.yellow > 0 ||
            line.red > 0 ||
            line.cleanSheet === 1 ||
            line.rating !== null)
          .map((line) => ({
            playerId: line.playerId,
            appearances: line.appearances,
            goals: line.goals,
            assists: line.assists,
            yellow: line.yellow,
            red: line.red,
            cleanSheet: line.cleanSheet,
            rating: line.rating,
          })),
      });
      setMessage(
        `Result ${result.matchResultId} confirmed as user-entered. ` +
        `Checkpoint ${result.checkpointId} protects the previous state.`,
      );
      setConfirmed(false);
      await Promise.all([reloadFixtures(), onCommitted()]);
    } catch (error) {
      setMessage(`Result was not committed: ${(error as Error).message}`);
    }
  };

  const selected = fixtures.find((fixture) => fixture.id === fixtureId);
  return (
    <section className="paper">
      <header>
        <p className="eyebrow">Post-match review</p>
        <h1>Nothing commits unseen.</h1>
        <p className="lede">Enter the fallback record, review every line, then explicitly confirm it.</p>
      </header>
      {fixtures.length === 0 ? (
        <div className="notice">
          No pending fixtures exist in the active career. Imported fixtures will appear here;
          manual result entry remains available when offset reads fail.
        </div>
      ) : (
        <>
          <label className="field">Fixture
            <select value={fixtureId ?? ''} onChange={(event) => setFixtureId(Number(event.target.value))}>
              {fixtures.map((fixture) => (
                <option value={fixture.id} key={fixture.id}>
                  {fixture.homeClub} v {fixture.awayClub}
                </option>
              ))}
            </select>
          </label>
          <div className="score-entry">
            <label>{selected?.homeClub ?? 'Home'}
              <input type="number" min="0" max="99" value={homeGoals} onChange={(event) => setHomeGoals(event.target.value)} />
            </label>
            <strong>:</strong>
            <label>{selected?.awayClub ?? 'Away'}
              <input type="number" min="0" max="99" value={awayGoals} onChange={(event) => setAwayGoals(event.target.value)} />
            </label>
          </div>
          <details className="penalties"><summary>Add penalty shootout</summary>
            <div className="score-entry compact">
              <input aria-label="Home penalties" type="number" min="0" max="99" value={homePens} onChange={(event) => setHomePens(event.target.value)} />
              <strong>:</strong>
              <input aria-label="Away penalties" type="number" min="0" max="99" value={awayPens} onChange={(event) => setAwayPens(event.target.value)} />
            </div>
          </details>
          <div className="player-lines">
            <div className="line headings">
              <span>Player</span><span>Played</span><span>G</span><span>A</span><span>YC</span><span>RC</span><span>CS</span><span>Rating</span>
            </div>
            {lines.map((line) => (
              <div className="line" key={line.playerId}>
                <span>{line.name}<small>{line.side}</small></span>
                <input aria-label={`${line.name} played`} type="checkbox" checked={line.appearances === 1} onChange={(event) => updateLine(line.playerId, { appearances: event.target.checked ? 1 : 0 })} />
                {(['goals', 'assists', 'yellow', 'red'] as const).map((field) => (
                  <input key={field} aria-label={`${line.name} ${field}`} type="number" min="0" max="99" value={line[field]} onChange={(event) => updateLine(line.playerId, { [field]: Number(event.target.value) })} />
                ))}
                <input aria-label={`${line.name} clean sheet`} type="checkbox" checked={line.cleanSheet === 1} onChange={(event) => updateLine(line.playerId, { cleanSheet: event.target.checked ? 1 : 0 })} />
                <input aria-label={`${line.name} rating`} type="number" min="0" max="10" step="0.1" value={line.rating ?? ''} onChange={(event) => updateLine(line.playerId, { rating: event.target.value === '' ? null : Number(event.target.value) })} />
              </div>
            ))}
          </div>
          <label className="confirm-line">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I reviewed the score and player lines. Commit this as user-entered evidence.
          </label>
          <div className="actions"><button disabled={!confirmed} onClick={() => void commit()}>Confirm manual result</button></div>
        </>
      )}
      <p className="recovery-message" aria-live="polite">{message}</p>
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
