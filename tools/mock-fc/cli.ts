#!/usr/bin/env node

import os from 'node:os';
import path from 'node:path';
import { loadHandshake, loadScenario, replayScenario } from './replay.ts';

interface CliOptions {
  readonly scenario?: string;
  readonly handshake?: string;
  readonly dryRun: boolean;
}

function usage(): string {
  return [
    'TENURE mock FC bridge',
    '',
    'Usage:',
    '  pnpm mock-fc -- --scenario <scenario.json> [--handshake <handshake.json>]',
    '  pnpm mock-fc -- --scenario <scenario.json> --dry-run',
    '',
    'The handshake defaults to:',
    '  %LOCALAPPDATA%\\Tenure\\bridge\\handshake.json',
  ].join('\n');
}

function parseArgs(args: readonly string[]): CliOptions {
  let scenario: string | undefined;
  let handshake: string | undefined;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--scenario') {
      scenario = args[index + 1];
      index += 1;
    } else if (arg === '--handshake') {
      handshake = args[index + 1];
      index += 1;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${String(arg)}`);
    }
  }
  return {
    ...(scenario === undefined ? {} : { scenario }),
    ...(handshake === undefined ? {} : { handshake }),
    dryRun,
  };
}

function defaultHandshakePath(): string {
  const localAppData = process.env.LOCALAPPDATA ??
    path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Tenure', 'bridge', 'handshake.json');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.scenario === undefined) {
    throw new Error(`--scenario is required\n\n${usage()}`);
  }
  const scenarioFile = path.resolve(options.scenario);
  const scenario = loadScenario(scenarioFile);

  if (options.dryRun) {
    const snapshots = scenario.steps.filter((step) => step.kind === 'snapshot').length;
    console.log(JSON.stringify({
      ok: true,
      scenario: scenario.name,
      steps: scenario.steps.length,
      snapshots,
    }, null, 2));
    return;
  }

  const handshake = loadHandshake(path.resolve(options.handshake ?? defaultHandshakePath()));
  const result = await replayScenario(scenario, {
    handshake,
    scenarioFile,
    onProgress: (message) => console.log(`  ${message}`),
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mock-fc: ${message}`);
  process.exitCode = 1;
});
