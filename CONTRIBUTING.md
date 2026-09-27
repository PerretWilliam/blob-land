# Contributing

This is a solo project under an MIT license, open to outside contributions.

## Local setup

```bash
pnpm install
pnpm --filter @blob-land/api db:apply   # local D1 schema
pnpm dev                                # API worker, its world-step ticker, and the desktop app
```

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `ci: ...`. A commit-msg hook (husky + commitlint) rejects messages that don't match — this is what keeps the changelog Changesets generates readable.

## Before opening a PR

1. Run the tests that apply to what you changed: `pnpm sim:test` and/or `pnpm api:test`.
2. If your change affects `packages/sim`, `apps/api`, or `apps/desktop` in a way users or consumers should see in a changelog, add a changeset: `pnpm changeset`, follow the prompts, and commit the generated file in `.changeset/` alongside your change.
3. Keep commit messages conventional (see above); the commit-msg hook will catch violations locally.
