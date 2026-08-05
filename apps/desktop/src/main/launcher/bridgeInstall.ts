import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_NAME = '.tenure-manifest.json';
const SOURCE_DIRECTORIES = ['lib', 'readers', 'compat'] as const;

export type BridgeInstallAction = 'create' | 'update' | 'unchanged' | 'conflict';

export interface BridgeInstallFilePlan {
  readonly relativePath: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceChecksum: string;
  readonly currentChecksum: string | null;
  readonly previousChecksum: string | null;
  readonly action: BridgeInstallAction;
  readonly diff: string;
}

export interface BridgeInstallPlan {
  readonly sourceDirectory: string;
  readonly destinationDirectory: string;
  readonly manifestPath: string;
  readonly files: readonly BridgeInstallFilePlan[];
}

interface InstalledManifest {
  readonly format: 1;
  readonly installedAt: number;
  readonly files: Readonly<Record<string, string>>;
}

export interface ApplyBridgeInstallOptions {
  readonly installedAt: number;
  /** Explicit consent to replace a file whose contents no longer match our last install. */
  readonly allowUserModified?: boolean;
}

export interface BridgeInstallResult {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly overwrittenConflicts: number;
  readonly manifestPath: string;
}

function checksum(data: Buffer | string): string {
  return `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;
}

function fileChecksum(file: string): string | null {
  return fs.existsSync(file) ? checksum(fs.readFileSync(file)) : null;
}

function toRelativePath(root: string, file: string): string {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  if (relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`Bridge source escaped its root: ${file}`);
  }
  return relative;
}

function collectLuaFiles(sourceDirectory: string): string[] {
  const files: string[] = [];
  const entry = path.join(sourceDirectory, 'tenure_bridge.lua');
  if (!fs.existsSync(entry)) throw new Error(`Bridge entry point is missing: ${entry}`);
  files.push(entry);

  const walk = (directory: string) => {
    if (!fs.existsSync(directory)) return;
    for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, child.name);
      if (child.isDirectory()) walk(full);
      if (child.isFile() && child.name.endsWith('.lua')) files.push(full);
    }
  };
  for (const directory of SOURCE_DIRECTORIES) walk(path.join(sourceDirectory, directory));
  return files.sort((left, right) =>
    toRelativePath(sourceDirectory, left).localeCompare(toRelativePath(sourceDirectory, right)));
}

function readInstalledManifest(file: string): InstalledManifest | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<InstalledManifest>;
    if (parsed.format !== 1 || parsed.files === undefined || typeof parsed.files !== 'object') {
      return null;
    }
    return parsed as InstalledManifest;
  } catch {
    return null;
  }
}

function renderDiff(before: string | null, after: string): string {
  if (before === after) return '';
  const removed = before === null
    ? []
    : before.split(/\r?\n/).map((line) => `-${line}`);
  const added = after.split(/\r?\n/).map((line) => `+${line}`);
  return ['--- installed', '+++ proposed', ...removed, ...added].join('\n');
}

export function planBridgeInstall(
  sourceDirectory: string,
  liveEditorDirectory: string,
): BridgeInstallPlan {
  const destinationDirectory = path.join(liveEditorDirectory, 'lua', 'tenure');
  const manifestPath = path.join(destinationDirectory, MANIFEST_NAME);
  const previous = readInstalledManifest(manifestPath);
  const files = collectLuaFiles(sourceDirectory).map((sourcePath): BridgeInstallFilePlan => {
    const relativePath = toRelativePath(sourceDirectory, sourcePath);
    const targetPath = path.join(destinationDirectory, ...relativePath.split('/'));
    const sourceContent = fs.readFileSync(sourcePath, 'utf8');
    const sourceChecksum = checksum(sourceContent);
    const currentChecksum = fileChecksum(targetPath);
    const previousChecksum = previous?.files[relativePath] ?? null;
    let action: BridgeInstallAction;
    if (currentChecksum === null) action = 'create';
    else if (currentChecksum === sourceChecksum) action = 'unchanged';
    else if (previousChecksum !== null && currentChecksum === previousChecksum) action = 'update';
    else action = 'conflict';
    return {
      relativePath,
      sourcePath,
      targetPath,
      sourceChecksum,
      currentChecksum,
      previousChecksum,
      action,
      diff: renderDiff(
        currentChecksum === null ? null : fs.readFileSync(targetPath, 'utf8'),
        sourceContent,
      ),
    };
  });
  return { sourceDirectory, destinationDirectory, manifestPath, files };
}

function assertPlanStillMatches(plan: BridgeInstallPlan): void {
  for (const file of plan.files) {
    if (fileChecksum(file.sourcePath) !== file.sourceChecksum) {
      throw new Error(`Bridge source changed after preview: ${file.relativePath}`);
    }
    if (fileChecksum(file.targetPath) !== file.currentChecksum) {
      throw new Error(`Installed bridge changed after preview: ${file.relativePath}`);
    }
  }
}

export function applyBridgeInstall(
  plan: BridgeInstallPlan,
  options: ApplyBridgeInstallOptions,
): BridgeInstallResult {
  const conflicts = plan.files.filter((file) => file.action === 'conflict');
  if (conflicts.length > 0 && options.allowUserModified !== true) {
    throw new Error(
      `Refusing to overwrite user-modified bridge file(s): ` +
      conflicts.map((file) => file.relativePath).join(', '),
    );
  }
  assertPlanStillMatches(plan);
  fs.mkdirSync(plan.destinationDirectory, { recursive: true });

  const staged: { readonly temporary: string; readonly target: string }[] = [];
  try {
    for (const file of plan.files) {
      if (file.action === 'unchanged') continue;
      fs.mkdirSync(path.dirname(file.targetPath), { recursive: true });
      const temporary = `${file.targetPath}.tenure-installing`;
      fs.writeFileSync(temporary, fs.readFileSync(file.sourcePath), { mode: 0o600 });
      if (fileChecksum(temporary) !== file.sourceChecksum) {
        throw new Error(`Checksum verification failed while staging ${file.relativePath}`);
      }
      staged.push({ temporary, target: file.targetPath });
    }
    for (const file of staged) fs.renameSync(file.temporary, file.target);

    const manifest: InstalledManifest = {
      format: 1,
      installedAt: options.installedAt,
      files: Object.fromEntries(plan.files.map((file) => [file.relativePath, file.sourceChecksum])),
    };
    const temporaryManifest = `${plan.manifestPath}.tenure-installing`;
    fs.writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryManifest, plan.manifestPath);

    for (const file of plan.files) {
      if (fileChecksum(file.targetPath) !== file.sourceChecksum) {
        throw new Error(`Installed checksum does not match for ${file.relativePath}`);
      }
    }
  } finally {
    for (const file of staged) {
      if (fs.existsSync(file.temporary)) fs.rmSync(file.temporary, { force: true });
    }
  }

  return {
    created: plan.files.filter((file) => file.action === 'create').length,
    updated: plan.files.filter((file) => file.action === 'update').length,
    unchanged: plan.files.filter((file) => file.action === 'unchanged').length,
    overwrittenConflicts: conflicts.length,
    manifestPath: plan.manifestPath,
  };
}
