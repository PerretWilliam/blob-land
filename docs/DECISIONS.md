# Decisions

Lightweight log of decisions already made, one paragraph each. This is a flat list, not a changelog.

## Local-first before account

The app is usable with zero network calls and no account: on first launch, picking a pseudo creates a local blob (seed, simulated state, journal) entirely offline. "Join the garden" is a separate, explicit action, not a gate the user has to pass before seeing their blob.

## Children are first-class blobs, not sub-records of their parents

A child born from a union gets its own row in the `blobs` table, addressable and displayable independently of the union or its parents. There's no ownership relationship — a child isn't "attached" to an account.

## A union ends at birth, not through a separate action

`unions.ended_at` is set in the same write as the child's birth. There is no `/unions/end` endpoint and no concept of a union ending for any other reason in this version — the model doesn't have a "breakup," only a birth that closes the union.

## UTC everywhere

All timestamps are epoch milliseconds, and all day-boundary logic (schedules, presence windows, deterministic daily rolls) operates in UTC. This keeps `packages/sim`'s output identical on the desktop client and the Worker regardless of the user's local timezone.

## 24-hour presence window

A user counts as "present" (eligible for pairing) if their `last_seen_at` is within the last 24 hours. The desktop client pings the API every 60 seconds while open, which comfortably keeps an active user inside that window without needing a persistent connection.

## Account seed can differ from the local blob's seed

A collision on the pseudo used for the private, local-only blob shouldn't block joining the garden. When the exact local pseudo is already registered as an account, the API suggests deterministic variants (`pseudo2`, `pseudo3`, ...) and the user picks one for the account only. The private blob keeps its original seed unchanged — the two are shown as visually distinct blobs, the account presented as a "sprout" of the private one, not a synchronized copy.
