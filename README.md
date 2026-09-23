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

See [AGENTS.md](AGENTS.md) for the working rules.
