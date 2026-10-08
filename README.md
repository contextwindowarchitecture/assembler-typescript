# @contextwindowarchitecture/assembler

A TypeScript assembler for the [Context Window Architecture](https://contextwindowarchitecture.io) (CWA) draft specification. It admits candidate items, resolves declared conflicts, fits them to a token budget, renders the payload and emits the trace.

Status: in development (M13). It passes all 65 published conformance cases byte for byte and rejects all 25 rejection snapshots.

## Install

```sh
pnpm add @contextwindowarchitecture/assembler
```

## Use

```ts
import { assemble, SnapshotRejectedError } from '@contextwindowarchitecture/assembler';

const { payload, trace } = assemble(snapshot);
// payload: the rendered UTF-8 bytes, or null when the assembly is refused (trace.refused.reason says why)
```

`assemble(snapshot, options?)` takes a snapshot in the shape of `schema/snapshot.schema.json`: the frozen assembly input (R-23). It runs admission, conflict resolution, supersession, deduplication, the source diversity cap, the refusal checks and fitting, as `conformance/README.md` defines them. It returns the payload and a trace valid against `schema/trace.schema.json`.

- A snapshot that fails its schemas or the snapshot checks throws `SnapshotRejectedError`, with its `problems` in words. There is no payload and no trace (R-17). `checkSnapshot(snapshot)` returns the same problems without assembling.
- A snapshot that names a tokenizer or renderer this package does not provide throws `UnsupportedComponentError`. The package provides the tokenizers `fixture-whitespace/v1` and `estimate-utf8/v1` and the renderers `fixture-xml/v1` and `cwa-messages/v1`, every one `conformance/README.md` requires, and the optional renderer `cwa-message-blocks/v1`. That renderer writes the request `cwa-messages/v1` writes, except that the user message's content is one `{id, text}` entry per item placed with an `xml:` wrap, so an application can put a prompt cache breakpoint at any item boundary. It counts each entry on its own, so with a tokenizer such as `estimate-utf8/v1`, which rounds each text up, the same items can count more than under `cwa-messages/v1` and fewer of them fit. Pass your model's tokenizer as `options.tokenizers`, keyed by the ID your snapshots name. A tokenizer or renderer is found only as an own key, of the package's tables or of `options.tokenizers`, so an ID such as `toString` or `__proto__` is not provided unless you pass it as a key of your own. Route producers are looked up the same way: a batch's producer is listed only when it is an own key of `route_policy.producers`.
- That ID must be one no published tokenizer uses, so that a trace naming a published tokenizer always means its published count (R-16). When `options.tokenizers` names a tokenizer `conformance/README.md` publishes, today `fixture-whitespace/v1` or `estimate-utf8/v1`, `assemble()` throws `PublishedTokenizerIdError` with those IDs in `ids`, even when the snapshot names another tokenizer. It stops before assembly, and before it checks the snapshot: there is no payload and no trace. R-16 says the same of a renderer under a published ID, today `fixture-xml/v1`, `cwa-messages/v1` or the optional `cwa-message-blocks/v1`, and here it holds with nothing to check: the package takes no renderer of the application's own. `AssembleOptions` has no renderers, and a snapshot's `renderer` must name `fixture-xml/v1`, `cwa-messages/v1` or `cwa-message-blocks/v1`, so a trace naming a published renderer always means its published rendering. The exported tables are frozen: assigning into `TOKENIZERS` throws a `TypeError` rather than replacing a published tokenizer, and so does changing `RENDERERS`.
- `options.traceId` sets the trace id, which is otherwise a random UUID. `trace.timings` records each stage's duration in milliseconds. Both may differ between runs of the same snapshot (R-23); everything else, the payload bytes included, is deterministic.

## Requirements

Node.js 22 or newer. The package is ESM only and compiled with `tsc` to JavaScript and `.d.ts` files in `dist/`.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm test
```

pnpm is the package manager. `packageManager` in `package.json` pins its version, which pnpm switches to by itself, and `pnpm-lock.yaml` pins every dependency. CI (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile` and `pnpm test` on Node 22 and 24.

## Cost

Every reduction under budget pressure is its own fit test, and every fit test renders and counts the whole payload (conformance/README.md, Fitting). A fit test counts only the payload; per-item counts are made once, for the trace. Shedding 498 of 500 passages of about 180 tokens each takes about a third of a second, nearly all of it tokenizing. Keep the cost down at the source, as the spec advises: send no more passages than the route's budget can use, and bound slots with `max_per_source` or `max_tokens`.

## Conformance

```sh
pnpm run conformance
```

This runs every vendored case and rejection snapshot as `conformance/README.md` describes. It writes `conformance-report.json`, valid against `schema/conformance_report.schema.json`, and exits 1 unless every case passed and every rejection snapshot was rejected. A case passes only when its payload matches byte for byte and its trace matches field for field, except `trace_id`, `timings` and `recovery.detail`, which is free text for people. The report's `contract` member names the repository and commit the cases came from, and whether that checkout was dirty, taken from `vendor/cwa.lock.json`: the specification repository, `contextwindowarchitecture/contextwindowarchitecture`. The committed report is the current run: a test fails when it goes stale. `runConformance(dir)` in `src/conformance.ts` does the same from code. Every implementation provides the four tokenizers and renderers `conformance/README.md` requires, the ones it lists before Optional, and this package does. It also provides the optional `cwa-message-blocks/v1`, so it skips no published case. A case is skipped only when its snapshot names an optional tokenizer or renderer, one the README does not require, that this package does not provide; a case that uses only required ones is never skipped, and an implementation that lacks one fails it. A rejection snapshot is skipped only when it names an optional renderer this package lacks and the check it breaks is that renderer's. Every other check runs before a renderer is needed and no check needs a tokenizer, so such a snapshot is rejected whatever it names, and one that breaks no check fails even when its tokenizer is missing. `componentOutcome()` makes the decision, and a test runs it against an implementation made to lack a required component, which no published case can reach.

## The contract

`vendor/cwa/` holds the published contract this implementation follows: the schemas, the contract data and the conformance cases, copied from the specification repository, [contextwindowarchitecture/contextwindowarchitecture](https://github.com/contextwindowarchitecture/contextwindowarchitecture), the contract's source (`pnpm run vendor <specification checkout>`). `vendor/cwa.lock.json` pins each file by SHA-256 and records the repository and the spec commit. It is Apache-2.0 licensed; see `vendor/cwa/LICENSE` and `vendor/cwa/NOTICE`.

## Publishing

`pnpm publish` publishes with public access (`publishConfig`). `prepublishOnly` runs the tests and a fresh build first, so a failing or stale `dist/` is never published. The tarball holds `dist/`, `LICENSE`, `NOTICE`, `README.md` and `package.json`.

Each tag gets a GitHub release once CI passes on the tagged commit (`.github/workflows/release.yml`); it publishes nothing to npm. Its notes name the specification repository and commit `vendor/cwa.lock.json` pins and list the tag's own commits, written by git-cliff (`cliff.toml`). A tag that is not `vX.Y.Z` is a prerelease, and a tag pushed before the workflow existed is released with `gh workflow run release.yml -f tag=<tag>`.

See [AGENTS.md](AGENTS.md) for the working rules.

## License

Apache License 2.0, the same as the specification: see [LICENSE](LICENSE) and [NOTICE](NOTICE). The package embeds the published schemas and contract data, and `vendor/cwa/` holds the conformance cases, all from the Apache-2.0 specification.
