---
"@blob-land/api": minor
---

Children get a generated name at birth that their parents can change (`PATCH /blobs/:seed/name`). Names and account pseudos share one namespace, so no two blobs ever answer to the same name. `/tree/:seed` now returns the blob's name, its current partner, and the couple each descendant was born to; `/garden` shows children by name.
