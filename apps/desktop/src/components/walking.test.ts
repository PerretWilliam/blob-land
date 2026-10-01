import { seededRng, type Segment } from "@blob-land/sim";
import { expect, it } from "vitest";
import { gardenIsland } from "@/lib/world-gen";
import { expressionNamed, targets, type SceneBlob } from "./scene";

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 1, 12);

// On the garden's big island, lakes, cliffs and rivers lie between a blob and
// where it's going: it must walk round them at a walking pace, never dash.
it("walks round the garden's obstacles at a pace that stays a stroll", () => {
  const size = 128;
  const layout = gardenIsland(size);
  const zoom = size / 8;
  const rng = seededRng(7);
  const activities = ["rest", "explore", "discover", "explore"] as const;
  const blobs: SceneBlob[] = Array.from({ length: 20 }, (_, n) => {
    let start = T0;
    const segments: Segment[] = Array.from({ length: 8 }, () => {
      const end = start + (10 + rng() * 40) * MIN;
      const seg: Segment = { start, end, activity: activities[Math.floor(rng() * activities.length)]!, expression: "idle", x: 0.1 + rng() * 0.8, y: 0.1 + rng() * 0.8, rng: Math.floor(rng() * 2 ** 32), with: null, detail: null };
      start = end;
      return seg;
    });
    return { seed: `b${n}`, label: `b${n}`, segments, expression: expressionNamed("idle"), activity: "rest", sex: "none", attraction: "any" };
  });

  let fastest = 0;
  let prev = targets(layout, blobs, T0);
  for (let s = 1; s < 3 * 3600; s++) {
    const now = targets(layout, blobs, T0 + s * 1000);
    now.forEach((p, i) => (fastest = Math.max(fastest, Math.hypot(p.x - prev[i]!.x, p.y - prev[i]!.y) * zoom)));
    prev = now;
  }
  // Ground units a second, per tile of a small island: a stroll is 0.02, a hurry to a meeting 0.1.
  expect(fastest).toBeLessThan(0.15);
}, 60_000);
