import { randomRng } from "@blob-land/sim";
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { advanceRegion } from "./garden";

/**
 * One region's writer: each region steps in its own object, with its own
 * time and CPU budget, so the cron run only fans out and the garden can
 * hold as many regions as it likes.
 */
export class Region extends DurableObject<Env> {
  // One step at a time: a run that overruns the next cron never has two
  // steps roll the same stretch of time differently.
  private running: Promise<void> = Promise.resolve();

  step(region: number, now: number, until: number): Promise<void> {
    const run = this.running.then(() => advanceRegion(this.env.DB, region, now, randomRng, until));
    this.running = run.catch(() => {});
    return run;
  }
}
