---
"@blob-land/api": minor
---

A local dev garden can run faster than real time: set `TIME_SCALE` in `.dev.vars`. `/garden` now returns the clock's `rate` next to `now`, and every garden time (timelines, births, relationships, family trees, the world step) follows that clock.
