# @cwa/assembler

A TypeScript assembler for the [Context Window Architecture](https://contextwindowarchitecture.io) (CWA) draft specification. It admits candidate items, resolves declared conflicts, fits them to a token budget, renders the payload and emits the trace.

Status: in development (M13). Its target is every published conformance case.

## Requirements

Node.js 22 or newer. The package is ESM only and compiled with `tsc` to JavaScript and `.d.ts` files in `dist/`.

## Development

```sh
npm ci
npm run build
npm test
```

## The contract

`vendor/cwa/` holds the published contract this implementation follows: the schemas, the contract data and the conformance cases, copied from the website repository. `vendor/cwa.lock.json` pins each file by SHA-256 and records the website commit. It is Apache-2.0 licensed; see `vendor/cwa/LICENSE` and `vendor/cwa/NOTICE`.

See [AGENTS.md](AGENTS.md) for the working rules.
