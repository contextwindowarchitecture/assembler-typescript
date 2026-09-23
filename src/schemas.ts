// Ajv 8 validators for the published JSON Schemas (draft 2020-12), compiled once from the embedded copies.
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import { SCHEMAS } from './generated/contract.js';

const BASE = 'https://contextwindowarchitecture.io/schema/';
// strictTypes is off because the published schemas use `properties` inside `if` without restating `type`.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
formats.default(ajv);
for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema);

function validator(file: string): ValidateFunction {
  const validate = ajv.getSchema(BASE + file);
  if (!validate) throw new Error(`schema ${file} is not published`);
  return validate;
}

export const validateSnapshot = validator('snapshot.schema.json');
export const validateItem = validator('context_item.schema.json');
export const validateTrace = validator('trace.schema.json');
export const validateReport = validator('conformance_report.schema.json');

/** Ajv's errors in words: the JSON Pointer of the value, then what is wrong with it. */
export const describeErrors = (errors: ErrorObject[] | null | undefined): string[] =>
  (errors ?? []).filter(error => error.keyword !== 'if')
    .map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}${
      error.keyword === 'additionalProperties' ? `: ${String(error.params['additionalProperty'])}` : ''}`);
