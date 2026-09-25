#!/usr/bin/env node
/**
 * D1 binding guard — every database_id referenced in any worker wrangler.toml
 * must exist in the account. Exits non-zero otherwise.
 * This prevents silent "D1 database has been deleted" regressions.
 * Usage: node scripts/verify-d1.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const WORKERS = join(ROOT, 'workers');

const ids = new Set();
for (const dir of readdirSync(WORKERS)) {
  const toml = join(WORKERS, dir, 'wrangler.toml');
  if (!existsSync(toml)) continue;
  const content = readFileSync(toml, 'utf8');
  for (const m of content.matchAll(/database_id\s*=\s*"([0-9a-f-]+)"/g)) {
    ids.add(m[1]);
  }
}

const listOutput = execSync('npx wrangler d1 list', { cwd: ROOT, encoding: 'utf8' });
const liveIds = new Set([...listOutput.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map((m) => m[0]));

let missing = 0;
for (const id of ids) {
  if (!liveIds.has(id)) {
    console.error('✗ database_id ' + id + ' is NOT present in wrangler d1 list — deleted database!');
    missing += 1;
  } else {
    console.log(`  ✓ ${id}`);
  }
}

if (missing) {
  console.error(`\nD1 guard FAILED: ${missing} binding(s) point at missing databases.`);
  process.exit(1);
}
console.log(`D1 guard PASS — all ${ids.size} bound databases exist.`);