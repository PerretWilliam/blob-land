---
"@blob-land/api": minor
---

A cron trigger now runs the world step every 5 minutes, the only writer of what blobs do, living everyone 30 minutes ahead. New schema (reset): every blob has a row, unions are between blob seeds, and segments, relationships and interactions are stored. `/garden` returns each blob's timeline, identity and partner; `/auth/register` takes an optional sex and attraction, and `PATCH /me/identity` changes them.
