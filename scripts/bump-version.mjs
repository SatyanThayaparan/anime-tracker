#!/usr/bin/env node
/**
 * Bump extension version in package.json + manifest.json together.
 *
 * Usage:
 *   npm run version:patch
 *   npm run version:minor
 *   npm run version:major
 *   node scripts/bump-version.mjs 1.3.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const manifestPath = join(root, 'manifest.json');

function parseArgs(argv) {
  const arg = argv[2] || 'patch';
  if (/^\d+\.\d+\.\d+$/.test(arg)) return { mode: 'exact', value: arg };
  if (['patch', 'minor', 'major'].includes(arg)) return { mode: arg };
  throw new Error(`Unknown bump arg "${arg}". Use patch|minor|major|x.y.z`);
}

function bump(version, mode) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (mode === 'major') return `${major + 1}.0.0`;
  if (mode === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const spec = parseArgs(process.argv);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const current = pkg.version || manifest.version || '0.0.0';
const next = spec.mode === 'exact' ? spec.value : bump(current, spec.mode);

pkg.version = next;
manifest.version = next;

writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Version: ${current} → ${next}`);
console.log('Updated package.json and manifest.json');
