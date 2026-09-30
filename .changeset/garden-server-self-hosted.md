---
"@blob-land/api": minor
---

The garden's server can now be hosted by anyone: it runs as a Docker container on Postgres (`docker compose up` in `apps/api`), and as many copies as needed can share one garden. Answers are gzipped and the garden loads faster under many players at once.

When a pseudo is taken, the names suggested instead now always fit the 16 characters a pseudo may have.
