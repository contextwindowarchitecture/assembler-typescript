# @contextwindowarchitecture/assembler

A TypeScript assembler for the [Context Window Architecture](https://contextwindowarchitecture.io) (CWA) draft specification. It admits candidate items, resolves declared conflicts, fits them to a token budget, renders the payload and emits the trace.

Status: in development (M13). It passes all 50 published conformance cases byte for byte and rejects all 22 rejection snapshots.

## Install

```sh
npm install @contextwindowarchitecture/assembler
```

## Use

```ts
import { assemble, SnapshotRejectedError } from '@contextwindowarchitecture/assembler';

const { payload, trace } = assemble(snapshot);
// payload: the rendered UTF-8 bytes, or null when the assembly is refused (trace.refused.reason says why)
```

`assemble(snapshot, options?)` takes a snapshot in the shape of `schema/snapshot.schema.json`: the frozen assembly input (R-23). It runs admission, conflict resolution, supersession, deduplication, the source diversity cap, the refusal checks and fitting, as `conformance/README.md` defines them. It returns the payload and a trace valid against `schema/trace.schema.json`.

- A snapshot that fails its schemas or the snapshot checks throws `SnapshotRejectedError`, with its `problems` in words. There is no payload and no trace (R-17). `checkSnapshot(snapshot)` returns the same problems without assembling.
- A snapshot that names a tokenizer or renderer this package does not provide throws `UnsupportedComponentError`. The package provides the tokenizers `fixture-whitespace/v1` and `estimate-utf8/v1` and the renderers `fixture-xml/v1` and `cwa-messages/v1`. Pass your model's tokenizer as `options.tokenizers`, keyed by the ID your snapshots name.
- `options.traceId` sets the trace id, which is otherwise a random UUID. `trace.timings` records each stage's duration in milliseconds. Both may differ between runs of the same snapshot (R-23); everything else, the payload bytes included, is deterministic.

## Requirements

Node.js 22 or newer. The package is ESM only and compiled with `tsc` to JavaScript and `.d.ts` files in `dist/`.

## Development

```sh
npm ci
npm run build
npm test
```

## Cost

Every reduction under budget pressure is its own fit test, and every fit test renders and counts the whole payload (conformance/README.md, Fitting). A fit test counts only the payload; per-item counts are made once, for the trace. Shedding 498 of 500 passages of about 180 tokens each takes about a third of a second, nearly all of it tokenizing. Keep the cost down at the source, as the spec advises: send no more passages than the route's budget can use, and bound slots with `max_per_source` or `max_tokens`.

## Conformance

```sh
npm run conformance
```

This runs every vendored case and rejection snapshot as `conformance/README.md` describes. It writes `conformance-report.json`, valid against `schema/conformance_report.schema.json`, and exits 1 unless every case passed and every rejection snapshot was rejected. A case passes only when its payload matches byte for byte and its trace matches field for field, except `trace_id` and `timings`. The committed report is the current run: a test fails when it goes stale. `runConformance(dir)` in `src/conformance.ts` does the same from code. A case is skipped when its snapshot names a tokenizer or renderer this package does not provide. A rejection snapshot is skipped only when it names a renderer this package lacks and the check it breaks is the renderer's; every other check runs before a renderer is needed, so the snapshot is rejected whatever it names.

## The contract

`vendor/cwa/` holds the published contract this implementation follows: the schemas, the contract data and the conformance cases, copied from the website repository. `vendor/cwa.lock.json` pins each file by SHA-256 and records the website commit. It is Apache-2.0 licensed; see `vendor/cwa/LICENSE` and `vendor/cwa/NOTICE`.

## Publishing

`npm publish` publishes with public access (`publishConfig`). `prepublishOnly` runs the tests and a fresh build first, so a failing or stale `dist/` is never published. The tarball holds `dist/`, `LICENSE`, `NOTICE`, `README.md` and `package.json`.

See [AGENTS.md](AGENTS.md) for the working rules.

## License

Apache License 2.0, the same as the specification: see [LICENSE](LICENSE) and [NOTICE](NOTICE). The package embeds the published schemas and contract data, and `vendor/cwa/` holds the conformance cases, all from the Apache-2.0 specification.
