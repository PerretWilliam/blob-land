# Blob

Desktop app (Tauri) around a blob avatar (blobatar.dev) that lives an autonomous,
simulated life, with a private layer and a public garden.

## Language

All code, comments, commit messages, and docs in this repo are in **English**,
regardless of the language the conversation happens in.

## Structure

- `apps/desktop` — Tauri + React/Vite/TS
- `apps/api` — Cloudflare Worker (Hono) + D1
- `packages/sim` — pure TS simulation engine, shared desktop ↔ worker
