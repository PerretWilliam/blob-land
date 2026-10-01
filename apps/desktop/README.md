# @blob-land/desktop

Tauri + React desktop client: renders the local blob and the public garden, and talks to `@blob-land/api`.

```bash
pnpm --filter @blob-land/desktop dev   # or `pnpm dev` at the root, with the API
pnpm --filter @blob-land/desktop build
```

In `dev`, a **Dev** box in the corner of the scenes tunes them live: time speed (pause to 100x), the sky's daylight, blob size, reduced motion. It's `src/components/dev-panel.tsx`, backed by `src/lib/dev.ts`, and is left out of builds. In the garden, the speed buttons (1x to 100x) ask the API to run its clock faster (needs `DEV_TOOLS=1`, and it can't go back in time). **Reset everything** wipes the API's database, this device's blob and island, and seeds a fresh garden: back to zero.
