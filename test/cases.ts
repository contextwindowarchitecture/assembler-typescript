import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './root.js';

export const CONFORMANCE = join(ROOT, 'vendor', 'cwa', 'conformance');

export interface Case {
  id: string;
  rules: string[];
  snapshot: unknown;
  trace: Record<string, unknown>;
  payload: Buffer | null;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

export function loadCases(): Case[] {
  const dir = join(CONFORMANCE, 'cases');
  return readdirSync(dir).sort().map(id => {
    const payloadPath = join(dir, id, 'expected.payload.txt');
    return {
      id,
      rules: (readJson(join(dir, id, 'case.json')) as { rules: string[] }).rules,
      snapshot: readJson(join(dir, id, 'snapshot.json')),
      trace: readJson(join(dir, id, 'expected.trace.json')) as Record<string, unknown>,
      payload: existsSync(payloadPath) ? readFileSync(payloadPath) : null,
    };
  });
}

export function loadRejections(): { id: string; rules: string[]; snapshot: unknown }[] {
  const dir = join(CONFORMANCE, 'rejections');
  return readdirSync(dir).sort().map(id => ({
    id,
    rules: (readJson(join(dir, id, 'case.json')) as { rules: string[] }).rules,
    snapshot: readJson(join(dir, id, 'snapshot.json')),
  }));
}
