function tableRows(timing, name) {
  const table = timing?.tables?.find((entry) => entry.table === name);
  return typeof table?.rows === 'number' ? table.rows : null;
}

function validPersistenceCycle(cycle) {
  return Boolean(
    cycle &&
    cycle.recorder_version === 2 &&
    cycle.cycle_id &&
    cycle.career_loaded === true &&
    cycle.same_save_uid === true &&
    cycle.all_originals_restored === true &&
    Array.isArray(cycle.tests) &&
    cycle.tests.length > 0 &&
    cycle.tests.every((test) =>
      (test.status === 'PERSISTED' || test.status === 'REVERTED') &&
      test.restore_ok === true &&
      !test.error),
  );
}

function versionParts(value) {
  const parts = String(value ?? '').match(/\d+/g)?.map(Number) ?? [];
  return parts.length > 0 ? parts : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (a === null || b === null) return null;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function compatibleEnvironment(environment, leVersion) {
  if (
    environment?.recorder_version !== 2 ||
    environment?.platform !== 'win32' ||
    typeof environment?.game_build !== 'string' ||
    environment.game_build.length === 0 ||
    !Array.isArray(environment?.required_le_for_build) ||
    environment.required_le_for_build.length === 0 ||
    typeof leVersion !== 'string'
  ) {
    return false;
  }
  return environment.required_le_for_build.some(
    (required) => compareVersions(leVersion, required) === 0,
  );
}

export function gradePhaseZero(evidence) {
  const gates = [];
  const add = (id, name, state, detail) => gates.push({ id, name, state, detail });
  const persistenceHistory = Array.isArray(evidence.persistenceHistory)
    ? evidence.persistenceHistory
    : [];
  const validCycles = persistenceHistory.filter(validPersistenceCycle);
  const invalidCycles = persistenceHistory.length - validCycles.length;
  const versionedHellos = (evidence.helloHistory ?? [])
    .filter((entry) => entry?.recorder_version === 2);
  const helloUids = new Set(
    versionedHellos
      .filter((entry) => entry?.body?.in_career === true)
      .map((entry) => entry?.body?.save_uid)
      .filter((value) => typeof value === 'string' && value.length > 0),
  );
  const saveUid = helloUids.size === 1 ? [...helloUids][0] : null;
  const helloVersions = new Set(
    versionedHellos
      .map((entry) => entry?.body?.le_version)
      .filter((value) => typeof value === 'string' && value.length > 0),
  );
  const leVersion = helloVersions.size === 1 ? [...helloVersions][0] : null;
  const sameSave = (value) => saveUid !== null && value === saveUid;
  const sameLe = (value) =>
    leVersion !== null && compareVersions(value, leVersion) === 0;
  const sessionCycles = validCycles.filter((cycle) =>
    sameSave(cycle.save_uid) && sameLe(cycle.le_version));

  add(
    'environment',
    'Supported Windows FC / Live Editor pair detected',
    compatibleEnvironment(evidence.environment, leVersion)
      ? 'PASS'
      : evidence.environment || versionedHellos.length > 0 ? 'FAIL' : 'UNKNOWN',
    evidence.environment
      ? `build=${evidence.environment.game_build ?? '?'}, ` +
        `Live Editor=${leVersion ?? '?'}`
      : 'run spike detect and spike 01 on the Windows FC machine',
  );

  add(
    'schema',
    'Real schema captured',
    evidence.schemaMeta?.recorder_version === 2 &&
      evidence.schemaSummary?.recorder_version === 2 &&
      evidence.schemaSummary?.record === 'summary' &&
      evidence.schemaSummary.tables > 0 &&
      sameSave(evidence.schemaMeta.save_uid) &&
      sameLe(evidence.schemaMeta.le_version)
      ? 'PASS'
      : evidence.schemaMeta || evidence.schemaSummary ? 'FAIL' : 'UNKNOWN',
    evidence.schemaSummary
      ? `${evidence.schemaSummary.tables ?? 0} tables, ` +
        `${evidence.schemaSummary.total_rows_seen ?? 0} rows`
      : 'run spike 02',
  );

  add(
    'persistence',
    'Per-table persistence proven across a full restart',
    sessionCycles.length > 0 ? 'PASS' : persistenceHistory.length > 0 ? 'FAIL' : 'UNKNOWN',
    sessionCycles.length > 0
      ? `${sessionCycles[0].tests.length} table/field test(s) verified and restored`
      : persistenceHistory.length > 0
        ? 'persistence evidence is incomplete, crossed careers, or failed restoration'
        : 'run spikes 05 and 06',
  );

  const fixtureVerdict = evidence.fixtures?.verdict;
  const fixturesMatchSave =
    evidence.fixtures?.recorder_version === 2 &&
    sameSave(evidence.fixtures?.save_uid) &&
    sameLe(evidence.fixtures?.le_version);
  add(
    'fixtures',
    'Fixtures and standings probed on this build',
    fixtureVerdict === 'PASS' && fixturesMatchSave
      ? 'PASS'
      : fixtureVerdict === 'PASS_WITH_DOUBT' && fixturesMatchSave
        ? 'CONCERN'
        : evidence.fixtures
          ? 'FAIL'
          : 'UNKNOWN',
    evidence.fixtures
      ? `${fixtureVerdict ?? 'UNNAMED'}: ` +
        `${evidence.fixtures.checks?.fixtures_found ?? 0} fixture(s)`
      : 'run spike 04',
  );

  add(
    'match_diff',
    'One real played match extracted by snapshot diff',
    evidence.matchDiff?.recorder_version === 2 &&
      sameSave(evidence.matchDiff?.save_uid) &&
      sameLe(evidence.matchDiff?.le_version) &&
      evidence.matchDiff?.verified === true &&
      evidence.matchDiff?.played_match_count >= 1 &&
      evidence.matchDiff?.player_lines > 0
      ? 'PASS'
      : evidence.matchDiff
        ? 'FAIL'
        : 'UNKNOWN',
    evidence.matchDiff
      ? `${evidence.matchDiff.played_match_count ?? 0} match(es), ` +
        `${evidence.matchDiff.player_lines ?? 0} player line(s)`
      : 'record before/after exports and complete Ticket 26',
  );

  add(
    'transport',
    'HTTP works from the game process to loopback',
    versionedHellos.length > 0 ? 'PASS' : 'UNKNOWN',
    versionedHellos.length > 0
      ? `${versionedHellos.length} authenticated versioned hello request(s) recorded`
      : 'run spike 01 with the server active',
  );

  const players = tableRows(evidence.timing, 'players');
  const teams = tableRows(evidence.timing, 'teams');
  const projected = evidence.timing?.projected_full_import_ms ??
    evidence.timing?.export_total_ms;
  const costEvidenceComplete =
    evidence.timing?.recorder_version === 2 &&
    sameSave(evidence.timing?.save_uid) &&
    sameLe(evidence.timing?.le_version) &&
    typeof players === 'number' &&
    players >= 5_000 &&
    typeof projected === 'number';
  add(
    'snapshot_cost',
    'At least 5,000 players exported within the 90 s import budget',
    !costEvidenceComplete
      ? players !== null || projected != null ? 'FAIL' : 'UNKNOWN'
      : projected < 90_000 ? 'PASS' : 'FAIL',
    players === null || projected == null
      ? 'run spike 03 and retain timing.json'
      : `${players} players, ${teams ?? '?'} teams, ${(projected / 1_000).toFixed(1)} s projected`,
  );

  add(
    'transfer_write',
    'TransferPlayer write is durable with backup/restore proven first',
    evidence.transferWrite?.recorder_version === 2 &&
      sameSave(evidence.transferWrite?.save_uid) &&
      sameLe(evidence.transferWrite?.le_version) &&
      evidence.transferWrite?.durable === true &&
      evidence.transferWrite?.backup_restored === true
      ? 'PASS'
      : evidence.transferWrite
        ? 'FAIL'
        : 'UNKNOWN',
    evidence.transferWrite
      ? `durable=${Boolean(evidence.transferWrite.durable)}, ` +
        `backup_restored=${Boolean(evidence.transferWrite.backup_restored)}`
      : 'no supervised TransferPlayer proof recorded',
  );

  const stableUidCycle = sessionCycles.find((cycle) =>
    sameSave(cycle.save_uid));
  add(
    'stable_uid',
    'Career detected and save UID stable across a complete restart',
    stableUidCycle && helloUids.size === 1
      ? 'PASS'
      : sessionCycles.length > 0 || helloUids.size > 0 ? 'FAIL' : 'UNKNOWN',
    stableUidCycle
      ? `save UID matched hello and restart cycle ${stableUidCycle.cycle_id}`
      : 'requires matching hello and spike 06 restart evidence',
  );

  const playedFixtures = evidence.fixtures?.checks?.played_fixtures;
  add(
    'played_result',
    'One played result read back',
    fixturesMatchSave && typeof playedFixtures === 'number' && playedFixtures > 0
      ? 'PASS'
      : evidence.fixtures
        ? 'FAIL'
        : 'UNKNOWN',
    evidence.fixtures ? `${playedFixtures ?? 0} played fixture(s) found` : 'run spike 04',
  );

  const uniqueCycles = new Set(sessionCycles.map((cycle) => cycle.cycle_id));
  const cycleUids = new Set(sessionCycles.map((cycle) => cycle.save_uid));
  add(
    'clean_cycles',
    'Zero corruption across 20 write/save/restart/restore cycles',
    invalidCycles > 0
      ? 'FAIL'
      : uniqueCycles.size >= 20 && cycleUids.size === 1 && sameSave([...cycleUids][0])
        ? 'PASS'
        : persistenceHistory.length > 0
          ? 'CONCERN'
          : 'UNKNOWN',
    `${uniqueCycles.size}/20 valid unique cycle(s); ${invalidCycles} invalid`,
  );

  return {
    gates,
    proceed: gates.every((gate) => gate.state === 'PASS'),
  };
}
