# Working in cwa-assembler-ts

A TypeScript implementation of the CWA draft specification (M13 of the CWA plan). Its target is every conformance case: each case's payload byte for byte and its trace, plus every rejection case rejected. `conformance-report.json` records the result.

## Rules

- **Test-first.** Red, then green, then refactor. Write the failing test, watch it fail for the reason you expect, then make it pass.
- **Commit unasked at each green step.** Don't wait to be asked to commit.
- **Conventional Commits, signed off.** Use `git commit -s` with a Conventional Commits subject (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `build:`).
- **Never push.**
- **Docs change in the same commit as the behavior.** A commit that changes behavior also updates the README, this file, or the code comments that describe it.
- **Prove a test protects something.** Before claiming it does, break the code on purpose and watch the test fail.

## Working from the spec

- Work from the published spec only: the contract vendored in `vendor/cwa/`. Don't read the reference assembler (`../cwa-assembler`).
- Where the spec leaves a behavior open, don't decide it here. Ask the maintainer, fix the spec in the website repo first (with its tests, committed on its `assembler-v0.0.2` branch), re-vendor, then implement.
- `vendor/cwa.lock.json` pins every vendored file by SHA-256, like a lockfile, with the website commit it came from and whether that checkout was dirty. Change vendored files only with `npm run vendor -- <website checkout>`. The tests fail when a vendored file no longer matches its hash, or when a file is added or missing.
- `src/generated/` is generated from the vendored contract by `npm run generate`: `types.ts` holds the TypeScript types json-schema-to-typescript derives from the published schemas, and `contract.ts` embeds the schemas, reasons and slot defaults. Don't edit either by hand; the tests fail when they are stale. Run `npm run generate` after every re-vendor.

- `conformance-report.json` is committed and must be the current run. Rerun `npm run conformance` after any change to the assembler or the vendored contract, and commit the report with the change.
- `src/implementation.ts` names the package in reports. Change it with `package.json`'s name or version; a test holds them together.

## Commands

```sh
npm ci
npm run build          # tsc: dist/ with .js and .d.ts
npm test               # build, then run the tests
npm run vendor -- ../website   # re-vendor the contract from a website checkout
npm run generate       # regenerate src/generated/ from vendor/cwa/
npm run conformance    # run every case and write conformance-report.json
```
