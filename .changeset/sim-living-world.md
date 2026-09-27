---
"@blob-land/sim": major
---

Blobs now live at random instead of by formula. `stepWorld` rolls each blob's timeline forward as stored segments (sleep, wake, rest, explore, discover, meet), with allowed transitions, minimum durations, energy and mood so the randomness stays believable. Meetings pick an interaction the relationship allows (rivals never hug), shift friendship, romance and tension by a capped step, and a per-pair chemistry makes every pair its own story. Couples form from mutual attraction and break up; children are born, grow up and can fall in love too. Adds sex and attraction (`Identity`), personalities, and playback helpers (`positionOn`, `legIn`, `segmentAt`). Removes `stateAt`, `positionAt`, `legAt`, `journal`, `loveChance` and `hash01`.
