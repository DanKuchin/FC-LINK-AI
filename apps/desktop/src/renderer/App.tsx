import { useEffect, useState } from 'react';
import type { SyncStatus, VersionSurface } from '../shared/ipc.js';

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
  const [sync, setSync] = useState<SyncStatus>({
    state: 'offline',
    label: 'Offline — playable',
    detail: 'Waiting for the desktop service.',
    writesEnabled: false,
  });

  useEffect(() => {
    void window.tenure.versions().then(setVersions);
    void window.tenure.syncStatus().then(setSync);
  }, []);

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
        {screen === 'doctor' && <Doctor sync={sync} versions={versions} />}
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

function Doctor({ sync, versions }: { sync: SyncStatus; versions: VersionSurface | null }) {
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
    </section>
  );
}
