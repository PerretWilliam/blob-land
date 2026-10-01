# @blob-land/desktop

Tauri + React desktop client: renders the local blob and the public garden, and talks to `@blob-land/api`.

```bash
pnpm --filter @blob-land/desktop dev   # or `pnpm dev` at the root, with the API
pnpm --filter @blob-land/desktop build
```

In `dev`, a **Dev** box in the corner of the scenes tunes them live: time speed (pause to 100x), the sky's daylight, blob size, reduced motion. It's `src/components/dev-panel.tsx`, backed by `src/lib/dev.ts`, and is left out of builds. Past 1x the garden runs out of the timeline the server sent: run it ahead with `TIME_SCALE` on the API instead.
