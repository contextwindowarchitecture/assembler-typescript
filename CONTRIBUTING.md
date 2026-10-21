# Contributing to the TypeScript assembler

This package implements the [Context Window Architecture](https://contextwindowarchitecture.io) draft specification. The specification lives in its own repository, [contextwindowarchitecture/contextwindowarchitecture](https://github.com/contextwindowarchitecture/contextwindowarchitecture). If a change alters what an assembler must do, it starts there, and this repository follows.

[AGENTS.md](AGENTS.md) holds the full rules. Coding agents and people follow the same ones. This page is the short version.

## Set up

You need Node.js 22 or newer, and pnpm. `packageManager` in `package.json` pins pnpm's version, which pnpm switches to by itself, and `pnpm-lock.yaml` pins every dependency. Don't use npm here, because a test fails when a script calls it or a `package-lock.json` appears.

```sh
pnpm install --frozen-lockfile
pnpm run build          # tsc: dist/ with .js and .d.ts
pnpm test               # build, then run every test; it must pass before every commit
pnpm run quickstart     # run examples/quickstart.ts
```

## How changes are made

**Test first.** Every behavior change starts with a test that fails for the reason you expect. Next comes the least code that makes it pass, then cleanup with the suite green. Before claiming a test protects something, break the code on purpose and watch the test fail.

**Work from the published spec only**, meaning the contract vendored in `vendor/cwa/`. Where the spec leaves a behavior open, don't decide it here. Fix the spec in the specification repository first, re-vendor, then implement.

**Documentation moves with the code.** A commit that changes behavior also updates the TSDoc of the API it changes, and the README section a caller would read. The README is written for application developers. Keep its Status section to a few sentences.

## Commits

- One step per commit, and every commit passes `pnpm test`. When you pipe its output, run `set -o pipefail` first, or a failing run looks green.
- Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `build:`), and sign off every commit (`git commit -s`).

## Conformance

```sh
pnpm run conformance
```

This runs every vendored case and rejection snapshot as the specification's `conformance/README.md` describes. It writes `conformance-report.json`, valid against `schema/conformance_report.schema.json`, and exits 1 unless every case passes and every rejection snapshot is rejected.

- **What counts as a pass.** A case passes only when its payload matches byte for byte and its trace matches field for field. The exceptions are `trace_id`, `timings` and `recovery.detail`, which is free text for people.
- **Where the cases come from.** The report's `contract` member, taken from `vendor/cwa.lock.json`, names the repository and commit the cases came from, and whether that checkout was dirty.
- **Keep the report current.** The committed report must be the current run, and a test fails when it goes stale. Rerun after any change to the assembler or the vendored contract, and commit the report with the change. `runConformance(dir)` in `src/conformance.ts` does the same from code.
- **Missing components.** `componentOutcome()` decides what happens when a case needs a component this package lacks. A case is skipped only when every tokenizer or renderer it needs and this package lacks is optional. A case that uses only required ones is never skipped. A rejection snapshot is skipped only when it names an optional renderer this package lacks and the check it breaks is that renderer's own. This package provides every published tokenizer and renderer, so it skips nothing today.
- **Cases not passing yet.** A case this package doesn't pass yet goes in `PENDING` in `test/cases.ts`, and that list only shrinks.

## The contract

`vendor/cwa/` holds the published contract: schemas, contract data and conformance cases, copied from the specification repository. `vendor/cwa.lock.json` pins each file by SHA-256 and records the repository and the spec commit.

```sh
pnpm run vendor ../contextwindowarchitecture   # re-vendor from a specification checkout
pnpm run generate                              # regenerate src/generated/ from vendor/cwa/
```

Change vendored files only through `pnpm run vendor`. Run `pnpm run generate` after every re-vendor, and never edit `src/generated/` by hand. The tests fail on a vendored file that doesn't match its hash, and on generated files that are stale.

## Performance

Every reduction under budget pressure is its own fit test, and every fit test renders and counts the whole payload (conformance/README.md, Fitting). A fit test counts only the payload; per-item counts are made once, for the trace. Shedding 498 of 500 passages of about 180 tokens each takes about a third of a second, nearly all of it tokenizing.

## CI, releases and publishing

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs `pnpm install --frozen-lockfile` and `pnpm test` on Node 22 and 24. The tests also check the vendored contract against its lock, and check that the generated files and the committed conformance report are current.

Each tag gets a GitHub release once CI passes on the tagged commit ([.github/workflows/release.yml](.github/workflows/release.yml)). The release publishes nothing to npm. Its notes name the specification repository and commit that `vendor/cwa.lock.json` pins, and list the tag's own commits, written by git-cliff (`cliff.toml`). A tag that isn't `vX.Y.Z` is a prerelease. A tag pushed before the workflow existed is released with `gh workflow run release.yml -f tag=<tag>`.

`pnpm publish` publishes to npm with public access (`publishConfig`). `prepublishOnly` runs the tests and a fresh build first, so a failing or stale `dist/` is never published. The tarball holds only the modules the package's exports reach, as `.js` and `.d.ts` in `dist/`, plus `LICENSE`, `NOTICE`, `README.md` and `package.json`. `.npmignore` keeps out everything else, including the conformance CLI, the examples and source maps. `package.json` has no `files` list, because npm and pnpm ignore a root `.npmignore` when it does. A test packs the package and fails on any other file, or on a reached module that is missing.
