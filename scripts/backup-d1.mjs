#!/usr/bin/env node
/**
 * D1 nightly backup — exports all capital-machine databases to infra/backups/.
 * Usage: node scripts/backup-d1.mjs          (export all 5)
 *        node scripts/backup-d1.mjs capital-db (export one)
 * Requires wrangler auth (CLOUDFLARE_API_TOKEN or wrangler login).
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BACKUP_DIR = join(ROOT, 'infra', 'backups');

const DBS = ['capital-db', 'revenue-db', 'entitlement-db', 'config-db', 'allocator-db'];
const targets = process.argv.slice(2).length ? process.argv.slice(2) : DBS;

mkdirSync(BACKUP_DIR, { recursive: true });

let failures = 0;
for (const db of targets) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join(BACKUP_DIR, `${db}-${stamp}.sql`);
  try {
    console.log(`Exporting ${db} → ${out}…`);
    execSync(`npx wrangler d1 export ${db} --remote --output="${out}"`, { stdio: 'inherit', cwd: ROOT });
    console.log(`  ✓ ${db} backed up`);
  } catch (e) {
    failures += 1;
    console.error(`  ✗ ${db} export failed: ${String(e.message ?? e).slice(0, 200)}`);
  }
}

if (failures) {
  console.error(`\nBackup FAILED for ${failures} database(s).`);
  process.exit(1);
}
console.log('\nAll databases backed up.');