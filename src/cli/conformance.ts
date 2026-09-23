#!/usr/bin/env node
// Writes a conformance report. Usage: node dist/cli/conformance.js <conformance dir> <report path>
// Exits 1 when any case did not pass or any rejection snapshot was not rejected.
import { writeFileSync } from 'node:fs';
import { runConformance } from '../conformance.js';

const [dir = 'vendor/cwa/conformance', out = 'conformance-report.json'] = process.argv.slice(2);
const report = runConformance(dir);
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
const count = (rows: { outcome: string }[], outcome: string) => rows.filter(row => row.outcome === outcome).length;
const rejections = report.rejections ?? [];
console.log(`${out}: ${count(report.cases, 'passed')}/${report.cases.length} cases passed, ` +
  `${count(rejections, 'rejected')}/${rejections.length} rejection snapshots rejected`);
for (const row of [...report.cases, ...rejections]) if (row.detail) console.log(`  ${row.id}: ${row.outcome}: ${row.detail}`);
process.exitCode = count(report.cases, 'passed') === report.cases.length && count(rejections, 'rejected') === rejections.length ? 0 : 1;
