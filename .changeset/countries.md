---
"@blob-land/sim": minor
"@blob-land/api": minor
"@blob-land/desktop": minor
---

Players can say which country they're from, or not: an optional country (ISO 3166-1 alpha-2) at sign-up (`/auth/register`) or from their blob's ID card (`PATCH /me/country`, null to drop it). `/garden` returns it, and the garden shows its flag next to the blob's name and on its ID card. Local databases need `ALTER TABLE users ADD COLUMN country TEXT`.
