import { useEffect, useState } from 'react';
import type {
  BridgeInstallPreview,
  CheckpointSummary,
  CompatibilityManifestSummary,
  DoctorConditionView,
  EnvironmentSummary,
  FixturePlayer,
  ManualResultCommit,
  ManualResultPlayerLine,
  MatchPrepState,
  PendingFixture,
  PostMatchCheckpointIssue,
  SquadPlayerView,
  SquadView,
  SyncStatus,
  VersionSurface,
} from '../shared/ipc.js';

type Screen = 'squad' | 'prepare' | 'result' | 'doctor';

const sampleSquad: readonly SquadPlayerView[] = [
  {
    id: -1,
    name: 'M. Hale',
    position: 'GK',
    age: 29,
    abilityLow: 78,
    abilityHigh: 81,
    potentialLow: 78,
    potentialHigh: 82,
    fitness: 100,
    form: 61,
    morale: 72,
    contractEnd: Math.floor(Date.UTC(2028, 5, 30) / 86_400_000),
    squadRole: 'important',
    wage: null,
    wageEstimated: false,
    personality: null,
  },
  {
    id: -2,
    name: 'J. Okafor',
    position: 'CB',
    age: 24,
    abilityLow: 75,
    abilityHigh: 79,
    potentialLow: 80,
    potentialHigh: 85,
    fitness: 92,
    form: 68,
    morale: 75,
    contractEnd: Math.floor(Date.UTC(2029, 5, 30) / 86_400_000),
    squadRole: 'rotation',
    wage: null,
    wageEstimated: false,
    personality: null,
  },
  {
    id: -3,
    name: 'R. Santos',
    position: 'CM',
    age: 21,
    abilityLow: 71,
    abilityHigh: 80,
    potentialLow: 82,
    potentialHigh: 89,
    fitness: 86,
    form: 73,
    morale: 81,
    contractEnd: Math.floor(Date.UTC(2027, 5, 30) / 86_400_000),
    squadRole: 'prospect',
    wage: null,
    wageEstimated: false,
    personality: null,
  },
  {
    id: -4,
    name: 'A. Mercer',
    position: 'ST',
    age: 27,
    abilityLow: 80,
    abilityHigh: 82,
    potentialLow: 80,
    potentialHigh: 83,
    fitness: 74,
    form: 78,
    morale: 66,
    contractEnd: Math.floor(Date.UTC(2028, 5, 30) / 86_400_000),
    squadRole: 'crucial',
    wage: null,
    wageEstimated: false,
    personality: null,
  },
];

export function App() {
  const [screen, setScreen] = useState<Screen>('squad');
  const [versions, setVersions] = useState<VersionSurface | null>(null);
  const [checkpoints, setCheckpoints] = useState<readonly CheckpointSummary[]>([]);
  const [environment, setEnvironment] = useState<EnvironmentSummary | null>(null);
  const [bridgePreview, setBridgePreview] = useState<BridgeInstallPreview | null>(null);
  const [doctorConditions, setDoctorConditions] = useState<readonly DoctorConditionView[]>([]);
  const [squad, setSquad] = useState<SquadView | null>(null);
  const [manifest, setManifest] = useState<CompatibilityManifestSummary | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [sync, setSync] = useState<SyncStatus>({
    state: 'offline',
    label: 'Offline — playable',
    detail: 'Waiting for the desktop service.',
    writesEnabled: false,
  });

  const refreshSync = async () => {
    const [status, conditions] = await Promise.all([
      window.tenure.syncStatus(),
      window.tenure.doctorConditions(),
    ]);
    setSync(status);
    setDoctorConditions(conditions);
  };

  useEffect(() => {
    void window.tenure.versions().then(setVersions);
    void refreshSync();
    void window.tenure.environment().then(setEnvironment);
    void window.tenure.squad().then(setSquad);
    void window.tenure.compatibilityManifest().then(setManifest);
    void window.tenure.listCheckpoints().then(setCheckpoints);
    const refreshTimer = globalThis.setInterval(() => void refreshSync(), 3_000);
    return () => globalThis.clearInterval(refreshTimer);
  }, []);

  const restore = async (checkpointId: string) => {
    try {
      const result = await window.tenure.restoreCheckpoint(checkpointId);
      if (!result.restored) return;
      setRecoveryMessage(`Restored checkpoint. Safety copy: ${result.safetyCopyPath}`);
      setCheckpoints(await window.tenure.listCheckpoints());
      setSquad(await window.tenure.squad());
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
    await refreshSync();
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

  const installCompatibilityManifest = async () => {
    try {
      const result = await window.tenure.installCompatibilityManifest();
      setManifest(result.status);
      if (result.cancelled) return;
      setVersions(await window.tenure.versions());
      await refreshSync();
      setRecoveryMessage(
        `Compatibility manifest ${result.status.updatedAt} installed from the selected file.`,
      );
    } catch (error) {
      setRecoveryMessage(
        `Compatibility manifest rejected: ${(error as Error).message}`,
      );
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
        {screen === 'squad' && <Squad data={squad} />}
        {screen === 'prepare' && <MatchPrep onCheckpoint={refreshCheckpoints} />}
        {screen === 'result' && <Result onCommitted={refreshCheckpoints} />}
        {screen === 'doctor' && (
          <Doctor
            sync={sync}
            conditions={doctorConditions}
            manifest={manifest}
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
            onRetest={refreshSync}
            onInstallManifest={installCompatibilityManifest}
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

export type SquadSortKey =
  | 'name'
  | 'position'
  | 'age'
  | 'ability'
  | 'fitness'
  | 'contract';
type Density = 'comfortable' | 'compact' | 'dense';

function range(low: number | null, high: number | null): string {
  if (low === null || high === null) return '—';
  return low === high ? String(low) : `${low}–${high}`;
}

function contractYear(day: number | null): string {
  if (day === null) return '—';
  return String(new Date(day * 86_400_000).getUTCFullYear());
}

function sortValue(player: SquadPlayerView, key: SquadSortKey): string | number {
  if (key === 'name') return player.name;
  if (key === 'position') return player.position;
  if (key === 'age') return player.age;
  if (key === 'ability') return player.abilityLow ?? -1;
  if (key === 'fitness') return player.fitness ?? -1;
  return player.contractEnd ?? Number.MAX_SAFE_INTEGER;
}

export function sortSquadPlayers(
  players: readonly SquadPlayerView[],
  key: SquadSortKey,
  ascending: boolean,
): SquadPlayerView[] {
  return [...players].sort((left, right) => {
    const a = sortValue(left, key);
    const b = sortValue(right, key);
    const order = typeof a === 'string' && typeof b === 'string'
      ? a.localeCompare(b)
      : Number(a) - Number(b);
    return ascending ? order : -order;
  });
}

export function Squad({ data }: { readonly data: SquadView | null }) {
  const [sortKey, setSortKey] = useState<SquadSortKey>('position');
  const [ascending, setAscending] = useState(true);
  const [density, setDensity] = useState<Density>('comfortable');
  const players = data?.source === 'career' ? data.players : sampleSquad;
  const [selectedId, setSelectedId] = useState(players[0]?.id ?? null);
  const selected = players.find((player) => player.id === selectedId) ?? players[0] ?? null;
  const sorted = sortSquadPlayers(players, sortKey, ascending);

  const chooseSort = (key: SquadSortKey) => {
    if (sortKey === key) setAscending((current) => !current);
    else {
      setSortKey(key);
      setAscending(true);
    }
  };
  const heading = (key: SquadSortKey, label: string) => (
    <th aria-sort={sortKey === key ? (ascending ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => chooseSort(key)}>{label}</button>
    </th>
  );

  return (
    <section className="paper" data-density={density}>
      <header>
        <p className="eyebrow">
          {data?.source === 'career'
            ? `${data.clubName ?? 'Managed club'} · career day ${data.currentDate ?? 'unknown'}`
            : 'First team · presentation fixture'}
        </p>
        <h1>Squad register</h1>
        <p className="lede">Ranges remain ranges until scouting or FC provides reliable evidence.</p>
      </header>
      {data?.source !== 'career' ? (
        <div className="notice">
          Sample presentation data — the internal career adapter is ready, while live FC import
          remains locked pending the Phase 0 schema dump.
        </div>
      ) : null}
      <div className="squad-toolbar">
        <span>{players.length} active player{players.length === 1 ? '' : 's'}</span>
        <label>
          Density
          <select value={density} onChange={(event) => setDensity(event.target.value as Density)}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
            <option value="dense">Dense</option>
          </select>
        </label>
      </div>
      <div className="squad-layout">
        <div className="squad-table">
          <table>
            <caption className="sr-only">Managed first-team squad</caption>
            <thead>
              <tr>
                {heading('name', 'Player')}
                {heading('position', 'Pos')}
                {heading('age', 'Age')}
                {heading('ability', 'Ability')}
                {heading('fitness', 'Fitness')}
                <th>Form</th>
                {heading('contract', 'Contract')}
              </tr>
            </thead>
            <tbody>{sorted.map((player) => (
              <tr key={player.id} className={selected?.id === player.id ? 'selected' : ''}>
                <td>
                  <button
                    className="player-link"
                    aria-pressed={selected?.id === player.id}
                    onClick={() => setSelectedId(player.id)}
                  >
                    {player.name}
                  </button>
                </td>
                <td>{player.position}</td>
                <td className="number">{player.age}</td>
                <td className="number">{range(player.abilityLow, player.abilityHigh)}</td>
                <td className="number">{player.fitness ?? '—'}</td>
                <td className="number">{player.form ?? '—'}</td>
                <td className="number">{contractYear(player.contractEnd)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <aside className="player-profile" aria-live="polite">
          {selected === null ? <p>No player is available.</p> : (
            <>
              <p className="eyebrow">Player profile</p>
              <h2>{selected.name}</h2>
              <p>{selected.position} · age {selected.age}</p>
              <dl>
                <div><dt>Ability</dt><dd>{range(selected.abilityLow, selected.abilityHigh)}</dd></div>
                <div><dt>Potential</dt><dd>{range(selected.potentialLow, selected.potentialHigh)}</dd></div>
                <div><dt>Fitness</dt><dd>{selected.fitness ?? 'Unknown'}</dd></div>
                <div><dt>Morale</dt><dd>{selected.morale ?? 'Unknown'}</dd></div>
                <div><dt>Role</dt><dd>{selected.squadRole ?? 'Unrecorded'}</dd></div>
                <div><dt>Contract</dt><dd>{contractYear(selected.contractEnd)}</dd></div>
              </dl>
              <h3>Personality</h3>
              {selected.personality === null ? (
                <p className="empty">Not generated for this player yet.</p>
              ) : (
                <dl>
                  {Object.entries(selected.personality)
                    .filter(([trait]) => trait !== 'seed')
                    .map(([trait, value]) => (
                      <div key={trait}>
                        <dt>{trait.replace('_', ' ')}</dt>
                        <dd className="number">{value}</dd>
                      </div>
                    ))}
                </dl>
              )}
            </>
          )}
        </aside>
      </div>
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
  const [checkpointIssues, setCheckpointIssues] = useState<
    readonly PostMatchCheckpointIssue[]
  >([]);

  const reloadFixtures = async () => {
    const pending = await window.tenure.pendingFixtures();
    setFixtures(pending);
    setFixtureId((current) =>
      current !== null && pending.some((fixture) => fixture.id === current)
        ? current
        : (pending[0]?.id ?? null));
  };

  const reloadCheckpointIssues = async () => {
    setCheckpointIssues(await window.tenure.postMatchCheckpointIssues());
  };

  useEffect(() => {
    void Promise.all([reloadFixtures(), reloadCheckpointIssues()]);
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
    let result: ManualResultCommit;
    try {
      result = await window.tenure.commitManualResult({
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
    } catch (error) {
      setMessage(`Result was not committed: ${(error as Error).message}`);
      return;
    }

    const committedMessage = result.checkpointState === 'created'
      ? `Result ${result.matchResultId} confirmed as user-entered. ` +
        `Post-match checkpoint ${result.checkpointId} is verified.`
      : result.warning ??
        `Result ${result.matchResultId} was committed, but its checkpoint needs retrying. ` +
        'Do not enter the score again.';
    setMessage(committedMessage);
    setConfirmed(false);
    try {
      await Promise.all([reloadFixtures(), reloadCheckpointIssues(), onCommitted()]);
    } catch (error) {
      setMessage(
        `${committedMessage} The screen could not refresh: ${(error as Error).message}`,
      );
    }
  };

  const retryCheckpoint = async (matchResultId: number) => {
    try {
      const result = await window.tenure.retryPostMatchCheckpoint(matchResultId);
      setCheckpointIssues((current) =>
        current.filter((issue) => issue.matchResultId !== matchResultId));
      setMessage(
        `Post-match checkpoint ${result.checkpointId} is now verified for ` +
        `result ${result.matchResultId}.`,
      );
      await Promise.all([reloadCheckpointIssues(), onCommitted()]);
    } catch (error) {
      setMessage(
        `Result ${matchResultId} remains committed, but checkpoint retry failed: ` +
        `${(error as Error).message}`,
      );
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
      {checkpointIssues.map((issue) => (
        <div className="notice" key={issue.matchResultId}>
          Result {issue.matchResultId} for fixture {issue.fixtureId} is committed,
          but its post-match checkpoint is {issue.state}.
          {issue.lastError === null ? null : <> Last error: {issue.lastError}</>}
          <div className="actions">
            <button onClick={() => void retryCheckpoint(issue.matchResultId)}>
              Retry post-match checkpoint
            </button>
          </div>
        </div>
      ))}
      <p className="recovery-message" aria-live="polite">{message}</p>
    </section>
  );
}

interface DoctorProps {
  readonly sync: SyncStatus;
  readonly conditions: readonly DoctorConditionView[];
  readonly manifest: CompatibilityManifestSummary | null;
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
  readonly onRetest: () => Promise<void>;
  readonly onInstallManifest: () => Promise<void>;
}

function Doctor({
  sync,
  conditions,
  manifest,
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
  onRetest,
  onInstallManifest,
}: DoctorProps) {
  return (
    <section className="paper">
      <header>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recovery and support</p>
            <h1>Sync Doctor</h1>
          </div>
          <button className="secondary" onClick={() => void onRetest()}>Re-test all</button>
        </div>
        <p className="lede">
          Twelve live checks read the desktop environment, Lua hello, active career,
          snapshots, mappings, and write history. Unknown evidence is never shown as healthy.
        </p>
      </header>
      <div className="checks">
        {conditions.length === 0 ? <p className="empty">Running live checks…</p> : null}
        {conditions.map((condition) => (
        <article
          key={condition.id}
          id={`doctor-${condition.id}`}
          className={`check ${condition.state}`}
        >
          <span className="state-mark" aria-label={condition.state}>
            {condition.state === 'ok' ? '✓' : condition.state === 'warning' ? '!' : '×'}
          </span>
          <div>
            <strong>{condition.title}</strong>
            <p>{condition.cause}</p>
            {condition.state !== 'ok' ? <p className="offer">{condition.offer}</p> : null}
          </div>
        </article>
      ))}</div>
      <div className="versions">
        <span>app {versions?.app ?? '…'}</span>
        <span>save schema {versions?.saveSchema ?? '…'}</span>
        <span>bridge {versions?.bridgeProtocol ?? '…'}</span>
        <span>manifest {versions?.compatibilityManifest ?? '…'}</span>
        <span>writes {sync.writesEnabled ? 'enabled' : 'disabled'}</span>
      </div>
      <section className="environment">
        <div className="section-heading">
          <div><p className="eyebrow">Local integration</p><h2>FC environment</h2></div>
          <div className="section-actions">
            <button className="secondary" onClick={() => void onInstallManifest()}>
              Import compatibility manifest
            </button>
            <button className="secondary" onClick={() => void onPreviewBridge()}>
              Preview bridge install
            </button>
          </div>
        </div>
        <div className="manifest-status">
          <strong>Compatibility manifest</strong>
          <p>
            {manifest?.updatedAt ?? 'checking'} · {manifest?.source ?? 'bundled'} source
          </p>
          {manifest?.problem ? <p className="recovery-message">{manifest.problem}</p> : null}
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
