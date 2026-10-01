// Copies the published CWA contract from a website checkout into vendor/cwa/ and pins every file by SHA-256
// in vendor/cwa.lock.json, with the website commit it came from. Usage: pnpm run vendor <website checkout>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor', 'cwa');
const LOCK = join(ROOT, 'vendor', 'cwa.lock.json');
// The contract an assembler needs: its license, schemas, contract data and the conformance cases.
const SOURCES = ['LICENSE', 'NOTICE', 'schema', 'contract/requirements.json', 'contract/reasons.json',
  'contract/slot-defaults.json', 'conformance/README.md', 'conformance/cases', 'conformance/rejections'];

const web = process.argv[2];
if (!web) {
  console.error('usage: pnpm run vendor <website checkout>');
  process.exit(2);
}
const git = (...args) => execFileSync('git', ['-C', web, ...args], { encoding: 'utf8' }).trim();
const walk = path => statSync(path).isDirectory()
  ? readdirSync(path).flatMap(name => walk(join(path, name)))
  : [path];

rmSync(VENDOR, { recursive: true, force: true });
const files = {};
for (const source of SOURCES) {
  for (const file of walk(join(web, source))) {
    const path = relative(web, file).split(sep).join('/');
    mkdirSync(dirname(join(VENDOR, path)), { recursive: true });
    cpSync(file, join(VENDOR, path));
    files[path] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
}
const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
// Dirty means a tracked file differs from the commit. Untracked files (an editor's or a tool's directory
// beside the contract) are not part of what the commit publishes, so they leave the flag alone.
const lock = { website_commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=no') !== '', files: sorted };
writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
console.log(`vendored ${Object.keys(sorted).length} files from ${lock.website_commit}${lock.dirty ? ' (dirty)' : ''}`);
