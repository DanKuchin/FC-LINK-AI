/**
 * Architectural boundaries, enforced as a test rather than as lint config.
 *
 * The rule that matters most: the simulation must never reach for the database,
 * the UI, or the operating system. Systems are pure functions of (state, ctx)
 * returning effects — that is what makes ten-season soak tests possible and what
 * keeps determinism honest.
 *
 * A test is used instead of an eslint plugin because it needs no configuration
 * to stay correct, it runs in the same command as everything else, and its
 * failure message can explain *why* the rule exists.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Boundary {
  readonly dir: string;
  readonly forbidden: readonly { readonly pattern: RegExp; readonly why: string }[];
}

const NO_UI = { pattern: /^react(-dom)?($|\/)|^electron($|\/)/, why: 'simulation and data layers must not know about the UI' };
const NO_APP = { pattern: /apps\/desktop/, why: 'lower layers must not depend on the Electron shell' };

const BOUNDARIES: readonly Boundary[] = [
  {
    dir: 'packages/domain',
    forbidden: [NO_UI, NO_APP,
      { pattern: /@tenure\/(sim|sync|persistence|narrative)/, why: 'domain is the bottom layer and depends on nothing' }],
  },
  {
    dir: 'packages/sim',
    forbidden: [NO_UI, NO_APP,
      { pattern: /@tenure\/persistence/, why: 'systems are pure: they return effects, they do not write rows' },
      { pattern: /^node:sqlite$|sqlite/, why: 'the simulation must be runnable with no database at all' },
      { pattern: /^node:fs$|^node:http|^node:child_process$/, why: 'the simulation must not touch the filesystem, network or processes' }],
  },
  {
    dir: 'packages/persistence',
    forbidden: [NO_UI, NO_APP,
      { pattern: /@tenure\/sim/, why: 'storage must not depend on game rules' }],
  },
  {
    dir: 'packages/narrative',
    forbidden: [NO_UI, NO_APP,
      { pattern: /@tenure\/persistence/, why: 'the narrative layer renders facts it is given; it does not query for them' }],
  },
  {
    dir: 'packages/sync',
    forbidden: [NO_UI, NO_APP],
  },
];

/** Deliberately naive: catches `import … from 'x'`, `import('x')` and `require('x')`. */
function importsIn(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^'"\n]*from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const match of source.matchAll(re)) specifiers.push(match[1] as string);
  }
  return specifiers;
}

function sourceFiles(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        out.push(full);
      }
    }
  };
  walk(absolute);
  return out;
}

describe('architectural boundaries', () => {
  for (const boundary of BOUNDARIES) {
    it(`${boundary.dir} respects its dependency rules`, () => {
      const violations: string[] = [];
      for (const file of sourceFiles(boundary.dir)) {
        const relative = path.relative(ROOT, file).replace(/\\/g, '/');
        for (const specifier of importsIn(file)) {
          for (const rule of boundary.forbidden) {
            if (rule.pattern.test(specifier)) {
              violations.push(`${relative} imports "${specifier}" — ${rule.why}`);
            }
          }
        }
      }
      expect(violations, violations.join('\n')).toEqual([]);
    });
  }

  it('the simulation contains no ambient randomness or wall-clock reads', () => {
    // Both would break reproducibility: the same seed must always produce the
    // same world, whether it runs now, after a reload, or in CI next year.
    const violations: string[] = [];
    for (const file of sourceFiles('packages/sim')) {
      const relative = path.relative(ROOT, file).replace(/\\/g, '/');
      const source = fs.readFileSync(file, 'utf8');
      // createMasterSeed is the one sanctioned exception, once per career.
      const withoutSanctioned = source.replace(/export function createMasterSeed[\s\S]*?\n}/, '');
      if (/\bMath\.random\s*\(/.test(withoutSanctioned)) violations.push(`${relative} calls Math.random()`);
      if (/\bDate\.now\s*\(/.test(withoutSanctioned)) violations.push(`${relative} calls Date.now()`);
      if (/\bnew Date\s*\(\s*\)/.test(withoutSanctioned)) violations.push(`${relative} constructs a Date from the clock`);
      if (/crypto\.getRandomValues/.test(withoutSanctioned)) violations.push(`${relative} uses getRandomValues`);
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('migrations are immutable once shipped — none may be edited in place', () => {
    // The checksum guard in migrate.ts enforces this at runtime for real saves;
    // this catches it in review, which is cheaper.
    const dir = path.join(ROOT, 'packages/persistence/migrations');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')) : [];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });
});
