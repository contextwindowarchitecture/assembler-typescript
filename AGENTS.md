# Working in assembler-typescript

A TypeScript implementation of the CWA draft specification (M13 of the CWA plan). Its target is every conformance case: each case's payload byte for byte and its trace, plus every rejection case rejected. `conformance-report.json` records the result.

## Rules

- **Test-first.** Red, then green, then refactor. Write the failing test, watch it fail for the reason you expect, then make it pass.
- **Commit unasked at each green step.** Don't wait to be asked to commit.
- **Conventional Commits, signed off.** Use `git commit -s` with a Conventional Commits subject (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `build:`).
- **Never push.**
- **Docs change in the same commit as the behavior.** A commit that changes behavior also updates the README, this file, or the code comments that describe it.
- **Prove a test protects something.** Before claiming it does, break the code on purpose and watch the test fail.

## Working from the spec

- Work from the published spec only: the contract vendored in `vendor/cwa/`. Don't read the reference assembler (`../assembler-python`).
- Where the spec leaves a behavior open, don't decide it here. Ask the maintainer, fix the spec in the specification repository (`../contextwindowarchitecture`) first (with its tests, committed on a branch there), re-vendor, then implement.
- `vendor/cwa.lock.json` pins every vendored file by SHA-256, like a lockfile, with the specification repository and commit it came from (`repository`, `spec_commit`) and whether that checkout was dirty: a tracked file differing from the commit, since untracked files don't count. Change vendored files only with `pnpm run vendor <specification checkout>`. The tests fail when a vendored file no longer matches its hash, or when a file is added or missing.
- `src/generated/` is generated from the vendored contract by `pnpm run generate`: `types.ts` holds the TypeScript types json-schema-to-typescript derives from the published schemas, and `contract.ts` embeds the schemas, reasons and slot defaults. Don't edit either by hand; the tests fail when they are stale. Run `pnpm run generate` after every re-vendor.

- Every case under `vendor/cwa/conformance/cases/` and every rejection case under `rejections/` is a test (`test/conformance.test.ts`). One this package does not pass yet goes in `PENDING` in `test/cases.ts`, and the list only shrinks; `test/report.test.ts` lets a pending one appear in the report only as `skipped`, for an optional component this package does not provide yet. A case that uses only the README's required components, the bullets under Tokenizers and renderers before its Optional heading, is never skipped (README, Reporting results).
- `conformance-report.json` is committed and must be the current run. Rerun `pnpm run conformance` after any change to the assembler or the vendored contract, and commit the report with the change.
- pnpm is the package manager. `packageManager` in `package.json` pins its version and `pnpm-lock.yaml` pins every dependency; a test fails when a script calls npm or a `package-lock.json` appears.
- `src/implementation.ts` names the package in reports. Change it with `package.json`'s name or version; a test holds them together.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm run build          # tsc: dist/ with .js and .d.ts
pnpm test               # build, then run the tests
pnpm run vendor ../contextwindowarchitecture   # re-vendor the contract from a specification checkout
pnpm run generate       # regenerate src/generated/ from vendor/cwa/
pnpm run conformance    # run every case and write conformance-report.json
```
