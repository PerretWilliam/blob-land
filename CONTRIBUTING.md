# Contributing

Thanks for wanting to help Blob Land grow. It's a solo project, open to outside contributions: bug fixes, performance, art, new things for blobs to do.

Before the how, the why. Blob Land is a small, gentle world, and the easiest way to hurt it is with a feature that works well but doesn't belong. So every change, code or art, is held to the rules below.

## The Blob Land way

These are the game's rules. A pull request that breaks one won't be merged, however well it's made. If you think a rule should change, open an issue and make the case there first.

### 1. Blobs live their own lives

A blob decides for itself when to sleep, where to wander, who to meet and how it goes. The player watches, cares and shapes the world around it (their island, their blob's identity), but never steers the blob. No "go there", "talk to them" or "fall in love" buttons.

### 2. Being away never hurts

Blob Land is something you come back to, not something you have to keep up with. No streaks, no daily rewards, no timers that punish a player for closing the app, no nagging notifications. A blob left alone for a week is fine, and has stories to tell.

### 3. Kind by design

Players never reach each other directly: no chat, no messages, no player-to-player trading or attacking. Blobs meet blobs, and that's where the social life happens. Blobs can argue, sulk, break up and become rivals, because a world without friction isn't believable, but nothing a player does can be aimed at another player.

### 4. No money in the garden

Nothing in the game is for sale. No ads, no premium currency, no loot boxes, no paid cosmetics, no way to pay for a better blob. Every player plays the same game.

### 5. A blob is its name

A blob's look comes from its name, through [blobatar](https://blobatar.dev), and never changes. No skins, no editors that override it, no rerolls. Names are short (16 characters) and unique across the garden.

### 6. Believable, never scripted

What happens in the garden comes from the simulation: rolled with real randomness, kept believable by structure (moods, energy, relationships that move a little at a time). No hand-written events, no drama forced for effect. Everyone watching the garden sees the same thing, because the server decides and the clients only play it back.

### 7. Your island is yours, offline

The private island works with no account and no connection, and always will. The garden is an invitation, not a gate. Anything online must fail kindly: tell the player what's wrong and what to do, in plain words.

### 8. Everyone's welcome

A blob's sex and who it's drawn to are the player's choice, and neither decides what a blob can do or how it behaves. Keep the words and pictures gentle and suitable for all ages.

### 9. It looks like one world

New art matches the sprite pack: flat bright colours, thick ink outlines, isometric. The interface matches the art: the cartoon theme in `apps/desktop/src/index.css` (the `.toon` cards, the ink-outlined buttons, the Fredoka lettering), not a new style next to it.

### 10. Light enough for any laptop

The app keeps its frame rate with a full island on a modest machine. Changes to the world's drawing or the simulation are measured against the targets in [docs/PERFORMANCE.md](docs/PERFORMANCE.md), with the bench described there.

## Where to start

- **Found a bug?** [Open a bug report](https://github.com/PerretWilliam/blob-land/issues/new?template=bug_report.yml).
- **Have an idea?** [Suggest a feature](https://github.com/PerretWilliam/blob-land/issues/new?template=feature_request.yml), or talk it through first in [Discussions](https://github.com/PerretWilliam/blob-land/discussions).
- **Think a rule of the game should change?** [Propose it](https://github.com/PerretWilliam/blob-land/issues/new?template=rule_change.yml) before writing any code.
- **Found a security problem?** Don't open an issue: see [SECURITY.md](SECURITY.md).
- **Want to write code?** Issues labelled [good first issue](https://github.com/PerretWilliam/blob-land/labels/good%20first%20issue) are a gentle way in. Say on the issue that you're taking it, so no one else does the same work.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Local setup

```bash
pnpm install
pnpm --filter @blob-land/api db:apply   # local D1 schema
pnpm dev                                # API worker, its world-step ticker, and the desktop app
```

The code is organised in three packages: see the [README](README.md#how-its-built), and [docs/DECISIONS.md](docs/DECISIONS.md) for why things are the way they are.

## Writing it

- Code, comments, commit messages and docs are in English.
- Match what's around it: its naming, its comments, its idioms. The simplest change that works is the best one.
- The interface talks to players, not developers: errors say what happened and what to do, in plain words.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `ci: ...`. A commit-msg hook (husky + commitlint) rejects messages that don't match; this is what keeps the changelog Changesets generates readable.

## Before opening a PR

1. Run `pnpm typecheck` and `pnpm test` (CI runs both on every pull request).
2. If your change affects `packages/sim`, `apps/api`, or `apps/desktop` in a way users or consumers should see in a changelog, add a changeset: `pnpm changeset`, follow the prompts, and commit the generated file in `.changeset/` alongside your change.
3. Keep commit messages conventional (see above); the commit-msg hook will catch violations locally.
4. Say in the PR which of the rules above your change touches, if any, and how it keeps to them.

## License

By contributing, you agree that your contribution is licensed under the [Blob Land license](LICENSE). New third-party code, art or fonts go in [CREDITS.md](CREDITS.md), with their license, in the same PR.
